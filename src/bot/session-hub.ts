/**
 * session-hub.ts — Unified session management service.
 *
 * THE canonical interface for all session operations across pikiclaw.
 * Upper-layer code (bot, dashboard, CLI) should import session functions
 * from here, not from code-agent.ts directly.
 *
 * Responsibilities:
 *   - Cross-agent / workspace-scoped session queries
 *   - Session metadata management (status, notes, links, classification)
 *   - Migration, export/import orchestration
 *   - Workspace registry (delegates to user-config)
 */

import path from 'node:path';
import {
  getSessions as _getSessions,
  getSessionTail as _getSessionTail,
  getSessionMessages as _getSessionMessages,
  classifySession as _classifySession,
  deriveUserStatus as _deriveStatusFromOutcome,
  exportSession as _exportSession,
  importSession as _importSession,
  findPikiclawSession,
  updateSessionMeta,
  deleteAgentSession as _deleteAgentSession,
  type DeleteAgentSessionOpts, type DeleteAgentSessionResult,
  collapseSkillPrompt,
  type Agent, type SessionInfo, type SessionListResult,
  type SessionTailResult, type SessionTailOpts,
  type SessionMessagesOpts, type SessionMessagesResult,
  type SessionClassification, type TailMessage, type RichMessage, type MessageBlock, type StreamResult,
  type ExportSessionOpts, type ExportSessionResult,
  type ImportSessionOpts, type ImportSessionResult,
  type MigrateSessionOpts, type SessionRunState,
} from '../agent/index.js';
import { allDriverIds, hasDriver } from '../agent/driver.js';
import {
  loadWorkspaces, addWorkspace, removeWorkspace, renameWorkspace,
  reorderWorkspaces, updateWorkspace, findWorkspace,
  type WorkspaceEntry,
} from '../core/config/user-config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserStatus = 'inbox' | 'active' | 'review' | 'done' | 'parked';

/** Flexible query options — supports single-agent, multi-agent, or all-agent queries. */
export interface SessionQueryOpts {
  workdir: string;
  /** Single agent, array of agents, or omit for all installed agents. */
  agent?: Agent | Agent[];
  limit?: number;
  userStatus?: UserStatus[];
}

/** Unified query result — superset of the old SessionListResult. */
export interface SessionQueryResult {
  ok: boolean;
  workdir: string;
  workspaceName: string;
  sessions: WorkspaceSessionInfo[];
  statusCounts: Record<UserStatus | 'unknown', number>;
  total: number;
  /** Per-agent errors, empty when all succeeded */
  errors: string[];
}

/** Session info enriched with workspace context. */
export interface WorkspaceSessionInfo extends SessionInfo {
  workspaceName: string;
}

/** Overview of a single workspace (sidebar / all-workspaces view). */
export interface WorkspaceOverview {
  workspace: WorkspaceEntry;
  attentionCount: number;
  agentSummary: Array<{ agent: string; active: number; review: number; total: number }>;
  lastActivityAt: string | null;
}

/** Patch object for session metadata updates. */
export interface SessionPatch {
  userStatus?: UserStatus | null;
  userNote?: string | null;
  classification?: SessionClassification;
  migratedFrom?: { agent: Agent; sessionId: string };
  migratedTo?: { agent: Agent; sessionId: string };
  addLink?: { agent: Agent; sessionId: string };
}

export interface MigrateResult {
  ok: boolean;
  contextInjected: string;
  messageCount: number;
  error: string | null;
}

// Re-export types that callers commonly need alongside session-hub functions
export type {
  Agent, SessionInfo, SessionClassification, TailMessage, RichMessage, MessageBlock,
  SessionTailResult, SessionMessagesOpts, SessionMessagesResult,
  ExportSessionOpts, ExportSessionResult, ImportSessionOpts, ImportSessionResult,
  MigrateSessionOpts, WorkspaceEntry, SessionListResult, SessionRunState,
};

// ---------------------------------------------------------------------------
// Resolve user status
// ---------------------------------------------------------------------------

/**
 * Compute the effective user status for a session.
 * Priority: explicit userStatus > derived from classification > inbox.
 */
export function resolveUserStatus(session: Pick<SessionInfo, 'userStatus' | 'classification'>): UserStatus {
  if (session.userStatus) return session.userStatus as UserStatus;
  if (session.classification) return _deriveStatusFromOutcome(session.classification.outcome);
  return 'inbox';
}

// ---------------------------------------------------------------------------
// Unified session query
// ---------------------------------------------------------------------------

function normalizeAgents(agent?: Agent | Agent[]): Agent[] {
  if (!agent) return allDriverIds().filter(a => hasDriver(a));
  const list = Array.isArray(agent) ? agent : [agent];
  return list.filter(a => hasDriver(a));
}

/**
 * Query sessions — the single entry point for all session listing.
 *
 * Handles single-agent, multi-agent, and all-agent queries with optional
 * status filtering and limits. Returns workspace-enriched results.
 */
export async function querySessions(opts: SessionQueryOpts): Promise<SessionQueryResult> {
  const resolvedWorkdir = path.resolve(opts.workdir);
  const ws = findWorkspace(resolvedWorkdir);
  const workspaceName = ws?.name || path.basename(resolvedWorkdir);
  const agents = normalizeAgents(opts.agent);

  const results = await Promise.all(
    agents.map(agent =>
      _getSessions({ agent, workdir: resolvedWorkdir }).catch((): SessionListResult => ({
        ok: false, sessions: [], error: `Failed to fetch ${agent} sessions`,
      })),
    ),
  );

  let allSessions: WorkspaceSessionInfo[] = [];
  const errors: string[] = [];
  let anyOk = false;

  for (const result of results) {
    if (result.ok) anyOk = true;
    if (result.error) errors.push(result.error);
    for (const session of result.sessions) {
      allSessions.push({ ...session, workspaceName });
    }
  }

  // Sort by most recent activity
  allSessions.sort((a, b) => {
    const aTime = a.runUpdatedAt || a.createdAt || '';
    const bTime = b.runUpdatedAt || b.createdAt || '';
    return Date.parse(bTime) - Date.parse(aTime);
  });

  // Filter by userStatus
  if (opts.userStatus?.length) {
    const allowed = new Set<string>(opts.userStatus);
    allSessions = allSessions.filter(s => allowed.has(resolveUserStatus(s)));
  }

  // Apply limit
  if (opts.limit && opts.limit > 0) {
    allSessions = allSessions.slice(0, opts.limit);
  }

  // Count statuses
  const statusCounts: Record<string, number> = { inbox: 0, active: 0, review: 0, done: 0, parked: 0, unknown: 0 };
  for (const s of allSessions) {
    const status = resolveUserStatus(s);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  return {
    ok: anyOk || agents.length === 0,
    workdir: resolvedWorkdir,
    workspaceName,
    sessions: allSessions,
    statusCounts: statusCounts as Record<UserStatus | 'unknown', number>,
    total: allSessions.length,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Session detail queries
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
};

/** Build image MessageBlocks from a session record's `lastUserAttachments`
 *  (relative paths under `workspacePath`). Used by fallback paths so the
 *  dashboard can still render the user's image bubble while the agent CLI
 *  has not yet flushed the turn to its own session file. Non-image
 *  attachments are skipped — the fallback is text-first and doesn't try to
 *  reconstruct generic file references. */
function imageBlocksFromManagedRecord(record: { workspacePath: string; lastUserAttachments?: string[] }): MessageBlock[] {
  const attachments = record.lastUserAttachments;
  if (!attachments?.length) return [];
  const blocks: MessageBlock[] = [];
  for (const rel of attachments) {
    const ext = path.extname(rel).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    const abs = path.isAbsolute(rel) ? rel : path.join(record.workspacePath, rel);
    blocks.push({
      type: 'image',
      // `file://` sentinel — `rewriteImageBlocksForTransport` (dashboard
      // response layer) converts it to a proper /attachment URL.
      content: `file://${abs}`,
      imagePath: abs,
      imageMime: MIME_BY_EXT[ext] || 'application/octet-stream',
    });
  }
  return blocks;
}

/**
 * Build a 1-2 message fallback transcript from the pikiclaw session record
 * for runs that crashed before the agent could write its own transcript file
 * (e.g. gemini auth failure, codex spawn failure). Without this the dashboard
 * detail panel would render blank for clearly-failed sessions.
 *
 * Returns both plain `messages` (text only — legacy callers) and full
 * `richMessages` (text + image blocks) so the dashboard's first-turn image
 * bubble survives the period before the agent CLI flushes its session file.
 */
interface ManagedFallback {
  messages: TailMessage[];
  richMessages: RichMessage[];
}

function tailFallbackFromManagedRecord(opts: SessionTailOpts): SessionTailResult | null {
  const fb = managedFallbackContent(opts);
  if (!fb) return null;
  const limit = Math.max(1, opts.limit ?? fb.messages.length);
  return { ok: true, messages: fb.messages.slice(-limit), error: null };
}

function managedFallbackContent(opts: SessionTailOpts): ManagedFallback | null {
  const record = findPikiclawSession(opts.workdir, opts.agent, opts.sessionId);
  if (!record) return null;
  const messages: TailMessage[] = [];
  const richMessages: RichMessage[] = [];

  if (record.lastQuestion) {
    const text = record.lastQuestion;
    messages.push({ role: 'user', text });
    const blocks: MessageBlock[] = text ? [{ type: 'text', content: text }] : [];
    blocks.push(...imageBlocksFromManagedRecord(record));
    if (blocks.length) richMessages.push({ role: 'user', text, blocks, usage: null });
  }

  const failureText = record.lastAnswer
    || (record.runState === 'incomplete' ? record.runDetail : null);
  if (failureText) {
    messages.push({ role: 'assistant', text: failureText });
    richMessages.push({
      role: 'assistant',
      text: failureText,
      blocks: [{ type: 'text', content: failureText }],
      usage: null,
    });
  }

  if (!messages.length) return null;
  return { messages, richMessages };
}

/** Get recent messages from a session (tail). */
export async function querySessionTail(opts: SessionTailOpts): Promise<SessionTailResult> {
  const result = await _getSessionTail(opts);
  if (!result.ok || !result.messages.length) {
    const fallback = tailFallbackFromManagedRecord(opts);
    if (fallback) return fallback;
  }
  return result;
}

/**
 * Replace canonical skill-execution expansions in a user message with the
 * `/skillname` shorthand the user originally typed. The expanded text is what
 * the agent CLI consumed and persisted; we collapse on read so the dashboard
 * chat shows the slash command instead of the long instruction we synthesized
 * for dispatch. Non-user messages and non-skill prompts pass through unchanged.
 */
function collapseSkillPromptsInResult(result: SessionMessagesResult): SessionMessagesResult {
  if (!result.ok) return result;
  const messages = result.messages.map(m => {
    if (m.role !== 'user') return m;
    const collapsed = collapseSkillPrompt(m.text);
    return collapsed ? { ...m, text: collapsed } : m;
  });
  const richMessages = result.richMessages?.map(m => {
    if (m.role !== 'user') return m;
    const collapsed = collapseSkillPrompt(m.text);
    if (!collapsed) return m;
    // The user's text content lives in one or more `text` blocks; collapse any
    // whose individual content also matches the expansion. Non-text blocks
    // (images, attachments) pass through untouched.
    const blocks = m.blocks.map(b => {
      if (b.type !== 'text') return b;
      const blockCollapsed = collapseSkillPrompt(b.content);
      return blockCollapsed ? { ...b, content: blockCollapsed } : b;
    });
    return { ...m, text: collapsed, blocks };
  });
  return { ...result, messages, richMessages };
}

/** Get full session messages (with optional turn filtering). */
export async function querySessionMessages(opts: SessionMessagesOpts & { agent: Agent }): Promise<SessionMessagesResult> {
  const result = await _getSessionMessages(opts);
  if (!result.ok || !result.messages.length) {
    const fb = managedFallbackContent({
      agent: opts.agent,
      sessionId: opts.sessionId,
      workdir: opts.workdir,
    });
    if (fb) {
      const totalTurns = fb.messages.filter(m => m.role === 'user').length;
      return collapseSkillPromptsInResult({
        ok: true,
        messages: fb.messages.map(m => ({ role: m.role, text: m.text })),
        // Always emit richMessages so the dashboard can render image blocks
        // for the first user turn while the agent CLI is still spinning up.
        richMessages: fb.richMessages,
        totalTurns,
        error: null,
      });
    }
  }
  return collapseSkillPromptsInResult(result);
}

// ---------------------------------------------------------------------------
// Workspace overviews
// ---------------------------------------------------------------------------

/** Overview of all registered workspaces — designed for dashboard sidebar. */
export async function getWorkspaceOverviews(): Promise<WorkspaceOverview[]> {
  const workspaces = loadWorkspaces();
  const agents = allDriverIds().filter(a => hasDriver(a));

  return Promise.all(workspaces.map(async (ws): Promise<WorkspaceOverview> => {
    const agentSummary: WorkspaceOverview['agentSummary'] = [];
    let attentionCount = 0;
    let lastActivityAt: string | null = null;

    for (const agent of agents) {
      try {
        const result = await _getSessions({ agent, workdir: ws.path });
        let active = 0;
        let review = 0;
        for (const session of result.sessions) {
          const status = resolveUserStatus(session);
          if (status === 'active' || session.running) active++;
          else if (status === 'review') review++;
          const ts = session.runUpdatedAt || session.createdAt || '';
          if (ts && (!lastActivityAt || ts > lastActivityAt)) lastActivityAt = ts;
        }
        agentSummary.push({ agent, active, review, total: result.sessions.length });
        attentionCount += active + review;
      } catch {
        agentSummary.push({ agent, active: 0, review: 0, total: 0 });
      }
    }

    return { workspace: ws, attentionCount, agentSummary, lastActivityAt };
  }));
}

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

/** Update session metadata (status, note, classification, migration links). */
export function updateSession(workdir: string, agent: Agent, sessionId: string, patch: SessionPatch): boolean {
  return updateSessionMeta(workdir, agent, sessionId, patch);
}

/**
 * Delete a session. Re-exports the agent-layer primitive so dashboard routes
 * stay in the bot/ layer for layering consistency. See
 * {@link DeleteAgentSessionOpts}.
 */
export function deleteSession(opts: DeleteAgentSessionOpts): Promise<DeleteAgentSessionResult> {
  return _deleteAgentSession(opts);
}

/** Link two sessions together (bidirectional). */
export function linkSessions(
  workdir: string,
  a: { agent: Agent; sessionId: string },
  b: { agent: Agent; sessionId: string },
): boolean {
  const updatedA = updateSessionMeta(workdir, a.agent, a.sessionId, {
    addLink: { agent: b.agent, sessionId: b.sessionId },
  });
  const updatedB = updateSessionMeta(workdir, b.agent, b.sessionId, {
    addLink: { agent: a.agent, sessionId: a.sessionId },
  });
  return updatedA || updatedB;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Auto-classify a session based on stream result. */
export function classifySession(
  result: Pick<StreamResult, 'ok' | 'incomplete' | 'error' | 'stopReason' | 'message' | 'activity'>,
): SessionClassification {
  return _classifySession(result);
}

// ---------------------------------------------------------------------------
// Export / Import / Migration
// ---------------------------------------------------------------------------

export function exportSession(opts: ExportSessionOpts): Promise<ExportSessionResult> {
  return _exportSession(opts);
}

export function importSession(opts: ImportSessionOpts): ImportSessionResult {
  return _importSession(opts);
}

/** Build migration context from source session for injection into target agent. */
export async function buildMigrationContext(opts: MigrateSessionOpts): Promise<MigrateResult> {
  try {
    const messagesResult = await _getSessionMessages({
      agent: opts.source.agent,
      sessionId: opts.source.sessionId,
      workdir: opts.source.workdir,
      lastNTurns: opts.lastNTurns,
    });

    if (!messagesResult.ok) {
      return { ok: false, contextInjected: '', messageCount: 0, error: messagesResult.error };
    }

    const messages = messagesResult.messages;
    if (!messages.length) {
      return { ok: false, contextInjected: '', messageCount: 0, error: 'No messages to migrate' };
    }

    const contextLines: string[] = [
      `[Migrated from ${opts.source.agent} session, ${messages.length} messages]`,
      '',
    ];
    for (const msg of messages) {
      contextLines.push(`[${msg.role === 'user' ? 'User' : 'Assistant'}]:`);
      contextLines.push(msg.text);
      contextLines.push('');
    }
    const contextInjected = contextLines.join('\n');

    updateSessionMeta(opts.source.workdir, opts.source.agent, opts.source.sessionId, {
      migratedTo: { agent: opts.target.agent, sessionId: '' },
    });

    return { ok: true, contextInjected, messageCount: messages.length, error: null };
  } catch (e: any) {
    return { ok: false, contextInjected: '', messageCount: 0, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Workspace registry (delegates to user-config)
// ---------------------------------------------------------------------------

export { loadWorkspaces, addWorkspace, removeWorkspace, renameWorkspace, reorderWorkspaces, updateWorkspace, findWorkspace };
