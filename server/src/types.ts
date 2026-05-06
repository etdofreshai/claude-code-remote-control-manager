export interface ClientRecord {
  name: string;
  baseUrl: string;
  platform?: string;
  hostname?: string;
  reachable?: boolean;
  lastSeen?: string;
}

export interface PromptRequest {
  workingDirectory: string;
  prompt: string;
  sessionId?: string;
}

export interface PromptResponse {
  sessionId: string;
  response: string;
}
