/**
 * Local Models section — sits on the Agents page after `<ModelsSection>`.
 *
 * Two pluggable backends today: Ollama (cross-platform default) and mlx-lm
 * (Apple Silicon native peak performance). UX shape mirrors the Extensions →
 * CLI page on purpose:
 *
 *   1. Tile grid: Ollama + mlx-lm, each opens a modal.
 *   2. Modal step A — Status: probe + version + brew/pipx install commands
 *      for the current OS, plus the "start the server" command.
 *   3. Modal step B — Models: list installed; for the recommended catalog, show
 *      the user-runnable shell command (`ollama pull <tag>` / `mlx_lm.server
 *      --model <repo>`) with a copy button. We deliberately do NOT stream
 *      downloads from the dashboard — they take minutes-to-hours and the user
 *      is better served running them in a real terminal where Ctrl-C works.
 *
 * There is no "connect to agents" step: a detected backend is auto-attached
 * server-side and shows up as a Provider in the Model Providers list above.
 * When that happens during a probe, we call `onConnected` so the upper layers
 * refetch and the agent dropdowns see the new provider without a page reload.
 *
 * Hardware fit: host total RAM from /api/host vs each entry's `minRamGb`.
 *   totalGb ≥ minRamGb + 4   → ok
 *   totalGb ≥ minRamGb        → tight
 *   otherwise                 → no-go
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { useStore } from '../../store';
import type { Locale } from '../../i18n';
import type {
  LocalBackendStatus,
  LocalBackendOs,
  LocalModelCatalogEntry,
} from '../../types';
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
  tileStatusUnsupported: string;
  tileBadgeReady: (n: number) => string;
  tileBlurbOllama: string;
  tileBlurbMlx: string;
  tileInstalledModels: (n: number) => string;

  modalTitle: (label: string) => string;
  modalDescription: (label: string) => string;
  stepStatus: string;
  stepModels: string;

  statusRunning: string;
  statusNotRunning: string;
  statusUnsupportedDesc: (label: string) => string;
  statusRecheck: string;
  statusRechecking: string;
  statusInstallHeader: string;
  statusInstallDocs: string;
  statusRunHint: string;
  statusHomepageCta: string;
  statusAutoAttachedHint: (label: string) => string;

  modelsInstalledHeader: (n: number) => string;
  modelsInstalledEmpty: string;
  modelsRecommendedHeader: string;
  modelsBackendOffline: string;
  fitOk: string;
  fitTight: string;
  fitNoGo: string;
  modelInstalledBadge: string;
  pullPrefix: string;
  copyCommand: string;
  copied: string;

  closeBtn: string;
}

function getCopy(locale: Locale): Copy {
  if (locale === 'zh-CN') {
    return {
      sectionLabel: '本地后端',
      hostLabel: '本机',
      hostUnknown: '检测中…',
      refresh: '刷新',
      refreshing: '刷新中…',
      loadFailed: '加载失败',

      tileStatusDetected: '已运行',
      tileStatusNotDetected: '未检测到',
      tileStatusUnsupported: '不支持当前系统',
      tileBadgeReady: n => `${n} 个模型已就绪`,
      tileBlurbOllama: '跨平台默认，CLI 友好，模型下载到本地后常驻',
      tileBlurbMlx: 'Apple Silicon 原生，性能压榨极限，按需启动',
      tileInstalledModels: n => `${n} 个模型`,

      modalTitle: label => `准备 ${label}`,
      modalDescription: label => `安装 ${label}、下载所需模型、核对运行状态——本地模型的全部配置都在这里完成。`,
      stepStatus: '后端状态',
      stepModels: '模型',

      statusRunning: '已运行',
      statusNotRunning: '未在本机检测到此后端',
      statusUnsupportedDesc: label => `${label} 不支持当前系统。`,
      statusRecheck: '重新检测',
      statusRechecking: '检测中…',
      statusInstallHeader: '安装命令',
      statusInstallDocs: '官方安装文档',
      statusRunHint: '启动服务（安装后）',
      statusHomepageCta: '官网',
      statusAutoAttachedHint: label => `本地 ${label} 已在运行；继续在下方下载并核对所需模型。`,

      modelsInstalledHeader: n => `已就绪（${n}）`,
      modelsInstalledEmpty: '后端在线，但尚未加载任何模型。在终端按下方命令准备一个。',
      modelsRecommendedHeader: '推荐模型 · 在终端执行以下命令准备',
      modelsBackendOffline: '启动后端后再返回此处准备模型。',
      fitOk: '推荐',
      fitTight: '勉强可跑',
      fitNoGo: '内存不足',
      modelInstalledBadge: '已就绪',
      pullPrefix: '终端执行',
      copyCommand: '复制',
      copied: '已复制',

      closeBtn: '完成',
    };
  }
  return {
    sectionLabel: 'Local backends',
    hostLabel: 'This machine',
    hostUnknown: 'Detecting…',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    loadFailed: 'Failed to load local backends',

    tileStatusDetected: 'Running',
    tileStatusNotDetected: 'Not detected',
    tileStatusUnsupported: 'Not supported on this OS',
    tileBadgeReady: n => `${n} models ready`,
    tileBlurbOllama: 'Cross-platform default, CLI-friendly, models persist on disk',
    tileBlurbMlx: 'Apple Silicon native, peak performance, on-demand launch',
    tileInstalledModels: n => `${n} models`,

    modalTitle: label => `Prepare ${label}`,
    modalDescription: label => `Install ${label}, download the models you want, and verify they're running — all the local-model configuration lives in this panel.`,
    stepStatus: 'Backend status',
    stepModels: 'Models',

    statusRunning: 'Running',
    statusNotRunning: 'Backend not detected on this machine',
    statusUnsupportedDesc: label => `${label} does not run on this OS.`,
    statusRecheck: 'Re-check',
    statusRechecking: 'Checking…',
    statusInstallHeader: 'Install commands',
    statusInstallDocs: 'Official install docs',
    statusRunHint: 'Start the server (after install)',
    statusHomepageCta: 'Homepage',
    statusAutoAttachedHint: label => `Local ${label} is running. Continue below to download and verify the models you need.`,

    modelsInstalledHeader: n => `Ready (${n})`,
    modelsInstalledEmpty: 'Backend is up but no model is loaded. Use the command below to prepare one.',
    modelsRecommendedHeader: 'Recommended models — run these in your terminal',
    modelsBackendOffline: 'Start the backend first, then come back to prepare models.',
    fitOk: 'Recommended',
    fitTight: 'Tight fit',
    fitNoGo: 'Not enough RAM',
    modelInstalledBadge: 'Ready',
    pullPrefix: 'Run in terminal',
    copyCommand: 'Copy',
    copied: 'Copied',

    closeBtn: 'Done',
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

function pullCommandFor(backend: LocalBackendStatus, entry: LocalModelCatalogEntry): string | null {
  const id = backend.id === 'ollama' ? entry.ollamaTag : entry.mlxModel;
  if (!id) return null;
  return backend.pullCommandTemplate.replace('${model}', id);
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

function catalogFor(backend: LocalBackendStatus, catalog: LocalModelCatalogEntry[]): LocalModelCatalogEntry[] {
  return catalog.filter(e => backend.id === 'ollama' ? !!e.ollamaTag : !!e.mlxModel);
}

function entryInstalledOn(entry: LocalModelCatalogEntry, backend: LocalBackendStatus): string | null {
  const tag = backend.id === 'ollama' ? entry.ollamaTag : entry.mlxModel;
  if (!tag) return null;
  const base = tag.split(':')[0].toLowerCase();
  for (const m of backend.models) {
    if (m.id.toLowerCase().startsWith(base)) return m.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared probe hook
// ---------------------------------------------------------------------------

export interface LocalBackendsSnapshot {
  backends: LocalBackendStatus[];
  catalog: LocalModelCatalogEntry[];
  currentOs: LocalBackendOs | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<{ addedProviderIds: string[] }>;
}

export function useLocalBackends(): LocalBackendsSnapshot {
  const [backends, setBackends] = useState<LocalBackendStatus[]>([]);
  const [catalog, setCatalog] = useState<LocalModelCatalogEntry[]>([]);
  const [currentOs, setCurrentOs] = useState<LocalBackendOs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<{ addedProviderIds: string[] }> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.probeLocalModels();
      if (!res.ok) throw new Error(res.error || 'Failed to load local backends');
      setBackends(res.backends || []);
      setCatalog(res.catalog || []);
      setCurrentOs(res.currentOs ?? null);
      return { addedProviderIds: res.addedProviderIds ?? [] };
    } catch (e: any) {
      setError(e?.message || String(e));
      return { addedProviderIds: [] };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { backends, catalog, currentOs, loading, error, refresh };
}

// ---------------------------------------------------------------------------
// Tile
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
  const unsupported = !backend.supportedOnThisOs;
  const blurb = backend.id === 'ollama' ? copy.tileBlurbOllama : copy.tileBlurbMlx;

  // Single status: detected backends are auto-attached, so the only signal we
  // need is "running with N models" vs "not detected".
  const badge = unsupported
    ? <Badge variant="muted">{copy.tileStatusUnsupported}</Badge>
    : backend.detected
      ? <Badge variant="ok">{copy.tileBadgeReady(backend.models.length)}</Badge>
      : null;

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
// Shared step header / chips / command row
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

function CommandRow({
  label,
  cmd,
  copy,
  onCopy,
}: {
  label?: string;
  cmd: string;
  copy: Copy;
  onCopy: (cmd: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <code
        className="flex-1 truncate rounded-md border border-edge bg-panel px-2.5 py-1.5 font-mono text-[12px] text-fg-3"
        title={cmd}
      >
        {label && <span className="mr-2 text-fg-5">{label}</span>}
        {cmd}
      </code>
      <button
        type="button"
        onClick={() => onCopy(cmd)}
        className="shrink-0 rounded-md border border-edge bg-panel-alt px-2 py-1 text-[11px] text-fg-3 transition hover:border-edge-strong hover:bg-panel"
      >
        {copy.copyCommand}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalog row
// ---------------------------------------------------------------------------

function CatalogRow({
  entry,
  backend,
  totalRamGb,
  copy,
  locale,
  onCopy,
}: {
  entry: LocalModelCatalogEntry;
  backend: LocalBackendStatus;
  totalRamGb: number | null;
  copy: Copy;
  locale: Locale;
  onCopy: (cmd: string) => void;
}) {
  const fit = fitFor(totalRamGb, entry.minRamGb);
  const blurb = locale === 'zh-CN' ? entry.descriptionZh : entry.description;
  const installedId = entryInstalledOn(entry, backend);
  const cmd = pullCommandFor(backend, entry);

  return (
    <div className="rounded-md border border-edge bg-panel-alt px-3 py-2.5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-fg">{entry.name}</div>
          <span className="text-[11px] text-fg-5">{entry.publisher}</span>
          {fit === 'ok' && <Badge variant="ok">{copy.fitOk}</Badge>}
          {fit === 'tight' && <Badge variant="warn">{copy.fitTight}</Badge>}
          {fit === 'no-go' && <Badge variant="err">{copy.fitNoGo}</Badge>}
          {installedId && <Badge variant="accent">{copy.modelInstalledBadge}</Badge>}
        </div>
        <div className="text-[12px] leading-relaxed text-fg-4">{blurb}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-5">
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
        {!installedId && fit !== 'no-go' && cmd && (
          <CommandRow label={copy.pullPrefix} cmd={cmd} copy={copy} onCopy={onCopy} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal — status + models. No connect step: detected backends auto-attach.
// ---------------------------------------------------------------------------

function LocalBackendModal({
  open,
  backend,
  catalog,
  totalRamGb,
  currentOs,
  copy,
  locale,
  onClose,
  onRefresh,
  onCopy,
}: {
  open: boolean;
  backend: LocalBackendStatus | null;
  catalog: LocalModelCatalogEntry[];
  totalRamGb: number | null;
  currentOs: LocalBackendOs | null;
  copy: Copy;
  locale: Locale;
  onClose: () => void;
  onRefresh: () => Promise<{ addedProviderIds: string[] }>;
  onCopy: (cmd: string) => void;
}) {
  const [rechecking, setRechecking] = useState(false);
  useEffect(() => { setRechecking(false); }, [backend?.detected, backend?.id]);

  const backendCatalog = useMemo(
    () => !backend ? [] : catalogFor(backend, catalog).sort((a, b) => {
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
  const unsupported = !backend.supportedOnThisOs;
  const installCommands = currentOs ? (backend.install[currentOs] || []) : [];

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
          <div className="space-y-2 rounded-md border border-edge bg-panel-alt px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-edge bg-panel">
                <BrandIcon brand={backend.id} size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-fg">{backend.label}</span>
                  {unsupported
                    ? <Badge variant="muted">{copy.tileStatusUnsupported}</Badge>
                    : backend.detected
                      ? <Badge variant="ok">{copy.statusRunning}</Badge>
                      : <Badge variant="muted">{copy.tileStatusNotDetected}</Badge>}
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-fg-5">
                  {unsupported ? (
                    <>{copy.statusUnsupportedDesc(backend.label)}</>
                  ) : backend.detected ? (
                    <>
                      {backend.version && <>v{backend.version} · </>}
                      <span className="font-mono">{backend.baseURL}</span>
                    </>
                  ) : (
                    <>{copy.statusNotRunning}</>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={backend.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-accent underline-offset-2 hover:underline"
                >
                  {copy.statusHomepageCta}
                </a>
                {!unsupported && (
                  <Button variant="outline" size="sm" disabled={rechecking} onClick={() => void handleRecheck()}>
                    {rechecking
                      ? <><Spinner className="h-3 w-3" /> {copy.statusRechecking}</>
                      : <><span aria-hidden="true">↻</span> {copy.statusRecheck}</>}
                  </Button>
                )}
              </div>
            </div>

            {/* Auto-attached confirmation when the backend is running — gives a
                clear answer to "did pikiclaw see it?" without making the user
                click anything. */}
            {!unsupported && backend.detected && backend.existingProviderId && (
              <div className="rounded-md border border-emerald-700/20 bg-emerald-700/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300">
                {copy.statusAutoAttachedHint(backend.label)}
              </div>
            )}

            {/* Install + run commands — CLI-style. Hidden once detected. */}
            {!unsupported && !backend.detected && (
              <div className="space-y-2 pt-1">
                {installCommands.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5">
                      {copy.statusInstallHeader}
                    </div>
                    {installCommands.map((c, i) => (
                      <CommandRow key={i} label={c.label} cmd={c.cmd} copy={copy} onCopy={onCopy} />
                    ))}
                    {backend.install.docs && (
                      <a
                        href={backend.install.docs}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-accent underline-offset-2 hover:underline"
                      >
                        {copy.statusInstallDocs} →
                      </a>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5">
                    {copy.statusRunHint}
                  </div>
                  <CommandRow
                    label={backend.runHint.label}
                    cmd={backend.runHint.cmd}
                    copy={copy}
                    onCopy={onCopy}
                  />
                </div>
              </div>
            )}
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
                        copy={copy}
                        locale={locale}
                        onCopy={onCopy}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="mt-6 border-t border-edge pt-4">
        <ActionBar primary={{ label: copy.closeBtn, onClick: onClose }} />
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
  /**
   * Called whenever a probe auto-attaches a new local backend as a Provider,
   * so the host page can refetch upper-layer state (Model Providers, agent
   * dropdowns) without the user reloading the page.
   */
  onConnected?: () => void | Promise<void>;
}) {
  const locale = useStore(s => s.locale);
  const host = useStore(s => s.host);
  const toast = useStore(s => s.toast);
  const copy = useMemo(() => getCopy(locale), [locale]);

  const local = useLocalBackends();
  const eff = snapshot ?? local;
  const { backends, catalog, currentOs, loading, error, refresh } = eff;

  const [openId, setOpenId] = useState<LocalBackendStatus['id'] | null>(null);
  const openBackend = useMemo(
    () => backends.find(b => b.id === openId) ?? null,
    [backends, openId],
  );

  // Auto-attach happens server-side on every probe. When the probe response
  // reports new provider ids, ping upper layers exactly once per event.
  const lastAttachKeyRef = useRef<string>('');
  useEffect(() => {
    const ids = backends.map(b => b.existingProviderId || '').join(',');
    if (ids === lastAttachKeyRef.current) return;
    lastAttachKeyRef.current = ids;
    if (onConnected && backends.some(b => b.existingProviderId)) {
      void onConnected();
    }
  }, [backends, onConnected]);

  const handleRefresh = useCallback(async () => {
    const r = await refresh();
    if (onConnected && r.addedProviderIds.length > 0) await onConnected();
    return r;
  }, [refresh, onConnected]);

  const handleCopy = useCallback((cmd: string) => {
    void navigator.clipboard?.writeText(cmd);
    toast(copy.copied);
  }, [copy.copied, toast]);

  const totalRamGb = host?.totalMem ? host.totalMem / 1024 ** 3 : null;
  const hostSummary = host
    ? `${host.cpuModel || host.arch} · ${formatGb(host.totalMem)} RAM`
    : copy.hostUnknown;

  // Two-tile placeholder while the first probe runs.
  const tiles: LocalBackendStatus[] = backends.length > 0
    ? backends
    : [
        {
          id: 'ollama', label: 'Ollama', detected: false,
          baseURL: 'http://127.0.0.1:11434', openAIBaseURL: 'http://127.0.0.1:11434/v1',
          models: [], existingProviderId: null,
          homepage: 'https://ollama.com/',
          install: {}, runHint: { cmd: 'ollama serve' }, pullCommandTemplate: 'ollama pull ${model}',
          supportedOnThisOs: true,
        },
        {
          id: 'mlx', label: 'mlx-lm', detected: false,
          baseURL: 'http://127.0.0.1:8080', openAIBaseURL: 'http://127.0.0.1:8080/v1',
          models: [], existingProviderId: null,
          homepage: 'https://github.com/ml-explore/mlx-lm',
          install: {}, runHint: { cmd: 'mlx_lm.server --port 8080' }, pullCommandTemplate: 'mlx_lm.server --model ${model} --port 8080',
          supportedOnThisOs: true,
        },
      ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] text-fg-5">
          <span className="font-semibold uppercase tracking-[0.14em] text-fg-5">{copy.hostLabel}</span>
          <span className="mx-2 text-fg-6">·</span>
          <span className="text-fg-3">{hostSummary}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void handleRefresh()} disabled={loading}>
          {loading
            ? <><Spinner className="h-3 w-3" /> {copy.refreshing}</>
            : <><span aria-hidden="true">↻</span> {copy.refresh}</>}
        </Button>
      </div>

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
        currentOs={currentOs}
        copy={copy}
        locale={locale}
        onClose={() => setOpenId(null)}
        onRefresh={handleRefresh}
        onCopy={handleCopy}
      />
    </div>
  );
}

export default LocalModelsSection;
