/**
 * Local Models section — sits on the Agents page after `<ModelsSection>`.
 *
 * UX shape mirrors "接入新供应商" deliberately: a flat tile grid of backends
 * (Ollama / LM Studio), each opening a modal that walks the user through
 * detection → model install/verify → connect-to-agents. Once connected, the
 * backend appears in the Model Providers list above as a regular provider
 * (no extra UI here — the provider card carries it from then on).
 *
 * Hardware fit:
 *   The host's total unified memory comes from /api/host (already in the
 *   store). For each curated model we compare against `minRamGb`:
 *     totalGb ≥ minRamGb + 4   → ✅ comfortable
 *     totalGb ≥ minRamGb        → ⚠️ tight
 *     otherwise                 → ❌ won't fit
 *   The +4 GB headroom matches what Ollama recommends for the OS + KV cache.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type OllamaPullEvent } from '../../api';
import { useStore } from '../../store';
import type { Locale } from '../../i18n';
import type { LocalBackendStatus, LocalModelCatalogEntry } from '../../types';
import { BrandIcon } from '../../components/BrandIcon';
import { Badge, Button, Spinner, Modal, ModalHeader } from '../../components/ui';
import { ActionBar } from '../shared';

const RAM_HEADROOM_GB = 4;

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

interface Copy {
  sectionLabel: string;
  hostLabel: string;
  hostUnknown: string;
  refresh: string;
  refreshing: string;
  loadFailed: string;

  // Tile
  tileStatusDetected: string;
  tileStatusNotDetected: string;
  tileStatusConnected: string;
  tileBadgeReadyToConnect: string;
  tileBadgeConnectedWithModels: (n: number) => string;
  tileBlurbOllama: string;
  tileBlurbLmstudio: string;
  tileNotDetectedHint: string;
  tileInstalledModels: (n: number) => string;

  // Modal — generic shell
  modalTitle: (label: string) => string;
  modalDescription: (label: string) => string;
  stepStatus: string;
  stepModels: string;
  stepConnect: string;

  // Step 1 — backend status
  statusRunning: string;
  statusNotRunning: string;
  statusRecheck: string;
  statusRechecking: string;
  statusInstallHint: (label: string) => string;
  statusHomepageCta: string;

  // Step 2 — models
  modelsInstalledHeader: (n: number) => string;
  modelsInstalledEmpty: string;
  modelsRecommendedHeader: string;
  modelsBackendOffline: string;
  fitOk: string;
  fitTight: string;
  fitNoGo: string;
  modelInstalledBadge: string;
  pullCta: string;
  pullInProgress: string;
  pullCancel: string;
  pullStatusManifest: string;
  pullStatusVerifying: string;
  pullStatusWriting: string;
  pullStatusDone: string;
  pullFailed: string;
  pullCommandHint: string;
  copyCommand: string;
  copied: string;

  // Step 3 — connect
  connectCta: string;
  connecting: string;
  connectedBadge: string;
  connectHint: string;
  connectAvailableHint: string;
  connectNeedsBackend: string;
  closeBtn: string;
  cancelBtn: string;

  // Toasts
  toastConnected: string;
  toastAlreadyConnected: string;
  toastConnectFailed: string;
  toastPulled: string;
}

function getCopy(locale: Locale): Copy {
  if (locale === 'zh-CN') {
    return {
      sectionLabel: '接入本地后端',
      hostLabel: '本机',
      hostUnknown: '检测中…',
      refresh: '刷新',
      refreshing: '刷新中…',
      loadFailed: '加载失败',

      tileStatusDetected: '已运行',
      tileStatusNotDetected: '未检测到',
      tileStatusConnected: '已接入',
      tileBadgeReadyToConnect: '可接入',
      tileBadgeConnectedWithModels: n => `可用 ${n} 个模型`,
      tileBlurbOllama: '本地一键拉取开源模型，OpenAI 兼容端口',
      tileBlurbLmstudio: '可视化加载 GGUF 模型，零配置 OpenAI 端口',
      tileNotDetectedHint: '未在本机检测到，点击查看安装与接入流程',
      tileInstalledModels: n => `已下载 ${n} 个模型`,

      modalTitle: label => `接入 ${label}`,
      modalDescription: label => `按顺序完成 3 步：检测后端、安装/校验模型、接入到智能体。完成后 ${label} 会作为一个供应商出现在上方模型供应商列表中。`,
      stepStatus: '后端状态',
      stepModels: '模型',
      stepConnect: '接入智能体',

      statusRunning: '已运行',
      statusNotRunning: '未在本机检测到此后端',
      statusRecheck: '重新检测',
      statusRechecking: '检测中…',
      statusInstallHint: label => `安装并启动 ${label}，然后点击重新检测。`,
      statusHomepageCta: '官网',

      modelsInstalledHeader: n => `已安装（${n}）`,
      modelsInstalledEmpty: '尚未下载任何模型。',
      modelsRecommendedHeader: '推荐安装',
      modelsBackendOffline: '启动后端后即可在此安装和管理模型。',
      fitOk: '推荐',
      fitTight: '勉强可跑',
      fitNoGo: '内存不足',
      modelInstalledBadge: '已安装',
      pullCta: '下载',
      pullInProgress: '下载中',
      pullCancel: '取消',
      pullStatusManifest: '获取清单…',
      pullStatusVerifying: '校验中…',
      pullStatusWriting: '写入中…',
      pullStatusDone: '下载完成',
      pullFailed: '下载失败',
      pullCommandHint: 'LM Studio 没有 HTTP 拉取接口，请在终端执行：',
      copyCommand: '复制命令',
      copied: '已复制',

      connectCta: '接入',
      connecting: '接入中…',
      connectedBadge: '已接入',
      connectHint: '接入后会作为一个供应商出现在「模型供应商」中，并可绑定到任意智能体卡片。',
      connectAvailableHint: '后端已就绪，可立即接入。即使尚未下载模型，也可以稍后再来下载。',
      connectNeedsBackend: '请先启动后端后再接入。',
      closeBtn: '完成',
      cancelBtn: '取消',

      toastConnected: '已接入，可在智能体卡片选择该供应商',
      toastAlreadyConnected: '此后端已接入',
      toastConnectFailed: '接入失败',
      toastPulled: '模型已下载',
    };
  }
  return {
    sectionLabel: 'Connect local backend',
    hostLabel: 'This Mac',
    hostUnknown: 'Detecting…',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    loadFailed: 'Failed to load local backends',

    tileStatusDetected: 'Running',
    tileStatusNotDetected: 'Not detected',
    tileStatusConnected: 'Connected',
    tileBadgeReadyToConnect: 'Ready to connect',
    tileBadgeConnectedWithModels: n => `${n} models available`,
    tileBlurbOllama: 'One-click open-source models, OpenAI-compatible endpoint',
    tileBlurbLmstudio: 'Visual GGUF loader, zero-config OpenAI endpoint',
    tileNotDetectedHint: 'Not detected on this machine — click to see install + connect steps',
    tileInstalledModels: n => `${n} models pulled`,

    modalTitle: label => `Connect ${label}`,
    modalDescription: label => `Walk through 3 steps: detect the backend, install/verify models, connect to agents. After connecting, ${label} appears as a provider in the Model Providers list above.`,
    stepStatus: 'Backend status',
    stepModels: 'Models',
    stepConnect: 'Connect to agents',

    statusRunning: 'Running',
    statusNotRunning: 'Backend not detected on this machine',
    statusRecheck: 'Re-check',
    statusRechecking: 'Checking…',
    statusInstallHint: label => `Install and launch ${label}, then click Re-check.`,
    statusHomepageCta: 'Homepage',

    modelsInstalledHeader: n => `Installed (${n})`,
    modelsInstalledEmpty: 'No models pulled yet.',
    modelsRecommendedHeader: 'Recommended',
    modelsBackendOffline: 'Launch the backend to install or manage models here.',
    fitOk: 'Recommended',
    fitTight: 'Tight fit',
    fitNoGo: 'Not enough RAM',
    modelInstalledBadge: 'Installed',
    pullCta: 'Download',
    pullInProgress: 'Downloading',
    pullCancel: 'Cancel',
    pullStatusManifest: 'Fetching manifest…',
    pullStatusVerifying: 'Verifying…',
    pullStatusWriting: 'Writing manifest…',
    pullStatusDone: 'Download complete',
    pullFailed: 'Download failed',
    pullCommandHint: 'LM Studio has no HTTP pull API; run this in a terminal:',
    copyCommand: 'Copy',
    copied: 'Copied',

    connectCta: 'Connect',
    connecting: 'Connecting…',
    connectedBadge: 'Connected',
    connectHint: 'Once connected, this backend appears as a provider in Model Providers above and can be bound to any agent card.',
    connectAvailableHint: 'Backend is ready. You can connect now and pull models later.',
    connectNeedsBackend: 'Start the backend first, then connect.',
    closeBtn: 'Done',
    cancelBtn: 'Cancel',

    toastConnected: 'Connected — pick it in any agent\'s Provider dropdown',
    toastAlreadyConnected: 'Backend is already connected',
    toastConnectFailed: 'Connect failed',
    toastPulled: 'Model downloaded',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Fit = 'ok' | 'tight' | 'no-go';

function fitFor(totalGb: number | null, minRamGb: number): Fit {
  if (totalGb === null) return 'tight';
  if (totalGb >= minRamGb + RAM_HEADROOM_GB) return 'ok';
  if (totalGb >= minRamGb) return 'tight';
  return 'no-go';
}

function pullCommandFor(backend: 'ollama' | 'lmstudio', entry: LocalModelCatalogEntry): string | null {
  if (backend === 'ollama' && entry.ollamaTag) return `ollama pull ${entry.ollamaTag}`;
  if (backend === 'lmstudio' && entry.lmstudioId) return `lms get ${entry.lmstudioId}`;
  return null;
}

function formatGb(bytes: number | undefined | null): string {
  if (!bytes || !Number.isFinite(bytes)) return '—';
  return `${(bytes / 1024 ** 3).toFixed(0)} GB`;
}

function formatModelSize(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

/** Filter the catalog to entries relevant to one backend. */
function catalogFor(backendId: 'ollama' | 'lmstudio', catalog: LocalModelCatalogEntry[]): LocalModelCatalogEntry[] {
  return catalog.filter(e => backendId === 'ollama' ? !!e.ollamaTag : !!e.lmstudioId);
}

/** Whether a catalog entry is satisfied by an installed model on this backend. */
function entryInstalledOn(entry: LocalModelCatalogEntry, backend: LocalBackendStatus): string | null {
  const tag = backend.id === 'ollama' ? entry.ollamaTag : entry.lmstudioId;
  if (!tag) return null;
  const base = tag.split(':')[0].toLowerCase();
  for (const m of backend.models) {
    if (m.id.toLowerCase().startsWith(base)) return m.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pull progress state
// ---------------------------------------------------------------------------

interface PullState {
  status: 'idle' | 'running' | 'done' | 'error';
  fraction: number | null;
  phase: string;
  error: string | null;
}

const IDLE_PULL: PullState = { status: 'idle', fraction: null, phase: '', error: null };

function describePhase(evt: OllamaPullEvent, copy: Copy): { phase: string; fraction: number | null } {
  if (evt.error) return { phase: evt.error, fraction: null };
  const status = (evt.status || '').toLowerCase();
  if (status.startsWith('pulling manifest')) return { phase: copy.pullStatusManifest, fraction: null };
  if (status.startsWith('verifying')) return { phase: copy.pullStatusVerifying, fraction: null };
  if (status.startsWith('writing')) return { phase: copy.pullStatusWriting, fraction: null };
  if (status === 'success') return { phase: copy.pullStatusDone, fraction: 1 };
  if (status.startsWith('downloading') && typeof evt.total === 'number' && typeof evt.completed === 'number' && evt.total > 0) {
    return { phase: `${Math.round((evt.completed / evt.total) * 100)}%`, fraction: evt.completed / evt.total };
  }
  return { phase: evt.status || '', fraction: null };
}

// ---------------------------------------------------------------------------
// Shared probe hook — used by the section, the modal, and (optionally) by
// ModelsSection so configured local backends can display their installed models.
// ---------------------------------------------------------------------------

export interface LocalBackendsSnapshot {
  backends: LocalBackendStatus[];
  catalog: LocalModelCatalogEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useLocalBackends(): LocalBackendsSnapshot {
  const [backends, setBackends] = useState<LocalBackendStatus[]>([]);
  const [catalog, setCatalog] = useState<LocalModelCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.probeLocalModels();
      if (!res.ok) throw new Error(res.error || 'Failed to load local backends');
      setBackends(res.backends || []);
      setCatalog(res.catalog || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { backends, catalog, loading, error, refresh };
}

// ---------------------------------------------------------------------------
// Tile card — matches the TemplateCard look used in ModelsSection
// ---------------------------------------------------------------------------

function BackendTile({
  backend,
  copy,
  onClick,
}: {
  backend: LocalBackendStatus;
  copy: Copy;
  locale: Locale;
  onClick: () => void;
}) {
  const isConnected = !!backend.existingProviderId;
  const blurb = backend.id === 'ollama' ? copy.tileBlurbOllama : copy.tileBlurbLmstudio;

  // Same rule as ProviderTile: only show a badge when it's load-bearing.
  //   ok   — connected & usable (with model count when known)
  //   warn — running locally but not yet hooked up — there's an action to take
  //   (no badge) — not detected; this is the default state for a fresh
  //                machine and shouldn't read as an action item
  const badge = isConnected
    ? <Badge variant="ok">{backend.models.length > 0
        ? copy.tileBadgeConnectedWithModels(backend.models.length)
        : copy.tileStatusConnected}</Badge>
    : backend.detected
      ? <Badge variant="warn">{copy.tileBadgeReadyToConnect}</Badge>
      : null;

  // Detail line: when the backend is running, show version + model count so
  // the user immediately knows what's on disk; otherwise show the marketing
  // blurb so the tile still has a one-liner of copy.
  const detail = backend.detected
    ? `${backend.version ? `v${backend.version} · ` : ''}${copy.tileInstalledModels(backend.models.length)}`
    : blurb;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex h-[104px] flex-col rounded-lg border border-edge bg-panel-alt px-4 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-edge-strong hover:bg-panel hover:shadow-[0_4px_16px_rgba(15,23,42,0.06)]"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <BrandIcon brand={backend.id} size={32} />
        {badge}
      </div>
      <div className="mt-auto min-w-0">
        <div className="truncate text-[14px] font-semibold tracking-tight text-fg group-hover:text-fg">{backend.label}</div>
        <div className="mt-1 truncate text-[11.5px] leading-relaxed text-fg-5" title={detail}>{detail}</div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal — install + verify + connect flow for one backend
// ---------------------------------------------------------------------------

function StepHeader({ index, label, done }: { index: number; label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
          done
            ? 'border-transparent bg-[var(--th-badge-accent-bg)] text-[var(--th-badge-accent-text)]'
            : 'border-edge bg-panel-alt text-fg-4'
        }`}
      >
        {done ? '✓' : index}
      </span>
      <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-fg-3">{label}</span>
    </div>
  );
}

function InstalledModelChip({ name, sizeBytes }: { name: string; sizeBytes?: number }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-edge bg-panel-alt px-2 py-0.5 text-[11px] text-fg-3">
      <span className="truncate font-mono">{name}</span>
      {sizeBytes ? <span className="shrink-0 text-fg-5">{formatModelSize(sizeBytes)}</span> : null}
    </span>
  );
}

function CatalogRow({
  entry,
  backend,
  totalRamGb,
  pull,
  copy,
  locale,
  onStartPull,
  onCancelPull,
  onCopyHint,
}: {
  entry: LocalModelCatalogEntry;
  backend: LocalBackendStatus;
  totalRamGb: number | null;
  pull: PullState;
  copy: Copy;
  locale: Locale;
  onStartPull: (entry: LocalModelCatalogEntry) => void;
  onCancelPull: (entry: LocalModelCatalogEntry) => void;
  onCopyHint: (cmd: string) => void;
}) {
  const fit = fitFor(totalRamGb, entry.minRamGb);
  const blurb = locale === 'zh-CN' ? entry.descriptionZh : entry.description;
  const installedId = entryInstalledOn(entry, backend);
  const isOllama = backend.id === 'ollama';
  const cmd = pullCommandFor(backend.id, entry);

  // Right-side action:
  //   1) installed → nothing (badge alone is enough)
  //   2) RAM won't fit → nothing
  //   3) Ollama backend running + has tag → in-app pull with progress
  //   4) Ollama backend NOT running → muted "start backend" hint
  //   5) LM Studio → command copy chip (no HTTP pull API)
  let action: 'pull' | 'lm-copy' | 'wait' | 'none' = 'none';
  if (!installedId && fit !== 'no-go') {
    if (isOllama && backend.detected && entry.ollamaTag) action = 'pull';
    else if (isOllama && !backend.detected) action = 'wait';
    else if (!isOllama && cmd) action = 'lm-copy';
  }

  return (
    <div className="rounded-md border border-edge bg-panel-alt px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-semibold text-fg">{entry.name}</div>
            <span className="text-[11px] text-fg-5">{entry.publisher}</span>
            {fit === 'ok' && <Badge variant="ok">{copy.fitOk}</Badge>}
            {fit === 'tight' && <Badge variant="warn">{copy.fitTight}</Badge>}
            {fit === 'no-go' && <Badge variant="err">{copy.fitNoGo}</Badge>}
            {installedId && <Badge variant="accent">{copy.modelInstalledBadge}</Badge>}
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-fg-4">{blurb}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-5">
            <span>{entry.paramsB}B params</span>
            <span>{entry.sizeGb} GB on disk</span>
            <span>≥ {entry.minRamGb} GB RAM</span>
            {entry.homepage && (
              <a
                href={entry.homepage}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                {locale === 'zh-CN' ? '模型主页' : 'Model card'}
              </a>
            )}
          </div>

          {(pull.status === 'running' || pull.status === 'error') && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] text-fg-4">
                <span>{pull.status === 'error' ? `${copy.pullFailed}: ${pull.error}` : pull.phase}</span>
                {pull.status === 'running' && (
                  <button
                    type="button"
                    onClick={() => onCancelPull(entry)}
                    className="text-[11px] text-fg-5 underline-offset-2 hover:text-fg-3 hover:underline"
                  >
                    {copy.pullCancel}
                  </button>
                )}
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-panel">
                <div
                  className={pull.status === 'error' ? 'h-full bg-rose-500/70' : 'h-full bg-accent'}
                  style={{
                    width: pull.fraction !== null
                      ? `${Math.max(2, Math.round(pull.fraction * 100))}%`
                      : '12%',
                    transition: 'width 200ms linear',
                    animation: pull.fraction === null && pull.status === 'running'
                      ? 'pulse 1.6s ease-in-out infinite'
                      : undefined,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start">
          {action === 'pull' && (
            <Button
              variant="primary"
              size="sm"
              disabled={pull.status === 'running'}
              onClick={() => onStartPull(entry)}
            >
              {pull.status === 'running'
                ? <><Spinner className="h-3 w-3" /> {pull.phase || copy.pullInProgress}</>
                : copy.pullCta}
            </Button>
          )}
          {action === 'lm-copy' && cmd && (
            <button
              type="button"
              onClick={() => onCopyHint(cmd)}
              className="rounded-md border border-edge bg-panel px-2 py-1 font-mono text-[11px] text-fg-3 transition hover:border-edge-strong hover:bg-panel-alt"
              title={copy.copyCommand}
            >
              {cmd}
            </button>
          )}
          {action === 'wait' && (
            <span className="text-[11px] text-fg-5">{copy.connectNeedsBackend}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LocalBackendModal({
  open,
  backend,
  catalog,
  totalRamGb,
  copy,
  locale,
  busyConnect,
  onClose,
  onConnect,
  onRefresh,
  onStartPull,
  onCancelPull,
  pulls,
  onCopyHint,
}: {
  open: boolean;
  backend: LocalBackendStatus | null;
  catalog: LocalModelCatalogEntry[];
  totalRamGb: number | null;
  copy: Copy;
  locale: Locale;
  busyConnect: boolean;
  onClose: () => void;
  onConnect: (backend: LocalBackendStatus) => Promise<void>;
  onRefresh: () => Promise<void>;
  onStartPull: (entry: LocalModelCatalogEntry) => void;
  onCancelPull: (entry: LocalModelCatalogEntry) => void;
  pulls: Record<string, PullState>;
  onCopyHint: (cmd: string) => void;
}) {
  const [rechecking, setRechecking] = useState(false);
  useEffect(() => { setRechecking(false); }, [backend?.detected, backend?.id]);

  // Hooks must run unconditionally — derive a stable empty list when backend
  // is null and bail out below.
  const backendCatalog = useMemo(
    () => !backend ? [] : catalogFor(backend.id, catalog).sort((a, b) => {
      const fa = fitFor(totalRamGb, a.minRamGb);
      const fb = fitFor(totalRamGb, b.minRamGb);
      const score = (f: Fit) => (f === 'ok' ? 0 : f === 'tight' ? 1 : 2);
      const installedA = entryInstalledOn(a, backend) ? 0 : 1;
      const installedB = entryInstalledOn(b, backend) ? 0 : 1;
      if (installedA !== installedB) return installedA - installedB;
      return score(fa) - score(fb);
    }),
    [backend, catalog, totalRamGb],
  );

  if (!backend) return null;
  const isOllama = backend.id === 'ollama';
  const isConnected = !!backend.existingProviderId;

  const handleRecheck = async () => {
    setRechecking(true);
    try { await onRefresh(); } finally { setRechecking(false); }
  };

  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title={copy.modalTitle(backend.label)}
        description={copy.modalDescription(backend.label)}
        onClose={onClose}
      />
      <div className="space-y-5">
        {/* Step 1 — Backend status */}
        <section className="space-y-2">
          <StepHeader index={1} label={copy.stepStatus} done={backend.detected} />
          <div className="rounded-md border border-edge bg-panel-alt px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-edge bg-panel">
                <BrandIcon brand={backend.id} size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-fg">{backend.label}</span>
                  {backend.detected
                    ? <Badge variant="ok">{copy.statusRunning}</Badge>
                    : <Badge variant="muted">{copy.tileStatusNotDetected}</Badge>}
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-fg-5">
                  {backend.detected ? (
                    <>
                      {backend.version && <>v{backend.version} · </>}
                      <span className="font-mono">{backend.baseURL}</span>
                    </>
                  ) : (
                    <>{copy.statusInstallHint(backend.label)}</>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!backend.detected && backend.installHint.brewFormula && (
                  <code className="rounded-md border border-edge bg-panel px-2 py-1 text-[11px] text-fg-3">
                    brew install {backend.installHint.brewFormula}
                  </code>
                )}
                {!backend.detected && (
                  <a
                    href={backend.installHint.homepage}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-accent underline-offset-2 hover:underline"
                  >
                    {copy.statusHomepageCta}
                  </a>
                )}
                <Button variant="outline" size="sm" disabled={rechecking} onClick={() => void handleRecheck()}>
                  {rechecking
                    ? <><Spinner className="h-3 w-3" /> {copy.statusRechecking}</>
                    : <><span aria-hidden="true">↻</span> {copy.statusRecheck}</>}
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Step 2 — Models */}
        <section className="space-y-2">
          <StepHeader index={2} label={copy.stepModels} done={backend.detected && backend.models.length > 0} />

          {!backend.detected ? (
            <div className="rounded-md border border-edge bg-panel-alt px-3.5 py-3 text-[12px] text-fg-5">
              {copy.modelsBackendOffline}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Installed */}
              <div className="rounded-md border border-edge bg-panel-alt px-3.5 py-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5">
                  {copy.modelsInstalledHeader(backend.models.length)}
                </div>
                {backend.models.length === 0 ? (
                  <div className="text-[12px] text-fg-5">{copy.modelsInstalledEmpty}</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {backend.models.map(m => (
                      <InstalledModelChip key={m.id} name={m.id} sizeBytes={m.sizeBytes} />
                    ))}
                  </div>
                )}
              </div>

              {/* Recommended catalog */}
              {backendCatalog.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5">
                    {copy.modelsRecommendedHeader}
                  </div>
                  <div className="space-y-1.5">
                    {backendCatalog.map(entry => (
                      <CatalogRow
                        key={entry.id}
                        entry={entry}
                        backend={backend}
                        totalRamGb={totalRamGb}
                        pull={pulls[entry.id] ?? IDLE_PULL}
                        copy={copy}
                        locale={locale}
                        onStartPull={onStartPull}
                        onCancelPull={onCancelPull}
                        onCopyHint={onCopyHint}
                      />
                    ))}
                  </div>
                  {!isOllama && (
                    <div className="text-[11px] leading-relaxed text-fg-5">{copy.pullCommandHint}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Step 3 — Connect to agents */}
        <section className="space-y-2">
          <StepHeader index={3} label={copy.stepConnect} done={isConnected} />
          <div className="rounded-md border border-edge bg-panel-alt px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {isConnected
                    ? <Badge variant="accent">{copy.connectedBadge}</Badge>
                    : backend.detected
                      ? <Badge variant="ok">{copy.statusRunning}</Badge>
                      : <Badge variant="muted">{copy.tileStatusNotDetected}</Badge>}
                </div>
                <div className="mt-1 text-[12px] leading-relaxed text-fg-4">
                  {isConnected
                    ? copy.connectHint
                    : backend.detected
                      ? copy.connectAvailableHint
                      : copy.connectNeedsBackend}
                </div>
              </div>
              {!isConnected && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!backend.detected || busyConnect}
                  onClick={() => void onConnect(backend)}
                >
                  {busyConnect ? <><Spinner className="h-3 w-3" /> {copy.connecting}</> : copy.connectCta}
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6 border-t border-edge pt-4">
        <ActionBar
          primary={{ label: copy.closeBtn, onClick: onClose }}
          secondary={isConnected ? undefined : { label: copy.cancelBtn, onClick: onClose }}
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Public section
// ---------------------------------------------------------------------------

export function LocalModelsSection({
  snapshot,
  onConnected,
}: {
  snapshot?: LocalBackendsSnapshot;
  onConnected?: () => void | Promise<void>;
}) {
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const host = useStore(s => s.host);
  const copy = useMemo(() => getCopy(locale), [locale]);

  const local = useLocalBackends();
  // If a parent already owns the probe state (e.g. AgentTab lifting to share
  // with ModelsSection), prefer that and skip our internal copy. We still
  // mount the hook unconditionally to keep hook order stable.
  const eff = snapshot ?? local;
  const { backends, catalog, loading, error, refresh } = eff;

  const [openId, setOpenId] = useState<'ollama' | 'lmstudio' | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [pulls, setPulls] = useState<Record<string, PullState>>({});
  const pullCancelsRef = useRef<Record<string, () => void>>({});

  const openBackend = useMemo(
    () => backends.find(b => b.id === openId) ?? null,
    [backends, openId],
  );

  const handleConnect = useCallback(async (b: LocalBackendStatus) => {
    setConnecting(b.id);
    try {
      const res = await api.connectLocalBackend(b.id);
      if (!res.ok) throw new Error(res.error || copy.toastConnectFailed);
      toast(res.alreadyConnected ? copy.toastAlreadyConnected : copy.toastConnected);
      await refresh();
      if (onConnected) await onConnected();
    } catch (e: any) {
      toast(`${copy.toastConnectFailed}: ${e?.message || String(e)}`, false);
    } finally {
      setConnecting(null);
    }
  }, [copy, onConnected, refresh, toast]);

  const handleCopyHint = useCallback((cmd: string) => {
    void navigator.clipboard?.writeText(cmd);
    toast(copy.copied);
  }, [copy.copied, toast]);

  const updatePull = useCallback((id: string, patch: Partial<PullState>) => {
    setPulls(prev => ({ ...prev, [id]: { ...(prev[id] ?? IDLE_PULL), ...patch } }));
  }, []);

  const handleStartPull = useCallback(async (entry: LocalModelCatalogEntry) => {
    if (!entry.ollamaTag) return;
    const id = entry.id;
    updatePull(id, { status: 'running', fraction: null, phase: copy.pullStatusManifest, error: null });
    const stream = api.pullLocalModel('ollama', entry.ollamaTag);
    pullCancelsRef.current[id] = stream.cancel;
    let succeeded = false;
    try {
      for await (const evt of stream.events) {
        if (evt.error) throw new Error(evt.error);
        const { phase, fraction } = describePhase(evt, copy);
        updatePull(id, { phase, fraction: fraction ?? null });
        if (evt.status === 'success') { succeeded = true; }
      }
      if (succeeded) {
        updatePull(id, { status: 'done', fraction: 1, phase: copy.pullStatusDone, error: null });
        toast(copy.toastPulled);
        await refresh();
        // After a successful pull, auto-connect Ollama so the agent dropdown
        // sees it immediately. The user already opted in by clicking Pull —
        // no point making them press Connect separately.
        const ollama = backends.find(b => b.id === 'ollama');
        if (ollama && !ollama.existingProviderId) {
          try {
            await api.connectLocalBackend('ollama');
            await refresh();
          } catch { /* surfaced via connect handler if user retries explicitly */ }
        }
        if (onConnected) await onConnected();
      } else {
        updatePull(id, { status: 'error', error: copy.pullFailed, fraction: null });
      }
    } catch (e: any) {
      const message = e?.name === 'AbortError' ? copy.pullCancel : (e?.message || String(e));
      updatePull(id, { status: 'error', error: message, fraction: null });
    } finally {
      delete pullCancelsRef.current[id];
    }
  }, [backends, copy, onConnected, refresh, toast, updatePull]);

  const handleCancelPull = useCallback((entry: LocalModelCatalogEntry) => {
    const cancel = pullCancelsRef.current[entry.id];
    if (cancel) cancel();
  }, []);

  useEffect(() => () => {
    for (const cancel of Object.values(pullCancelsRef.current)) {
      try { cancel(); } catch { /* swallow */ }
    }
  }, []);

  const totalRamGb = host?.totalMem ? host.totalMem / 1024 ** 3 : null;
  const hostSummary = host
    ? `${host.cpuModel || host.arch} · ${formatGb(host.totalMem)} RAM`
    : copy.hostUnknown;

  // Backends always come back in a stable order (Ollama, LM Studio). The
  // probe may take a moment on first paint — keep the tile grid mounted even
  // while loading by falling back to placeholder cards.
  const tiles: LocalBackendStatus[] = backends.length > 0
    ? backends
    : [
        // Loading placeholders — same shape but obviously "not detected" so
        // the modal copy still applies if the user clicks before probe done.
        { id: 'ollama', label: 'Ollama', detected: false, baseURL: 'http://127.0.0.1:11434', openAIBaseURL: 'http://127.0.0.1:11434/v1', models: [], existingProviderId: null, installHint: { homepage: 'https://ollama.com/download', brewFormula: 'ollama' } },
        { id: 'lmstudio', label: 'LM Studio', detected: false, baseURL: 'http://127.0.0.1:1234', openAIBaseURL: 'http://127.0.0.1:1234/v1', models: [], existingProviderId: null, installHint: { homepage: 'https://lmstudio.ai/' } },
      ];

  return (
    <div className="space-y-3">
      {/* Host info row — kept compact, paired with refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] text-fg-5">
          <span className="font-semibold uppercase tracking-[0.14em] text-fg-5">{copy.hostLabel}</span>
          <span className="mx-2 text-fg-6">·</span>
          <span className="text-fg-3">{hostSummary}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading
            ? <><Spinner className="h-3 w-3" /> {copy.refreshing}</>
            : <><span aria-hidden="true">↻</span> {copy.refresh}</>}
        </Button>
      </div>

      {/* Tile grid — matches the "接入新供应商" grid in ModelsSection */}
      <div className="space-y-1.5 pt-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-5">{copy.sectionLabel}</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {tiles.map(b => (
            <BackendTile
              key={b.id}
              backend={b}
              copy={copy}
              locale={locale}
              onClick={() => setOpenId(b.id)}
            />
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <LocalBackendModal
        open={openId !== null}
        backend={openBackend}
        catalog={catalog}
        totalRamGb={totalRamGb}
        copy={copy}
        locale={locale}
        busyConnect={!!openBackend && connecting === openBackend.id}
        onClose={() => setOpenId(null)}
        onConnect={handleConnect}
        onRefresh={refresh}
        onStartPull={handleStartPull}
        onCancelPull={handleCancelPull}
        pulls={pulls}
        onCopyHint={handleCopyHint}
      />
    </div>
  );
}

export default LocalModelsSection;
