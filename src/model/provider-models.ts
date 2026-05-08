/**
 * Provider model-list cache.
 *
 * Backs the GET /api/models/providers/:id/models endpoint and the agent-status
 * + IM /models surfaces. Each entry is a list of model ids the provider's
 * /models endpoint reported, plus a fetch timestamp for TTL invalidation.
 *
 * Cache is in-memory only — providers' validation state already persists in
 * setting.json; the model list itself can be re-fetched cheaply on demand.
 */

import { getProvider } from './store.js';
import { validateProvider, type ProviderModelInfo } from './validation.js';
import type { ProviderConfig } from './types.js';

const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  models: string[];
  modelInfos: ProviderModelInfo[];
  fetchedAt: number;
  providerUpdatedAt: string;
}

const cache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry, provider: ProviderConfig): boolean {
  if (entry.providerUpdatedAt !== provider.updatedAt) return false;
  return (Date.now() - entry.fetchedAt) < TTL_MS;
}

/**
 * Get the model list for a provider, fetching from /models on cache miss or
 * when the provider config has been updated since the last fetch.
 */
export async function getProviderModelList(providerId: string, opts: { forceRefresh?: boolean } = {}): Promise<{
  models: string[];
  modelInfos: ProviderModelInfo[];
  fetchedAt: number;
  fromCache: boolean;
} | null> {
  const provider = getProvider(providerId);
  if (!provider) return null;

  const cached = cache.get(providerId);
  if (!opts.forceRefresh && cached && isFresh(cached, provider)) {
    return {
      models: cached.models,
      modelInfos: cached.modelInfos,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
    };
  }

  const result = await validateProvider(provider);
  const entry: CacheEntry = {
    models: result.models,
    modelInfos: result.modelInfos,
    fetchedAt: Date.now(),
    providerUpdatedAt: provider.updatedAt,
  };
  cache.set(providerId, entry);
  return {
    models: entry.models,
    modelInfos: entry.modelInfos,
    fetchedAt: entry.fetchedAt,
    fromCache: false,
  };
}

/**
 * Invalidate cached model list (e.g. after a provider edit/delete).
 */
export function invalidateProviderModels(providerId: string): void {
  cache.delete(providerId);
}
