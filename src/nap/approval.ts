import { createHmac, timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RiskyAction } from "./types.ts";

export const RISKY_PERMISSION = "approve:risky";

export function localApprovalToken(actionId: string, secret = process.env.APPROVAL_SECRET || "sloth-demo"): string {
  const mac = createHmac("sha256", secret).update(actionId).digest("hex");
  return `local.${actionId}.${mac}`;
}

export function verifyLocalApproval(token: string, actionId: string, secret = process.env.APPROVAL_SECRET || "sloth-demo"): boolean {
  const expected = localApprovalToken(actionId, secret);
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function verifyAuth0Approval(token: string, actionId: string): Promise<boolean> {
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!domain || !audience) return false;
  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  const jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, jwks, {
    audience,
    issuer: `https://${domain}/`,
  });
  const approvedFor = payload["https://slothnap.tech/action"];
  const permissions = payload.permissions;
  const canApprove = Array.isArray(permissions) && permissions.includes(RISKY_PERMISSION);
  return approvedFor === actionId && canApprove;
}

export async function approvalIsValid(token: string | undefined, actionId: string): Promise<boolean> {
  if (!token) return false;
  if (token.startsWith("local.")) return verifyLocalApproval(token, actionId);
  return verifyAuth0Approval(token, actionId);
}

type LedgerEntry = {
  key: string;
  status: "submitted" | "confirmed" | "rejected";
  actionId: string;
};

async function readLedger(outDir: string): Promise<LedgerEntry[]> {
  try {
    const raw = await readFile(path.join(outDir, "intent-ledger.json"), "utf8");
    return JSON.parse(raw) as LedgerEntry[];
  } catch {
    return [];
  }
}

async function writeLedger(outDir: string, entries: LedgerEntry[]): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "intent-ledger.json"), JSON.stringify(entries, null, 2));
}

/**
 * Archive is the one write in the nap. The intent is recorded before the copy.
 * A retry with the same action id sees "confirmed" and does not copy again.
 * A timeout leaves the entry "submitted", which blocks a blind retry.
 */
export async function settleArchive(
  action: RiskyAction,
  notePaths: string[],
  outDir: string,
  token: string | undefined,
): Promise<RiskyAction> {
  const ledger = await readLedger(outDir);
  const key = `archive:${action.id}`;
  const existing = ledger.find((entry) => entry.key === key);
  if (existing?.status === "confirmed") {
    return { ...action, status: "approved" };
  }
  if (existing?.status === "submitted") {
    return { ...action, status: "pending" };
  }
  const allowed = await approvalIsValid(token, action.id);
  if (!allowed) {
    return { ...action, status: "pending" };
  }
  ledger.push({ key, status: "submitted", actionId: action.id });
  await writeLedger(outDir, ledger);
  const archiveDir = path.join(outDir, "archived");
  await mkdir(archiveDir, { recursive: true });
  for (const notePath of notePaths) {
    await copyFile(notePath, path.join(archiveDir, path.basename(notePath)));
  }
  const confirmed = ledger.map((entry) => (entry.key === key ? { ...entry, status: "confirmed" as const } : entry));
  await writeLedger(outDir, confirmed);
  return { ...action, status: "approved" };
}
