/**
 * Agent configuration tab.
 *
 * Two independent concerns sit on each agent card:
 *
 *   1. Install state (CLI binary present on PATH) — purely a status check.
 *      When not installed, the only available action is "Install"; we do NOT
 *      surface configuration controls because they would be moot.
 *
 *   2. Provider / Model / Effort — editable inline once installed. Provider is
 *      the primary single-pick (Native CLI auth or any connected BYOK
 *      provider); Model and Effort follow the chosen provider.
 *
 * The top "新会话默认值" section only picks which agent is the default for new
 * sessions. Each agent's own model/effort/provider lives on its own card and
 * is editable any time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { createT, type Locale } from '../../i18n';
import { useStore } from '../../store';
import type { Agent, AgentRuntimeStatus, AgentStatusResponse, ModelInfo } from '../../types';
import { AGENT_ACCEPTED_PROVIDER_KINDS, cn, EFFORT_OPTIONS, getAgentMeta } from '../../utils';
import { BrandIcon } from '../../components/BrandIcon';
import { Badge, Button, Input, Label, Modal, ModalHeader, ModelSelect, Select, Spinner } from '../../components/ui';
import { SectionCard } from '../shared';
import ModelsSection, { useModelLayer, type ModelLayerSnapshot } from '../models/ModelsTab';
import LocalModelsSection, { useLocalBackends } from '../local-models/LocalModelsSection';
import ProfilesSection from '../profiles/ProfilesSection';

const NATIVE_PROVIDER_VALUE = '__native__';
const AGENT_ORDER: Agent[] = ['claude', 'codex', 'gemini', 'hermes'];

// Mirrors the backend type in src/model/validation.ts. Pricing fields are USD
// per 1M tokens; `created` is unix epoch (seconds).
interface ProviderModelInfo {
  id: string;
  name?: string;
  created?: number;
  contextLength?: number;
  pricePromptUsd?: number;
  priceCompletionUsd?: number;
}

function formatUsdPerMillion(n: number | undefined): string | null {
  if (n === undefined || !Number.isFinite(n)) return null;
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(1)}`;
}

function formatContextLength(n: number | undefined): string | null {
  if (!n || !Number.isFinite(n)) return null;
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M ctx`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K ctx`;
  return `${n} ctx`;
}

function formatCreatedDate(epochSeconds: number | undefined): string | null {
  if (!epochSeconds || !Number.isFinite(epochSeconds)) return null;
  // OpenRouter / OpenAI use seconds; Anthropic sometimes returns ms. Detect by
  // magnitude: anything older than year 3000 in seconds is almost certainly
  // already in milliseconds.
  const ms = epochSeconds > 32_000_000_000 ? epochSeconds : epochSeconds * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

/**
 * Two-line option for a provider model. Line 1 is the raw model id (e.g.
 * `openai/gpt-5.4-mini`) so users can always see exactly what they are
 * binding — friendly names like "OpenAI: GPT-5.4 Mini" hide the
 * provider/slash structure that matters when picking between near-duplicates.
 * Line 2 is the friendly name (when it adds info) followed by pricing →
 * context → release date, monospace and muted.
 */
function buildModelOption(info: ProviderModelInfo): { label: string; description?: string } {
  const label = info.id;
  const parts: string[] = [];
  const friendly = info.name?.trim();
  if (friendly && friendly.toLowerCase() !== info.id.toLowerCase()) parts.push(friendly);
  const prompt = formatUsdPerMillion(info.pricePromptUsd);
  const completion = formatUsdPerMillion(info.priceCompletionUsd);
  if (prompt && completion) parts.push(`${prompt} / ${completion} per 1M`);
  else if (prompt) parts.push(`${prompt} prompt / 1M`);
  const ctx = formatContextLength(info.contextLength);
  if (ctx) parts.push(ctx);
  const released = formatCreatedDate(info.created);
  if (released) parts.push(released);
  return { label, description: parts.length ? parts.join(' · ') : undefined };
}

/**
 * When true the agent's native CLI config is *external* to pikiclaw — we
 * read it but cannot write to it (e.g. Hermes' ~/.hermes/config.yaml is
 * managed via `hermes config`). The unified config modal keeps native fields
 * read-only for these.
 */
function isNativeConfigExternal(agent: Agent): boolean {
  return agent === 'hermes';
}

/**
 * Map a native provider slug returned by the driver (e.g. 'openrouter') to a
 * BrandIcon id. Falls back to 'custom' when unknown.
 */
function brandIdForNativeSlug(slug: string | undefined | null): string {
  const s = (slug || '').toLowerCase().trim();
  if (s === 'openrouter') return 'openrouter';
  if (s === 'anthropic') return 'anthropic';
  if (s === 'openai') return 'openai';
  if (s === 'google' || s === 'gemini') return 'google';
  if (s === 'deepseek') return 'deepseek';
  if (s === 'qwen' || s === 'dashscope') return 'qwen';
  if (s === 'doubao' || s === 'volces' || s === 'volcengine') return 'doubao';
  if (s === 'glm' || s === 'zhipu' || s === 'bigmodel') return 'glm';
  if (s === 'minimax') return 'minimax';
  return 'custom';
}

// ---------------------------------------------------------------------------
// Bound profile info — what an agent's currently-active Profile resolves to.
// ---------------------------------------------------------------------------

interface BoundProfileInfo {
  profileId: string;
  providerId: string;
  providerName: string;
  providerBrand: string;
  modelId: string;
  effort: string | null;
}

function brandIdForProvider(p: { kind: string; baseURL: string }): string {
  const host = (() => { try { return new URL(p.baseURL).host.toLowerCase(); } catch { return ''; } })();
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

function buildBoundInfo(layer: ModelLayerSnapshot, agentId: string): BoundProfileInfo | null {
  const profileId = layer.bindings[agentId];
  if (!profileId) return null;
  const profile = layer.profiles.find(p => p.id === profileId);
  if (!profile) return null;
  const provider = layer.providers.find(p => p.id === profile.providerId);
  if (!provider) return null;
  return {
    profileId: profile.id,
    providerId: provider.id,
    providerName: provider.name,
    providerBrand: brandIdForProvider(provider),
    modelId: profile.modelId,
    effort: profile.effort || null,
  };
}

type SnapshotState = {
  defaultAgent: Agent;
  agents: AgentRuntimeStatus[];
};

type CopyPack = {
  defaultsTitle: string;
  defaultsHint: string;
  defaultsEditTitle: string;
  defaultsEditHint: string;
  defaultsSaved: string;
  editDefaults: string;
  agentsTitle: string;
  defaultAgent: string;
  installLabel: string;
  versionLabel: string;
  defaultBadge: string;
  installed: string;
  notInstalled: string;
  notInstalledHint: string;
  noModel: string;
  noVersion: string;
  loadFailed: string;
  updateAvailable: string;
  updateSkipped: string;
  updateFailed: string;
  update: string;
  updating: string;
  checkUpdate: string;
  checking: string;
  upToDate: string;
  install: string;
  installing: string;
  profilesTitle: string;
  profilesHint: string;
  modelsTitle: string;
  modelsHint: string;
  localTitle: string;
  localHint: string;
  // Inline editor labels
  rowProvider: string;
  rowModel: string;
  rowEffort: string;
  rowWorkflow: string;
  workflowOn: string;
  workflowOff: string;
  workflowHint: string;
  providerNative: string;
  providerNativeFromAgent: string;
  effortDefault: string;
  modelLoading: string;
  modelEmpty: string;
  modelCustomToggle: string;
  modelListToggle: string;
  modelCustomPlaceholder: string;
  modelSearchPlaceholder: string;
  modelSearchEmpty: string;
  modelCurrentLabel: string;
  modelGroupNative: string;
  modelGroupProfiles: string;
  modelPickerEmpty: string;
  modelPickerEmptyHint: string;
  saveChanges: string;
  saving: string;
  saved: string;
  configError: string;
  // Read-only banner for external native (Hermes)
  externalNativeNote: (path: string) => string;
  // Compact agent row + modal
  configure: string;
  configModalTitle: (label: string) => string;
  rowSummaryNative: string;
  rowSummaryNoModel: string;
  rowSummaryNoEffort: string;
  rowWorkflowChipOn: string;
  rowWorkflowChipOff: string;
};

function getCopy(locale: Locale): CopyPack {
  if (locale === 'zh-CN') {
    return {
      defaultsTitle: '新会话默认值',
      defaultsHint: '决定新建对话默认走哪个智能体。具体模型与推理强度由该智能体卡片下的「供应商 / 模型 / 推理强度」决定。',
      defaultsEditTitle: '修改默认智能体',
      defaultsEditHint: '选择新建对话默认走哪个智能体。',
      defaultsSaved: '默认智能体已更新',
      editDefaults: '修改默认',
      agentsTitle: '可用智能体',
      defaultAgent: '默认智能体',
      installLabel: '安装状态',
      versionLabel: '版本',
      defaultBadge: '默认',
      installed: '已安装',
      notInstalled: '未安装',
      notInstalledHint: '安装该智能体的本地 CLI 后即可在此配置供应商与模型。',
      noModel: '未设置',
      noVersion: '版本未知',
      loadFailed: '无法加载智能体状态',
      updateAvailable: '有新版本',
      updateSkipped: '自动更新已跳过',
      updateFailed: '自动更新失败',
      update: '升级',
      updating: '升级中…',
      checkUpdate: '检查更新',
      checking: '检查中…',
      upToDate: '已是最新',
      install: '安装',
      installing: '安装中…',
      profilesHint: '把你常用的模型登记成一条条快捷方式，自由起别名。这是一份纯粹的选择列表——智能体（包括 Hermes）会从这里挑模型，但选了谁不会反向显示在这里。',
      profilesTitle: '我的模型',
      modelsTitle: '模型供应商',
      modelsHint: '接入 BYOK 供应商；接入后可在上方"我的模型"里挑选具体模型并固定下来。',
      localTitle: '本地模型',
      localHint: '在本机检测 Ollama / mlx-lm 并按内存推荐合适的开源模型；接入后会作为一个供应商出现在智能体卡片中。',
      rowProvider: '供应商',
      rowModel: '模型',
      rowEffort: '推理强度',
      rowWorkflow: '多智能体编排',
      workflowOn: '开启',
      workflowOff: '关闭（默认）',
      workflowHint: '开启后，遇到大型多步任务（广度调研、大规模重构 / 审计、跨多文件评审）智能体可自行编排多个子智能体并行处理。关闭时彻底禁用 Workflow 工具，普通对话不受影响。',
      providerNative: '官方（CLI 内置认证）',
      providerNativeFromAgent: '智能体自身配置',
      effortDefault: '默认',
      modelLoading: '正在拉取模型列表…',
      modelEmpty: '该供应商未返回模型列表，请使用自定义输入。',
      modelCustomToggle: '改为自定义输入',
      modelListToggle: '从列表选择',
      modelCustomPlaceholder: 'anthropic/claude-sonnet-4',
      modelSearchPlaceholder: '搜索模型',
      modelSearchEmpty: '没有匹配的模型',
      modelCurrentLabel: '当前',
      modelGroupNative: '官方',
      modelGroupProfiles: '我的模型',
      modelPickerEmpty: '没有可选模型',
      modelPickerEmptyHint: '该智能体的官方模型列表为空，且你还没有登记任何"我的模型"。',
      saveChanges: '保存',
      saving: '保存中…',
      saved: '已保存',
      configError: '保存失败',
      externalNativeNote: path => `Hermes 当前从 ${path || '~/.hermes/config.yaml'} 读取这些值；切换为某个 BYOK 供应商可由 pikiclaw 接管。`,
      configure: '配置',
      configModalTitle: label => `配置 ${label}`,
      rowSummaryNative: '官方认证',
      rowSummaryNoModel: '未选模型',
      rowSummaryNoEffort: '默认强度',
      rowWorkflowChipOn: '编排开',
      rowWorkflowChipOff: '编排关',
    };
  }
  return {
    defaultsTitle: 'New Session Defaults',
    defaultsHint: 'Pick which agent new sessions use by default. Provider / Model / Effort live on each agent card below.',
    defaultsEditTitle: 'Change Default Agent',
    defaultsEditHint: 'Which agent should new sessions use by default?',
    defaultsSaved: 'Default agent updated',
    editDefaults: 'Change default',
    agentsTitle: 'Available Agents',
    defaultAgent: 'Default Agent',
    installLabel: 'Install',
    versionLabel: 'Version',
    defaultBadge: 'Default',
    installed: 'Installed',
    notInstalled: 'Not installed',
    notInstalledHint: 'Install the local CLI for this agent to configure its provider and model.',
    noModel: 'Not set',
    noVersion: 'Version unavailable',
    loadFailed: 'Failed to load agent status',
    updateAvailable: 'Update available',
    updateSkipped: 'Auto-update skipped',
    updateFailed: 'Auto-update failed',
    update: 'Update',
    updating: 'Updating…',
    checkUpdate: 'Check update',
    checking: 'Checking…',
    upToDate: 'Up to date',
    install: 'Install',
    installing: 'Installing…',
    profilesTitle: 'My Models',
    profilesHint: 'Register the models you actually use as named shortcuts. A pure selection list — agents (including Hermes) pick from here, but who picks what does not bubble back into this view.',
    modelsTitle: 'Model Providers',
    modelsHint: 'Connect BYOK providers; pin specific models above in "My Models".',
    localTitle: 'Local Models',
    localHint: 'Detect Ollama / mlx-lm on this machine and surface coding models that fit your RAM. Connected backends show up as a provider on the agent cards.',
    rowProvider: 'Provider',
    rowModel: 'Model',
    rowEffort: 'Effort',
    rowWorkflow: 'Multi-agent Workflow',
    workflowOn: 'On',
    workflowOff: 'Off (default)',
    workflowHint: 'When on, the agent may orchestrate multiple sub-agents in parallel for large multi-step work (broad research, big refactors/audits, cross-file reviews). Off fully disables the Workflow tool; ordinary chat is unaffected.',
    providerNative: 'Native (CLI auth)',
    providerNativeFromAgent: "agent's own config",
    effortDefault: 'default',
    modelLoading: 'Loading model list…',
    modelEmpty: 'Provider returned no model list — use custom input.',
    modelCustomToggle: 'Use custom input',
    modelListToggle: 'Pick from list',
    modelCustomPlaceholder: 'anthropic/claude-sonnet-4',
    modelSearchPlaceholder: 'Search models',
    modelSearchEmpty: 'No matching models',
    modelCurrentLabel: 'Current',
    modelGroupNative: 'Native',
    modelGroupProfiles: 'My Models',
    modelPickerEmpty: 'No models available',
    modelPickerEmptyHint: 'This agent has no native model list, and no "My Models" entries are registered.',
    saveChanges: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    configError: 'Save failed',
    externalNativeNote: path => `Hermes reads these values from ${path || '~/.hermes/config.yaml'}; pick a BYOK provider to let pikiclaw take over.`,
    configure: 'Configure',
    configModalTitle: label => `Configure ${label}`,
    rowSummaryNative: 'Native auth',
    rowSummaryNoModel: 'No model',
    rowSummaryNoEffort: 'Default effort',
    rowWorkflowChipOn: 'Workflow on',
    rowWorkflowChipOff: 'Workflow off',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAgentOptions(agents: AgentRuntimeStatus[], copy: CopyPack) {
  const installedAgents = agents.filter(agent => agent.installed);
  const source = installedAgents.length ? installedAgents : agents;
  return source.map(agent => ({
    value: agent.agent,
    label: `${getAgentMeta(agent.agent).label} · ${agent.installed ? (agent.version || copy.installed) : copy.notInstalled}`,
  }));
}

function modelLabel(model: ModelInfo | null | undefined): string {
  if (!model) return '—';
  return model.alias || model.id;
}

function defaultNativeModel(agent: AgentRuntimeStatus): string {
  // Prefer the agent's *native* model surface — `selectedModel` is now
  // BYOK-overridden when a Profile is bound, so falling through to it would
  // seed the native editor with a BYOK model id that the CLI can't run.
  if (agent.nativeSelectedModel) return agent.nativeSelectedModel;
  if (agent.nativeConfig?.model) return agent.nativeConfig.model;
  if (agent.models.length) return agent.models[0].id;
  return '';
}

function applySnapshot(setter: (value: SnapshotState) => void, next: AgentStatusResponse) {
  setter({ defaultAgent: next.defaultAgent, agents: next.agents });
}

// ---------------------------------------------------------------------------
// Inline editor — Provider / Model / Effort
// ---------------------------------------------------------------------------

/**
 * Unified selection: either a native model id (kind='native') or a Profile id
 * from "My Models" (kind='profile'). The Provider column is gone — Profile IS
 * the upstream contract, the Provider field underneath is now an internal
 * detail of the chosen Profile, not a separate axis the user picks.
 */
interface ConfigDraft {
  kind: 'native' | 'profile';
  /** When kind='native': the model id to send to the CLI.
   *  When kind='profile': mirrors the Profile's modelId for display/dirty checks. */
  modelId: string;
  /** Active Profile id when kind='profile'; null when kind='native'. */
  profileId: string | null;
  /** Agent-level effort override. Stored in runtime config regardless of kind. */
  effort: string;
  /** Multi-agent Workflow orchestration toggle. Agent-level, kind-independent. */
  workflow: boolean;
}

function makeInitialDraft(
  _agentId: Agent,
  agentStatus: AgentRuntimeStatus | null,
  boundInfo: BoundProfileInfo | null,
): ConfigDraft {
  if (boundInfo) {
    return {
      kind: 'profile',
      modelId: boundInfo.modelId,
      profileId: boundInfo.profileId,
      effort: boundInfo.effort || '',
      workflow: !!agentStatus?.workflowEnabled,
    };
  }
  const native = agentStatus?.nativeConfig || null;
  return {
    kind: 'native',
    modelId: native?.model || agentStatus?.selectedModel || '',
    profileId: null,
    effort: native?.effort || agentStatus?.selectedEffort || '',
    workflow: !!agentStatus?.workflowEnabled,
  };
}

function draftEqual(a: ConfigDraft, b: ConfigDraft): boolean {
  return a.kind === b.kind
    && (a.profileId || '') === (b.profileId || '')
    && a.modelId.trim() === b.modelId.trim()
    && (a.effort || '') === (b.effort || '')
    && a.workflow === b.workflow;
}

/** Encode/decode the unified selection on the wire used by ModelSelect.
 *  Format mirrors the IM picker codec: `n:<modelId>` for native rows,
 *  `p:<profileId>` for Profile rows. */
function encodeSelection(draft: ConfigDraft): string {
  return draft.kind === 'profile' && draft.profileId
    ? `p:${draft.profileId}`
    : `n:${draft.modelId}`;
}
function decodeSelection(value: string): { kind: 'native'; modelId: string } | { kind: 'profile'; profileId: string } | null {
  if (value.startsWith('n:')) return { kind: 'native', modelId: value.slice(2) };
  if (value.startsWith('p:')) return { kind: 'profile', profileId: value.slice(2) };
  return null;
}

function AgentInlineConfig({
  agentId,
  agentStatus,
  boundInfo,
  copy,
  layer,
  toast,
  onSaved,
  onCancel,
  t,
}: {
  agentId: Agent;
  agentStatus: AgentRuntimeStatus;
  boundInfo: BoundProfileInfo | null;
  copy: CopyPack;
  layer: ModelLayerSnapshot;
  toast: (msg: string, ok?: boolean) => void;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const externalNative = isNativeConfigExternal(agentId);
  const native = agentStatus.nativeConfig || null;

  const baseline = useMemo(
    () => makeInitialDraft(agentId, agentStatus, boundInfo),
    [agentId, agentStatus, boundInfo],
  );
  const [draft, setDraft] = useState<ConfigDraft>(baseline);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(baseline); setError(null); }, [baseline]);

  const isNative = draft.kind === 'native';
  // External-native means we can't write the model from here (Hermes) — we
  // surface it as a read-only display when the native selection is active.
  const nativeReadOnly = isNative && externalNative;

  const effortOptions = useMemo(() => {
    const levels = EFFORT_OPTIONS[agentId] || EFFORT_OPTIONS['claude'];
    return [
      { value: '', label: copy.effortDefault },
      ...levels.map(v => ({ value: v, label: v })),
    ];
  }, [agentId, copy.effortDefault]);

  // Build the unified picker options: native rows from the agent CLI's own
  // model list, then every Profile registered in "My Models". Provider is
  // intentionally NOT a separate axis — selecting a Profile *is* selecting
  // the upstream binding wholesale.
  //
  // External-native agents (Hermes — config lives in ~/.hermes/config.yaml)
  // skip the native group entirely: pikiclaw can't enumerate Hermes' native
  // catalogue, and the backend's `agentStatus.models` for these agents falls
  // back to the currently-bound Profile id, which would surface as a fake
  // "Native" row of the Profile's own modelId.
  const modelOptions = useMemo(() => {
    type RichOpt = { value: string; label: string; description?: string; meta?: string; group?: string };
    const out: RichOpt[] = [];
    if (!externalNative) {
      for (const m of agentStatus.models) {
        const aliasNormalized = m.alias?.toLowerCase().replace(/[\s_-]/g, '');
        const idNormalized = m.id.toLowerCase().replace(/[\s_-]/g, '');
        const showAlias = m.alias && aliasNormalized !== idNormalized;
        out.push({
          value: `n:${m.id}`,
          label: m.id,
          description: showAlias ? m.alias! : undefined,
          group: copy.modelGroupNative,
        });
      }
    }
    // Only Profiles whose provider kind the agent can actually route through
    // (cf. injector.ts) are eligible. Gemini for example can only BYOK via
    // `google` kind — listing an OpenRouter Profile here would let the user
    // pick a binding that fails at spawn time.
    const acceptedKinds = new Set(AGENT_ACCEPTED_PROVIDER_KINDS[agentId] || []);
    for (const p of layer.profiles) {
      const provider = layer.providers.find(x => x.id === p.providerId);
      if (!provider || !acceptedKinds.has(provider.kind)) continue;
      const providerName = provider.name;
      // Description: provider name + raw modelId when it differs from the
      // user-set display name. Keeps the row informative without doubling up
      // on the visible name when the user left it as the model id default.
      const showModelId = p.name.trim().toLowerCase() !== p.modelId.trim().toLowerCase();
      const description = showModelId ? `${providerName} · ${p.modelId}` : providerName;
      out.push({
        value: `p:${p.id}`,
        label: p.name,
        description,
        group: copy.modelGroupProfiles,
      });
    }
    return out;
  }, [agentId, agentStatus.models, layer.profiles, layer.providers, copy.modelGroupNative, copy.modelGroupProfiles, externalNative]);

  const selectionValue = encodeSelection(draft);

  const handleSelectionChange = useCallback((value: string) => {
    const parsed = decodeSelection(value);
    if (!parsed) return;
    if (parsed.kind === 'native') {
      setDraft(d => ({
        ...d,
        kind: 'native',
        modelId: parsed.modelId,
        profileId: null,
        // When flipping out of a Profile back to native, restore the native
        // effort we know about rather than carrying the Profile's effort over.
        effort: d.kind === 'profile'
          ? (agentStatus.nativeSelectedEffort || agentStatus.nativeConfig?.effort || '')
          : d.effort,
      }));
    } else {
      const profile = layer.profiles.find(p => p.id === parsed.profileId);
      setDraft(d => ({
        ...d,
        kind: 'profile',
        profileId: parsed.profileId,
        modelId: profile?.modelId || d.modelId,
        // Carry the Profile's own effort (if it has one) over so the field
        // reflects what the chosen entry was last configured with.
        effort: profile?.effort || d.effort,
      }));
    }
  }, [layer.profiles, agentStatus.nativeSelectedEffort, agentStatus.nativeConfig]);

  const dirty = !draftEqual(draft, baseline);
  const canSave = !submitting && dirty && (nativeReadOnly || !!draft.modelId.trim() || draft.kind === 'profile');

  const submit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const targetEffort = draft.effort || null;

      if (draft.kind === 'native') {
        // Clear any active Profile binding. We do NOT delete the Profile here —
        // it lives in "My Models" as a shared user resource, independent of
        // which agent currently uses it.
        if (layer.bindings[agentId]) await layer.setActiveProfile(agentId, null);
        if (!externalNative) {
          const patch: Record<string, unknown> = { agent: agentId };
          const targetModel = draft.modelId.trim();
          if (targetModel && targetModel !== (agentStatus.nativeSelectedModel || '')) patch.model = targetModel;
          if (targetEffort !== (agentStatus.nativeSelectedEffort || null)) patch.effort = targetEffort;
          if (Object.keys(patch).length > 1) {
            const res = await api.updateRuntimeAgent(patch);
            if (!res.ok) throw new Error(res.error || 'Failed to update agent');
          }
        }
      } else {
        if (!draft.profileId) throw new Error('No profile selected');
        await layer.setActiveProfile(agentId, draft.profileId);
        // Effort is an agent-level override; we keep it in runtime config
        // rather than mutating the shared Profile entry from here.
        if (targetEffort !== (agentStatus.selectedEffort || null)) {
          const res = await api.updateRuntimeAgent({ agent: agentId, effort: targetEffort });
          if (!res.ok) throw new Error(res.error || 'Failed to update agent');
        }
      }

      // Workflow orchestration is an agent-level toggle, orthogonal to the
      // model/effort/provider binding above — sync it independently when it
      // diverges from the saved state and the driver supports it.
      if (agentStatus.capabilities?.workflow && draft.workflow !== !!agentStatus.workflowEnabled) {
        const res = await api.updateRuntimeAgent({ agent: agentId, workflow: draft.workflow });
        if (!res.ok) throw new Error(res.error || 'Failed to update agent');
      }

      await Promise.resolve(onSaved());
      toast(copy.saved);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setError(msg);
      toast(`${copy.configError}: ${msg}`, false);
    } finally {
      setSubmitting(false);
    }
  }, [agentId, agentStatus, copy, draft, externalNative, layer, onSaved, toast]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Model — unified picker: native rows + Profile rows from "我的模型". */}
        <div>
          <Label className="!mb-1 text-[11px]">{copy.rowModel}</Label>
          {nativeReadOnly ? (
            <div className="flex h-9 items-center rounded-md border border-control-border bg-control px-3 text-[13px] text-fg-3">
              <span className="truncate font-mono">{native?.model || copy.noModel}</span>
            </div>
          ) : modelOptions.length === 0 ? (
            <div className="rounded-md border border-edge bg-panel-alt px-3 py-3">
              <div className="text-[12px] font-medium text-fg-3">{copy.modelPickerEmpty}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-fg-5">{copy.modelPickerEmptyHint}</div>
            </div>
          ) : (
            <ModelSelect
              value={selectionValue}
              options={modelOptions}
              onChange={handleSelectionChange}
              placeholder="—"
              searchPlaceholder={copy.modelSearchPlaceholder}
              noMatchesText={copy.modelSearchEmpty}
              currentLabel={copy.modelCurrentLabel}
            />
          )}
        </div>

        {/* Effort */}
        <div>
          <Label className="!mb-1 text-[11px]">{copy.rowEffort}</Label>
          {nativeReadOnly ? (
            <div className="flex h-9 items-center rounded-md border border-control-border bg-control px-3 text-[13px] text-fg-3">
              <span className="font-mono">{native?.effort || copy.effortDefault}</span>
            </div>
          ) : (
            <Select
              value={draft.effort}
              options={effortOptions}
              onChange={v => setDraft(d => ({ ...d, effort: v }))}
            />
          )}
        </div>
      </div>

      {/* Workflow orchestration — orthogonal toggle, only for drivers that
          advertise the capability (claude). Default OFF; enabling lets the
          agent fan out multi-agent Workflows on large tasks. */}
      {agentStatus.capabilities?.workflow && (
        <div>
          <Label className="!mb-1 text-[11px]">{copy.rowWorkflow}</Label>
          <Select
            value={draft.workflow ? 'on' : 'off'}
            options={[
              { value: 'off', label: copy.workflowOff },
              { value: 'on', label: copy.workflowOn },
            ]}
            onChange={v => setDraft(d => ({ ...d, workflow: v === 'on' }))}
          />
          <div className="mt-1 text-[11px] leading-relaxed text-fg-5">{copy.workflowHint}</div>
        </div>
      )}

      {/* External-native (Hermes) hint when native is selected. */}
      {nativeReadOnly && (
        <div className="text-[11px] leading-relaxed text-fg-5">
          {copy.externalNativeNote(native?.configPath || '')}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Save / Cancel — always visible so the modal has the standard pair of
          terminal actions, matching the defaults modal pattern. Save stays
          disabled until the draft diverges from baseline. */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
          {t('modal.cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={!canSave} onClick={() => void submit()}>
          {submitting && <Spinner className="h-3 w-3" />}
          {submitting ? copy.saving : copy.saveChanges}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentRow — single agent card
// ---------------------------------------------------------------------------

/**
 * Compact summary line shown in the collapsed AgentRow. Returns the values
 * that the row needs to render its `provider · model · effort` chip strip.
 * `providerLabel` is intentionally short — full provider name lives in the
 * config modal where the user actually picks one.
 */
function buildRowSummary(
  agent: AgentRuntimeStatus,
  boundInfo: BoundProfileInfo | null,
  copy: CopyPack,
): { providerBrand: string; providerLabel: string; modelText: string; effortText: string } {
  if (boundInfo) {
    return {
      providerBrand: boundInfo.providerBrand,
      providerLabel: boundInfo.providerName,
      modelText: boundInfo.modelId || copy.rowSummaryNoModel,
      effortText: boundInfo.effort || copy.rowSummaryNoEffort,
    };
  }
  const native = agent.nativeConfig || null;
  const nativeSlug = native?.provider || null;
  return {
    providerBrand: brandIdForNativeSlug(nativeSlug),
    providerLabel: copy.rowSummaryNative,
    modelText: agent.nativeSelectedModel || native?.model || agent.selectedModel || copy.rowSummaryNoModel,
    effortText: agent.nativeSelectedEffort || native?.effort || agent.selectedEffort || copy.rowSummaryNoEffort,
  };
}

function AgentRow({
  agent,
  copy,
  t,
  installing,
  onInstall,
  updatingAgent,
  checkingAgent,
  onUpdate,
  onCheckUpdate,
  onEdit,
  loading = false,
  boundInfo,
}: {
  agent: AgentRuntimeStatus;
  copy: CopyPack;
  t: (key: string) => string;
  installing: boolean;
  onInstall: (agent: AgentRuntimeStatus) => void;
  updatingAgent: boolean;
  checkingAgent: boolean;
  onUpdate: (agent: AgentRuntimeStatus) => void;
  onCheckUpdate: (agent: AgentRuntimeStatus) => void;
  onEdit: (agent: AgentRuntimeStatus) => void;
  loading?: boolean;
  boundInfo: BoundProfileInfo | null;
}) {
  const meta = getAgentMeta(agent.agent);
  const tagline = meta.advantageKey ? t(meta.advantageKey) : '';
  const summary = agent.installed ? buildRowSummary(agent, boundInfo, copy) : null;

  return (
    <div
      className="glass rounded-md border border-edge px-3.5 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.02),0_4px_12px_rgba(15,23,42,0.05)]"
      title={tagline || undefined}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-edge bg-panel-alt">
          <BrandIcon brand={agent.agent} size={20} />
        </div>

        {/* Identity + summary (two tight lines) */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold tracking-tight text-fg">{meta.label}</span>
            {agent.isDefault && <Badge variant="accent">{copy.defaultBadge}</Badge>}
            {loading
              ? <Badge variant="muted"><Spinner className="h-3 w-3" /> {t('status.loading')}</Badge>
              : agent.installed
                ? <Badge variant="ok">{copy.installed}</Badge>
                : <Badge variant="muted">{copy.notInstalled}</Badge>}
            {agent.installed && agent.updateAvailable && (
              <Badge variant="warn">{copy.updateAvailable}</Badge>
            )}
            {agent.installed && agent.version && (
              <span className="text-[11px] font-mono text-fg-5">v{agent.version}</span>
            )}
            {agent.latestVersion && agent.updateAvailable && (
              <span className="text-[11px] text-amber-400">→ {agent.latestVersion}</span>
            )}
          </div>
          {/* Line 2: config summary for installed agents, tagline for missing ones. */}
          {summary ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-4">
              <span className="inline-flex items-center gap-1">
                <BrandIcon brand={summary.providerBrand} size={11} />
                <span className="text-fg-3">{summary.providerLabel}</span>
              </span>
              <span className="text-fg-6" aria-hidden="true">·</span>
              <span className="font-mono text-fg-3">{summary.modelText}</span>
              <span className="text-fg-6" aria-hidden="true">·</span>
              <span>{summary.effortText}</span>
              {agent.capabilities?.workflow && (
                <>
                  <span className="text-fg-6" aria-hidden="true">·</span>
                  {agent.workflowEnabled
                    ? <Badge variant="accent">{copy.rowWorkflowChipOn}</Badge>
                    : <span className="text-fg-5">{copy.rowWorkflowChipOff}</span>}
                </>
              )}
            </div>
          ) : tagline ? (
            <div className="mt-0.5 truncate text-[11px] text-fg-5">{tagline}</div>
          ) : null}
        </div>

        {/* Right-side actions: install / update / check-update / configure */}
        <div className="flex shrink-0 items-center gap-1.5">
          {loading && (
            <div className="inline-flex h-7 items-center gap-2 px-2 text-[11px] text-fg-5">
              <Spinner className="h-3 w-3" />
            </div>
          )}
          {!loading && !agent.installed && (
            <Button variant="primary" size="sm" disabled={installing} onClick={() => onInstall(agent)}>
              {installing ? copy.installing : copy.install}
            </Button>
          )}
          {!loading && agent.installed && agent.updateAvailable && (
            <Button variant="outline" size="sm" disabled={updatingAgent} onClick={() => onUpdate(agent)}>
              {updatingAgent ? copy.updating : copy.update}
            </Button>
          )}
          {!loading && agent.installed && !agent.updateAvailable && (
            <Button
              variant="ghost"
              size="icon"
              disabled={checkingAgent}
              onClick={() => onCheckUpdate(agent)}
              title={copy.checkUpdate}
              aria-label={copy.checkUpdate}
              className="h-7 w-7"
            >
              {checkingAgent ? <Spinner className="h-3 w-3" /> : <span aria-hidden="true">↻</span>}
            </Button>
          )}
          {!loading && agent.installed && (
            <Button variant="outline" size="sm" onClick={() => onEdit(agent)}>
              {copy.configure}
            </Button>
          )}
        </div>
      </div>

      {/* Update status detail (errors / skipped reasons). */}
      {!loading && agent.installed && agent.updateAvailable && agent.updateStatus === 'skipped' && agent.updateDetail && (
        <div className="mt-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--th-badge-warn-text)' }}>
          {copy.updateSkipped}: {agent.updateDetail}
        </div>
      )}
      {!loading && agent.installed && agent.updateStatus === 'failed' && agent.updateDetail && (
        <div className="mt-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--th-badge-err-text)' }}>
          {copy.updateFailed}: {agent.updateDetail}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Defaults summary (single SummaryField — kept tight)
// ---------------------------------------------------------------------------

function SummaryField({ label, value, hint, loading = false }: {
  label: string; value: string; hint?: string; loading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel-alt px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-5">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-[13px] font-semibold text-fg-2">
        {loading && <Spinner className="h-3.5 w-3.5" />}
        <span>{value}</span>
      </div>
      {hint && <div className="mt-0.5 text-[10px] leading-relaxed text-fg-5">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level — defaults summary + agent list + Models section + modal
// ---------------------------------------------------------------------------

export function AgentTab() {
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const storeAgentStatus = useStore(s => s.agentStatus);
  const setStoreAgentStatus = useStore(s => s.setAgentStatus);
  const refreshStoreAgentStatus = useStore(s => s.refreshAgentStatus);
  const t = useMemo(() => createT(locale), [locale]);
  const copy = useMemo(() => getCopy(locale), [locale]);
  const modelLayer = useModelLayer();
  // Probed once at the AgentTab level so both ModelsSection (to surface
  // installed local models on the configured provider card) and
  // LocalModelsSection (tile grid + install modal) share one source of truth.
  const localBackendLayer = useLocalBackends();

  const [snapshot, setSnapshot] = useState<SnapshotState | null>(
    storeAgentStatus ? { defaultAgent: storeAgentStatus.defaultAgent, agents: storeAgentStatus.agents } : null,
  );
  const [loading, setLoading] = useState(!storeAgentStatus);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [installingAgent, setInstallingAgent] = useState<Agent | null>(null);
  const [defaultsModalOpen, setDefaultsModalOpen] = useState(false);
  const [defaultsDraft, setDefaultsDraft] = useState<Agent>('codex');
  const [updatingAgent, setUpdatingAgent] = useState<Agent | null>(null);
  const [checkingAgent, setCheckingAgent] = useState<Agent | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const hasLoaded = useRef(!!storeAgentStatus);

  useEffect(() => {
    if (storeAgentStatus) {
      applySnapshot(setSnapshot, storeAgentStatus);
      if (!hasLoaded.current) { hasLoaded.current = true; setLoading(false); }
    }
  }, [storeAgentStatus]);

  const applyAndSync = useCallback((status: AgentStatusResponse) => {
    applySnapshot(setSnapshot, status);
    setStoreAgentStatus(status);
  }, [setStoreAgentStatus]);

  const refresh = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);
    try {
      const status = await api.getAgentStatus();
      applyAndSync(status);
      setError(null);
      hasLoaded.current = true;
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.loadFailed;
      setError(message);
      if (!hasLoaded.current) toast(message, false);
      return null;
    } finally {
      setLoading(false);
    }
  }, [applyAndSync, copy.loadFailed, toast]);

  useEffect(() => {
    if (!storeAgentStatus) void refresh();
    else void refreshStoreAgentStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agents = useMemo(() => {
    const source = snapshot?.agents || [];
    const map = new Map(source.map(agent => [agent.agent, agent] as const));
    return AGENT_ORDER.map(agentId => {
      const current = map.get(agentId);
      if (current) return current;
      const meta = getAgentMeta(agentId);
      return {
        agent: agentId,
        label: meta.label,
        installed: false,
        version: undefined,
        installCommand: undefined,
        selectedModel: null,
        selectedEffort: null,
        isDefault: snapshot?.defaultAgent === agentId,
        models: [],
        usage: null,
      } satisfies AgentRuntimeStatus;
    });
  }, [snapshot]);

  const defaultAgent = snapshot?.defaultAgent || 'codex';
  const defaultAgentStatus = agents.find(agent => agent.agent === defaultAgent) || null;
  const installedAgents = agents.filter(agent => agent.installed);
  const canEditDefaults = installedAgents.length > 0;
  const agentOptions = buildAgentOptions(agents, copy);

  const updateRuntime = useCallback(async (patch: Record<string, unknown>) => {
    setUpdating(true);
    try {
      const result = await api.updateRuntimeAgent(patch);
      if (!result.ok) throw new Error(result.error || t('config.applyFailed'));
      applyAndSync(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : t('config.applyFailed');
      toast(message, false);
      void refresh();
      return null;
    } finally {
      setUpdating(false);
    }
  }, [applyAndSync, refresh, t, toast]);

  useEffect(() => {
    if (!defaultsModalOpen) return;
    setDefaultsDraft(defaultAgent);
  }, [defaultAgent, defaultsModalOpen]);

  const handleSaveDefaults = useCallback(async () => {
    if (defaultsDraft === defaultAgent) {
      setDefaultsModalOpen(false);
      return;
    }
    const result = await updateRuntime({ defaultAgent: defaultsDraft });
    if (!result) return;
    toast(copy.defaultsSaved);
    setDefaultsModalOpen(false);
  }, [copy.defaultsSaved, defaultAgent, defaultsDraft, toast, updateRuntime]);

  const handleInstall = useCallback(async (agent: AgentRuntimeStatus) => {
    if (installingAgent) return;
    setInstallingAgent(agent.agent);
    try {
      const result = await api.installAgent(agent.agent);
      if (!result.ok) throw new Error(result.error || t('config.agentInstallFailed'));
      applyAndSync(result);
      toast(t('config.agentInstalled'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('config.agentInstallFailed');
      toast(message, false);
      void refresh();
    } finally {
      setInstallingAgent(current => (current === agent.agent ? null : current));
    }
  }, [applyAndSync, installingAgent, refresh, t, toast]);

  const handleUpdate = useCallback(async (agent: AgentRuntimeStatus) => {
    if (updatingAgent) return;
    setUpdatingAgent(agent.agent);
    try {
      const result = await api.updateAgent(agent.agent);
      if (!result.ok) throw new Error(result.error || t('config.agentInstallFailed'));
      applyAndSync(result);
      toast(copy.upToDate);
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.updateFailed;
      toast(message, false);
      void refresh();
    } finally {
      setUpdatingAgent(current => (current === agent.agent ? null : current));
    }
  }, [applyAndSync, copy.updateFailed, copy.upToDate, refresh, t, toast, updatingAgent]);

  const handleCheckUpdate = useCallback(async (agent: AgentRuntimeStatus) => {
    if (checkingAgent) return;
    setCheckingAgent(agent.agent);
    try {
      const result = await api.checkAgentUpdate(agent.agent);
      if (!result.ok) throw new Error(result.error || copy.loadFailed);
      applyAndSync(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.loadFailed;
      toast(message, false);
      void refresh();
    } finally {
      setCheckingAgent(current => (current === agent.agent ? null : current));
    }
  }, [applyAndSync, checkingAgent, copy.loadFailed, refresh, toast]);

  const initialLoading = loading && !snapshot;
  const defaultAgentValue = initialLoading
    ? t('status.loading')
    : defaultAgentStatus
      ? getAgentMeta(defaultAgentStatus.agent).label
      : copy.notInstalled;
  const defaultAgentHint = initialLoading
    ? t('status.loading')
    : defaultAgentStatus?.installed ? copy.installed : copy.notInstalled;

  const handleConfigSaved = useCallback(async () => {
    await modelLayer.reload();
    await refresh();
  }, [modelLayer, refresh]);

  const editingAgentStatus = editingAgent ? agents.find(a => a.agent === editingAgent) ?? null : null;
  const editingMeta = editingAgentStatus ? getAgentMeta(editingAgentStatus.agent) : null;

  return (
    <div className="animate-in space-y-4">
      {/* Compact section: agent list with inline "default" strip on top.
          The default-agent chip is a single button — label + brand + name +
          chevron are baked into one pill, so the affordance is the chip
          itself rather than a separate ghost "修改默认" button that nobody
          notices. Same "click the thing to edit it" pattern as the rest
          of the page. */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-5">{copy.agentsTitle}</div>
          {initialLoading ? (
            <div className="flex items-center gap-1.5 text-[12px] text-fg-5">
              <Spinner className="h-3 w-3" />
              <span>{copy.defaultAgent}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDefaultsModalOpen(true)}
              disabled={updating || !canEditDefaults}
              title={copy.editDefaults}
              className="group inline-flex items-center gap-1.5 rounded-full border border-edge bg-panel-alt px-3 py-1 text-[12px] transition hover:border-edge-strong hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-fg-5 group-hover:text-fg-4">{copy.defaultAgent}</span>
              <BrandIcon brand={defaultAgent} size={14} />
              <span className="font-semibold text-fg-2">{defaultAgentValue}</span>
              <svg
                className="text-fg-6 transition group-hover:text-fg-3"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {agents.map(agent => (
            <AgentRow
              key={agent.agent}
              agent={agent}
              copy={copy}
              t={t}
              installing={installingAgent === agent.agent}
              loading={initialLoading}
              onInstall={handleInstall}
              updatingAgent={updatingAgent === agent.agent}
              checkingAgent={checkingAgent === agent.agent}
              onUpdate={handleUpdate}
              onCheckUpdate={handleCheckUpdate}
              onEdit={a => setEditingAgent(a.agent)}
              boundInfo={buildBoundInfo(modelLayer, agent.agent)}
            />
          ))}
        </div>
      </section>

      {error && (
        <SectionCard className="border-amber-500/20 bg-amber-500/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] text-fg-2">{error}</div>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              {t('sessions.retry')}
            </Button>
          </div>
        </SectionCard>
      )}

      <section className="space-y-3 pt-4">
        <div className="flex items-baseline justify-between border-t border-edge pt-4">
          <div>
            <div className="text-base font-semibold tracking-tight text-fg">{copy.profilesTitle}</div>
            <div className="mt-0.5 text-[13px] leading-relaxed text-fg-4">{copy.profilesHint}</div>
          </div>
        </div>
        <ProfilesSection snapshot={modelLayer} />
      </section>

      <section className="space-y-3 pt-4">
        <div className="flex items-baseline justify-between border-t border-edge pt-4">
          <div>
            <div className="text-base font-semibold tracking-tight text-fg">{copy.modelsTitle}</div>
            <div className="mt-0.5 text-[13px] leading-relaxed text-fg-4">{copy.modelsHint}</div>
          </div>
        </div>
        <ModelsSection snapshot={modelLayer} localBackends={localBackendLayer.backends} />
      </section>

      <section className="space-y-3 pt-4">
        <div className="flex items-baseline justify-between border-t border-edge pt-4">
          <div>
            <div className="text-base font-semibold tracking-tight text-fg">{copy.localTitle}</div>
            <div className="mt-0.5 text-[13px] leading-relaxed text-fg-4">{copy.localHint}</div>
          </div>
        </div>
        <LocalModelsSection snapshot={localBackendLayer} onConnected={handleConfigSaved} />
      </section>

      {/* Per-agent configure modal — provider/model/effort. Wraps the same
          form the inline card used to render. AgentInlineConfig keeps its own
          dirty/save state; we just close the modal after onSaved fires. */}
      <Modal open={!!editingAgentStatus} onClose={() => setEditingAgent(null)} wide>
        {editingAgentStatus && editingMeta && (
          <>
            <ModalHeader
              title={copy.configModalTitle(editingMeta.label)}
              description={editingMeta.advantageKey ? t(editingMeta.advantageKey) : undefined}
              onClose={() => setEditingAgent(null)}
            />
            <AgentInlineConfig
              agentId={editingAgentStatus.agent}
              agentStatus={editingAgentStatus}
              boundInfo={buildBoundInfo(modelLayer, editingAgentStatus.agent)}
              copy={copy}
              layer={modelLayer}
              toast={toast}
              t={t}
              onSaved={async () => {
                await handleConfigSaved();
                setEditingAgent(null);
              }}
              onCancel={() => setEditingAgent(null)}
            />
          </>
        )}
      </Modal>

      {/* Defaults modal — agent only */}
      <Modal open={defaultsModalOpen} onClose={() => setDefaultsModalOpen(false)}>
        <ModalHeader
          title={copy.defaultsEditTitle}
          description={copy.defaultsEditHint}
          onClose={() => setDefaultsModalOpen(false)}
        />
        <div className="space-y-4">
          <div>
            <Label>{copy.defaultAgent}</Label>
            <Select
              value={defaultsDraft}
              options={agentOptions}
              onChange={v => setDefaultsDraft(v as Agent)}
              disabled={updating || !canEditDefaults}
              placeholder={copy.notInstalled}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDefaultsModalOpen(false)}>
            {t('modal.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={updating || defaultsDraft === defaultAgent}
            onClick={() => void handleSaveDefaults()}
          >
            {updating ? t('config.validating') : t('modal.save')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default AgentTab;
