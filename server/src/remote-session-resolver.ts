import type { FastifyRequest } from "fastify";
import { fetchClaudeAiJson } from "./claude-ai-proxy.js";
import type { ClientInfo, PinnedSession, RemoteControlState } from "./state.js";

export interface ResolveRemoteSessionInput {
  state: RemoteControlState;
  req: FastifyRequest;
  remote?: string;
  url?: string;
  client?: string;
}

export interface RemoteSessionCandidate {
  client: string;
  sessionId: string;
  cwd?: string;
  name?: string;
  title?: string;
  running?: boolean;
  score: number;
  reasons: string[];
  source: "pinned" | "known";
  claudeAiSessionId?: string;
  controlSessionId?: string;
  sessionUrl?: string;
}

export interface ResolveRemoteSessionResult {
  claudeAiSessionId: string;
  controlSessionId: string;
  sessionUrl: string;
  claudeAiSession?: unknown;
  exact?: RemoteSessionCandidate;
  candidates: RemoteSessionCandidate[];
  resolved: boolean;
  ambiguous: boolean;
}

interface ClaudeAiSessionMetadata {
  id?: string;
  title?: string;
  updated_at?: string;
  created_at?: string;
  session_context?: {
    cwd?: string;
    outcomes?: Array<{ git_info?: { repo?: string; branches?: string[] } }>;
    sources?: Array<{ url?: string; revision?: string }>;
  };
  tags?: string[];
}

export async function resolveRemoteSession(input: ResolveRemoteSessionInput): Promise<ResolveRemoteSessionResult> {
  const claudeAiSessionId = extractClaudeAiSessionId(input.remote ?? input.url);
  if (!claudeAiSessionId) throw Object.assign(new Error("remote session id or claude.ai/code URL required"), { statusCode: 400 });
  const controlSessionId = toControlSessionId(claudeAiSessionId);
  const sessionUrl = `https://claude.ai/code/${claudeAiSessionId}`;
  const clients = input.client ? [input.state.getClient(input.client)].filter(Boolean) as ClientInfo[] : input.state.listClients();

  const direct = findDirectMappings(clients, { claudeAiSessionId, controlSessionId, sessionUrl });
  if (direct.length > 0) return rankedResult({ claudeAiSessionId, controlSessionId, sessionUrl, candidates: direct, claudeAiSession: undefined });

  const claudeAiSession = await fetchClaudeAiJson(input.req, { method: "GET", upstreamPath: `/v1/sessions/${claudeAiSessionId}` }) as ClaudeAiSessionMetadata;
  const candidates = rankKnownSessionCandidates(clients, claudeAiSession, { claudeAiSessionId, controlSessionId, sessionUrl });
  return rankedResult({ claudeAiSessionId, controlSessionId, sessionUrl, candidates, claudeAiSession });
}

function rankedResult(input: { claudeAiSessionId: string; controlSessionId: string; sessionUrl: string; candidates: RemoteSessionCandidate[]; claudeAiSession?: unknown }): ResolveRemoteSessionResult {
  const candidates = input.candidates.sort((a, b) => b.score - a.score).slice(0, 10);
  const top = candidates[0];
  const second = candidates[1];
  const resolved = Boolean(top && top.score >= 12 && (!second || top.score - second.score >= 3));
  return {
    claudeAiSessionId: input.claudeAiSessionId,
    controlSessionId: input.controlSessionId,
    sessionUrl: input.sessionUrl,
    claudeAiSession: input.claudeAiSession,
    exact: resolved ? top : undefined,
    candidates,
    resolved,
    ambiguous: Boolean(top && !resolved),
  };
}

function findDirectMappings(clients: ClientInfo[], ids: { claudeAiSessionId: string; controlSessionId: string; sessionUrl: string }): RemoteSessionCandidate[] {
  const out: RemoteSessionCandidate[] = [];
  for (const client of clients) {
    for (const session of client.pinnedSessions) {
      if (
        session.claudeAiSessionId === ids.claudeAiSessionId ||
        session.controlSessionId === ids.controlSessionId ||
        session.sessionUrl === ids.sessionUrl
      ) {
        out.push(candidateFromSession(client.name, session as unknown as Record<string, unknown>, "pinned", 100, ["direct remote id match in pinnedSessions"]));
      }
    }
    for (const raw of client.knownSessions) {
      const session = rawSession(raw);
      if (!session) continue;
      if (
        session.claudeAiSessionId === ids.claudeAiSessionId ||
        session.controlSessionId === ids.controlSessionId ||
        session.sessionUrl === ids.sessionUrl
      ) {
        out.push(candidateFromSession(client.name, session, "known", 95, ["direct remote id match in knownSessions"]));
      }
    }
  }
  return out;
}

function rankKnownSessionCandidates(clients: ClientInfo[], remote: ClaudeAiSessionMetadata, ids: { claudeAiSessionId: string; controlSessionId: string; sessionUrl: string }): RemoteSessionCandidate[] {
  const remoteCwd = remote.session_context?.cwd;
  const remoteTitle = remote.title;
  const remoteUpdated = remote.updated_at ?? remote.created_at;
  const repoNames = new Set<string>();
  for (const outcome of remote.session_context?.outcomes ?? []) {
    const repo = outcome.git_info?.repo;
    if (repo) repoNames.add(repo);
    const base = repo?.split("/").pop();
    if (base) repoNames.add(base);
  }
  for (const source of remote.session_context?.sources ?? []) {
    const url = source.url;
    if (!url) continue;
    repoNames.add(url);
    const base = url.replace(/\.git$/, "").split(/[/:]/).pop();
    if (base) repoNames.add(base);
  }

  const out: RemoteSessionCandidate[] = [];
  for (const client of clients) {
    for (const raw of client.knownSessions) {
      const session = rawSession(raw);
      if (!session?.sessionId) continue;
      const reasons: string[] = [];
      let score = 0;
      const sessionCwd = stringField(session.cwd);
      const sessionTitle = stringField(session.title) ?? stringField(session.name);

      if (remoteCwd && sessionCwd) {
        const cwdScore = pathSimilarity(remoteCwd, sessionCwd);
        if (cwdScore >= 0.95) { score += 14; reasons.push("cwd exact/normalized match"); }
        else if (cwdScore >= 0.75) { score += 8; reasons.push("cwd strong fuzzy match"); }
        else if (cwdScore >= 0.55) { score += 4; reasons.push("cwd weak fuzzy match"); }
      }

      if (remoteTitle && sessionTitle) {
        const titleScore = tokenSimilarity(remoteTitle, sessionTitle);
        if (titleScore >= 0.85 || normalized(sessionTitle).includes(normalized(remoteTitle)) || normalized(remoteTitle).includes(normalized(sessionTitle))) {
          score += 8; reasons.push("title/name match");
        } else if (titleScore >= 0.45) {
          score += 4; reasons.push("title/name fuzzy match");
        }
      }

      for (const repo of Array.from(repoNames)) {
        const n = normalized(repo);
        if (!n) continue;
        if (normalized(sessionCwd ?? "").includes(n) || normalized(sessionTitle ?? "").includes(n)) {
          score += 3; reasons.push(`repo hint match: ${repo}`);
          break;
        }
      }

      if (session.running === true) { score += 3; reasons.push("session currently running"); }
      const timeScore = timestampScore(remoteUpdated, session.updatedAt);
      if (timeScore) { score += timeScore.score; reasons.push(timeScore.reason); }

      if (score > 0) out.push({ ...candidateFromSession(client.name, session, "known", score, reasons), claudeAiSessionId: ids.claudeAiSessionId, controlSessionId: ids.controlSessionId, sessionUrl: ids.sessionUrl });
    }
  }
  return out;
}

function candidateFromSession(client: string, session: Partial<PinnedSession> & Record<string, unknown>, source: "pinned" | "known", score: number, reasons: string[]): RemoteSessionCandidate {
  return {
    client,
    sessionId: String(session.sessionId),
    cwd: stringField(session.cwd),
    name: stringField(session.name),
    title: stringField(session.title),
    running: typeof session.running === "boolean" ? session.running : undefined,
    score,
    reasons,
    source,
    claudeAiSessionId: stringField(session.claudeAiSessionId),
    controlSessionId: stringField(session.controlSessionId),
    sessionUrl: stringField(session.sessionUrl),
  };
}

function rawSession(value: unknown): (Partial<PinnedSession> & Record<string, unknown>) | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const sessionId = source.sessionId ?? source.id;
  if (typeof sessionId !== "string" || !sessionId) return undefined;
  return { ...source, sessionId } as Partial<PinnedSession> & Record<string, unknown>;
}

export function extractClaudeAiSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(/(?:session|cse)_[A-Za-z0-9]+/);
  if (!match) return undefined;
  return match[0].startsWith("cse_") ? `session_${match[0].slice(4)}` : match[0];
}

function toControlSessionId(sessionId: string): string {
  return sessionId.startsWith("session_") ? `cse_${sessionId.slice(8)}` : sessionId;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pathParts(value: string): string[] {
  return value.toLowerCase().replace(/\\/g, "/").split(/[^a-z0-9]+/).filter(Boolean);
}

function pathSimilarity(a: string, b: string): number {
  const an = normalized(a);
  const bn = normalized(b);
  if (!an || !bn) return 0;
  if (an === bn || an.includes(bn) || bn.includes(an)) return 1;
  const aa = new Set(pathParts(a));
  const bb = new Set(pathParts(b));
  if (!aa.size || !bb.size) return 0;
  const intersection = Array.from(aa).filter((part) => bb.has(part)).length;
  return intersection / Math.max(aa.size, bb.size);
}

function tokenSimilarity(a: string, b: string): number {
  const aa = new Set(pathParts(a));
  const bb = new Set(pathParts(b));
  if (!aa.size || !bb.size) return 0;
  const intersection = Array.from(aa).filter((part) => bb.has(part)).length;
  return intersection / Math.max(aa.size, bb.size);
}

function timestampScore(remote: string | undefined, local: unknown): { score: number; reason: string } | undefined {
  if (!remote || typeof local !== "string") return undefined;
  const delta = Math.abs(Date.parse(remote) - Date.parse(local));
  if (!Number.isFinite(delta)) return undefined;
  const minutes = delta / 60_000;
  if (minutes <= 10) return { score: 4, reason: "updated within 10 minutes" };
  if (minutes <= 60) return { score: 2, reason: "updated within 1 hour" };
  if (minutes <= 24 * 60) return { score: 1, reason: "updated within 24 hours" };
  return undefined;
}
