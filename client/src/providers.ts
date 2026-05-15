/**
 * Provider config.
 *
 * Two providers right now:
 *   - claude: routes through the Claude Agent SDK. Auth lives in
 *     ~/.claude/credentials.json. No env tokens needed by default.
 *   - codex:  routes through @openai/codex-sdk. Auth uses `codex login`
 *     cached creds or OPENAI_API_KEY. No baseUrl override.
 *
 * Override the entire map by setting PROVIDERS_JSON in env, e.g.:
 *
 *   PROVIDERS_JSON={
 *     "claude": { "models": ["claude-sonnet-4-6","claude-opus-4-7"] },
 *     "codex":  { "models": ["gpt-5.3-codex"] }
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

function defaultProviders(): ProvidersConfig {
  return {
    claude: {
      models: [
        "claude-opus-4-7",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
      ],
    },
    codex: {
      // gpt-5.3-codex-spark isn't on the public /v1/models endpoint but works
      // through the codex CLI's ChatGPT-OAuth path that the SDK delegates to.
      models: [
        "gpt-5.5",
        "gpt-5.3-codex-spark",
        "gpt-5.3-codex",
      ],
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
    const def = defaultProviders();
    if (!parsed.claude) parsed.claude = def.claude;
    if (!parsed.codex) parsed.codex = def.codex;
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

/**
 * Form advertised to the server. Includes auth tokens — the UI uses them
 * to surface a paste-and-run "Copy Resume" command. Only authenticated
 * UI sessions can read this (the server requires Bearer + cookie auth on
 * /api/clients). If you want a stricter posture, drop authToken from
 * this projection.
 */
export function publicProviders(): Record<
  string,
  {
    baseUrl?: string;
    authToken?: string;
    models: string[];
    modelOverrides?: Record<string, { baseUrl?: string; authToken?: string }>;
  }
> {
  const cfg = loadProviders();
  const out: Record<
    string,
    {
      baseUrl?: string;
      authToken?: string;
      models: string[];
      modelOverrides?: Record<string, { baseUrl?: string; authToken?: string }>;
    }
  > = {};
  for (const [name, p] of Object.entries(cfg)) {
    const modelOverrides: Record<string, { baseUrl?: string; authToken?: string }> = {};
    for (const [m, ov] of Object.entries(p.modelOverrides ?? {})) {
      if (ov?.baseUrl || ov?.authToken)
        modelOverrides[m] = { baseUrl: ov.baseUrl, authToken: ov.authToken };
    }
    out[name] = {
      baseUrl: p.baseUrl,
      authToken: p.authToken,
      models: p.models ?? [],
      modelOverrides: Object.keys(modelOverrides).length ? modelOverrides : undefined,
    };
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
