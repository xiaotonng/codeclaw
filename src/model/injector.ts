/**
 * Credential injector — turn an active Profile into the env vars and
 * additional argv that should be applied when spawning a specific agent.
 *
 * This is the single point where pikiclaw's Profile abstraction is
 * translated into per-agent quirks. Adding a new agent (e.g. OpenCode)
 * = adding one entry to AGENT_INJECT_TABLE.
 */

import { resolveCredential } from '../core/secrets/index.js';
import { getActiveProfile, getProvider } from './store.js';
import type { ProviderConfig, ModelProfileConfig, ProviderKind } from './types.js';

export interface InjectedSpawnConfig {
  /** Env vars to merge into the child process environment. */
  env: Record<string, string>;
  /** Extra argv tokens to append to the agent CLI invocation (Hermes only). */
  argvAppend: string[];
  /** When set, override the agent's `model` opt (Claude/Codex/Gemini). */
  modelOverride?: string;
  /** When set, files to write before spawn (path → content). */
  configFiles?: Record<string, string>;
  /** When set, override HOME / similar to redirect agent's data dir. */
  homeOverride?: string;
  /** Diagnostic message returned for logging / UI. */
  detail: string;
}

const EMPTY: InjectedSpawnConfig = { env: {}, argvAppend: [], detail: '' };

// ---------------------------------------------------------------------------
// Per-agent translation rules
// ---------------------------------------------------------------------------

type AgentInjector = (
  provider: ProviderConfig,
  profile: ModelProfileConfig,
  apiKey: string,
) => InjectedSpawnConfig | Promise<InjectedSpawnConfig>;

/**
 * Claude Code respects `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` (or
 * `ANTHROPIC_AUTH_TOKEN`) as a BYOK route. The CLI itself is unchanged.
 * The model is overridden via opts.claudeModel (handled in stream.ts).
 */
const claudeInjector: AgentInjector = (provider, profile, apiKey) => {
  if (provider.kind !== 'anthropic' && provider.kind !== 'openai-compatible') {
    return {
      ...EMPTY,
      detail: `Claude BYOK requires Anthropic or OpenAI-compatible (Anthropic-API-shaped) provider; got ${provider.kind}.`,
    };
  }
  return {
    env: {
      ANTHROPIC_BASE_URL: provider.baseURL,
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_AUTH_TOKEN: apiKey,
    },
    argvAppend: [],
    modelOverride: profile.modelId,
    detail: `Claude BYOK → ${provider.name} / ${profile.modelId}`,
  };
};

/** Codex CLI honors `OPENAI_BASE_URL` + `OPENAI_API_KEY`. */
const codexInjector: AgentInjector = (provider, profile, apiKey) => {
  if (provider.kind !== 'openai' && provider.kind !== 'openai-compatible') {
    return {
      ...EMPTY,
      detail: `Codex BYOK requires OpenAI-compatible provider; got ${provider.kind}.`,
    };
  }
  return {
    env: {
      OPENAI_BASE_URL: provider.baseURL,
      OPENAI_API_KEY: apiKey,
    },
    argvAppend: [],
    modelOverride: profile.modelId,
    detail: `Codex BYOK → ${provider.name} / ${profile.modelId}`,
  };
};

/** Gemini CLI accepts `GEMINI_API_KEY` but does not allow custom baseURL. */
const geminiInjector: AgentInjector = (provider, profile, apiKey) => {
  if (provider.kind !== 'google') {
    return {
      ...EMPTY,
      detail: `Gemini BYOK only supports Google AI Studio keys; got ${provider.kind}.`,
    };
  }
  return {
    env: { GEMINI_API_KEY: apiKey },
    argvAppend: [],
    modelOverride: profile.modelId,
    detail: `Gemini BYOK → ${provider.name} / ${profile.modelId}`,
  };
};

/**
 * Hermes accepts a wide menu of provider env vars. We map by ProviderKind +
 * baseURL hint, falling back to a generic OPENROUTER-style env. The actual
 * model and provider selection are passed via argv (`-m`, `--provider`).
 */
const HERMES_ENV_BY_KIND: Record<ProviderKind, (apiKey: string, baseURL: string) => Record<string, string>> = {
  'anthropic':         (k): Record<string, string> => ({ ANTHROPIC_API_KEY: k }),
  'openai':            (k): Record<string, string> => ({ OPENAI_API_KEY: k }),
  'google':            (k): Record<string, string> => ({ GOOGLE_API_KEY: k, GEMINI_API_KEY: k }),
  'openai-compatible': (k, baseURL): Record<string, string> => {
    // Heuristic: pick the env name Hermes recognises based on baseURL host.
    // Env names match what `hermes status` lists as recognised slots.
    const host = (() => { try { return new URL(baseURL).host.toLowerCase(); } catch { return ''; } })();
    if (host.includes('openrouter'))     return { OPENROUTER_API_KEY: k };
    if (host.includes('deepseek'))       return { DEEPSEEK_API_KEY: k };
    if (host.includes('moonshot') || host.includes('kimi')) return { KIMI_API_KEY: k, MOONSHOT_API_KEY: k };
    if (host.includes('minimax'))        return { MINIMAX_API_KEY: k };
    if (host.includes('zhipuai') || host.includes('z.ai') || host.includes('bigmodel')) return { ZAI_API_KEY: k, ZHIPU_API_KEY: k };
    if (host.includes('x.ai'))           return { XAI_API_KEY: k };
    if (host.includes('stepfun'))        return { STEPFUN_API_KEY: k };
    // Qwen via Alibaba DashScope OpenAI-compatible endpoint.
    if (host.includes('dashscope') || host.includes('qwen')) return { DASHSCOPE_API_KEY: k, QWEN_API_KEY: k };
    // Doubao Seed via Volcengine Ark.
    if (host.includes('volces') || host.includes('volcengine') || host.includes('doubao')) return { ARK_API_KEY: k, DOUBAO_API_KEY: k };
    // Generic fallback — Hermes accepts OPENROUTER_API_KEY for many providers
    return { OPENROUTER_API_KEY: k };
  },
};

/**
 * Map our internal `ProviderKind` to Hermes' provider slug used in ACP
 * model-id encoding (`<provider>:<model>`). Falls back to `openrouter`,
 * which Hermes treats as an OpenAI-compatible passthrough.
 */
function hermesProviderSlug(provider: ProviderConfig): string {
  if (provider.kind === 'anthropic') return 'anthropic';
  if (provider.kind === 'openai') return 'openai';
  if (provider.kind === 'google') return 'google';
  // openai-compatible: pick a host-aware slug Hermes recognises.
  const host = (() => { try { return new URL(provider.baseURL).host.toLowerCase(); } catch { return ''; } })();
  if (host.includes('deepseek'))    return 'deepseek';
  if (host.includes('moonshot') || host.includes('kimi')) return 'kimi';
  if (host.includes('minimax'))     return 'minimax';
  if (host.includes('zhipuai') || host.includes('z.ai') || host.includes('bigmodel')) return 'zai';
  if (host.includes('x.ai'))        return 'xai';
  if (host.includes('stepfun'))     return 'stepfun';
  if (host.includes('dashscope') || host.includes('qwen')) return 'qwen';
  if (host.includes('volces') || host.includes('volcengine') || host.includes('doubao')) return 'doubao';
  if (host.includes('openrouter'))  return 'openrouter';
  return 'openrouter';
}

/**
 * Hermes injector. Two channels:
 *   1. Env vars carry the credential — `hermes acp` honours `OPENROUTER_API_KEY`,
 *      `ANTHROPIC_API_KEY`, etc. just like the top-level `hermes` CLI.
 *   2. The model is bound *per-session* by the driver via the ACP
 *      `session/set_model` request — `hermes acp` does NOT accept `-m` /
 *      `--provider` (only `--accept-hooks`); appending `-m` here used to make
 *      every BYOK-bound spawn die with `unrecognized arguments`.
 *
 * The model is handed to the driver via `modelOverride` (an ACP-style
 * `<provider>:<model>` string). The driver passes it to `session/set_model`
 * after `session/new` returns; if the user has no Profile bound, no
 * `set_model` call is made and Hermes uses its `~/.hermes/config.yaml`
 * default.
 */
const hermesInjector: AgentInjector = (provider, profile, apiKey) => {
  const envBuilder = HERMES_ENV_BY_KIND[provider.kind];
  const env = envBuilder ? envBuilder(apiKey, provider.baseURL) : { OPENROUTER_API_KEY: apiKey };
  const slug = hermesProviderSlug(provider);
  // Only strip a leading `<slug>/` or `<slug>:` if the user accidentally
  // stored a redundant provider prefix. Do NOT strip the *first segment* of
  // a slash-separated model id wholesale — for OpenRouter the canonical
  // model id is `vendor/model` (e.g. `deepseek/deepseek-v4-flash`), and
  // dropping the `vendor/` part yields a non-existent model.
  let bareModel = profile.modelId;
  if (bareModel.startsWith(`${slug}/`) || bareModel.startsWith(`${slug}:`)) {
    bareModel = bareModel.slice(slug.length + 1);
  }
  return {
    env,
    argvAppend: [],
    modelOverride: `${slug}:${bareModel}`,
    detail: `Hermes → ${provider.name} / ${profile.modelId}`,
  };
};

const AGENT_INJECT_TABLE: Record<string, AgentInjector | undefined> = {
  claude: claudeInjector,
  codex: codexInjector,
  gemini: geminiInjector,
  hermes: hermesInjector,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the active Profile for an agent and return the spawn config to
 * inject. Returns `null` when no Profile is bound (caller should fall back
 * to the agent's native auth / default model).
 */
export async function resolveAgentInjection(agentId: string): Promise<InjectedSpawnConfig | null> {
  const profile = getActiveProfile(agentId);
  if (!profile) return null;
  const provider = getProvider(profile.providerId);
  if (!provider) return null;
  const injector = AGENT_INJECT_TABLE[agentId];
  if (!injector) return null;

  let apiKey: string;
  try {
    apiKey = await resolveCredential(provider.credential);
  } catch (e: any) {
    throw new Error(`Failed to resolve credential for ${provider.name}: ${e?.message || e}`);
  }

  const result = await injector(provider, profile, apiKey);
  return result;
}

/** Returns `true` if the given agent is bound to a Profile. */
export function isAgentBoundToProfile(agentId: string): boolean {
  return getActiveProfile(agentId) !== null;
}
