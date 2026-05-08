/**
 * Dashboard API: Model layer (Providers, Profiles, BYOK bindings).
 *
 * Endpoints:
 *   GET    /api/models/catalog                          → models.dev metadata
 *   GET    /api/models/providers                        → list configured providers
 *   POST   /api/models/providers                        → add new provider (paste key / use env)
 *   PATCH  /api/models/providers/:id                    → update provider
 *   DELETE /api/models/providers/:id                    → remove provider + bound profiles
 *   POST   /api/models/providers/:id/validate           → Feishu-style validation
 *
 *   GET    /api/models/profiles                         → list profiles
 *   POST   /api/models/profiles                         → add profile
 *   PATCH  /api/models/profiles/:id                     → update profile
 *   DELETE /api/models/profiles/:id                     → remove profile
 *
 *   GET    /api/models/agents                           → list active bindings
 *   POST   /api/models/agents/:agent/active             → bind/unbind a Profile
 */

import { Hono } from 'hono';
import {
  getModelsDevCatalog, searchCatalogProviders,
  listProviders, getProvider, addProvider, updateProvider, removeProvider, setProviderValidation,
  listProfiles, getProfile, addProfile, updateProfile, removeProfile,
  getActiveProfileId, setActiveProfile,
  validateProvider,
  getProviderModelList, invalidateProviderModels,
  type ProviderKind, type ProviderConfig,
} from '../../model/index.js';
import type { CredentialRef } from '../../core/secrets/index.js';
import { isCredentialRef, describeCredentialRef } from '../../core/secrets/index.js';
import { allDriverIds } from '../../agent/index.js';

const router = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function publicProvider(p: ProviderConfig): any {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    baseURL: p.baseURL,
    extraHeaders: p.extraHeaders,
    credential: { source: p.credential.source, summary: describeCredentialRef(p.credential) },
    validation: p.validation || null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

const VALID_KINDS: ProviderKind[] = ['anthropic', 'openai', 'openai-compatible', 'google'];

// ---------------------------------------------------------------------------
// Catalog (read-only models.dev mirror)
// ---------------------------------------------------------------------------

router.get('/api/models/catalog', async c => {
  const q = c.req.query('q') || '';
  const refresh = c.req.query('refresh') === '1';
  try {
    if (refresh) await getModelsDevCatalog({ forceRefresh: true });
    const providers = await searchCatalogProviders(q);
    return c.json({
      ok: true,
      providers: providers.map(p => ({
        id: p.id,
        name: p.name,
        api: p.api,
        doc: p.doc,
        env: p.env || [],
        modelCount: Object.keys(p.models || {}).length,
      })),
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

router.get('/api/models/catalog/:providerId', async c => {
  const id = c.req.param('providerId');
  try {
    const cat = await getModelsDevCatalog();
    const provider = cat[id];
    if (!provider) return c.json({ ok: false, error: 'Catalog provider not found' }, 404);
    const models = Object.values(provider.models || {}).map(m => ({
      id: m.id,
      name: m.name || m.id,
      reasoning: !!m.reasoning,
      tool_call: !!m.tool_call,
      context: m.limit?.context || null,
      output: m.limit?.output || null,
      cost: m.cost || null,
      release_date: m.release_date || null,
    }));
    return c.json({
      ok: true,
      provider: {
        id: provider.id,
        name: provider.name,
        api: provider.api,
        doc: provider.doc,
        env: provider.env || [],
      },
      models,
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

router.get('/api/models/providers', c => {
  return c.json({ ok: true, providers: listProviders().map(publicProvider) });
});

router.post('/api/models/providers', async c => {
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const kind = body.kind as ProviderKind;
  const name = String(body.name || '').trim();
  const baseURL = String(body.baseURL || '').trim();
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
  const credentialRef = isCredentialRef(body.credentialRef) ? body.credentialRef as CredentialRef : undefined;
  const extraHeaders = body.extraHeaders && typeof body.extraHeaders === 'object' ? body.extraHeaders : undefined;
  if (!VALID_KINDS.includes(kind)) return c.json({ ok: false, error: `Invalid kind. Use one of: ${VALID_KINDS.join(', ')}` }, 400);
  if (!name) return c.json({ ok: false, error: 'name is required' }, 400);
  if (!baseURL) return c.json({ ok: false, error: 'baseURL is required' }, 400);
  if (!apiKey && !credentialRef) return c.json({ ok: false, error: 'apiKey or credentialRef is required' }, 400);
  try {
    const provider = await addProvider({ kind, name, baseURL, apiKey: apiKey || undefined, credentialRef, extraHeaders });
    return c.json({ ok: true, provider: publicProvider(provider) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

router.patch('/api/models/providers/:id', async c => {
  const id = c.req.param('id');
  if (!getProvider(id)) return c.json({ ok: false, error: 'Provider not found' }, 404);
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  try {
    const provider = await updateProvider(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      baseURL: typeof body.baseURL === 'string' ? body.baseURL : undefined,
      apiKey: typeof body.apiKey === 'string' && body.apiKey.length > 0 ? body.apiKey : undefined,
      credentialRef: isCredentialRef(body.credentialRef) ? body.credentialRef as CredentialRef : undefined,
      extraHeaders: body.extraHeaders === null ? null : (body.extraHeaders && typeof body.extraHeaders === 'object' ? body.extraHeaders : undefined),
    });
    invalidateProviderModels(id);
    return c.json({ ok: true, provider: publicProvider(provider) });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

router.delete('/api/models/providers/:id', async c => {
  const id = c.req.param('id');
  const removed = await removeProvider(id);
  if (!removed) return c.json({ ok: false, error: 'Provider not found' }, 404);
  invalidateProviderModels(id);
  return c.json({ ok: true });
});

/**
 * GET /api/models/providers/:id/models — model id list for the configured
 * provider, served from a 30-minute in-memory TTL cache. The first hit (or any
 * hit after a config edit) re-fetches from the provider's /models endpoint.
 *
 * Used by:
 *   - Dashboard: per-agent unified config modal model picker
 *   - IM /models command: when an agent is bound to this provider
 *   - Agent status response: when an agent is bound to this provider
 */
router.get('/api/models/providers/:id/models', async c => {
  const id = c.req.param('id');
  const refresh = c.req.query('refresh') === '1';
  try {
    const result = await getProviderModelList(id, { forceRefresh: refresh });
    if (!result) return c.json({ ok: false, error: 'Provider not found' }, 404);
    return c.json({
      ok: true,
      models: result.models,
      modelInfos: result.modelInfos,
      fetchedAt: new Date(result.fetchedAt).toISOString(),
      fromCache: result.fromCache,
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

router.post('/api/models/providers/:id/validate', async c => {
  const id = c.req.param('id');
  const provider = getProvider(id);
  if (!provider) return c.json({ ok: false, error: 'Provider not found' }, 404);
  try {
    const result = await validateProvider(provider);
    setProviderValidation(id, result.status);
    return c.json({ ok: true, validation: result.status, models: result.models });
  } catch (e: any) {
    const status = {
      state: 'error' as const,
      detail: e?.message || String(e),
      checkedAt: new Date().toISOString(),
    };
    setProviderValidation(id, status);
    return c.json({ ok: true, validation: status, models: [] });
  }
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

router.get('/api/models/profiles', c => {
  return c.json({ ok: true, profiles: listProfiles() });
});

router.post('/api/models/profiles', async c => {
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const providerId = String(body.providerId || '').trim();
  const modelId = String(body.modelId || '').trim();
  if (!providerId) return c.json({ ok: false, error: 'providerId is required' }, 400);
  if (!modelId) return c.json({ ok: false, error: 'modelId is required' }, 400);
  if (!getProvider(providerId)) return c.json({ ok: false, error: `Provider not found: ${providerId}` }, 404);
  try {
    const profile = addProfile({
      name: typeof body.name === 'string' ? body.name : undefined,
      providerId,
      modelId,
      effort: body.effort || null,
      maxOutputTokens: typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : null,
      extras: body.extras && typeof body.extras === 'object' ? body.extras : undefined,
    });
    return c.json({ ok: true, profile });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

router.patch('/api/models/profiles/:id', async c => {
  const id = c.req.param('id');
  if (!getProfile(id)) return c.json({ ok: false, error: 'Profile not found' }, 404);
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  try {
    const profile = updateProfile(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      modelId: typeof body.modelId === 'string' ? body.modelId : undefined,
      effort: 'effort' in body ? body.effort : undefined,
      maxOutputTokens: 'maxOutputTokens' in body ? body.maxOutputTokens : undefined,
      extras: 'extras' in body ? body.extras : undefined,
    });
    return c.json({ ok: true, profile });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

router.delete('/api/models/profiles/:id', c => {
  const id = c.req.param('id');
  const removed = removeProfile(id);
  if (!removed) return c.json({ ok: false, error: 'Profile not found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Agent bindings
// ---------------------------------------------------------------------------

router.get('/api/models/agents', c => {
  const agents = allDriverIds();
  return c.json({
    ok: true,
    bindings: agents.map(agent => ({
      agent,
      activeProfileId: getActiveProfileId(agent),
    })),
  });
});

router.post('/api/models/agents/:agent/active', async c => {
  const agent = c.req.param('agent');
  if (!allDriverIds().includes(agent)) return c.json({ ok: false, error: `Unknown agent: ${agent}` }, 400);
  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const profileId = body.profileId === null ? null : (typeof body.profileId === 'string' ? body.profileId : undefined);
  if (profileId === undefined) return c.json({ ok: false, error: 'profileId (string|null) is required' }, 400);
  try {
    setActiveProfile(agent, profileId);
    return c.json({ ok: true, agent, activeProfileId: profileId });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 400);
  }
});

export default router;
