/**
 * Shared selection UI models and action executor for interactive commands.
 */

import type { Bot, ChatId, Agent, SessionRuntime } from './bot.js';
import { normalizeAgent } from './bot.js';
import { getSessionStatusForChat } from './session-status.js';
import {
  getAgentsListData,
  getModelsListData,
  getSessionsPageData,
  getSkillsListData,
  summarizeSessionRun,
  modelMatchesSelection,
  resolveSkillPrompt,
} from './commands.js';

export type CommandAction =
  | { kind: 'sessions.page'; page: number }
  | { kind: 'session.new' }
  | { kind: 'session.switch'; sessionId: string }
  | { kind: 'agent.switch'; agent: Agent }
  | { kind: 'model.switch'; modelId: string }
  | { kind: 'effort.set'; effort: string }
  /**
   * `modelId` always carries the model identifier the agent CLI / provider
   * expects. `profileId` distinguishes BYOK Profile rows from native rows:
   *   - `null` (or absent) → user picked a native model
   *   - `'<uuid>'`         → user picked that Profile (and `modelId` is the
   *     Profile's modelId, kept for display consistency)
   */
  | { kind: 'models.select.model'; modelId: string; profileId?: string | null }
  | { kind: 'models.select.effort'; effort: string }
  | { kind: 'models.confirm' }
  | { kind: 'skill.run'; command: string }
  | { kind: 'mode.switch'; mode: string };

export type CommandItemState = 'default' | 'current' | 'running' | 'unavailable';

export interface CommandActionButton {
  label: string;
  action: CommandAction;
  state?: CommandItemState;
  primary?: boolean;
}

export interface CommandSelectionItem {
  label: string;
  detail?: string | null;
  state?: CommandItemState;
}

export interface CommandSelectionView {
  kind: 'sessions' | 'agents' | 'models' | 'skills' | 'mode';
  title: string;
  detail?: string | null;
  metaLines: string[];
  items: CommandSelectionItem[];
  emptyText?: string | null;
  helperText?: string | null;
  rows: CommandActionButton[][];
}

export interface CommandNotice {
  title: string;
  value?: string | null;
  detail?: string | null;
  valueMode?: 'code' | 'plain';
}

export type CommandActionResult =
  | { kind: 'view'; view: CommandSelectionView; callbackText?: string | null }
  | { kind: 'notice'; notice: CommandNotice; callbackText?: string | null; session?: SessionRuntime | null; previewSession?: { agent: Agent; sessionId: string | null } | null }
  | { kind: 'skill'; prompt: string; skillName: string; callbackText?: string | null }
  | { kind: 'noop'; message: string };

function chunkRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  const size = Math.max(1, columns);
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function buttonStateFromFlags(opts: { isCurrent?: boolean; isRunning?: boolean; unavailable?: boolean }): CommandItemState {
  if (opts.unavailable) return 'unavailable';
  if (opts.isRunning) return 'running';
  if (opts.isCurrent) return 'current';
  return 'default';
}

export function encodeCommandAction(action: CommandAction): string {
  switch (action.kind) {
    case 'sessions.page':
      return `sp:${Math.max(0, action.page)}`;
    case 'session.new':
      return 'sess:new';
    case 'session.switch':
      return `sess:${action.sessionId}`;
    case 'agent.switch':
      return `ag:${action.agent}`;
    case 'model.switch':
      return `mod:${action.modelId}`;
    case 'effort.set':
      return `eff:${action.effort}`;
    case 'models.select.model':
      // Encode native vs profile selection on the wire so decode is unambiguous.
      // `md:n:<modelId>` = native; `md:p:<profileId>:<modelId>` = BYOK profile.
      return action.profileId
        ? `md:p:${action.profileId}:${action.modelId}`
        : `md:n:${action.modelId}`;
    case 'models.select.effort':
      return `ed:${action.effort}`;
    case 'models.confirm':
      return 'mc';
    case 'skill.run':
      return `skr:${action.command}`;
    case 'mode.switch':
      return `pm:${action.mode}`;
  }
}

export function decodeCommandAction(data: string): CommandAction | null {
  if (data === 'sess:new') return { kind: 'session.new' };
  if (data.startsWith('sp:')) {
    const page = Number.parseInt(data.slice(3), 10);
    if (!Number.isFinite(page) || page < 0) return null;
    return { kind: 'sessions.page', page };
  }
  if (data.startsWith('sess:')) {
    const sessionId = data.slice(5);
    if (!sessionId) return null;
    return { kind: 'session.switch', sessionId };
  }
  if (data.startsWith('ag:')) {
    try {
      return { kind: 'agent.switch', agent: normalizeAgent(data.slice(3)) };
    } catch {
      return null;
    }
  }
  if (data.startsWith('mod:')) {
    const modelId = data.slice(4);
    if (!modelId) return null;
    return { kind: 'model.switch', modelId };
  }
  if (data.startsWith('eff:')) {
    const effort = data.slice(4);
    if (!effort) return null;
    return { kind: 'effort.set', effort };
  }
  if (data.startsWith('md:')) {
    const rest = data.slice(3);
    if (rest.startsWith('n:')) {
      const modelId = rest.slice(2);
      if (!modelId) return null;
      return { kind: 'models.select.model', modelId, profileId: null };
    }
    if (rest.startsWith('p:')) {
      // p:<profileId>:<modelId> — profileId is a uuid (no colons), so split on
      // the first remaining colon yields a clean (profileId, modelId) pair.
      const sep = rest.indexOf(':', 2);
      if (sep < 0) return null;
      const profileId = rest.slice(2, sep);
      const modelId = rest.slice(sep + 1);
      if (!profileId || !modelId) return null;
      return { kind: 'models.select.model', modelId, profileId };
    }
    // Legacy callback payloads (pre-union) carried `md:<modelId>` directly.
    // Treat them as native selections so old buttons in the wild still work.
    if (!rest) return null;
    return { kind: 'models.select.model', modelId: rest, profileId: null };
  }
  if (data.startsWith('ed:')) {
    const effort = data.slice(3);
    if (!effort) return null;
    return { kind: 'models.select.effort', effort };
  }
  if (data === 'mc') return { kind: 'models.confirm' };
  if (data.startsWith('skr:')) {
    const command = data.slice(4);
    if (!command) return null;
    return { kind: 'skill.run', command };
  }
  if (data.startsWith('pm:')) {
    const mode = data.slice(3);
    if (!mode) return null;
    return { kind: 'mode.switch', mode };
  }
  return null;
}

export async function buildSessionsCommandView(
  bot: Bot,
  chatId: ChatId,
  page: number,
  pageSize = 5,
): Promise<CommandSelectionView> {
  const data = await getSessionsPageData(bot, chatId, page, pageSize);
  // Multi-row: one button per session on its own line, prefixed with the
  // agent badge so a mixed workspace list reads cleanly. Avoid cramming
  // multiple buttons onto one row (some IM clients truncate).
  const sessionButtons: CommandActionButton[][] = data.sessions.map(session => [{
    label: `[${session.agent}] ${session.title} · ${session.time}`,
    action: { kind: 'session.switch', sessionId: session.key } as CommandAction,
    state: buttonStateFromFlags({ isCurrent: session.isCurrent, isRunning: session.isRunning }),
    primary: session.isCurrent,
  }]);
  const navRow: CommandActionButton[] = [];
  if (data.page > 0) navRow.push({ label: `◀ p${data.page}`, action: { kind: 'sessions.page', page: data.page - 1 } });
  navRow.push({ label: '+ New', action: { kind: 'session.new' } });
  if (data.page < data.totalPages - 1) navRow.push({ label: `p${data.page + 2} ▶`, action: { kind: 'sessions.page', page: data.page + 1 } });

  const agentChips = Object.entries(data.agentTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([agent, count]) => `${agent}:${count}`)
    .join(' · ');
  const headerDetail = data.workspaceName
    ? (agentChips ? `${data.workspaceName} · ${agentChips}` : data.workspaceName)
    : (agentChips || null);

  return {
    kind: 'sessions',
    title: 'Sessions',
    detail: headerDetail,
    metaLines: [`${data.total} total · p${data.page + 1}/${data.totalPages}`],
    items: data.sessions.map(session => ({
      label: `[${session.agent}] ${session.title}`,
      detail: session.time,
      state: buttonStateFromFlags({ isCurrent: session.isCurrent, isRunning: session.isRunning }),
    })),
    emptyText: 'No sessions found in this workspace.',
    helperText: data.totalPages > 1
      ? `Pick a row to resume (agent/model/effort restore automatically).`
      : 'Pick a row to resume, or start a new session.',
    rows: navRow.length ? [...sessionButtons, navRow] : sessionButtons,
  };
}

export function buildAgentsCommandView(bot: Bot, chatId: ChatId): CommandSelectionView {
  const data = getAgentsListData(bot, chatId);
  const installed = data.agents.filter(a => a.installed);

  // Buttons stay short — friendly label + optional ✓ marker — so they don't
  // truncate on narrow IM clients.
  const actions = installed.map(agent => ({
    label: agent.label,
    action: { kind: 'agent.switch', agent: agent.agent as Agent } as CommandAction,
    state: buttonStateFromFlags({ isCurrent: agent.isCurrent }),
    primary: agent.isCurrent,
  }));

  // Details (version + bound provider) live in the items list above the
  // buttons, where the renderer can show them in full without truncation.
  const items = installed.map(agent => {
    const main = agent.versionShort
      ? `${agent.label} · v${agent.versionShort}`
      : agent.label;
    const detail = agent.boundProvider && agent.boundModel
      ? `${agent.boundProvider} / ${agent.boundModel}`
      : null;
    return {
      label: main,
      detail,
      state: buttonStateFromFlags({ isCurrent: agent.isCurrent }),
    };
  });

  const current = installed.find(a => a.isCurrent);

  return {
    kind: 'agents',
    title: 'Agents',
    detail: current ? current.label : undefined,
    metaLines: current ? [`Current: ${current.label}`] : [],
    items,
    emptyText: actions.length ? undefined : 'No installed agents.',
    helperText: actions.length ? 'Tap an agent to switch.' : undefined,
    rows: actions.map(action => [action]),
  };
}

// ---------------------------------------------------------------------------
// Models draft state — "select then confirm" pattern
// ---------------------------------------------------------------------------

interface ModelsDraft {
  modelId: string;
  /** null = native selection; uuid = BYOK Profile selection. */
  profileId: string | null;
  effort: string | null;
}

const modelsDrafts = new Map<string, ModelsDraft>();

async function initModelsDraft(bot: Bot, chatId: ChatId): Promise<ModelsDraft> {
  const cs = bot.chat(chatId);
  const data = await getModelsListData(bot, chatId);
  const activeProfileId = bot.activeProfileIdForAgent(cs.agent);
  const draft: ModelsDraft = {
    modelId: data.currentModel,
    profileId: activeProfileId,
    effort: data.effort?.current ?? null,
  };
  modelsDrafts.set(String(chatId), draft);
  return draft;
}

/**
 * Section headings for the unified picker. The trailing em-dash padding gives
 * the row a "label" look in Telegram/Feishu — clicking it falls through to a
 * harmless confirm which is a no-op when nothing has changed.
 */
const MODEL_GROUP_LABELS: Record<'native' | 'cloud' | 'local', string> = {
  native: '— Native —',
  cloud: '— Cloud Profiles —',
  local: '— Local Profiles —',
};

/** Match a picker row against the live draft so the "current" pip is unambiguous. */
function modelRowMatchesDraft(
  agent: Agent,
  row: { id: string; profileId?: string | null; group?: 'native' | 'cloud' | 'local' },
  draft: ModelsDraft,
): boolean {
  if (draft.profileId) return !!row.profileId && row.profileId === draft.profileId;
  const isNativeRow = (row.group ?? 'native') === 'native';
  return isNativeRow && modelMatchesSelection(agent, row.id, draft.modelId);
}

export async function buildModelsCommandView(
  bot: Bot,
  chatId: ChatId,
  draft?: ModelsDraft,
): Promise<CommandSelectionView> {
  const data = await getModelsListData(bot, chatId);

  const d: ModelsDraft = draft ?? {
    modelId: data.currentModel,
    profileId: bot.activeProfileIdForAgent(data.agent),
    effort: data.effort?.current ?? null,
  };
  modelsDrafts.set(String(chatId), d);

  // Bucket rows by group while preserving the order resolveAgentModels gave us
  // (native → cloud → local). We render each non-empty group with a header.
  const groups: Record<'native' | 'cloud' | 'local', typeof data.models> = {
    native: [],
    cloud: [],
    local: [],
  };
  for (const model of data.models) {
    const g = (model.group ?? 'native') as 'native' | 'cloud' | 'local';
    groups[g].push(model);
  }

  const rows: CommandActionButton[][] = [];
  for (const group of ['native', 'cloud', 'local'] as const) {
    const rawItems = groups[group];
    if (!rawItems.length) continue;
    // Promote the currently-selected row to the top of its group so the user
    // sees their active pick first without having to scroll. This matches the
    // pre-union picker's behaviour, just scoped per-group instead of globally.
    const items = [...rawItems].sort((a, b) =>
      Number(modelRowMatchesDraft(data.agent, b, d)) - Number(modelRowMatchesDraft(data.agent, a, d))
    );
    rows.push([{
      label: MODEL_GROUP_LABELS[group],
      action: { kind: 'models.confirm' } as CommandAction,
      state: 'default' as CommandItemState,
      primary: false,
    }]);
    for (const model of items) {
      const selected = modelRowMatchesDraft(data.agent, model, d);
      const labelBase = model.alias || model.id;
      // For BYOK rows the alias is the Profile name — include provider tag so
      // two Profiles sharing a model id (e.g. "Sonnet 4.6 · OpenRouter" vs
      // "Sonnet 4.6 · Anthropic Direct") stay distinguishable in 1-column mode.
      const label = group === 'native' || !model.providerName
        ? labelBase
        : `${labelBase} · ${model.providerName}`;
      rows.push([{
        label,
        action: {
          kind: 'models.select.model',
          modelId: model.id,
          profileId: model.profileId ?? null,
        } as CommandAction,
        state: buttonStateFromFlags({ isCurrent: selected }),
        primary: selected,
      }]);
    }
  }

  if (data.effort) {
    const effortButtons = data.effort.levels.map(level => ({
      label: level.label,
      action: { kind: 'models.select.effort', effort: level.id } as CommandAction,
      state: buttonStateFromFlags({ isCurrent: level.id === d.effort }),
      primary: level.id === d.effort,
    }));
    rows.push([{
      label: '— Thinking Effort —',
      action: { kind: 'models.confirm' } as CommandAction,
      state: 'default' as CommandItemState,
      primary: false,
    }]);
    rows.push(...chunkRows(effortButtons, effortButtons.length <= 3 ? effortButtons.length : 2));
  }

  const currentProfileId = bot.activeProfileIdForAgent(data.agent);
  const profileChanged = (d.profileId || null) !== (currentProfileId || null);
  const modelChanged = !d.profileId && !currentProfileId
    && !modelMatchesSelection(data.agent, d.modelId, data.currentModel);
  const effortChanged = !!(data.effort && d.effort !== data.effort.current);
  const hasChanges = profileChanged || modelChanged || effortChanged;

  rows.push([{
    label: hasChanges ? '✓ Apply' : '✓ OK',
    action: { kind: 'models.confirm' } as CommandAction,
    state: 'default' as CommandItemState,
    primary: hasChanges,
  }]);

  return {
    kind: 'models',
    title: 'Models',
    detail: data.agent,
    metaLines: [
      ...(data.sources.length ? [`Source: ${data.sources.join(', ')}`] : []),
      ...(data.note ? [data.note] : []),
      ...(data.effort ? [`Thinking Effort: ${d.effort}`] : []),
    ],
    items: data.models.map(model => ({
      label: model.alias || model.id,
      detail: model.providerName || (model.alias ? model.id : null),
      state: buttonStateFromFlags({ isCurrent: modelRowMatchesDraft(data.agent, model, d) }),
    })),
    emptyText: 'No discoverable models found.',
    helperText: data.models.length ? 'Pick a model (native or BYOK), then tap Apply.' : null,
    rows,
  };
}

export function buildSkillsCommandView(bot: Bot, chatId: ChatId): CommandSelectionView {
  const data = getSkillsListData(bot, chatId);
  const buttons = data.skills.map(skill => ({
    label: skill.label,
    action: { kind: 'skill.run', command: skill.command } as CommandAction,
  }));

  return {
    kind: 'skills',
    title: 'Skills',
    detail: data.agent,
    metaLines: [`Workdir: ${data.workdir}`],
    items: data.skills.map(skill => ({
      label: skill.label,
      detail: skill.description || `/${skill.command}`,
    })),
    emptyText: 'No project skills found.',
    helperText: data.skills.length ? 'Use the controls below to run a skill.' : null,
    rows: chunkRows(buttons, buttons.some(button => button.label.length > 14) ? 1 : 2),
  };
}

export function buildModeCommandView(bot: Bot, chatId: ChatId): CommandSelectionView {
  const cs = bot.chat(chatId);
  const isPlanMode = cs.agent === 'claude' && bot.claudePermissionMode === 'plan';
  return {
    kind: 'mode',
    title: 'Agent Mode',
    detail: `Current: ${isPlanMode ? 'Plan (read-only)' : 'Code (full access)'}`,
    metaLines: cs.agent !== 'claude' ? ['Only available for Claude agent'] : [],
    items: [],
    rows: [
      [
        { label: 'Code', action: { kind: 'mode.switch', mode: 'bypassPermissions' },
          state: isPlanMode ? 'default' : 'current', primary: !isPlanMode },
        { label: 'Plan', action: { kind: 'mode.switch', mode: 'plan' },
          state: isPlanMode ? 'current' : 'default', primary: isPlanMode },
      ],
    ],
  };
}

export async function executeCommandAction(
  bot: Bot,
  chatId: ChatId,
  action: CommandAction,
  opts: { sessionsPageSize?: number } = {},
): Promise<CommandActionResult> {
  const sessionsPageSize = opts.sessionsPageSize ?? 5;

  switch (action.kind) {
    case 'sessions.page':
      return {
        kind: 'view',
        view: await buildSessionsCommandView(bot, chatId, action.page, sessionsPageSize),
        callbackText: '',
      };

    case 'session.new': {
      bot.resetConversationForChat(chatId);
      return {
        kind: 'notice',
        callbackText: 'New session',
        notice: { title: 'New Session', detail: 'Send a message to start.' },
      };
    }

    case 'session.switch': {
      const chat = bot.chat(chatId);
      // Workspace-wide lookup (no agent filter) so a row from any agent can be
      // resumed directly from a single mixed list.
      const result = await bot.fetchSessions(undefined, bot.chatWorkdir(chatId));
      if (!result.ok) return { kind: 'noop', message: 'Failed to load sessions' };

      const session = result.sessions.find(entry => entry.sessionId === action.sessionId);
      if (!session) return { kind: 'noop', message: 'Session not found' };

      const prevAgent = chat.agent;
      const runtime = bot.adoptExistingSessionForChat(chatId, session);
      // Restore the agent's persistent model / effort / Profile binding so the
      // next stream — and the IM picker chips — match the resumed session.
      if (session.model) {
        bot.switchModelForChat(chatId, session.model, session.profileId ?? null);
      } else if (session.profileId !== undefined) {
        // Session was native (profileId === null) — explicitly clear any
        // active Profile so we don't run with a stale BYOK binding.
        bot.switchModelForChat(chatId, bot.modelForAgent(session.agent), null);
      }
      if (session.thinkingEffort) {
        bot.switchEffortForChat(chatId, session.thinkingEffort);
      }
      const displayId = session.sessionId || action.sessionId;
      const sessionStatus = getSessionStatusForChat(bot, chat, session);
      const runDetail = summarizeSessionRun({ ...session, running: sessionStatus.isRunning }).noticeDetail;
      const restoreParts: string[] = [];
      if (prevAgent !== session.agent) restoreParts.push(`agent → ${session.agent}`);
      if (session.model) restoreParts.push(`model → ${session.model}`);
      if (session.thinkingEffort) restoreParts.push(`effort → ${session.thinkingEffort}`);
      const detail = restoreParts.length ? `${runDetail} · ${restoreParts.join(' · ')}` : runDetail;
      return {
        kind: 'notice',
        callbackText: `Switched: ${displayId.slice(0, 12)}`,
        notice: {
          title: 'Session Switched',
          value: displayId,
          detail,
          valueMode: 'code',
        },
        session: runtime,
        previewSession: { agent: session.agent, sessionId: session.sessionId },
      };
    }

    case 'agent.switch': {
      const chat = bot.chat(chatId);
      if (chat.agent === action.agent) return { kind: 'noop', message: `Already using ${action.agent}` };
      bot.switchAgentForChat(chatId, action.agent);
      const resumed = bot.selectedSession(chatId);
      return {
        kind: 'notice',
        callbackText: `Switched to ${action.agent}`,
        notice: {
          title: 'Agent',
          value: action.agent,
          detail: resumed?.agent === action.agent && resumed.sessionId ? 'Resumed previous session' : 'Session reset',
          valueMode: 'plain',
        },
        session: resumed?.agent === action.agent ? resumed : undefined,
        previewSession: resumed?.agent === action.agent
          ? { agent: resumed.agent, sessionId: resumed.sessionId }
          : null,
      };
    }

    case 'model.switch': {
      const chat = bot.chat(chatId);
      const currentModel = bot.modelForAgent(chat.agent);
      if (modelMatchesSelection(chat.agent, action.modelId, currentModel)) {
        return { kind: 'noop', message: `Already using ${action.modelId}` };
      }
      bot.switchModelForChat(chatId, action.modelId);
      return {
        kind: 'notice',
        callbackText: `Switched to ${action.modelId}`,
        notice: {
          title: 'Model',
          value: action.modelId,
          detail: `${chat.agent} · session reset`,
          valueMode: 'code',
        },
      };
    }

    case 'effort.set': {
      const chat = bot.chat(chatId);
      const currentEffort = bot.effortForAgent(chat.agent);
      if (action.effort === currentEffort) {
        return { kind: 'noop', message: `Already using ${action.effort} effort` };
      }
      bot.switchEffortForChat(chatId, action.effort);
      return {
        kind: 'notice',
        callbackText: `Effort set to ${action.effort}`,
        notice: {
          title: 'Thinking Effort',
          value: action.effort,
          detail: `${chat.agent} · takes effect on next message`,
          valueMode: 'code',
        },
      };
    }

    case 'models.select.model': {
      const draft = modelsDrafts.get(String(chatId)) ?? await initModelsDraft(bot, chatId);
      draft.modelId = action.modelId;
      // profileId can be null (native pick) or a uuid (BYOK pick). Treating
      // `undefined` as "leave alone" preserves the action shape's old contract.
      if (action.profileId !== undefined) draft.profileId = action.profileId;
      return { kind: 'view', view: await buildModelsCommandView(bot, chatId, draft), callbackText: '' };
    }

    case 'models.select.effort': {
      const draft = modelsDrafts.get(String(chatId)) ?? await initModelsDraft(bot, chatId);
      draft.effort = action.effort;
      return { kind: 'view', view: await buildModelsCommandView(bot, chatId, draft), callbackText: '' };
    }

    case 'models.confirm': {
      const chat = bot.chat(chatId);
      const draft = modelsDrafts.get(String(chatId));
      modelsDrafts.delete(String(chatId));
      if (!draft) return { kind: 'noop', message: 'No changes' };

      const currentModel = bot.modelForAgent(chat.agent);
      const currentEffort = bot.effortForAgent(chat.agent);
      const currentProfileId = bot.activeProfileIdForAgent(chat.agent);
      const profileChanged = (draft.profileId || null) !== (currentProfileId || null);
      const modelChanged = profileChanged
        || (!draft.profileId && !modelMatchesSelection(chat.agent, draft.modelId, currentModel));
      const effortChanged = draft.effort != null && draft.effort !== currentEffort;

      if (!modelChanged && !effortChanged) {
        return { kind: 'noop', message: 'No changes' };
      }

      const parts: string[] = [];
      if (modelChanged) {
        // Pass profileId explicitly: a null clears any active Profile binding,
        // a uuid binds the picked Profile. switchModelForChat handles both
        // sides of the dual path so call sites stay agnostic.
        bot.switchModelForChat(chatId, draft.modelId, draft.profileId ?? null);
        parts.push(draft.profileId ? `Profile: ${draft.modelId}` : `Model: ${draft.modelId}`);
      }
      if (effortChanged) {
        bot.switchEffortForChat(chatId, draft.effort!);
        parts.push(`Effort: ${draft.effort}`);
      }

      return {
        kind: 'notice',
        callbackText: parts.join(', '),
        notice: {
          title: 'Configuration Updated',
          value: parts.join('\n'),
          detail: modelChanged
            ? `${chat.agent} · session reset`
            : `${chat.agent} · takes effect on next message`,
          valueMode: 'plain',
        },
      };
    }

    case 'skill.run': {
      const resolved = resolveSkillPrompt(bot, chatId, action.command, '');
      if (!resolved) return { kind: 'noop', message: 'Skill not found' };
      return {
        kind: 'skill',
        prompt: resolved.prompt,
        skillName: resolved.skillName,
        callbackText: `Run ${resolved.skillName}`,
      };
    }

    case 'mode.switch': {
      const cs = bot.chat(chatId);
      if (cs.agent !== 'claude') {
        return { kind: 'noop', message: 'Mode toggle is only available for Claude agent' };
      }
      bot.switchPermissionModeForChat(chatId, action.mode);
      const label = action.mode === 'plan' ? 'Plan (read-only)' : 'Code (full access)';
      return {
        kind: 'notice',
        callbackText: `Mode: ${label}`,
        notice: { title: 'Agent Mode', value: label },
      };
    }
  }
}
