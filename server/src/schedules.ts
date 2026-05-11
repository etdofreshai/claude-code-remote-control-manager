import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import cronParser from "cron-parser";

export interface Schedule {
  id: string;
  name: string;
  clientName: string;
  sessionId: string;
  cron: string; // 5-field cron, e.g. "*/15 * * * *"
  /** Either text or content; one is required. */
  text?: string;
  content?: unknown;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastResult?: string;
}

const SCHEDULES_PATH =
  process.env.SCHEDULES_PATH ?? "/app/data/schedules.json";

let schedules = new Map<string, Schedule>();
let saveTimer: NodeJS.Timeout | null = null;

export function loadSchedules(): void {
  try {
    if (!existsSync(SCHEDULES_PATH)) return;
    const raw = JSON.parse(readFileSync(SCHEDULES_PATH, "utf8")) as Schedule[];
    for (const s of raw) schedules.set(s.id, s);
    console.log(`schedules: loaded ${schedules.size} from ${SCHEDULES_PATH}`);
  } catch (err) {
    console.error("schedules: load failed", err);
  }
}

function persist(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(path.dirname(SCHEDULES_PATH), { recursive: true });
      writeFileSync(
        SCHEDULES_PATH,
        JSON.stringify([...schedules.values()], null, 2),
      );
    } catch (err) {
      console.error("schedules: save failed", err);
    }
  }, 500);
}

export function validateCron(cron: string): { ok: boolean; error?: string } {
  try {
    cronParser.parseExpression(cron, { tz: "UTC" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

function computeNextRun(cron: string, from: Date = new Date()): string | undefined {
  try {
    const it = cronParser.parseExpression(cron, { currentDate: from, tz: "UTC" });
    return it.next().toDate().toISOString();
  } catch {
    return undefined;
  }
}

export function listSchedules(): Schedule[] {
  return [...schedules.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function getSchedule(id: string): Schedule | undefined {
  return schedules.get(id);
}

export interface ScheduleInput {
  name?: string;
  clientName: string;
  sessionId: string;
  cron: string;
  text?: string;
  content?: unknown;
  enabled?: boolean;
}

export function createSchedule(input: ScheduleInput): Schedule {
  const cronCheck = validateCron(input.cron);
  if (!cronCheck.ok) throw new Error(`invalid cron: ${cronCheck.error}`);
  if (!input.clientName || !input.sessionId)
    throw new Error("clientName and sessionId required");
  if (input.text == null && input.content == null)
    throw new Error("provide text or content");
  const now = new Date().toISOString();
  const sched: Schedule = {
    id: randomUUID(),
    name: input.name?.trim() || `${input.clientName}/${input.sessionId.slice(0, 8)}`,
    clientName: input.clientName,
    sessionId: input.sessionId,
    cron: input.cron,
    text: input.text,
    content: input.content,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
    nextRunAt: computeNextRun(input.cron),
  };
  schedules.set(sched.id, sched);
  persist();
  return sched;
}

export function updateSchedule(id: string, patch: Partial<ScheduleInput> & { enabled?: boolean }): Schedule {
  const s = schedules.get(id);
  if (!s) throw new Error(`schedule ${id} not found`);
  if (patch.cron) {
    const c = validateCron(patch.cron);
    if (!c.ok) throw new Error(`invalid cron: ${c.error}`);
  }
  const next: Schedule = {
    ...s,
    name: patch.name?.trim() || s.name,
    clientName: patch.clientName ?? s.clientName,
    sessionId: patch.sessionId ?? s.sessionId,
    cron: patch.cron ?? s.cron,
    text: patch.text !== undefined ? patch.text : s.text,
    content: patch.content !== undefined ? patch.content : s.content,
    enabled: patch.enabled ?? s.enabled,
    updatedAt: new Date().toISOString(),
  };
  if (patch.cron && patch.cron !== s.cron) {
    next.nextRunAt = computeNextRun(next.cron);
  }
  schedules.set(id, next);
  persist();
  return next;
}

export function removeSchedule(id: string): boolean {
  const ok = schedules.delete(id);
  if (ok) persist();
  return ok;
}

/**
 * Recompute next-run for every schedule (after server restart, or when
 * we want to backfill missing nextRunAt). Does not fire anything.
 */
export function reindexNextRuns(): void {
  for (const s of schedules.values()) {
    if (!s.nextRunAt) {
      s.nextRunAt = computeNextRun(s.cron);
    }
  }
  persist();
}

/**
 * Called by the tick loop. For each enabled schedule whose nextRunAt has
 * passed, invoke the fire callback and advance to the next run.
 */
export function tickDueSchedules(
  now: Date,
  fire: (s: Schedule) => Promise<string | undefined>,
): void {
  for (const s of schedules.values()) {
    if (!s.enabled) continue;
    if (!s.nextRunAt) {
      s.nextRunAt = computeNextRun(s.cron, now);
      continue;
    }
    if (new Date(s.nextRunAt).getTime() > now.getTime()) continue;
    // Capture the run; advance immediately so a stuck fire() doesn't double-fire next tick.
    const wasDueAt = s.nextRunAt;
    s.lastRunAt = now.toISOString();
    s.nextRunAt = computeNextRun(s.cron, now);
    persist();
    fire(s)
      .then((result) => {
        const cur = schedules.get(s.id);
        if (cur) {
          cur.lastResult = result ?? "ok";
          persist();
        }
      })
      .catch((err) => {
        const cur = schedules.get(s.id);
        if (cur) {
          cur.lastResult = `error: ${String(err?.message ?? err)}`;
          persist();
        }
      });
    void wasDueAt;
  }
}
