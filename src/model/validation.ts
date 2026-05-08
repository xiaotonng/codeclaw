/**
 * Provider credential validation — Feishu-style explicit check.
 *
 * Validation strategy: GET ${baseURL}/models with the resolved API key.
 * Status semantics mirror ChannelSetupState in core/config/validation.ts:
 *   missing | invalid | error | ready
 */

import { request } from 'undici';
import { resolveCredential } from '../core/secrets/index.js';
import type { ProviderConfig, ProviderValidationStatus } from './types.js';

const VALIDATION_TIMEOUT_MS = 10_000;

/**
 * Per-model details surfaced from a provider's /models endpoint. We pluck the
 * fields that the OpenRouter / OpenAI / Anthropic catalogs commonly expose:
 *   - `name`            display name distinct from the canonical id
 *   - `created`         unix epoch (seconds) — useful as a "released" marker
 *   - `contextLength`   max context window
 *   - `pricePromptUsd`  / `priceCompletionUsd` — converted to USD / 1M tokens
 *
 * Every field is optional; consumers must tolerate sparse data because not
 * every provider returns the full set.
 */
export interface ProviderModelInfo {
  id: string;
  name?: string;
  created?: number;
  contextLength?: number;
  pricePromptUsd?: number;
  priceCompletionUsd?: number;
}

export interface ProviderValidationResult {
  status: ProviderValidationStatus;
  /** Model ids returned by the endpoint, when available. */
  models: string[];
  /** Detailed per-model info (id + optional name/created/pricing). */
  modelInfos: ProviderModelInfo[];
}

interface ListModelsItem {
  id?: string;
  name?: string;
  display_name?: string;
  created?: number | string;
  /** OpenRouter convention. */
  context_length?: number;
  /** Anthropic convention. */
  max_tokens?: number;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    input?: string | number;
    output?: string | number;
  };
}

interface ListModelsResponse {
  data?: ListModelsItem[];
  models?: ListModelsItem[];
}

function buildHeaders(provider: ProviderConfig, apiKey: string): Record<string, string> {
  const base: Record<string, string> = { 'Accept': 'application/json' };
  switch (provider.kind) {
    case 'anthropic':
      // Anthropic models endpoint is /v1/models with x-api-key + anthropic-version
      base['x-api-key'] = apiKey;
      base['anthropic-version'] = '2023-06-01';
      break;
    case 'google':
      // Google AI Studio uses ?key= query param, not Authorization header.
      // Caller appends ?key= in URL builder below.
      break;
    case 'openai':
    case 'openai-compatible':
    default:
      base['Authorization'] = `Bearer ${apiKey}`;
      break;
  }
  if (provider.extraHeaders) Object.assign(base, provider.extraHeaders);
  return base;
}

function modelsUrl(provider: ProviderConfig, apiKey: string): string {
  const base = provider.baseURL.replace(/\/+$/, '');
  if (provider.kind === 'google') {
    // Google AI Studio: GET https://generativelanguage.googleapis.com/v1beta/models?key=API_KEY
    const sep = base.includes('?') ? '&' : '?';
    return `${base}/models${sep}key=${encodeURIComponent(apiKey)}`;
  }
  if (provider.kind === 'anthropic') {
    return `${base}/v1/models`;
  }
  // OpenAI-compatible
  return `${base}/models`;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Convert a per-token USD price (the format OpenRouter & most OpenAI-compatible
 * APIs use) to USD per 1M tokens. We preserve up to 4 decimals so micro-prices
 * don't round to zero.
 */
function perTokenToPerMillion(value: unknown): number | undefined {
  const n = toNumber(value);
  if (n === undefined) return undefined;
  const perM = n * 1_000_000;
  return Math.round(perM * 10000) / 10000;
}

function extractModelInfos(payload: unknown): ProviderModelInfo[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as ListModelsResponse;
  const arr = p.data || p.models;
  if (!Array.isArray(arr)) return [];
  const out: ProviderModelInfo[] = [];
  for (const m of arr) {
    const id = (typeof m?.id === 'string' && m.id) || (typeof m?.name === 'string' && m.name) || '';
    if (!id) continue;
    const info: ProviderModelInfo = { id };
    const name = typeof m?.name === 'string' ? m.name : (typeof m?.display_name === 'string' ? m.display_name : '');
    if (name && name !== id) info.name = name;
    const created = toNumber(m?.created);
    if (created !== undefined) info.created = created;
    const ctx = toNumber(m?.context_length) ?? toNumber(m?.max_tokens);
    if (ctx !== undefined) info.contextLength = ctx;
    if (m?.pricing) {
      const prompt = perTokenToPerMillion(m.pricing.prompt ?? m.pricing.input);
      const completion = perTokenToPerMillion(m.pricing.completion ?? m.pricing.output);
      if (prompt !== undefined) info.pricePromptUsd = prompt;
      if (completion !== undefined) info.priceCompletionUsd = completion;
    }
    out.push(info);
  }
  return out;
}

export async function validateProvider(provider: ProviderConfig): Promise<ProviderValidationResult> {
  let apiKey: string;
  try {
    apiKey = await resolveCredential(provider.credential);
  } catch (e: any) {
    return {
      status: {
        state: 'invalid',
        detail: `Cannot read credential: ${e?.message || e}`,
        checkedAt: new Date().toISOString(),
      },
      models: [],
      modelInfos: [],
    };
  }

  if (!apiKey || apiKey.length < 4) {
    return {
      status: {
        state: 'invalid',
        detail: 'Empty or too-short API key.',
        checkedAt: new Date().toISOString(),
      },
      models: [],
      modelInfos: [],
    };
  }

  const url = modelsUrl(provider, apiKey);
  const headers = buildHeaders(provider, apiKey);

  let statusCode = 0;
  let bodyText = '';
  try {
    const result = await request(url, {
      method: 'GET',
      headers,
      headersTimeout: VALIDATION_TIMEOUT_MS,
      bodyTimeout: VALIDATION_TIMEOUT_MS,
    });
    statusCode = result.statusCode;
    bodyText = await result.body.text();
  } catch (e: any) {
    return {
      status: {
        state: 'error',
        detail: `Network error reaching ${provider.baseURL}: ${e?.code || e?.message || e}`,
        checkedAt: new Date().toISOString(),
      },
      models: [],
      modelInfos: [],
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      status: {
        state: 'invalid',
        detail: `Provider rejected credential (HTTP ${statusCode}). ${shortBody(bodyText)}`,
        checkedAt: new Date().toISOString(),
      },
      models: [],
      modelInfos: [],
    };
  }

  if (statusCode < 200 || statusCode >= 300) {
    return {
      status: {
        state: 'error',
        detail: `HTTP ${statusCode} from ${provider.baseURL}. ${shortBody(bodyText)}`,
        checkedAt: new Date().toISOString(),
      },
      models: [],
      modelInfos: [],
    };
  }

  let parsed: unknown = null;
  try { parsed = JSON.parse(bodyText); } catch { /* unparsed body — still treat 2xx as ready */ }
  const modelInfos = extractModelInfos(parsed);
  const models = modelInfos.map(info => info.id);

  return {
    status: {
      state: 'ready',
      detail: models.length
        ? `${models.length} models available.`
        : `Endpoint reachable; model list not enumerable.`,
      checkedAt: new Date().toISOString(),
      modelCount: models.length,
    },
    models,
    modelInfos,
  };
}

function shortBody(text: string, max = 200): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}
