/**
 * "我的模型" / My Models — the curated middle layer.
 *
 * Each card here is one ModelProfileConfig: a user-defined shortcut that pairs
 * a configured Provider with a specific modelId (and optional effort). Agents
 * upstream pick FROM this list — they never reach past it into the provider's
 * raw model catalogue. That keeps the contract narrow: providers are
 * connections, Profiles are choices, agents bind to choices.
 *
 * Backend CRUD already exists at /api/models/profiles; this component is a
 * thin client over that surface, intentionally mirroring the visual rhythm of
 * ModelsTab's provider tiles so the two sections sit comfortably next to each
 * other on the Agent Configuration page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Input, Label, Modal, ModalHeader, ModelSelect, Select, Spinner } from '../../components/ui';
import { ActionBar } from '../shared';
import { BrandIcon } from '../../components/BrandIcon';
import { useStore } from '../../store';
import type { Locale } from '../../i18n';
import type { ModelLayerSnapshot } from '../models/ModelsTab';

// ---------------------------------------------------------------------------
// Local types — mirror the wire shapes from ModelsTab. We could lift these to
// a shared module but the duplication is one screen wide and keeps this file
// usable without circular re-exports.
// ---------------------------------------------------------------------------

type ProviderKind = 'anthropic' | 'openai' | 'openai-compatible' | 'google';

interface ProviderRow {
  id: string;
  kind: ProviderKind;
  name: string;
  baseURL: string;
}

interface ProfileRow {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  effort?: string | null;
  maxOutputTokens?: number | null;
}

// ---------------------------------------------------------------------------
// Brand inference — same heuristic as ModelsTab.brandIdForProvider but trimmed
// to what we need for the profile tile. Kept local because the source one is
// not exported; if we end up needing a third copy we should promote it.
// ---------------------------------------------------------------------------

function formatContextLength(n: number | undefined): string | null {
  if (!n || !Number.isFinite(n)) return null;
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M ctx`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K ctx`;
  return `${n} ctx`;
}

function brandIdForProvider(p: { kind: ProviderKind; baseURL: string }): string {
  const url = (() => { try { return new URL(p.baseURL); } catch { return null; } })();
  const host = url?.host.toLowerCase() ?? '';
  const port = url?.port ?? '';
  if ((host.startsWith('127.0.0.1') || host.startsWith('localhost')) && port === '11434') return 'ollama';
  if ((host.startsWith('127.0.0.1') || host.startsWith('localhost')) && port === '8080') return 'mlx';
  if (host.includes('openrouter')) return 'openrouter';
  if (host.includes('anthropic')) return 'anthropic';
  if (host.includes('deepseek')) return 'deepseek';
  if (host.includes('googleapis') || host.includes('vertex')) return 'google';
  if (host.includes('openai.com')) return 'openai';
  if (host.includes('dashscope') || host.includes('qwen') || host.includes('aliyun')) return 'qwen';
  if (host.includes('volces') || host.includes('volcengine') || host.includes('doubao')) return 'doubao';
  if (host.includes('bigmodel') || host.includes('zhipu') || host.includes('z.ai')) return 'glm';
  if (host.includes('minimax')) return 'minimax';
  if (p.kind === 'anthropic') return 'anthropic';
  if (p.kind === 'google') return 'google';
  if (p.kind === 'openai') return 'openai';
  return 'custom';
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

interface Copy {
  sectionTitle: string;
  sectionHint: string;
  addLabel: string;
  empty: string;
  emptyHint: string;
  addModalTitle: string;
  editModalTitle: string;
  fieldName: string;
  fieldNameHint: string;
  fieldProvider: string;
  fieldProviderEmpty: string;
  fieldProviderLockedHint: string;
  fieldModelId: string;
  fieldModelIdHint: string;
  fieldModelIdLoading: string;
  fieldModelIdEmpty: string;
  fieldModelIdToggleManual: string;
  fieldModelIdToggleList: string;
  fieldModelIdSearchPlaceholder: string;
  fieldModelIdSearchEmpty: string;
  fieldModelIdCurrentLabel: string;
  fieldEffort: string;
  effortDefault: string;
  cancel: string;
  save: string;
  saving: string;
  remove: string;
  removeConfirm: string;
  via: string;
}

function getCopy(locale: Locale): Copy {
  if (locale === 'zh-CN') {
    return {
      sectionTitle: '我的模型',
      sectionHint: '把你常用的模型登记成一条条快捷方式，自由起别名。这是一份纯粹的选择列表——智能体会从这里挑模型，但谁选了什么不会反向显示在这里。',
      addLabel: '添加模型',
      empty: '还没有登记任何模型',
      emptyHint: '先在下方"模型供应商"里接入一个供应商，再点上方"添加模型"把常用的几个固定下来。',
      addModalTitle: '添加模型',
      editModalTitle: '编辑模型',
      fieldName: '显示名',
      fieldNameHint: '智能体卡片和 IM 选择菜单里会看到的名称；留空则直接用模型 ID。',
      fieldProvider: '供应商',
      fieldProviderEmpty: '没有可用的供应商；请先在下方"模型供应商"里接入一个。',
      fieldProviderLockedHint: '想换别的供应商？关闭这个窗口，先到下方"模型供应商"里接入。',
      fieldModelId: '模型',
      fieldModelIdHint: '从供应商 /v1/models 拉到的真实模型列表中挑选。',
      fieldModelIdLoading: '正在拉取该供应商的模型列表…',
      fieldModelIdEmpty: '该供应商没有返回模型列表（或还未校验），可手动输入模型 ID。',
      fieldModelIdToggleManual: '改为手动输入',
      fieldModelIdToggleList: '从列表选择',
      fieldModelIdSearchPlaceholder: '搜索模型',
      fieldModelIdSearchEmpty: '没有匹配的模型',
      fieldModelIdCurrentLabel: '当前',
      fieldEffort: '推理强度',
      effortDefault: '（沿用默认）',
      cancel: '取消',
      save: '保存',
      saving: '保存中',
      remove: '删除',
      removeConfirm: '删除这个模型条目？已经选择它的智能体会自动回退到官方认证。',
      via: '经由',
    };
  }
  return {
    sectionTitle: 'My Models',
    sectionHint: 'Register the models you actually use as named shortcuts. A pure selection list — agents pick from here, but who picks what does not bubble back into this view.',
    addLabel: 'Add model',
    empty: 'No models registered yet',
    emptyHint: 'Connect a provider below first, then come back here to pin the few you actually use.',
    addModalTitle: 'Add Model',
    editModalTitle: 'Edit Model',
    fieldName: 'Display name',
    fieldNameHint: 'Shown in agent cards and the IM model picker. Leave empty to use the model id as-is.',
    fieldProvider: 'Provider',
    fieldProviderEmpty: 'No providers configured yet; add one in "Model Providers" below first.',
    fieldProviderLockedHint: 'Want a different provider? Close this dialog and connect one in "Model Providers" below.',
    fieldModelId: 'Model',
    fieldModelIdHint: 'Picked from the provider\'s live /v1/models list.',
    fieldModelIdLoading: 'Loading the provider\'s model list…',
    fieldModelIdEmpty: 'This provider returned no model list (or has not been validated yet). Enter a model ID manually.',
    fieldModelIdToggleManual: 'Enter manually',
    fieldModelIdToggleList: 'Pick from list',
    fieldModelIdSearchPlaceholder: 'Search models',
    fieldModelIdSearchEmpty: 'No matching models',
    fieldModelIdCurrentLabel: 'Current',
    fieldEffort: 'Reasoning effort',
    effortDefault: '(default)',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving',
    remove: 'Remove',
    removeConfirm: 'Remove this model entry? Agents that picked it will fall back to native auth.',
    via: 'via',
  };
}

// ---------------------------------------------------------------------------
// Tiny fetch helpers — duplicated locally for parity with ModelsTab.
// ---------------------------------------------------------------------------

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json() as Promise<T>;
}

const EFFORT_CHOICES = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

// ---------------------------------------------------------------------------
// Modal — add/edit a Profile
// ---------------------------------------------------------------------------

interface ProfileDraft {
  name: string;
  providerId: string;
  modelId: string;
  effort: string;          // '' means "use provider/agent default"
}

/** Subset of the response from GET /api/models/providers/:id/models. */
interface ProviderModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
  pricePromptUsd?: number;
  priceCompletionUsd?: number;
}

interface ProviderModelsResponse {
  ok: boolean;
  models?: string[];
  modelInfos?: ProviderModelInfo[];
  error?: string;
}

/** Cache provider→models inside the modal so flipping back and forth between
 *  providers (in a future multi-provider setup) doesn't re-fetch each time.
 *  Cleared when the modal closes. */
type ProviderModelCache = Map<string, ProviderModelInfo[]>;

function ProfileModal({
  open,
  copy,
  providers,
  initial,
  existing,
  onClose,
  onSaved,
  onRemove,
}: {
  open: boolean;
  copy: Copy;
  providers: ProviderRow[];
  initial: ProfileDraft;
  existing?: ProfileRow | null;
  onClose: () => void;
  onSaved: () => void;
  onRemove?: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelCache, setModelCache] = useState<ProviderModelCache>(() => new Map());
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // Escape hatch when a provider's /v1/models returns something incomplete and
  // the user knows a model id pikiclaw can't see.
  const [manualEntry, setManualEntry] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setError(null);
    setManualEntry(false);
    setModelCache(new Map());
  }, [open, initial]);

  // Fetch the chosen provider's /v1/models list whenever provider changes.
  // We intentionally don't block save on this — if the fetch fails the user
  // can still flip to manual entry and proceed.
  useEffect(() => {
    if (!open) return;
    const providerId = draft.providerId;
    if (!providerId) return;
    if (modelCache.has(providerId)) return;
    let aborted = false;
    setModelsLoading(true);
    setModelsError(null);
    (async () => {
      try {
        const r = await fetch(`/api/models/providers/${providerId}/models`);
        const data: ProviderModelsResponse = await r.json();
        if (aborted) return;
        const list: ProviderModelInfo[] = data.modelInfos && data.modelInfos.length > 0
          ? data.modelInfos
          : (data.models || []).map(id => ({ id }));
        setModelCache(prev => {
          const next = new Map(prev);
          next.set(providerId, list);
          return next;
        });
        if (!data.ok && data.error) setModelsError(data.error);
      } catch (e: any) {
        if (!aborted) setModelsError(e?.message || String(e));
      } finally {
        if (!aborted) setModelsLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [open, draft.providerId, modelCache]);

  const isEdit = !!existing;
  const providerModels = modelCache.get(draft.providerId) ?? null;

  const submit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        name: draft.name.trim() || undefined,
        providerId: draft.providerId,
        modelId: draft.modelId.trim(),
        effort: draft.effort || null,
      };
      const url = isEdit && existing
        ? `/api/models/profiles/${existing.id}`
        : '/api/models/profiles';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await send<{ ok: boolean; error?: string }>(method, url, body);
      if (!res.ok) { setError(res.error || 'Failed to save'); return; }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }, [draft, isEdit, existing, onSaved, onClose]);

  const canSave = !submitting
    && !!draft.providerId
    && draft.modelId.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader
        title={isEdit ? copy.editModalTitle : copy.addModalTitle}
        description={copy.sectionHint}
        onClose={onClose}
      />
      <div className="space-y-4">
        <div>
          <Label>{copy.fieldProvider}</Label>
          {providers.length === 0 ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700">
              {copy.fieldProviderEmpty}
            </div>
          ) : (() => {
            // Pick visual treatment by context. The shared <Select> auto-collapses
            // to a readonly div when options.length <= 1, which makes the field
            // look broken ("why won't this drop down?") — so we explicitly render
            // a brand-tagged tile in that case and reserve the dropdown for
            // multi-provider setups.
            const locked = isEdit || providers.length <= 1;
            const selected = providers.find(p => p.id === draft.providerId) ?? providers[0];
            if (locked) {
              return (
                <>
                  <div className="flex h-10 w-full items-center gap-2.5 rounded-md border border-edge bg-panel-alt px-3">
                    <BrandIcon brand={brandIdForProvider(selected)} size={20} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-fg-2">{selected.name}</div>
                      <div className="truncate font-mono text-[10.5px] leading-tight text-fg-5">{selected.baseURL}</div>
                    </div>
                  </div>
                  {!isEdit && (
                    <div className="mt-1 text-[11px] leading-relaxed text-fg-5">{copy.fieldProviderLockedHint}</div>
                  )}
                </>
              );
            }
            return (
              <Select
                value={draft.providerId}
                options={providers.map(p => ({ value: p.id, label: `${p.name} · ${p.baseURL}` }))}
                onChange={v => setDraft(d => ({ ...d, providerId: v }))}
              />
            );
          })()}
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <Label className="mb-0">{copy.fieldModelId}</Label>
            {/* Toggle is only meaningful once we have a real list to choose
                from. Without a list, the field is already a manual input — no
                "switch back to manual" affordance to offer. */}
            {providerModels && providerModels.length > 0 && (
              <button
                type="button"
                onClick={() => setManualEntry(v => !v)}
                className="text-[11px] text-fg-5 transition hover:text-fg-3"
              >
                {manualEntry ? copy.fieldModelIdToggleList : copy.fieldModelIdToggleManual}
              </button>
            )}
          </div>
          {modelsLoading && (
            <div className="flex h-9 items-center gap-2 rounded-md border border-edge bg-panel-alt px-3 text-[12px] text-fg-5">
              <Spinner />
              {copy.fieldModelIdLoading}
            </div>
          )}
          {!modelsLoading && !manualEntry && providerModels && providerModels.length > 0 && (() => {
            // Build the option list. If the draft modelId isn't in the
            // provider's catalogue (custom alias, model not exposed via
            // /v1/models, etc.), prepend it so the picker stays consistent
            // with what's actually saved on the Profile.
            const inList = providerModels.some(m => m.id === draft.modelId);
            const options = [
              ...(!inList && draft.modelId
                ? [{ value: draft.modelId, label: draft.modelId, description: copy.fieldModelIdCurrentLabel }]
                : []),
              ...providerModels.map(m => ({
                value: m.id,
                label: m.id,
                description: m.name && m.name.toLowerCase() !== m.id.toLowerCase() ? m.name : undefined,
                meta: m.contextLength ? formatContextLength(m.contextLength) : undefined,
              })),
            ];
            return (
              <ModelSelect
                value={draft.modelId}
                options={options}
                onChange={v => setDraft(d => ({ ...d, modelId: v }))}
                searchPlaceholder={copy.fieldModelIdSearchPlaceholder}
                noMatchesText={copy.fieldModelIdSearchEmpty}
                currentLabel={copy.fieldModelIdCurrentLabel}
              />
            );
          })()}
          {!modelsLoading && (manualEntry || !providerModels || providerModels.length === 0) && (
            <>
              <Input
                value={draft.modelId}
                onChange={e => setDraft(d => ({ ...d, modelId: e.target.value }))}
                placeholder="anthropic/claude-sonnet-4"
              />
              {(!providerModels || providerModels.length === 0) && !modelsError && (
                <div className="mt-1 text-[11px] leading-relaxed text-fg-5">{copy.fieldModelIdEmpty}</div>
              )}
            </>
          )}
          {modelsError && (
            <div className="mt-1 text-[11px] leading-relaxed text-amber-700">{modelsError}</div>
          )}
          {!manualEntry && providerModels && providerModels.length > 0 && (
            <div className="mt-1 text-[11px] leading-relaxed text-fg-5">{copy.fieldModelIdHint}</div>
          )}
        </div>
        <div>
          <Label>{copy.fieldName}</Label>
          <Input
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            // Mirror the server-side default (just the model id) so the
            // placeholder previews exactly what gets saved on blank submit.
            placeholder={draft.modelId || 'anthropic/claude-sonnet-4'}
          />
          <div className="mt-1 text-[11px] leading-relaxed text-fg-5">{copy.fieldNameHint}</div>
        </div>
        <div>
          <Label>{copy.fieldEffort}</Label>
          <Select
            value={draft.effort}
            options={EFFORT_CHOICES.map(e => ({ value: e, label: e || copy.effortDefault }))}
            onChange={v => setDraft(d => ({ ...d, effort: v }))}
          />
        </div>
        {error && (
          <div className="rounded-md border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-xs text-rose-200">{error}</div>
        )}
      </div>
      <div className="mt-6 flex items-center justify-between gap-2 border-t border-edge pt-4">
        <div>
          {isEdit && onRemove && (
            <button
              type="button"
              onClick={() => void onRemove()}
              className="text-[12px] text-fg-5 transition hover:text-[var(--th-err)]"
            >
              {copy.remove}
            </button>
          )}
        </div>
        <ActionBar
          primary={{ label: submitting ? copy.saving : copy.save, onClick: submit, disabled: !canSave }}
          secondary={{ label: copy.cancel, onClick: onClose }}
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tile — one Profile card
// ---------------------------------------------------------------------------

function ProfileTile({
  profile,
  provider,
  copy,
  onPick,
}: {
  profile: ProfileRow;
  provider: ProviderRow | null;
  copy: Copy;
  onPick: () => void;
}) {
  const brand = provider ? brandIdForProvider(provider) : 'custom';
  return (
    <button
      type="button"
      onClick={onPick}
      className="group relative flex h-[120px] flex-col rounded-lg border border-edge bg-panel-alt px-4 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-edge-strong hover:bg-panel hover:shadow-[0_4px_16px_rgba(15,23,42,0.06)]"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <BrandIcon brand={brand} size={28} />
        {profile.effort && <Badge variant="muted">{profile.effort}</Badge>}
      </div>
      <div className="mt-auto min-w-0">
        <div className="truncate text-[14px] font-semibold tracking-tight text-fg">{profile.name}</div>
        <div className="mt-0.5 truncate font-mono text-[11px] leading-relaxed text-fg-4">{profile.modelId}</div>
        <div className="mt-1 truncate text-[11.5px] text-fg-5">
          {copy.via} {provider?.name ?? '?'}
        </div>
      </div>
    </button>
  );
}

function AddTile({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[120px] flex-col items-center justify-center rounded-lg border border-dashed border-edge bg-panel-alt text-fg-4 transition hover:border-edge-strong hover:bg-panel hover:text-fg-2"
    >
      <div className="text-2xl leading-none">+</div>
      <div className="mt-1 text-[12.5px] font-medium tracking-tight">{label}</div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export default function ProfilesSection({
  snapshot,
}: {
  snapshot: ModelLayerSnapshot;
}) {
  const { providers, profiles, reload } = snapshot;
  const locale = useStore(s => s.locale);
  const copy = useMemo(() => getCopy(locale), [locale]);

  const [modal, setModal] = useState<
    | { kind: 'add' }
    | { kind: 'edit'; profile: ProfileRow }
    | null
  >(null);

  const providerById = useMemo(() => new Map(providers.map(p => [p.id, p])), [providers]);

  const remove = useCallback(async (profile: ProfileRow) => {
    if (!confirm(copy.removeConfirm)) return;
    await send('DELETE', `/api/models/profiles/${profile.id}`);
    await reload();
  }, [copy, reload]);

  const addDraft: ProfileDraft = useMemo(() => ({
    name: '',
    providerId: providers[0]?.id ?? '',
    modelId: '',
    effort: '',
  }), [providers]);

  const editDraft: ProfileDraft | null = useMemo(() => {
    if (!modal || modal.kind !== 'edit') return null;
    const p = modal.profile;
    return {
      name: p.name,
      providerId: p.providerId,
      modelId: p.modelId,
      effort: p.effort || '',
    };
  }, [modal]);

  // Empty state hint only when we genuinely have nothing — once at least one
  // Profile exists, the add tile is enough of an affordance on its own.
  const showEmptyState = profiles.length === 0;

  return (
    <div className="space-y-2">
      {showEmptyState && (
        <div className="rounded-lg border border-dashed border-edge bg-panel-alt px-4 py-6 text-center">
          <div className="text-[13.5px] font-semibold text-fg-2">{copy.empty}</div>
          <div className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-fg-5">{copy.emptyHint}</div>
          {providers.length > 0 && (
            <div className="mt-3">
              <Button variant="primary" size="sm" onClick={() => setModal({ kind: 'add' })}>
                {copy.addLabel}
              </Button>
            </div>
          )}
        </div>
      )}

      {!showEmptyState && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {profiles.map(profile => (
            <ProfileTile
              key={profile.id}
              profile={profile}
              provider={providerById.get(profile.providerId) ?? null}
              copy={copy}
              onPick={() => setModal({ kind: 'edit', profile })}
            />
          ))}
          {providers.length > 0 && (
            <AddTile label={copy.addLabel} onClick={() => setModal({ kind: 'add' })} />
          )}
        </div>
      )}

      {modal && (
        <ProfileModal
          open
          copy={copy}
          providers={providers}
          initial={modal.kind === 'edit' ? editDraft! : addDraft}
          existing={modal.kind === 'edit' ? modal.profile : null}
          onClose={() => setModal(null)}
          onSaved={reload}
          onRemove={modal.kind === 'edit'
            ? async () => {
                await remove(modal.profile);
                setModal(null);
              }
            : undefined}
        />
      )}
    </div>
  );
}
