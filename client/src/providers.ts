/**
 * Provider config:
 *
 *   PROVIDERS_JSON = {
 *     "claude": { "models": ["claude-sonnet-4-5", "claude-opus-4-7"] },
 *     "codex": {
 *       "baseUrl": "https://litellm.example/v1",
 *       "authToken": "sk-litellm-...",
 *       "models": ["gpt-5", "gpt-5-mini"]
 *     },
 *     "glm": {
 *       "baseUrl": "https://litellm.example/v1",
 *       "authToken": "sk-litellm-...",
 *       "models": ["glm-4.6"]
 *     }
 *   }
 *
 * baseUrl + authToken go to ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN at
 * spawn time so the claude CLI talks to a LiteLLM (or any Anthropic-API-
 * compatible) gateway. The "claude" provider can omit them to use native
 * auth from ~/.claude.
 */

export interface ProviderConfig {
  baseUrl?: string;
  authToken?: string;
  models: string[];
}

export type ProvidersConfig = Record<string, ProviderConfig>;

let cached: ProvidersConfig | null = null;

export function loadProviders(): ProvidersConfig {
  if (cached) return cached;
  const raw = process.env.PROVIDERS_JSON?.trim();
  if (!raw) {
    cached = { claude: { models: [] } };
    return cached;
  }
  try {
    const parsed = JSON.parse(raw) as ProvidersConfig;
    // Always include "claude" as a provider option even if not declared.
    if (!parsed.claude) parsed.claude = { models: [] };
    cached = parsed;
    return cached;
  } catch (err) {
    console.error("PROVIDERS_JSON is not valid JSON; ignoring", err);
    cached = { claude: { models: [] } };
    return cached;
  }
}

/** Sanitized form to advertise to the server (no auth tokens). */
export function publicProviders(): Record<string, { baseUrl?: string; models: string[] }> {
  const cfg = loadProviders();
  const out: Record<string, { baseUrl?: string; models: string[] }> = {};
  for (const [name, p] of Object.entries(cfg)) {
    out[name] = { baseUrl: p.baseUrl, models: p.models ?? [] };
  }
  return out;
}

export function getProvider(name: string | undefined): ProviderConfig | null {
  if (!name) return null;
  const cfg = loadProviders();
  return cfg[name] ?? null;
}
