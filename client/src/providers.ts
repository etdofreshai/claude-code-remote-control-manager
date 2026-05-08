/**
 * Provider config.
 *
 * Defaults (hard-coded below) point at https://litellm.etdofresh.com for
 * `codex` and `glm`. Set LITELLM_TOKEN in the client env so the spawned
 * claude binary can authenticate. The native `claude` provider is
 * authless from the binary's POV — it uses ~/.claude credentials.
 *
 * Override the entire map by setting PROVIDERS_JSON in env, e.g.:
 *
 *   PROVIDERS_JSON={
 *     "claude": { "models": ["claude-sonnet-4-7","claude-opus-4-7"] },
 *     "codex":  { "baseUrl": "https://litellm.example", "authToken": "sk-...", "models": ["codex"] },
 *     "glm":    { "baseUrl": "https://litellm.example", "authToken": "sk-...", "models": ["glm"]   }
 *   }
 */

export interface ProviderConfig {
  baseUrl?: string;
  authToken?: string;
  models: string[];
}

export type ProvidersConfig = Record<string, ProviderConfig>;

const LITELLM_DEFAULT_BASE_URL = "https://litellm.etdofresh.com";

function defaultProviders(): ProvidersConfig {
  const liteToken = process.env.LITELLM_TOKEN?.trim();
  return {
    claude: {
      models: [
        "claude-opus-4-7",
        "claude-sonnet-4-7",
        "claude-haiku-4-5",
        "claude-sonnet-4-6",
      ],
    },
    codex: {
      baseUrl: process.env.CODEX_BASE_URL?.trim() || LITELLM_DEFAULT_BASE_URL,
      authToken: process.env.CODEX_AUTH_TOKEN?.trim() || liteToken,
      models: ["codex"],
    },
    glm: {
      baseUrl: process.env.GLM_BASE_URL?.trim() || LITELLM_DEFAULT_BASE_URL,
      authToken: process.env.GLM_AUTH_TOKEN?.trim() || liteToken,
      models: ["glm"],
    },
  };
}

let cached: ProvidersConfig | null = null;

export function loadProviders(): ProvidersConfig {
  if (cached) return cached;
  const raw = process.env.PROVIDERS_JSON?.trim();
  if (!raw) {
    cached = defaultProviders();
    return cached;
  }
  try {
    const parsed = JSON.parse(raw) as ProvidersConfig;
    if (!parsed.claude) parsed.claude = defaultProviders().claude;
    cached = parsed;
    return cached;
  } catch (err) {
    console.error(
      "PROVIDERS_JSON is not valid JSON; falling back to defaults",
      err,
    );
    cached = defaultProviders();
    return cached;
  }
}

/** Sanitized form to advertise to the server (no auth tokens). */
export function publicProviders(): Record<
  string,
  { baseUrl?: string; models: string[] }
> {
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
