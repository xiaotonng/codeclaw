/**
 * Dashboard API: Local Model backends (Ollama / mlx-lm).
 *
 * Surfaces a probe endpoint plus a connect action that links a detected
 * backend into the Provider/Profile model layer so the agent cards above
 * pick it up without any further configuration.
 *
 *   GET  /api/local-models/probe    → which backends are running, what models
 *                                     they expose, install/run hints, and
 *                                     whether a Provider already points at each.
 *   POST /api/local-models/connect  → idempotently create the Provider for the
 *                                     named backend.
 *
 * Endpoints we expect:
 *   - Ollama  baseURL → http://127.0.0.1:11434
 *             version  → GET /api/version
 *             models   → GET /api/tags
 *             OpenAI   → /v1/chat/completions, /v1/models
 *
 *   - mlx-lm  baseURL → http://127.0.0.1:8080   (mlx_lm.server default)
 *             probe   → GET /v1/models   (200 OK iff server up; no version)
 *
 * Model downloads stay manual (user runs `ollama pull <tag>` or restarts
 * `mlx_lm.server --model <repo>` in their own terminal). The install spec
 * is shipped alongside detection so the UI can mirror the CLI tools page.
 */

import { Hono } from 'hono';
import { LOCAL_MODELS, type LocalModelEntry } from '../../catalog/local-models.js';
import {
  listProviders, addProvider, listProfiles, addProfile,
  type ProviderConfig,
} from '../../model/index.js';

const router = new Hono();

// ---------------------------------------------------------------------------
// Backend descriptors — CLI-style install spec lives here so the dashboard
// renders identical UX to the Extensions → CLI page.
// ---------------------------------------------------------------------------

type BackendId = 'ollama' | 'mlx';
type OsKey = 'darwin' | 'linux' | 'win';

interface InstallCommand { label?: string; cmd: string }

interface InstallSpec {
  darwin?: InstallCommand[];
  linux?: InstallCommand[];
  win?: InstallCommand[];
  docs?: string;
}

interface BackendSpec {
  id: BackendId;
  label: string;
  baseURL: string;          // host root, no /v1 suffix
  openAIBaseURL: string;    // passed to ProviderConfig.baseURL
  /** 200-OK probe — doubles as version source when available. */
  probePath: string;
  homepage: string;
  install: InstallSpec;
  /** Command to start the server (after install). */
  runHint: InstallCommand;
  /** Template for "pull/load a specific model". `${model}` is substituted. */
  pullCommandTemplate: string;
  /** Per-entry id field used to fill `${model}` in pullCommandTemplate. */
  modelField: keyof Pick<LocalModelEntry, 'ollamaTag' | 'mlxModel'>;
  /** Platforms where this backend can run. mlx is Apple Silicon only. */
  platforms: OsKey[];
}

const BACKENDS: BackendSpec[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    baseURL: 'http://127.0.0.1:11434',
    openAIBaseURL: 'http://127.0.0.1:11434/v1',
    probePath: '/api/version',
    homepage: 'https://ollama.com/',
    install: {
      docs: 'https://github.com/ollama/ollama#ollama',
      darwin: [
        { label: 'Homebrew', cmd: 'brew install ollama' },
        { label: 'Install script', cmd: 'curl -fsSL https://ollama.com/install.sh | sh' },
      ],
      linux: [
        { label: 'Install script', cmd: 'curl -fsSL https://ollama.com/install.sh | sh' },
      ],
      win: [
        { label: 'winget', cmd: 'winget install Ollama.Ollama' },
      ],
    },
    runHint: { label: 'Start the daemon', cmd: 'ollama serve' },
    pullCommandTemplate: 'ollama pull ${model}',
    modelField: 'ollamaTag',
    platforms: ['darwin', 'linux', 'win'],
  },
  {
    id: 'mlx',
    label: 'mlx-lm',
    baseURL: 'http://127.0.0.1:8080',
    openAIBaseURL: 'http://127.0.0.1:8080/v1',
    // mlx_lm.server has no /api/version; /v1/models doubles as liveness probe.
    probePath: '/v1/models',
    homepage: 'https://github.com/ml-explore/mlx-lm',
    install: {
      docs: 'https://github.com/ml-explore/mlx-lm#installation',
      darwin: [
        { label: 'pipx (recommended)', cmd: 'pipx install mlx-lm' },
        { label: 'pip', cmd: 'pip install mlx-lm' },
      ],
    },
    runHint: {
      label: 'Start the server (replace model)',
      cmd: 'mlx_lm.server --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit --port 8080',
    },
    // mlx-lm loads a single model per server instance — "pull" here means
    // re-launching the server with that model id.
    pullCommandTemplate: 'mlx_lm.server --model ${model} --port 8080',
    modelField: 'mlxModel',
    platforms: ['darwin'],
  },
];

const PROBE_TIMEOUT_MS = 1500;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function currentOs(): OsKey {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'win32') return 'win';
  return 'linux';
}

// ---------------------------------------------------------------------------
// Per-backend detection
// ---------------------------------------------------------------------------

interface DetectedModel {
  id: string;
  sizeBytes?: number;
}

interface BackendStatus {
  id: BackendId;
  label: string;
  detected: boolean;
  version?: string;
  baseURL: string;
  openAIBaseURL: string;
  models: DetectedModel[];
  existingProviderId: string | null;
  homepage: string;
  install: InstallSpec;
  runHint: InstallCommand;
  pullCommandTemplate: string;
  /** True when the current OS is in `platforms` — UI uses this to mark a tile
   *  unsupported rather than just "not detected". */
  supportedOnThisOs: boolean;
}

async function probeOllama(spec: BackendSpec): Promise<{ detected: boolean; version?: string; models: DetectedModel[] }> {
  type VersionRes = { version: string };
  type TagsRes = { models?: Array<{ name: string; size?: number }> };
  const ver = await fetchJson<VersionRes>(`${spec.baseURL}${spec.probePath}`);
  if (!ver) return { detected: false, models: [] };
  const tags = await fetchJson<TagsRes>(`${spec.baseURL}/api/tags`, 3000);
  const models: DetectedModel[] = (tags?.models || []).map(m => ({
    id: m.name,
    sizeBytes: typeof m.size === 'number' ? m.size : undefined,
  }));
  return { detected: true, version: ver.version, models };
}

async function probeMlx(spec: BackendSpec): Promise<{ detected: boolean; version?: string; models: DetectedModel[] }> {
  type ModelsRes = { data?: Array<{ id: string }> };
  const res = await fetchJson<ModelsRes>(`${spec.baseURL}${spec.probePath}`, 3000);
  if (!res) return { detected: false, models: [] };
  return {
    detected: true,
    models: (res.data || []).map(m => ({ id: m.id })),
  };
}

/**
 * Normalize a provider baseURL for comparison: drop trailing slashes and
 * collapse the localhost ↔ 127.0.0.1 distinction.
 */
function normalizeBaseURL(raw: string): string {
  return raw
    .replace(/\/+$/, '')
    .replace(/^http:\/\/localhost(?=[:/]|$)/i, 'http://127.0.0.1')
    .replace(/^https:\/\/localhost(?=[:/]|$)/i, 'https://127.0.0.1');
}

function findProviderForBackend(providers: ProviderConfig[], spec: BackendSpec): ProviderConfig | null {
  const target = normalizeBaseURL(spec.openAIBaseURL);
  return providers.find(p => normalizeBaseURL(p.baseURL) === target) || null;
}

async function probeBackend(spec: BackendSpec, providers: ProviderConfig[]): Promise<BackendStatus> {
  const os = currentOs();
  const supported = spec.platforms.includes(os);
  const result = !supported
    ? { detected: false, models: [] as DetectedModel[] }
    : spec.id === 'ollama' ? await probeOllama(spec) : await probeMlx(spec);
  const existing = findProviderForBackend(providers, spec);
  return {
    id: spec.id,
    label: spec.label,
    detected: result.detected,
    version: result.version,
    baseURL: spec.baseURL,
    openAIBaseURL: spec.openAIBaseURL,
    models: result.models,
    existingProviderId: existing?.id || null,
    homepage: spec.homepage,
    install: spec.install,
    runHint: spec.runHint,
    pullCommandTemplate: spec.pullCommandTemplate,
    supportedOnThisOs: supported,
  };
}

// ---------------------------------------------------------------------------
// Catalog join — recommended models × backend availability
// ---------------------------------------------------------------------------

function isEntryInstalled(entry: LocalModelEntry, spec: BackendSpec, installed: DetectedModel[]): string | null {
  const target = entry[spec.modelField];
  if (!target) return null;
  const base = target.split(':')[0].toLowerCase();
  for (const m of installed) {
    if (m.id.toLowerCase().startsWith(base)) return m.id;
  }
  return null;
}

interface CatalogJoinEntry extends LocalModelEntry {
  installed: { backend: BackendId; id: string } | null;
}

function joinCatalog(backends: BackendStatus[]): CatalogJoinEntry[] {
  return LOCAL_MODELS.map(entry => {
    for (const b of backends) {
      if (!b.detected) continue;
      const spec = BACKENDS.find(s => s.id === b.id);
      if (!spec) continue;
      const hit = isEntryInstalled(entry, spec, b.models);
      if (hit) return { ...entry, installed: { backend: b.id, id: hit } };
    }
    return { ...entry, installed: null };
  });
}

/**
 * For a connected local backend, mirror every detected model as a Profile under
 * its Provider so the unified picker shows them without an extra user gesture.
 * Idempotent. Never deletes Profiles — a model that disappears from probe
 * output might be a transient blip.
 */
function syncLocalProfilesForBackend(providerId: string, detected: DetectedModel[]): { added: number } {
  if (!providerId || !detected.length) return { added: 0 };
  const existing = new Set(
    listProfiles().filter(p => p.providerId === providerId).map(p => p.modelId)
  );
  let added = 0;
  for (const m of detected) {
    if (!m.id || existing.has(m.id)) continue;
    try {
      addProfile({ providerId, modelId: m.id });
      added += 1;
      existing.add(m.id);
    } catch {
      // Provider may have been removed between calls — skip; next probe retries.
    }
  }
  return { added };
}

/**
 * Idempotently create a Provider pointing at this backend. Returns the
 * provider id. The placeholder API key is a sentinel ("local-no-auth") rather
 * than something that looks like a real key, so future code can recognize and
 * special-case local providers.
 */
async function ensureProviderForBackend(spec: BackendSpec): Promise<string | null> {
  const providers = listProviders();
  const existing = findProviderForBackend(providers, spec);
  if (existing) return existing.id;
  try {
    const provider = await addProvider({
      kind: 'openai-compatible',
      name: spec.label,
      baseURL: spec.openAIBaseURL,
      apiKey: 'local-no-auth',
    });
    return provider.id;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Single probe-and-attach endpoint. The Local Models page no longer asks the
 * user to "connect" — every detected backend becomes a Provider automatically
 * so its models show up in the unified picker without an extra click.
 *
 *   - Backend detected, no existing Provider → create one, then sync Profiles.
 *   - Backend detected, Provider already exists → just sync Profiles.
 *   - Backend not detected → leave existing Provider in place (a transient
 *     blip during a restart shouldn't tear down config).
 *
 * Response includes `addedProviderIds` so the dashboard can refetch the upper
 * Model Providers / agent layer exactly when something new appears.
 */
router.get('/api/local-models/probe', async c => {
  try {
    const initialProviders = listProviders();
    const backends = await Promise.all(BACKENDS.map(spec => probeBackend(spec, initialProviders)));
    const addedProviderIds: string[] = [];
    for (const b of backends) {
      if (!b.detected) continue;
      const spec = BACKENDS.find(s => s.id === b.id);
      if (!spec) continue;
      let providerId = b.existingProviderId;
      if (!providerId) {
        providerId = await ensureProviderForBackend(spec);
        if (providerId) {
          b.existingProviderId = providerId;
          addedProviderIds.push(providerId);
        }
      }
      if (providerId) syncLocalProfilesForBackend(providerId, b.models);
    }
    const catalog = joinCatalog(backends);
    return c.json({ ok: true, backends, catalog, currentOs: currentOs(), addedProviderIds });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

export default router;
