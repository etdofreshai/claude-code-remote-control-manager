import type { ClientRecord } from "./types.js";

const clients = new Map<string, ClientRecord>();

export function loadFromEnv(): void {
  const raw = process.env.CLIENTS;
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as ClientRecord[];
    for (const c of parsed) clients.set(c.name, c);
  } catch {
    console.error("CLIENTS env is not valid JSON");
  }
}

export function list(): ClientRecord[] {
  return [...clients.values()];
}

export function get(name: string): ClientRecord | undefined {
  return clients.get(name);
}

export function upsert(c: ClientRecord): ClientRecord {
  clients.set(c.name, c);
  return c;
}

export function remove(name: string): boolean {
  return clients.delete(name);
}

export async function probe(c: ClientRecord, token: string): Promise<ClientRecord> {
  try {
    const res = await fetch(new URL("/health", c.baseUrl), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const body = (await res.json()) as Partial<ClientRecord>;
      const updated: ClientRecord = {
        ...c,
        ...body,
        reachable: true,
        lastSeen: new Date().toISOString(),
      };
      clients.set(c.name, updated);
      return updated;
    }
  } catch {
    /* ignore */
  }
  const updated = { ...c, reachable: false };
  clients.set(c.name, updated);
  return updated;
}
