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
  /**
   * Per-model overrides — same shape as the parent. Useful when one model
   * in a provider needs a different upstream URL (e.g. routing `codex`
   * through our /v1/messages → /v1/responses bridge while `glm` keeps
   * going direct to LiteLLM).
   */
  modelOverrides?: Record<string, { baseUrl?: string; authToken?: string }>;
}

export type ProvidersConfig = Record<string, ProviderConfig>;

const LITELLM_DEFAULT_BASE_URL = "https://litellm.etdofresh.com";
const BRIDGE_DEFAULT_BASE_URL = "https://ccrcm-bridge.etdofresh.com";
const ZAI_ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic";

function defaultProviders(): ProvidersConfig {
  const liteToken = process.env.LITELLM_TOKEN?.trim();
  const liteUrl = process.env.LITELLM_BASE_URL?.trim() || LITELLM_DEFAULT_BASE_URL;
  const bridgeUrl =
    process.env.BRIDGE_BASE_URL?.trim() || BRIDGE_DEFAULT_BASE_URL;
  const zaiToken = process.env.ZAI_API_KEY?.trim();
  const zaiUrl = process.env.ZAI_BASE_URL?.trim() || ZAI_ANTHROPIC_BASE_URL;
  return {
    claude: {
      // glm-5.1 sits in the Claude provider for UX simplicity — it's
      // routed via z.ai's Anthropic-compatible endpoint, so the binary
      // still speaks /v1/messages and treats it like any Claude model.
      models: [
        "claude-opus-4-7",
        "claude-sonnet-4-7",
        "claude-haiku-4-5",
        "claude-sonnet-4-6",
        "glm-5.1",
      ],
      modelOverrides: {
        "glm-5.1": { baseUrl: zaiUrl, authToken: zaiToken },
      },
    },
    litellm: {
      baseUrl: liteUrl,
      authToken: liteToken,
      // codex stays on litellm because it needs the responses-API bridge.
      models: ["codex"],
      modelOverrides: {
        codex: { baseUrl: bridgeUrl, authToken: liteToken },
      },
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

/** Resolve effective baseUrl/authToken for a provider+model combination. */
export function resolveEndpoint(
  providerName: string | undefined,
  modelName: string | undefined,
): { baseUrl?: string; authToken?: string } {
  const p = getProvider(providerName);
  if (!p) return {};
  const override = modelName ? p.modelOverrides?.[modelName] : undefined;
  return {
    baseUrl: override?.baseUrl ?? p.baseUrl,
    authToken: override?.authToken ?? p.authToken,
  };
}
