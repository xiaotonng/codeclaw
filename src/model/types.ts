/**
 * Pikiclaw "Model" layer — Provider/Profile data model.
 *
 *   Provider  = a configured endpoint + credential reference (e.g. "OpenRouter
 *               personal", "Anthropic direct"). Holds baseURL + extra headers.
 *   Profile   = a Provider + modelId + tuning params (effort, max output).
 *               This is the unit a user binds to an agent.
 *
 * Profiles are the smallest selectable unit because Hermes (and most coding
 * agents) only support one model per session. Binding `activeProfileByAgent`
 * tells the driver which Profile to use when spawning that agent.
 */

import type { CredentialRef } from '../core/secrets/index.js';

/** Connection family — determines which env vars the Profile maps to. */
export type ProviderKind =
  | 'anthropic'           // Anthropic native API (also: 3rd-party Anthropic-compatible)
  | 'openai'              // OpenAI native API
  | 'openai-compatible'   // OpenRouter, DeepSeek, Kimi, MiniMax, Z.AI, …
  | 'google';             // Google AI Studio / Gemini API

export interface ProviderValidationStatus {
  state: 'unknown' | 'ready' | 'invalid' | 'error';
  detail: string;
  checkedAt: string;       // ISO timestamp
  modelCount?: number;
}

export interface ProviderConfig {
  /** Stable id (uuid-ish) — used as keychain account suffix. */
  id: string;
  kind: ProviderKind;
  /** User-friendly name shown in UI ("OpenRouter Personal"). */
  name: string;
  /** Base URL, e.g. https://openrouter.ai/api/v1. */
  baseURL: string;
  /** Reference to credential (never the raw key). */
  credential: CredentialRef;
  /** Extra HTTP headers (e.g. OpenRouter HTTP-Referer / X-Title). */
  extraHeaders?: Record<string, string>;
  /** Last validation result, null until first validate. */
  validation?: ProviderValidationStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelProfileConfig {
  id: string;
  name: string;            // "OpenRouter · Sonnet 4.6 (high)"
  providerId: string;
  modelId: string;         // The model id the provider expects
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null;
  maxOutputTokens?: number | null;
  /** Optional extra params passed verbatim to driver where supported. */
  extras?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** The slice of UserConfig owned by the Model layer. */
export interface ModelLayerConfig {
  providers?: Record<string, ProviderConfig>;
  profiles?: Record<string, ModelProfileConfig>;
  /** agentId → profileId; absence means "use the agent's native auth". */
  activeProfileByAgent?: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// models.dev cache types — minimal subset; full file at ~/.pikiclaw/models-dev.json
// ---------------------------------------------------------------------------

export interface ModelsDevModel {
  id: string;
  name?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  release_date?: string;
  last_updated?: string;
  knowledge?: string;
  modalities?: { input?: string[]; output?: string[] };
  open_weights?: boolean;
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  limit?: { context?: number; output?: number };
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  api?: string;             // baseURL when provided
  doc?: string;
  npm?: string;
  env?: string[];           // env var names this provider expects
  models: Record<string, ModelsDevModel>;
}

export type ModelsDevCatalog = Record<string, ModelsDevProvider>;
