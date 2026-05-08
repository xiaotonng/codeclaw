/**
 * models.dev catalog — read-only metadata about LLM providers and their
 * models (pricing, context window, capabilities). We hit the public JSON
 * endpoint and cache the result locally for 24h, with a fallback to the
 * cached copy when offline.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request } from 'undici';
import type { ModelsDevCatalog, ModelsDevProvider, ModelsDevModel } from './types.js';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_PATH = path.join(os.homedir(), '.pikiclaw', 'models-dev-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

interface CacheEnvelope {
  fetchedAt: number;
  data: ModelsDevCatalog;
}

let memCache: CacheEnvelope | null = null;
let inflight: Promise<ModelsDevCatalog> | null = null;

function readDiskCache(): CacheEnvelope | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.fetchedAt && parsed.data) {
      return parsed as CacheEnvelope;
    }
  } catch {}
  return null;
}

function writeDiskCache(env: CacheEnvelope): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(env), { mode: 0o644 });
  } catch {}
}

async function fetchFromNetwork(): Promise<ModelsDevCatalog> {
  const { body, statusCode } = await request(MODELS_DEV_URL, {
    method: 'GET',
    headersTimeout: FETCH_TIMEOUT_MS,
    bodyTimeout: FETCH_TIMEOUT_MS,
  });
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`models.dev returned HTTP ${statusCode}`);
  }
  const text = await body.text();
  return JSON.parse(text) as ModelsDevCatalog;
}

/**
 * Get the catalog. Returns a cached copy if fresh; otherwise fetches in the
 * background and falls back to the stale cache on failure.
 */
export async function getModelsDevCatalog(opts: { forceRefresh?: boolean } = {}): Promise<ModelsDevCatalog> {
  const now = Date.now();
  if (!opts.forceRefresh && memCache && now - memCache.fetchedAt < CACHE_TTL_MS) {
    return memCache.data;
  }
  if (!memCache) memCache = readDiskCache();
  if (!opts.forceRefresh && memCache && now - memCache.fetchedAt < CACHE_TTL_MS) {
    return memCache.data;
  }
  if (!inflight) {
    inflight = (async () => {
      try {
        const data = await fetchFromNetwork();
        const env = { fetchedAt: Date.now(), data };
        memCache = env;
        writeDiskCache(env);
        return data;
      } catch (e) {
        if (memCache) return memCache.data; // fall back to stale cache
        throw e;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/** Lookup a single provider by its models.dev id (e.g. "openrouter"). */
export async function getCatalogProvider(providerId: string): Promise<ModelsDevProvider | null> {
  const cat = await getModelsDevCatalog().catch(() => null);
  return cat?.[providerId] || null;
}

/** Lookup a model entry within a provider. */
export async function getCatalogModel(providerId: string, modelId: string): Promise<ModelsDevModel | null> {
  const provider = await getCatalogProvider(providerId);
  return provider?.models?.[modelId] || null;
}

/**
 * Lightweight search: returns providers whose id/name match the query.
 * If query is empty, returns all providers sorted by id.
 */
export async function searchCatalogProviders(query: string): Promise<ModelsDevProvider[]> {
  const cat = await getModelsDevCatalog().catch(() => ({} as ModelsDevCatalog));
  const all = Object.values(cat);
  const q = query.trim().toLowerCase();
  if (!q) return all.sort((a, b) => a.id.localeCompare(b.id));
  return all.filter(p => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
}
