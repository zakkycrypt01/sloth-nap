import type { Audience, Chunk, ScoredChunk } from "./types.ts";

const DIMS = 32;

export const TIGER_HYBRID_SQL = `
SELECT id, text, source, audience,
  0.6 * (1 - (embedding <=> $1::vector))
  + 0.4 * ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', $2)) AS score
FROM sloth_chunks
WHERE audience = ANY($3::text[])
ORDER BY score DESC
LIMIT $4
`.trim();

export function embed(text: string): number[] {
  const vector = new Array<number>(DIMS).fill(0);
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    let hash = 2166136261;
    for (const char of raw) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
    vector[Math.abs(hash) % DIMS] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function cosine(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function keywordScore(text: string, query: string): number {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  if (words.length === 0) return 0;
  const haystack = text.toLowerCase();
  const hits = words.filter((word) => haystack.includes(word)).length;
  return hits / words.length;
}

export function hybridScore(text: string, query: string): number {
  return 0.6 * cosine(embed(text), embed(query)) + 0.4 * keywordScore(text, query);
}

export function chunkDocument(source: string, text: string, audience: Audience): Chunk[] {
  const pieces = text
    .split(/\n\s*\n/)
    .map((piece) => piece.replace(/\s+/g, " ").trim())
    .filter((piece) => piece.length > 40);
  return pieces.map((piece, index) => ({
    id: `${source}#${index}`,
    text: piece,
    audience,
    source,
  }));
}

export function searchPile(
  chunks: Chunk[],
  query: string,
  permissions: readonly string[],
  limit = 3,
): ScoredChunk[] {
  return chunks
    .filter((chunk) => permissions.includes(`read:${chunk.audience}`))
    .map((chunk) => ({ ...chunk, score: Number(hybridScore(chunk.text, query).toFixed(4)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function vectorLiteral(text: string): string {
  return `[${embed(text).map((value) => value.toFixed(6)).join(",")}]`;
}

type PgClient = {
  query: (sql: string, params: unknown[]) => Promise<{ rows: ScoredChunk[] }>;
  end: () => Promise<void>;
};

/**
 * Tiger Data path. Same hybrid score as the local ranker, executed in Postgres
 * with pgvector. Callers fall back to searchPile when DATABASE_URL is unset.
 */
export async function searchTiger(
  databaseUrl: string,
  chunks: Chunk[],
  query: string,
  permissions: readonly string[],
  limit = 3,
): Promise<ScoredChunk[]> {
  const pg = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl }) as unknown as PgClient;
  await (client as unknown as { connect: () => Promise<void> }).connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector", []);
    await client.query(
      `CREATE TABLE IF NOT EXISTS sloth_chunks (
        id text PRIMARY KEY,
        text text NOT NULL,
        source text NOT NULL,
        audience text NOT NULL,
        embedding vector(32) NOT NULL
      )`,
      [],
    );
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO sloth_chunks (id, text, source, audience, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding`,
        [chunk.id, chunk.text, chunk.source, chunk.audience, vectorLiteral(chunk.text)],
      );
    }
    const audiences = permissions
      .filter((permission) => permission.startsWith("read:"))
      .map((permission) => permission.slice("read:".length));
    const result = await client.query(TIGER_HYBRID_SQL, [
      vectorLiteral(query),
      query,
      audiences,
      limit,
    ]);
    return result.rows;
  } finally {
    await client.end();
  }
}
