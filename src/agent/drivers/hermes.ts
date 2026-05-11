/**
 * Hermes Agent driver — speaks ACP (Agent Client Protocol) to `hermes acp`.
 *
 * Pikiclaw owns Provider/Profile credentials in its own vault; this driver
 * reads the active Profile via the model layer's injector and applies env
 * vars when spawning the Hermes ACP child process. Hermes' own config and
 * `hermes auth` command are not touched.
 *
 * Reference: https://agentclientprotocol.com — JSON-RPC 2.0 over stdio.
 * Hermes implements ACP via `~/.hermes/hermes-agent/acp_adapter/server.py`.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname } from 'node:path';
import { resolve as resolvePath } from 'node:path';
import { registerDriver, type AgentDriver, type AgentNativeConfig } from '../driver.js';
import { AcpClient, toAcpMcpServers } from '../acp-client.js';
import {
  type StreamOpts, type StreamResult,
  type SessionListResult, type SessionTailOpts, type SessionTailResult,
  type SessionMessagesOpts, type SessionMessagesResult,
  type ModelListOpts, type ModelListResult, type ModelInfo,
  type UsageOpts, type UsageResult, type UsageWindowInfo,
  type TailMessage, type RichMessage, type MessageBlock,
  agentLog, agentWarn, emptyUsage, normalizeErrorMessage,
  listPikiclawSessions, findPikiclawSession,
  buildStreamPreviewMeta, applyTurnWindow, pushRecentActivity,
  IMAGE_EXTS, mimeForExt,
} from '../index.js';

// Build the ACP `prompt` content array from the user's text + staged
// attachments. Images become ImageContentBlocks (base64 + mimeType — the
// shape Hermes' acp_adapter accepts and converts to OpenAI multimodal
// content). Non-image attachments are referenced by path so the agent can
// open them with its own filesystem tools.
function buildHermesPromptBlocks(prompt: string, attachments: string[]): any[] {
  const blocks: any[] = [];
  for (const filePath of attachments) {
    const ext = extname(filePath).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      try {
        const data = readFileSync(filePath);
        blocks.push({
          type: 'image',
          data: data.toString('base64'),
          mimeType: mimeForExt(ext),
        });
        continue;
      } catch (e: any) {
        agentWarn(`[hermes] failed to read image ${filePath}: ${e?.message || e}`);
      }
    }
    blocks.push({ type: 'text', text: `[Attached file: ${filePath}]` });
  }
  blocks.push({ type: 'text', text: prompt });
  return blocks;
}

// ---------------------------------------------------------------------------
// Stream state — encapsulates the per-turn buffer + delta model so we can
// reset/snapshot it cleanly across resume → replay → prompt boundaries.
// ---------------------------------------------------------------------------

interface StreamState {
  text: string;
  thinking: string;
  activity: string;
  recentActivity: string[];
  toolsById: Map<string, { title: string }>;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  contextWindow: number | null;
  contextUsedTokens: number | null;
}

function makeStreamState(): StreamState {
  return {
    text: '', thinking: '', activity: '',
    recentActivity: [],
    toolsById: new Map(),
    inputTokens: null, outputTokens: null, cachedInputTokens: null,
    contextWindow: null, contextUsedTokens: null,
  };
}

function applySessionUpdate(state: StreamState, update: any): boolean {
  if (!update) return false;
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const t = update.content?.text;
      if (typeof t === 'string') { state.text += t; return true; }
      return false;
    }
    case 'agent_thought_chunk': {
      const t = update.content?.text;
      if (typeof t === 'string') { state.thinking += t; return true; }
      return false;
    }
    case 'tool_call': {
      // ACP tool_call kicks off a new invocation. Accumulate it (mirroring
      // Claude/Codex) so the user sees the full chain in the live footer,
      // not just the title of whatever tool is currently mid-flight.
      const id = typeof update.toolCallId === 'string' ? update.toolCallId : '';
      const title = (typeof update.title === 'string' && update.title.trim()) || 'tool';
      if (id) state.toolsById.set(id, { title });
      pushRecentActivity(state.recentActivity, title);
      state.activity = state.recentActivity.join('\n');
      return true;
    }
    case 'tool_call_update': {
      const id = typeof update.toolCallId === 'string' ? update.toolCallId : '';
      const known = id ? state.toolsById.get(id) : null;
      const title = (typeof update.title === 'string' && update.title.trim()) || known?.title || 'tool';
      if (id && typeof update.title === 'string' && update.title.trim()) {
        state.toolsById.set(id, { title });
      }
      if (update.status === 'completed') {
        pushRecentActivity(state.recentActivity, `${title} done`);
        state.activity = state.recentActivity.join('\n');
      } else if (update.status === 'failed') {
        pushRecentActivity(state.recentActivity, `${title} failed`);
        state.activity = state.recentActivity.join('\n');
      }
      return true;
    }
    case 'usage_update': {
      // ACP semantics: `size` = model context window, `used` = current
      // context pressure. We previously mis-mapped `size` to
      // contextUsedTokens, which made the chip show the full window
      // (e.g. "1.0M tok" for a 1M-window model) regardless of actual use.
      if (typeof update.size === 'number') state.contextWindow = update.size;
      if (typeof update.used === 'number') state.contextUsedTokens = update.used;
      return true;
    }
    default:
      return false;
  }
}

function makeStreamResult(start: number, partial: Partial<StreamResult> = {}): StreamResult {
  return {
    ok: false, message: '', thinking: null, sessionId: null, workspacePath: null,
    model: null, thinkingEffort: '', elapsedS: (Date.now() - start) / 1000,
    inputTokens: null, outputTokens: null, cachedInputTokens: null,
    cacheCreationInputTokens: null, contextWindow: null, contextUsedTokens: null,
    contextPercent: null, codexCumulative: null, error: null, stopReason: null,
    incomplete: true, activity: null, plan: null,
    ...partial,
  };
}

// Empty / refusal heuristic — used to surface a hint when the model's reply
// is the canonical OpenAI safety refusal with no content. We don't paper
// over it (the user should see exactly what the model said), but a short
// pikiclaw note tells them this came from the model itself, not a bug.
const REFUSAL_REGEX = /^(?:i'?m sorry|sorry),?[\s\w,'`]*?(?:can(?:not|'t)|unable to)\s+(?:assist|help)[\s\S]{0,40}$/i;

// ---------------------------------------------------------------------------
// ACP-driven streaming
// ---------------------------------------------------------------------------

async function doHermesStream(opts: StreamOpts): Promise<StreamResult> {
  const start = Date.now();
  // BYOK env is populated on opts by stream.ts via resolveAgentInjection('hermes');
  // we just merge it into the spawn env. The bound model is delivered via the
  // ACP `session/set_model` request below — `hermes acp` does NOT accept any
  // CLI flags besides `--accept-hooks`, so we MUST NOT append byokArgvAppend
  // here (doing so would crash the spawn with `unrecognized arguments`).
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, ...(opts.extraEnv || {}) };
  if (!opts.hermesModel) {
    agentLog(`[hermes] no active profile bound — running with hermes' native config default`);
  }

  const client = new AcpClient({
    command: 'hermes',
    args: ['acp'],
    env: baseEnv,
    cwd: opts.workdir,
  });

  let sessionId = opts.sessionId || null;
  let stopReason: string | null = null;
  // Per-turn streaming state. We reset it just before sending session/prompt
  // so any session/update events from the prior session/load replay don't
  // leak into the user-visible reply.
  const state = makeStreamState();
  // While true, sessionUpdate events flow into `state`. When false, they are
  // counted but discarded — used during the session/load replay window so
  // history-replay chunks don't pollute the new turn's reply.
  let consumeUpdates = true;

  // Agent-initiated requests we must respond to (we deny filesystem ops we
  // don't support; pikiclaw has its own sandbox/permission model elsewhere).
  client.on('request', ({ id, method }: any) => {
    if (method === 'session/request_permission') {
      client.respond(id, { outcome: { outcome: 'cancelled' } });
      return;
    }
    if (method === 'fs/read_text_file' || method === 'fs/write_text_file') {
      client.respondError(id, -32601, 'fs methods not supported by pikiclaw client');
      return;
    }
    client.respondError(id, -32601, `Method not implemented: ${method}`);
  });

  const buildMeta = () => buildStreamPreviewMeta({
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cachedInputTokens: state.cachedInputTokens,
    cacheCreationInputTokens: null,
    contextWindow: state.contextWindow,
    contextUsedTokens: state.contextUsedTokens,
  });

  const onUpdate = (params: any) => {
    if (!consumeUpdates) return;
    if (applySessionUpdate(state, params?.update)) {
      try { opts.onText(state.text, state.thinking, state.activity, buildMeta(), null); } catch {}
    }
  };
  client.on('sessionUpdate', onUpdate);

  // Abort handling
  const onAbort = () => {
    stopReason = 'interrupted';
    if (sessionId) client.notify('session/cancel', { sessionId });
  };
  if (opts.abortSignal?.aborted) onAbort();
  opts.abortSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    client.start();

    await client.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
      },
    });

    if (!sessionId) {
      const newSession = await client.request('session/new', {
        cwd: opts.workdir,
        mcpServers: toAcpMcpServers(opts.mcpServers),
      }) as any;
      sessionId = newSession?.sessionId || newSession?.session_id || null;
      if (sessionId) opts.onSessionId?.(sessionId);
    } else {
      // Resumed session in a fresh `hermes acp` process. We MUST call
      // `session/load`, not just rely on the implicit DB restore that
      // `session/prompt` does internally:
      //   1. ACP-registered MCP servers are NOT persisted on disk — Hermes'
      //      `_make_agent` (used during DB restore) recreates the agent with
      //      *only* its native toolset. Without re-registering, the model
      //      sees a different tool surface than turn 1.
      //   2. `session/load` triggers Hermes' history-replay (it streams every
      //      prior user/assistant message back as session/update events).
      //      Discard them so they don't pollute the new turn's reply.
      consumeUpdates = false;
      try {
        const result = await client.request('session/load', {
          sessionId,
          cwd: opts.workdir,
          mcpServers: toAcpMcpServers(opts.mcpServers),
        }, 30_000);
        if (result === null) {
          agentWarn(`[hermes] session/load returned null for ${sessionId} — session not found in Hermes DB; continuing with a fresh prompt against the existing id`);
        } else {
          // Replay events arrive on Hermes' event loop AFTER session/load
          // resolves. Wait until the stream goes quiet for ~150ms (or 3s
          // hard cap) — that's a more robust signal than a fixed sleep.
          const drained = await client.waitForQuiet(150, 3_000);
          if (drained > 0) agentLog(`[hermes] drained ${drained} replay event(s) after session/load`);
        }
      } catch (e: any) {
        agentWarn(`[hermes] session/load failed (${sessionId}): ${e?.message || e} — proceeding without re-registration`);
      }
    }

    if (!sessionId) throw new Error('Hermes did not return a session id');

    // If a Profile is bound, override Hermes' config-default model via ACP.
    // `set_model` is best-effort: a Hermes that doesn't recognise the model id
    // (or doesn't have credentials for the requested provider) responds with
    // an error, but we keep going — the user will see that error in the first
    // prompt response and can re-pick a working profile, which is far better
    // than crashing the whole spawn.
    if (opts.hermesModel) {
      try {
        await client.request('session/set_model', {
          sessionId,
          modelId: opts.hermesModel,
        }, 15_000);
        agentLog(`[hermes] bound model: ${opts.hermesModel}`);
      } catch (e: any) {
        agentWarn(`[hermes] session/set_model failed (${opts.hermesModel}): ${e?.message || e} — falling back to Hermes' config default`);
      }
    }

    // Best-effort: forward the chosen reasoning effort via ACP `session/set_mode`.
    // Current `hermes acp` accepts the request but only persists the value on
    // the session record (it doesn't influence generation). When Hermes adds a
    // real effort knob to the ACP surface, this call will start taking effect
    // without any pikiclaw change.
    if (opts.thinkingEffort) {
      await client.tryRequest('session/set_mode', {
        sessionId,
        modeId: opts.thinkingEffort,
      });
    }

    // Reset the buffer one last time before we start consuming updates for
    // the prompt. Anything that arrived during/after the drain (latency
    // stragglers from the replay) gets discarded too.
    state.text = '';
    state.thinking = '';
    state.activity = '';
    state.recentActivity = [];
    state.toolsById.clear();
    consumeUpdates = true;

    const promptResponse = await client.request('session/prompt', {
      sessionId,
      prompt: buildHermesPromptBlocks(opts.prompt, opts.attachments || []),
    }, Math.max(opts.timeout * 1000, 30_000)) as any;

    stopReason = promptResponse?.stopReason || 'end_turn';

    // `PromptResponse.usage` (ACP) carries real per-turn token counts from the
    // provider. `usage_update` notifications, by contrast, describe the
    // session's *context window pressure* (size/used), not this turn's I/O.
    const usage = promptResponse?.usage;
    if (usage && typeof usage === 'object') {
      const input = usage.inputTokens ?? usage.input_tokens;
      const output = usage.outputTokens ?? usage.output_tokens;
      const cached = usage.cachedReadTokens ?? usage.cached_read_tokens;
      if (typeof input === 'number') state.inputTokens = input;
      if (typeof output === 'number') state.outputTokens = output;
      if (typeof cached === 'number') state.cachedInputTokens = cached;
    }

    const messageText = state.text.trim();
    const isRefusalOnly = !!messageText && messageText.length < 120 && REFUSAL_REGEX.test(messageText);
    return makeStreamResult(start, {
      ok: !isRefusalOnly,
      message: messageText || '(no textual response)',
      thinking: state.thinking.trim() || null,
      sessionId,
      model: opts.model,
      thinkingEffort: opts.thinkingEffort,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      cachedInputTokens: state.cachedInputTokens,
      contextWindow: state.contextWindow,
      contextUsedTokens: state.contextUsedTokens,
      stopReason,
      incomplete: stopReason !== 'end_turn',
      activity: null,
      // When the model itself refuses, mark as incomplete and add a hint so
      // the user can tell it's the model's choice (not a pikiclaw error).
      error: isRefusalOnly
        ? `Model returned a safety refusal. Try a different model on the agent card (e.g. claude-haiku-4.5 via OpenRouter), or check ~/.hermes/config.yaml.`
        : null,
      elapsedS: (Date.now() - start) / 1000,
    });
  } catch (e: any) {
    const message = normalizeErrorMessage(e) || 'Hermes ACP stream failed.';
    agentWarn(`[hermes] stream error: ${message}`);
    return makeStreamResult(start, {
      ok: false,
      message: state.text.trim() || message,
      thinking: state.thinking.trim() || null,
      sessionId,
      model: opts.model,
      thinkingEffort: opts.thinkingEffort,
      error: message,
      stopReason,
      incomplete: true,
      elapsedS: (Date.now() - start) / 1000,
    });
  } finally {
    opts.abortSignal?.removeEventListener('abort', onAbort);
    await client.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Sessions / models / usage — minimal surface
// ---------------------------------------------------------------------------

async function getHermesSessions(workdir: string, limit?: number): Promise<SessionListResult> {
  // Hermes' own session list lives in a SQLite DB inside ~/.hermes — useful
  // for the `hermes sessions` CLI but irrelevant to pikiclaw, which always
  // creates its own ACP session per turn and records it under .pikiclaw.
  const resolvedWorkdir = resolvePath(workdir);
  const records = listPikiclawSessions(resolvedWorkdir, 'hermes');
  const sessions = records.map(record => ({
    sessionId: record.sessionId,
    agent: 'hermes' as const,
    workdir: record.workdir,
    workspacePath: record.workspacePath,
    threadId: record.threadId,
    model: record.model,
    createdAt: record.createdAt,
    title: record.title,
    running: record.runState === 'running',
    runState: record.runState,
    runDetail: record.runDetail,
    runUpdatedAt: record.runUpdatedAt,
    runPid: record.runPid,
    classification: record.classification,
    userStatus: record.userStatus,
    userNote: record.userNote,
    lastQuestion: record.lastQuestion,
    lastAnswer: record.lastAnswer,
    lastMessageText: record.lastMessageText,
    migratedFrom: record.migratedFrom,
    migratedTo: record.migratedTo,
    linkedSessions: record.linkedSessions,
    numTurns: record.numTurns ?? null,
  }));
  sessions.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  const sliced = typeof limit === 'number' ? sessions.slice(0, limit) : sessions;
  agentLog(`[sessions:hermes] workdir=${resolvedWorkdir} pikiclaw=${records.length} returned=${sliced.length}`);
  return { ok: true, sessions: sliced, error: null };
}

async function getHermesSessionTail(_opts: SessionTailOpts): Promise<SessionTailResult> {
  return { ok: true, messages: [], error: null };
}

// Hermes mirrors every ACP/CLI session to ~/.hermes/sessions/session_<id>.json
// (in addition to the SQLite store at ~/.hermes/state.db). The JSON file is
// authoritative for full conversation replay: it carries the OpenAI-style
// `messages[]` stream, including assistant `reasoning_content` and any
// `tool_calls[] / role:"tool"` pairs. Reading it is ~20ms vs. a 4+ s ACP
// `session/load` replay round-trip, so we use it directly.
function hermesSessionJsonPath(sessionId: string): string {
  return join(homedir(), '.hermes', 'sessions', `session_${sessionId}.json`);
}

function extractHermesContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  // OpenAI multimodal: array of { type, text | image_url, ... }.
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text);
      else if (p.type === 'image_url' || p.type === 'input_image') parts.push('[image]');
    }
    return parts.join('\n').trim();
  }
  return '';
}

function formatHermesArgs(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // tool_calls.function.arguments is a JSON string — pretty-print when valid.
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return trimmed;
    }
  }
  try { return JSON.stringify(raw, null, 2); } catch { return String(raw); }
}

function buildHermesAssistantText(blocks: MessageBlock[]): string {
  return blocks
    .filter(b => b.type === 'text' && b.content.trim())
    .map(b => b.content.trim())
    .join('\n\n')
    .trim();
}

interface PendingHermesAssistant {
  blocks: MessageBlock[];
  toolNamesByCallId: Map<string, string>;
}

function getHermesSessionMessagesFromJson(opts: SessionMessagesOpts): SessionMessagesResult | null {
  const path = hermesSessionJsonPath(opts.sessionId);
  if (!existsSync(path)) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e: any) {
    agentWarn(`[hermes] failed to parse session JSON ${path}: ${e?.message || e}`);
    return null;
  }
  const rawMessages: any[] = Array.isArray(parsed?.messages) ? parsed.messages : [];
  if (!rawMessages.length) return { ok: true, messages: [], richMessages: [], totalTurns: 0, error: null };

  const allMsgs: TailMessage[] = [];
  const richMsgs: RichMessage[] = [];
  let pending: PendingHermesAssistant | null = null;

  const ensureAssistant = (): PendingHermesAssistant => {
    if (!pending) pending = { blocks: [], toolNamesByCallId: new Map() };
    return pending;
  };

  const flushAssistant = () => {
    if (!pending) return;
    const blocks = pending.blocks.filter(b =>
      b.type === 'tool_use' || b.type === 'tool_result' || !!b.content.trim(),
    );
    pending = null;
    if (!blocks.length) return;
    const text = buildHermesAssistantText(blocks);
    allMsgs.push({ role: 'assistant', text });
    richMsgs.push({ role: 'assistant', text, blocks });
  };

  for (const msg of rawMessages) {
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role;

    if (role === 'system') continue;

    if (role === 'user') {
      flushAssistant();
      const text = extractHermesContentText(msg.content).trim();
      if (!text) continue;
      allMsgs.push({ role: 'user', text });
      richMsgs.push({ role: 'user', text, blocks: [{ type: 'text', content: text }] });
      continue;
    }

    if (role === 'assistant') {
      const a = ensureAssistant();
      const reasoning = typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()
        ? msg.reasoning_content
        : (typeof msg.reasoning === 'string' ? msg.reasoning : '');
      if (reasoning && reasoning.trim()) {
        a.blocks.push({ type: 'thinking', content: reasoning });
      }
      const text = extractHermesContentText(msg.content);
      if (text && text.trim()) {
        a.blocks.push({ type: 'text', content: text, phase: 'final_answer' });
      }
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const tc of toolCalls) {
        if (!tc || typeof tc !== 'object') continue;
        const fn = (tc as any).function || {};
        const name = typeof fn.name === 'string' ? fn.name.trim() : '';
        const callId = typeof (tc as any).id === 'string'
          ? (tc as any).id
          : (typeof (tc as any).call_id === 'string' ? (tc as any).call_id : '');
        if (!name) continue;
        if (callId) a.toolNamesByCallId.set(callId, name);
        a.blocks.push({
          type: 'tool_use',
          content: formatHermesArgs(fn.arguments),
          toolName: name,
          toolId: callId || undefined,
        });
      }
      continue;
    }

    if (role === 'tool') {
      const a = ensureAssistant();
      const callId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : '';
      const toolName = (callId && a.toolNamesByCallId.get(callId))
        || (typeof msg.tool_name === 'string' && msg.tool_name) || '';
      const output = formatHermesArgs(msg.content);
      a.blocks.push({
        type: 'tool_result',
        content: output,
        toolName: toolName || undefined,
        toolId: callId || undefined,
      });
      continue;
    }
    // Unknown role — ignore silently.
  }
  flushAssistant();

  return applyTurnWindow(allMsgs, opts, opts.rich !== false ? richMsgs : undefined);
}

function getHermesSessionMessagesFromRecord(opts: SessionMessagesOpts): SessionMessagesResult {
  // Fallback for sessions that pre-date the JSON store (or that Hermes wrote
  // somewhere we can't see). Synthesizes the most recent turn from the
  // pikiclaw session record so the dashboard still has *something* after the
  // live snapshot expires.
  const record = findPikiclawSession(opts.workdir, 'hermes', opts.sessionId);
  if (!record || (!record.lastQuestion && !record.lastAnswer && !record.lastThinking)) {
    return { ok: true, messages: [], totalTurns: 0, error: null };
  }
  const messages: TailMessage[] = [];
  const richMessages: RichMessage[] = [];
  if (record.lastQuestion) {
    messages.push({ role: 'user', text: record.lastQuestion });
    richMessages.push({
      role: 'user',
      text: record.lastQuestion,
      blocks: [{ type: 'text', content: record.lastQuestion }],
    });
  }
  if (record.lastAnswer || record.lastThinking) {
    const answerText = record.lastAnswer || '';
    messages.push({ role: 'assistant', text: answerText });
    const blocks: MessageBlock[] = [];
    if (record.lastThinking) blocks.push({ type: 'thinking', content: record.lastThinking });
    if (answerText) blocks.push({ type: 'text', content: answerText });
    richMessages.push({ role: 'assistant', text: answerText, blocks });
  }
  const totalTurns = record.numTurns ?? (richMessages.length ? 1 : 0);
  return {
    ok: true,
    messages,
    richMessages,
    totalTurns,
    window: {
      offset: 0,
      limit: 1,
      returnedTurns: richMessages.length ? 1 : 0,
      totalTurns,
      hasOlder: totalTurns > 1,
      hasNewer: false,
      startTurn: Math.max(0, totalTurns - 1),
      endTurn: totalTurns,
    },
    error: null,
  };
}

async function getHermesSessionMessages(opts: SessionMessagesOpts): Promise<SessionMessagesResult> {
  const fromJson = getHermesSessionMessagesFromJson(opts);
  if (fromJson && fromJson.totalTurns > 0) return fromJson;
  return getHermesSessionMessagesFromRecord(opts);
}

async function listHermesModels(_opts: ModelListOpts): Promise<ModelListResult> {
  // When Hermes has its own working config (typical case — user ran `hermes auth`
  // and `hermes config`), surface the configured default model so the dashboard
  // and IM /models reflect what Hermes will actually use without forcing the
  // user to re-configure inside pikiclaw.
  const native = readHermesNativeConfig();
  const models: ModelInfo[] = native?.model
    ? [{ id: native.model, alias: `${native.provider} (Hermes config)` }]
    : [];
  return {
    agent: 'hermes',
    models,
    sources: native ? [`~/.hermes/config.yaml · ${native.provider}`] : ['~/.hermes/config.yaml (not configured)'],
    note: native
      ? `Reading Hermes' own config. Bind a pikiclaw Provider on the agent card to override.`
      : `Run \`hermes config\` to set a default model, or bind a pikiclaw Provider on the agent card.`,
  };
}

// ---------------------------------------------------------------------------
// Native config reader
//
// Pikiclaw never writes to ~/.hermes/config.yaml — that is Hermes' own state.
// We just *read* a few fields so the dashboard can show what Hermes will run
// with when no BYOK Profile is bound, and so the UI doesn't pretend that an
// already-configured Hermes "needs" to be re-configured inside pikiclaw.
//
// Limited surface: only the top-level `model.*` and `agent.reasoning_effort`
// keys we care about. Implemented with simple string matching (no YAML
// dependency) since the schema is stable and shallow.
// ---------------------------------------------------------------------------

let cachedNativeConfig: { value: AgentNativeConfig | null; mtimeMs: number; path: string } | null = null;

function readHermesNativeConfig(): AgentNativeConfig | null {
  const path = join(homedir(), '.hermes', 'config.yaml');
  if (!existsSync(path)) return null;

  // Cheap mtime check — re-read only when the file has changed.
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs as number;
  } catch {
    mtimeMs = 0;
  }
  if (cachedNativeConfig && cachedNativeConfig.path === path && cachedNativeConfig.mtimeMs === mtimeMs) {
    return cachedNativeConfig.value;
  }

  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }

  const blockOf = (name: string): string => {
    // Captures consecutive indented lines under `name:` (a top-level mapping).
    // Stops at the first non-indented line, which marks the next top-level
    // key. Plain (no `m` flag) so `.` matches across lines via [^\n].
    const re = new RegExp(`(?:^|\\n)${name}:[ \\t]*\\n((?:[ \\t]+[^\\n]*\\n?)+)`);
    return text.match(re)?.[1] || '';
  };
  const valueOf = (block: string, key: string): string | null => {
    // The key must be at any indentation level deeper than the parent.
    const m = block.match(new RegExp(`(?:^|\\n)[ \\t]+${key}:[ \\t]*([^\\n]*)`));
    if (!m) return null;
    return m[1].trim().replace(/^["']|["']$/g, '') || null;
  };

  const modelBlock = blockOf('model');
  const agentBlock = blockOf('agent');
  const model = valueOf(modelBlock, 'default');
  const provider = valueOf(modelBlock, 'provider');
  const baseURL = valueOf(modelBlock, 'base_url');
  const effort = valueOf(agentBlock, 'reasoning_effort');

  const value: AgentNativeConfig | null = (model && provider)
    ? { model, provider, baseURL: baseURL || null, effort: effort || null, configPath: path, source: 'hermes' }
    : null;
  cachedNativeConfig = { value, mtimeMs, path };
  return value;
}

function getHermesNativeConfig(): AgentNativeConfig | null {
  return readHermesNativeConfig();
}

function getHermesUsage(_opts: UsageOpts): UsageResult {
  return emptyUsage('hermes', 'Run `hermes insights` for token analytics.');
}

async function getHermesUsageLive(_opts: UsageOpts): Promise<UsageResult> {
  // Spawn `hermes insights --days 30 --source tool` and parse output.
  return new Promise<UsageResult>(resolve => {
    let stdout = '';
    let stderr = '';
    try {
      const proc = spawn('hermes', ['insights', '--days', '30', '--source', 'tool'], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.stdout.on('data', (b: Buffer) => { stdout += b.toString(); });
      proc.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });
      const timeout = setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} }, 8_000);
      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          resolve(emptyUsage('hermes', `hermes insights exited ${code}: ${stderr.trim().slice(0, 200)}`));
          return;
        }
        const windows = parseHermesInsightsOutput(stdout);
        resolve({
          ok: true,
          agent: 'hermes',
          source: 'hermes-insights',
          capturedAt: new Date().toISOString(),
          status: null,
          windows,
          error: null,
        });
      });
      proc.on('error', err => {
        clearTimeout(timeout);
        resolve(emptyUsage('hermes', `hermes insights error: ${err.message}`));
      });
    } catch (e: any) {
      resolve(emptyUsage('hermes', e?.message || String(e)));
    }
  });
}

function parseHermesInsightsOutput(text: string): UsageWindowInfo[] {
  // Minimal parser: extract Sessions / Total tokens summary line.
  const out: UsageWindowInfo[] = [];
  const sessionsMatch = text.match(/Sessions:\s+(\d+)/);
  const totalTokensMatch = text.match(/Total tokens:\s+([\d,]+)/);
  if (sessionsMatch || totalTokensMatch) {
    out.push({
      label: 'Last 30d',
      usedPercent: null,
      remainingPercent: null,
      resetAt: null,
      resetAfterSeconds: null,
      status: [
        sessionsMatch ? `${sessionsMatch[1]} sessions` : '',
        totalTokensMatch ? `${totalTokensMatch[1]} tokens` : '',
      ].filter(Boolean).join(' · '),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Driver registration
// ---------------------------------------------------------------------------

const HermesDriver: AgentDriver = {
  id: 'hermes',
  cmd: 'hermes',
  thinkLabel: 'Reasoning',
  // Hermes locks the model at profile-binding time. The ACP `session/set_model`
  // hook exists but is unreliable across providers in current Hermes builds, so
  // pikiclaw treats the model as fixed for the session and hides the picker.
  capabilities: { fork: false, modelSwitch: false },
  doStream: doHermesStream,
  getSessions: getHermesSessions,
  getSessionTail: getHermesSessionTail,
  getSessionMessages: getHermesSessionMessages,
  listModels: listHermesModels,
  getUsage: getHermesUsage,
  getUsageLive: getHermesUsageLive,
  getNativeConfig: getHermesNativeConfig,
  shutdown() {
    /* Per-stream AcpClient is closed in doStream finally; nothing process-wide. */
  },
};

registerDriver(HermesDriver);

export { doHermesStream, REFUSAL_REGEX };
