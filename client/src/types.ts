export type CommandType = "list-sessions" | "start" | "resume" | "message" | "interrupt" | "stop" | "disconnect";

export interface RemoteCommand {
  id: string;
  type: CommandType;
  payload: Record<string, unknown>;
}

export interface ServerApi {
  connect(): Promise<unknown>;
  poll(): Promise<RemoteCommand | null>;
  ack(id: string, body: { ok: boolean; result?: unknown; error?: string }): Promise<void>;
  disconnect(name: string): Promise<void>;
  reportSessions(name: string, sessions: unknown[]): Promise<void>;
}

export interface ClaudeController {
  listSessions(): Promise<unknown[]>;
  startSession(input: { cwd: string; name?: string; text?: string }): Promise<unknown>;
  resumeSession(input: { sessionId: string; cwd: string; name?: string }): Promise<unknown>;
  sendMessage(input: { sessionId: string; text: string }): Promise<unknown>;
  interruptSession(input: { sessionId: string; text?: string; name?: string }): Promise<unknown>;
  stopSession(sessionId: string): Promise<unknown>;
  shutdown(): Promise<void>;
}
