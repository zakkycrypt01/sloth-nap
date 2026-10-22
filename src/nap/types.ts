export type Audience = "notes" | "lease";

export type Chore = {
  task: string;
  ageDays: number;
  minutes: number;
  dread: number;
  skippedLast4: number;
  audience: Audience;
};

export type Forecast = {
  task: string;
  minutes: number;
  skipProbability: number;
  model: string;
};

export type Chunk = {
  id: string;
  text: string;
  audience: Audience;
  source: string;
};

export type ScoredChunk = Chunk & { score: number };

export type ResearchHit = {
  title: string;
  url: string;
  snippet: string;
  pageText: string;
  mode: "live" | "local";
};

export type PartnerMode = {
  partner: string;
  mode: "live" | "local" | "unconfigured";
  detail: string;
};

export type RiskyAction = {
  id: string;
  kind: "archive-notes";
  summary: string;
  status: "pending" | "approved" | "rejected";
};

export type MorningBrief = {
  lines: [string, string];
  doToday: string[];
  leaveForLater: string[];
  pile: ScoredChunk[];
  research: ResearchHit | null;
  docSummary: string;
  forecast: Forecast[];
  risky: RiskyAction;
  model: string;
  minutesSaved: number;
  partners: PartnerMode[];
  createdAt: string;
};

export type Inbox = {
  chores: Chore[];
  notes: { source: string; text: string; audience: Audience }[];
  question: string;
};

export type Span = {
  name: string;
  ms: number;
  mode: string;
  detail?: string;
};
