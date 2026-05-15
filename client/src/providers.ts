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
const SWITCHBOARD_DEFAULT_BASE_URL = "https://switchboard.etdofresh.com";

function defaultProviders(): ProvidersConfig {
  const liteToken = process.env.LITELLM_TOKEN?.trim();
  const liteUrl = process.env.LITELLM_BASE_URL?.trim() || LITELLM_DEFAULT_BASE_URL;
  const bridgeUrl =
    process.env.BRIDGE_BASE_URL?.trim() || BRIDGE_DEFAULT_BASE_URL;
  const zaiToken = process.env.ZAI_API_KEY?.trim();
  const zaiUrl = process.env.ZAI_BASE_URL?.trim() || ZAI_ANTHROPIC_BASE_URL;
  const switchboardToken =
    process.env.SWITCHBOARD_API_KEY?.trim() || "switchboard";
  const switchboardUrl =
    process.env.SWITCHBOARD_BASE_URL?.trim() || SWITCHBOARD_DEFAULT_BASE_URL;
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
    // Native codex provider — routes through @openai/codex-sdk (not the
    // Claude Agent SDK). Auth uses `codex login` cached credentials or
    // OPENAI_API_KEY; no upstream baseUrl override needed.
    // Distinct from `litellm.codex` below, which proxies the same model
    // family through an Anthropic-compatible bridge.
    codex: {
      models: [
        "gpt-5.5",
        "gpt-5.3-codex-spark",
        "gpt-5.3-codex",
      ],
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
    switchboard: {
      // Anthropic-compatible gateway hosted at switchboard.etdofresh.com.
      // /v1/messages sits at the root, so we pass the bare domain as
      // ANTHROPIC_BASE_URL. The gateway routes by the "switchboard/<name>"
      // model id, fanning out to Claude, GLM, Gemini, GPT, Codex, etc.
      baseUrl: switchboardUrl,
      authToken: switchboardToken,
      models: [
        "switchboard/claude",
        "switchboard/claude-opus-4-7",
        "switchboard/codex",
        "switchboard/gemini",
        "switchboard/gemini-3.1-pro-preview",
        "switchboard/glm",
        "switchboard/glm-5.1",
        "switchboard/glm-vision",
        "switchboard/glm-vision-anthropic",
        "switchboard/glm-vision-coding",
        "switchboard/gpt-5.5",
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
