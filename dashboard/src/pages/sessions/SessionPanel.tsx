import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo, useMemo } from 'react';
import { useStore } from '../../store';
import { createT } from '../../i18n';
import { api } from '../../api';
import { loadSessionMessages, peekSessionMessages } from '../../session-preload';
import { useDashboardEvent, useDashboardReconnect, type DashboardEvent } from '../../ws';
import { cn, getAgentMeta, shortenModel, sessionDisplayState } from '../../utils';
import { Spinner, Modal, ModalHeader, Button } from '../../components/ui';
import { hasPlan } from '../../components/PlanProgressCard';
import type { InteractionSnapshot, SessionInfo, StreamPlan, StreamPreviewMeta, StreamSubAgent } from '../../types';
import { TurnView, UserBubble, TurnDivider } from './TurnView';
import { LivePreview, ThinkingDots, liveStreamShouldRender } from './LivePreview';
import { InputComposer } from './InputComposer';
import { InteractionPromptModal } from './InteractionPromptModal';
import {
  normalizeTurnHistory,
  mergeOlderHistory,
  mergeLatestHistory,
  type Turn,
  type TurnHistoryWindow,
} from './utils';

const SESSION_PAGE_TURNS = 12;
const TOP_LOAD_THRESHOLD_PX = 160;
const BOTTOM_STICK_THRESHOLD_PX = 96;

/* ── Stale-while-revalidate: persist last-known history across mount/unmount ── */
const MAX_HISTORY_SNAPSHOTS = 20;
const historySnapshots = new Map<string, TurnHistoryWindow>();
function snapshotKey(agent: string, sessionId: string) { return `${agent}:${sessionId}`; }
function saveHistorySnapshot(key: string, h: TurnHistoryWindow) {
  historySnapshots.delete(key); // refresh LRU position
  historySnapshots.set(key, h);
  while (historySnapshots.size > MAX_HISTORY_SNAPSHOTS) {
    historySnapshots.delete(historySnapshots.keys().next().value!);
  }
}

/* ═══════════════════════════════════════════════════════════════
   SessionPanel
   ═══════════════════════════════════════════════════════════════ */
export const SessionPanel = memo(function SessionPanel({
  session, workdir, active = true, onSessionChange, initialPendingPrompt, initialPendingImageUrls, onPendingPromptConsumed,
}: {
  session: SessionInfo;
  workdir: string;
  active?: boolean;
  onSessionChange?: (next: { agent: string; sessionId: string; workdir: string }) => void;
  initialPendingPrompt?: string | null;
  /** Blob-URL previews for images attached to the first message of a new session.
   *  Ownership transfers to this panel: we revoke them once the turn completes. */
  initialPendingImageUrls?: string[];
  onPendingPromptConsumed?: () => void;
}) {
  const locale = useStore(s => s.locale);
  const agentRuntime = useStore(s => s.agentStatus?.agents?.find(a => a.agent === session.agent) ?? null);
  const globalEffort = agentRuntime?.selectedEffort ?? null;
  const globalModel = agentRuntime?.selectedModel ?? null;
  // BYOK attribution surfaces on every turn so the user knows the agent is
  // routing through a third-party provider. `agentRuntime.byokProviderName`
  // is null when no Profile is bound (native auth) — falsy values hide the
  // tag, so we don't need to gate display further.
  const byokProviderName = agentRuntime?.byokProviderName ?? null;
  const t = useMemo(() => createT(locale), [locale]);
  const meta = getAgentMeta(session.agent || '');
  const displayState = sessionDisplayState(session);

  const hasInitialPending = !!initialPendingPrompt || !!(initialPendingImageUrls && initialPendingImageUrls.length);
  const [history, setHistory] = useState<TurnHistoryWindow | null>(null);
  const [loading, setLoading] = useState(!hasInitialPending);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [liveStream, setLiveStream] = useState<{
    taskId: string | null;
    phase: 'streaming' | 'done';
    text: string;
    thinking: string;
    activity?: string;
    plan?: StreamPlan | null;
    model?: string | null;
    effort?: string | null;
    previewMeta?: StreamPreviewMeta | null;
    subAgents?: StreamSubAgent[] | null;
    error?: string | null;
  } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string | null>(null);
  const [streamPollNonce, setStreamPollNonce] = useState(0);
  const [streamTaskId, setStreamTaskId] = useState<string | null>(null);
  const [queuedTaskIds, setQueuedTaskIds] = useState<string[]>([]);
  const [queuedTasks, setQueuedTasks] = useState<Array<{ taskId: string; prompt: string }>>([]);
  // Active human-in-the-loop prompts attached to this session — driven by the
  // `interactions` field of the stream snapshot. The latest entry is rendered
  // as a modal popup; the server clears entries as users answer them.
  const [interactions, setInteractions] = useState<InteractionSnapshot[]>([]);
  // Optimistic state for the RUNNING task only — the user message bubble that
  // backs the in-flight turn until rawTurns picks it up. Earlier this slot
  // doubled as the optimistic source for queued sends, which meant sending a
  // new follow-up while a task was still streaming would overwrite the
  // running task's bubble. Queued sends now live in `pendingQueuedSends`.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(initialPendingPrompt || null);
  const [pendingImageUrls, setPendingImageUrls] = useState<string[]>(initialPendingImageUrls || []);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const pendingTaskIdRef = useRef<string | null>(null);
  pendingTaskIdRef.current = pendingTaskId;
  // Optimistic state for queued sends — one entry per send made while another
  // task was already streaming. Each entry carries an opaque localId so we can
  // match the API-assigned taskId back to the right entry even if responses
  // arrive out of order. InputComposer reads this array to fill its queued-row
  // prompts before the server snapshot's `queuedTasks` catches up.
  type PendingQueuedSend = { localId: string; taskId: string | null; prompt: string; imageUrls: string[] };
  const [pendingQueuedSends, setPendingQueuedSends] = useState<PendingQueuedSend[]>([]);
  const pendingQueuedSendsRef = useRef<PendingQueuedSend[]>([]);
  pendingQueuedSendsRef.current = pendingQueuedSends;
  // Routes the next onSendTaskAssigned callback. Set in handleSendStart based
  // on whether the send went to the queue or kicked off a new running turn.
  // Sends are sequential (InputComposer guards with `sending`), so a single
  // ref is sufficient.
  const lastSendQueuedLocalIdRef = useRef<string | null>(null);
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const [forkRequest, setForkRequest] = useState<{ atTurn: number } | null>(null);
  const [forkPrompt, setForkPrompt] = useState('');
  const [forkSubmitting, setForkSubmitting] = useState(false);
  const canFork = !!agentRuntime?.capabilities?.fork;
  const submitForkRef = useRef<(() => Promise<void>) | null>(null);
  const pendingImageUrlsRef = useRef<string[]>(initialPendingImageUrls || []);
  const liveStreamRef = useRef(liveStream);
  const streamingRef = useRef(streaming);
  liveStreamRef.current = liveStream;
  streamingRef.current = streaming;
  const scrollRef = useRef<HTMLDivElement>(null);
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const stickToBottomRef = useRef(true);
  const scrollToBottomRef = useRef(false);
  const loadingLatestRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const localStreamPendingRef = useRef(hasInitialPending);
  const clearPendingOnLoadRef = useRef(false);
  // When a task ends, we wait for loadLatestTurns to commit its final text to
  // history before clearing liveStream. We remember which task triggered the
  // clear so that if a new task has already started streaming into liveStream
  // by the time history arrives, we don't accidentally wipe the new task's
  // preview. `true` = no specific task (used for non-handoff shutdown paths).
  const clearLiveStreamOnLoadRef = useRef<{ taskId: string | null } | true | false>(false);
  const initialPendingConsumedRef = useRef(false);
  const promotingRef = useRef(false);

  // Consume initialPendingPrompt/initialPendingImageUrls from new-session flow.
  // State (pendingPrompt, pendingImageUrls, loading, localStreamPendingRef) is already initialized
  // from the props so the very first render shows the user message — no spinner flash.
  // This effect only triggers the remaining side effects (polling + parent notify).
  useEffect(() => {
    if (initialPendingConsumedRef.current || !hasInitialPending) return;
    initialPendingConsumedRef.current = true;
    setStreamPollNonce(n => n + 1);
    onPendingPromptConsumed?.();
  }, [hasInitialPending, onPendingPromptConsumed]);

  const clearPending = useCallback(() => {
    setPendingPrompt(null);
    setPendingImageUrls(prev => { for (const u of prev) URL.revokeObjectURL(u); return []; });
    pendingImageUrlsRef.current = [];
    setPendingTaskId(null);
  }, []);

  const clearPendingQueuedSends = useCallback(() => {
    setPendingQueuedSends(prev => {
      if (!prev.length) return prev;
      for (const s of prev) for (const url of s.imageUrls) URL.revokeObjectURL(url);
      return [];
    });
    lastSendQueuedLocalIdRef.current = null;
  }, []);

  const handleSendStart = useCallback((prompt: string, imageUrls?: string[]) => {
    const willBeQueued = !!liveStreamRef.current || streamingRef.current;
    const urls = imageUrls || [];
    if (willBeQueued) {
      // Don't disturb the running task's optimistic bubble — append to the
      // queued-sends list so the InputComposer queue row gets its prompt and
      // the conversation history keeps showing the in-flight running turn.
      const localId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      lastSendQueuedLocalIdRef.current = localId;
      setPendingQueuedSends(prev => [...prev, { localId, taskId: null, prompt: prompt || '', imageUrls: urls }]);
      return;
    }
    // No active stream — this send is the (about-to-be) running task. Replace
    // the running pending slot wholesale and revoke any stale image URLs.
    for (const u of pendingImageUrlsRef.current) URL.revokeObjectURL(u);
    lastSendQueuedLocalIdRef.current = null;
    setPendingPrompt(prompt || null);
    setPendingImageUrls(urls);
    pendingImageUrlsRef.current = urls;
    setPendingTaskId(null);
  }, []);

  const handleSendTaskAssigned = useCallback((taskId: string) => {
    const queuedLocalId = lastSendQueuedLocalIdRef.current;
    if (queuedLocalId) {
      lastSendQueuedLocalIdRef.current = null;
      setPendingQueuedSends(prev => {
        const idx = prev.findIndex(s => s.localId === queuedLocalId);
        if (idx < 0) return prev;
        const next = prev.slice();
        next[idx] = { ...next[idx], taskId };
        return next;
      });
      return;
    }
    setPendingTaskId(taskId);
  }, []);

  const submitFork = useCallback(async () => {
    if (!forkRequest) return;
    const trimmed = forkPrompt.trim();
    if (!trimmed) return;
    setForkSubmitting(true);
    try {
      const res = await api.forkSession(
        workdir,
        session.agent || '',
        session.sessionId,
        forkRequest.atTurn,
        trimmed,
        {},
      );
      if (!res.ok || !res.sessionKey) {
        // Bubble the error inline by leaving the modal open; consumer can retry.
        setForkSubmitting(false);
        return;
      }
      const [agent, sessionId] = res.sessionKey.split(':');
      setForkRequest(null);
      setForkPrompt('');
      // Hand off to the parent so the new child session opens in its own panel.
      onSessionChange?.({ agent, sessionId, workdir });
    } finally {
      setForkSubmitting(false);
    }
  }, [forkRequest, forkPrompt, workdir, session.agent, session.sessionId, onSessionChange]);
  submitForkRef.current = submitFork;

  const fetchTurnWindow = useCallback(async (
    query: { turnOffset?: number; turnLimit?: number; lastNTurns?: number },
    opts: { force?: boolean } = {},
  ) => {
    try {
      const res = await loadSessionMessages({
        workdir,
        agent: session.agent || '',
        sessionId: session.sessionId,
        rich: true,
        turnOffset: query.turnOffset,
        turnLimit: query.turnLimit,
        lastNTurns: query.lastNTurns,
      }, { force: opts.force });
      if (!res.ok) return null;
      return normalizeTurnHistory(res);
    } catch {
      return null;
    }
  }, [workdir, session.agent, session.sessionId]);

  const loadLatestTurns = useCallback(async ({ keepOlder, force = false, scrollToBottom = false }: { keepOlder: boolean; force?: boolean; scrollToBottom?: boolean }) => {
    if (loadingLatestRef.current) return false;
    loadingLatestRef.current = true;
    try {
      const next = await fetchTurnWindow({ turnOffset: 0, turnLimit: SESSION_PAGE_TURNS }, { force });
      if (!next) return false;
      // Set scroll flag right before setHistory so React batches both into
      // the same render and the layoutEffect sees the flag when turns update.
      if (scrollToBottom) scrollToBottomRef.current = true;
      setHistory(current => {
        if (!current || !keepOlder) return next;
        return mergeLatestHistory(current, next);
      });
      // Clear pending + liveStream in the same synchronous block as setHistory so
      // React batches all updates into a single render (avoids flash/scroll jump)
      if (clearPendingOnLoadRef.current) {
        clearPendingOnLoadRef.current = false;
        clearPending();
      }
      if (clearLiveStreamOnLoadRef.current) {
        const pending = clearLiveStreamOnLoadRef.current;
        clearLiveStreamOnLoadRef.current = false;
        // If the pending clear was scoped to a specific (finished) task, only
        // drop liveStream when it still belongs to that task. A new task that
        // started streaming during the fetch has already replaced liveStream,
        // and its content must be preserved.
        const scopedTaskId = pending !== true ? pending.taskId : null;
        const owned = !!liveStreamRef.current
          && (pending === true || liveStreamRef.current.taskId === scopedTaskId);
        if (owned) setLiveStream(null);
      }
      return true;
    } finally {
      loadingLatestRef.current = false;
    }
  }, [fetchTurnWindow, clearPending]);

  const loadOlderTurns = useCallback(async () => {
    if (!history?.hasOlder || loadingOlderRef.current) return;
    const el = scrollRef.current;
    if (el) prependAnchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const next = await fetchTurnWindow({
        turnOffset: Math.max(0, history.totalTurns - history.startTurn),
        turnLimit: SESSION_PAGE_TURNS,
      });
      if (next) setHistory(current => current ? mergeOlderHistory(current, next) : next);
      else prependAnchorRef.current = null;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [fetchTurnWindow, history]);

  const prevPhaseRef = useRef<'queued' | 'streaming' | 'done' | null>(null);

  /** Apply a stream snapshot to local state — called from both WS push and poll fallback.
   *  All open panels receive full updates regardless of active state. */
  const applyStreamSnapshot = useCallback((state: any | null) => {
    // Detect session promotion: backend promoted pending_XXX → native ID.
    // Update sessionKeyRef immediately so subsequent WS events match the new key,
    // then notify parent — but do NOT return: the snapshot carries live stream data
    // that must be applied to avoid swallowing content during promotion.
    if (state?.sessionId && state.sessionId !== session.sessionId) {
      promotingRef.current = true;
      sessionKeyRef.current = `${session.agent}:${state.sessionId}`;
      onSessionChange?.({ agent: session.agent || '', sessionId: state.sessionId, workdir });
    }
    if (!state) {
      const prev = prevPhaseRef.current;
      setStreaming(false);
      if (prev === 'streaming') {
        // Delay liveStream clearing — same pattern as the 'done' handler
        clearPendingOnLoadRef.current = true;
        clearLiveStreamOnLoadRef.current = true;
        void loadLatestTurns({ keepOlder: true, force: true, scrollToBottom: stickToBottomRef.current });
      } else {
        setLiveStream(null);
      }
      if (prev === 'done') {
        clearPending();
        clearPendingQueuedSends();
      } else if (prev === null && localStreamPendingRef.current) {
        // Do NOT clear pending here — for slow uploads (e.g. images via FormData),
        // the poll may return null before the stream actually starts. The pending
        // bubble should stay visible until the stream begins or the safety cleanup
        // effect fires (displayState !== 'running' && !streaming && !liveStream).
        void loadLatestTurns({ keepOlder: true, force: true });
      }
      localStreamPendingRef.current = false;
      setStreamTaskId(null);
      setStreamPhase(null);
      setQueuedTaskIds([]);
      setQueuedTasks([]);
      setInteractions([]);
      prevPhaseRef.current = null;
      return;
    }
    setStreamPhase(state.phase);
    setStreamTaskId(state.taskId || null);
    setQueuedTaskIds(state.queuedTaskIds && state.queuedTaskIds.length ? state.queuedTaskIds : []);
    setQueuedTasks(state.queuedTasks && state.queuedTasks.length ? state.queuedTasks : []);
    setInteractions(Array.isArray(state.interactions) && state.interactions.length ? state.interactions : []);
    if (state.phase === 'streaming') {
      // Steer handoff: a previous task just ended ('done' triggered loadLatestTurns
      // and armed clearLiveStreamOnLoadRef). The new task's initial snapshot carries
      // an empty text — overwriting liveStream here would flash the previous task's
      // partial response away before loadLatestTurns has a chance to commit it to
      // history. Skip the empty overwrite; the new task's subsequent text events
      // (or the loadLatestTurns completion) will replace liveStream naturally.
      const handingOffPrevTask = clearLiveStreamOnLoadRef.current
        && !!liveStreamRef.current
        && liveStreamRef.current.taskId !== null
        && liveStreamRef.current.taskId !== (state.taskId || null)
        && !(state.text || '').trim();
      if (!handingOffPrevTask) {
        setLiveStream({
          taskId: state.taskId || null,
          phase: 'streaming',
          text: state.text || '',
          thinking: state.thinking || '',
          activity: state.activity,
          plan: state.plan ?? null,
          model: state.model ?? null,
          effort: state.effort ?? null,
          previewMeta: state.previewMeta ?? null,
          subAgents: state.previewMeta?.subAgents ?? null,
          error: null,
        });
      }
      setStreaming(true);
      // Promote a queued send to the running pending slot when the streaming
      // task is one we previously queued. Without this, the queued send's
      // optimistic bubble would never appear in the conversation while it
      // runs — we'd be stuck showing the prior task's deduped pendingPrompt.
      if (state.taskId && state.taskId !== pendingTaskIdRef.current) {
        const queue = pendingQueuedSendsRef.current;
        const idx = queue.findIndex(s => s.taskId === state.taskId);
        if (idx >= 0) {
          const promoted = queue[idx];
          // Revoke the previous running slot's images before overwriting.
          for (const url of pendingImageUrlsRef.current) URL.revokeObjectURL(url);
          setPendingPrompt(promoted.prompt || null);
          setPendingImageUrls(promoted.imageUrls);
          pendingImageUrlsRef.current = promoted.imageUrls;
          setPendingTaskId(state.taskId);
          setPendingQueuedSends(prev => prev.filter((_, i) => i !== idx));
        }
      }
      if (stickToBottomRef.current) scrollToBottomRef.current = true;
    } else if (state.phase === 'queued') {
      setLiveStream(null);
      setStreaming(false);
    } else if (state.phase === 'done') {
      // Don't clear liveStream here — keep it visible so the scroll position stays
      // stable while loadLatestTurns fetches the full history.  The live preview is
      // cleared atomically with the history update inside loadLatestTurns to avoid
      // the intermediate "empty" render that causes a scroll jump.
      setStreaming(false);
      // Mark the live preview as finished and forward any error from the
      // snapshot so a content-less failure surfaces a reason instead of a phantom.
      setLiveStream(prev => prev ? { ...prev, phase: 'done', error: state.error ?? null } : prev);
      const hasMoreQueued = !!state.queuedTaskIds?.length;
      if (prevPhaseRef.current !== 'done') {
        if (!hasMoreQueued) clearPendingOnLoadRef.current = true;
        // Scope the pending clear to the finishing task so a steer handoff can
        // start a new task's stream without losing its preview when the history
        // fetch resolves.
        clearLiveStreamOnLoadRef.current = { taskId: state.taskId || null };
        void loadLatestTurns({ keepOlder: true, force: true, scrollToBottom: stickToBottomRef.current });
      }
      if (!hasMoreQueued) localStreamPendingRef.current = false;
    }
    // Prune queued-send optimistic entries whose server-assigned taskId no
    // longer appears in the live snapshot — covers server-side cancel /
    // completion paths where the entry would otherwise leak until the safety
    // effect kicks in. Entries with taskId === null are kept (their API
    // response is still in flight).
    const liveTaskIds = new Set<string>();
    if (state.taskId) liveTaskIds.add(state.taskId);
    if (Array.isArray(state.queuedTaskIds)) for (const id of state.queuedTaskIds) liveTaskIds.add(id);
    setPendingQueuedSends(prev => {
      let changed = false;
      const next: PendingQueuedSend[] = [];
      for (const send of prev) {
        if (!send.taskId || liveTaskIds.has(send.taskId)) {
          next.push(send);
        } else {
          for (const url of send.imageUrls) URL.revokeObjectURL(url);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    prevPhaseRef.current = state.phase;
  }, [clearPending, clearPendingQueuedSends, loadLatestTurns, session.sessionId, session.agent, onSessionChange, workdir]);

  const requestStreamPolling = useCallback(() => {
    localStreamPendingRef.current = true;
    setStreamPollNonce(current => current + 1);
  }, []);

  const handleRecallTask = useCallback(async (taskId: string) => {
    try {
      await api.recallSessionMessage(taskId);
      // The running task (pendingTaskId) being recalled is the rare case — the
      // common recall is for a queued entry. Both branches must clean their
      // own optimistic state so the bubble / queue row vanishes immediately.
      if (pendingTaskIdRef.current === taskId) clearPending();
      setPendingQueuedSends(prev => {
        let changed = false;
        const next: PendingQueuedSend[] = [];
        for (const send of prev) {
          if (send.taskId === taskId) {
            for (const url of send.imageUrls) URL.revokeObjectURL(url);
            changed = true;
          } else {
            next.push(send);
          }
        }
        return changed ? next : prev;
      });
      // Optimistic: clear the specific task reference so UI responds immediately
      setQueuedTaskIds(prev => prev.filter(id => id !== taskId));
      setQueuedTasks(prev => prev.filter(t => t.taskId !== taskId));
      setStreamTaskId(prev => prev === taskId ? null : prev);
    } catch {}
  }, [clearPending]);

  const handleSteerTask = useCallback(async (taskId: string) => {
    try { await api.steerSession(taskId); } catch {}
  }, []);

  // Stop EVERYTHING for this session (running + queued). Bound to the main
  // stop button so the user's expectation that "stop = halt this conversation"
  // holds even when they've already queued follow-ups behind the active turn.
  const handleStopAll = useCallback(async () => {
    try {
      await api.stopSession(session.agent || '', session.sessionId);
    } catch { /* server-side already logged */ }
  }, [session.agent, session.sessionId]);

  const sk = snapshotKey(session.agent || '', session.sessionId);
  useEffect(() => {
    // During session promotion (pending→native), the sessionId prop changes but the
    // panel stays mounted (stable mountKey). Skip the full reset to preserve live
    // stream state — only refresh history with the new session ID.
    if (promotingRef.current) {
      promotingRef.current = false;
      void loadLatestTurns({ keepOlder: true, force: true });
      return;
    }
    let c = false;
    const cachedLatest = peekSessionMessages({
      workdir,
      agent: session.agent || '',
      sessionId: session.sessionId,
      rich: true,
      turnOffset: 0,
      turnLimit: SESSION_PAGE_TURNS,
    }, { allowStale: true });
    const isNewSession = hasInitialPending && !initialPendingConsumedRef.current;
    // Stale-while-revalidate: API cache → history snapshot → loading spinner
    const initialHistory = cachedLatest?.ok
      ? normalizeTurnHistory(cachedLatest)
      : historySnapshots.get(sk) || null;
    setLoading(isNewSession ? false : !initialHistory);
    setHistory(initialHistory);
    setLiveStream(null);
    setStreaming(false);
    setStreamPhase(null);
    setQueuedTaskIds([]);
    setQueuedTasks([]);
    setInteractions([]);
    // Reset the previous session's optimistic state (pending bubble, queued
    // sends, deferred clear flags). Without this, navigating to another
    // session via onSessionChange — including the fork flow that swaps the
    // slot in-place — leaves a stale pendingPrompt that renders as a ghost
    // user bubble in the new session's history. Skip on the new-session
    // mount path, which seeds pending state from props via useState.
    if (!isNewSession) {
      clearPending();
      clearPendingQueuedSends();
      localStreamPendingRef.current = false;
      clearPendingOnLoadRef.current = false;
      clearLiveStreamOnLoadRef.current = false;
    }
    stickToBottomRef.current = true;
    scrollToBottomRef.current = true;
    if (!isNewSession) {
      loadLatestTurns({ keepOlder: false, force: true }).finally(() => { if (!c) setLoading(false); });
    }
    return () => { c = true; };
  }, [loadLatestTurns, session.agent, session.sessionId, workdir, sk, clearPending, clearPendingQueuedSends]);

  // Persist history snapshot for stale-while-revalidate on re-mount
  useEffect(() => {
    if (history && history.turns.length > 0) saveHistorySnapshot(sk, history);
  }, [sk, history]);

  /* ── Poll stream state — works identically across multiple tabs ── */
  useEffect(() => {
    if (!active) return;
    void loadLatestTurns({ keepOlder: true, force: true });
  }, [active, loadLatestTurns]);

  /* ── WS-driven: apply stream snapshots for ALL open panels (active or not).
     Active panels get full liveStream text; inactive panels get phase/status only. ── */
  const sessionKeyRef = useRef(`${session.agent}:${session.sessionId}`);
  sessionKeyRef.current = `${session.agent}:${session.sessionId}`;

  useDashboardEvent(
    'stream-update',
    useCallback((event: DashboardEvent) => {
      if (event.key !== sessionKeyRef.current) return;
      applyStreamSnapshot(event.snapshot ?? null);
    }, [applyStreamSnapshot]),
  );

  /* ── Initial stream-state fetch (WS handles all subsequent updates).
     Runs for ALL open panels so inactive panels know the current phase. ── */
  useEffect(() => {
    let mounted = true;
    void api.getSessionStreamState(session.agent || '', session.sessionId).then(res => {
      if (mounted) applyStreamSnapshot(res.state);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [applyStreamSnapshot, session.agent, session.sessionId, streamPollNonce]);

  /* ── Refresh stream state after WS reconnect (covers missed events) ── */
  useDashboardReconnect(useCallback(() => {
    void api.getSessionStreamState(session.agent || '', session.sessionId).then(res => {
      applyStreamSnapshot(res.state);
    }).catch(() => {});
    void loadLatestTurns({ keepOlder: true, force: true });
  }, [applyStreamSnapshot, session.agent, session.sessionId, loadLatestTurns]));

  /* ── Safety: clear stale pending state when session stops running ── */
  // Must wait until the stream snapshot is gone (streamPhase null, no queued
  // tasks). Otherwise a steer/recall mid-flight — where session.running can
  // briefly flip to false between task A finishing and queued task B starting —
  // would clear pendingPrompt and "lose" the optimistic bubble for the queued
  // message until loadLatestTurns later picks it up as a persisted turn.
  useEffect(() => {
    if (displayState !== 'running' && !streaming && !liveStream
        && !streamPhase && queuedTaskIds.length === 0) {
      clearPending();
      clearPendingQueuedSends();
      localStreamPendingRef.current = false;
    }
  }, [displayState, streaming, liveStream, streamPhase, queuedTaskIds.length, clearPending, clearPendingQueuedSends]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el) return;
    prependAnchorRef.current = null;
    el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight);
  }, [history?.turns.length]);

  useLayoutEffect(() => {
    if (!scrollToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    scrollToBottomRef.current = false;
    el.scrollTop = el.scrollHeight;
    // Catch any post-layout height shifts (CSS animations, LivePreview→TurnView swap)
    requestAnimationFrame(() => {
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
  }, [history, liveStream]);

  // Scroll to bottom when a pending prompt appears
  useLayoutEffect(() => {
    if (!pendingPrompt) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pendingPrompt]);

  useEffect(() => {
    if (!history?.hasOlder || loading || loadingOlder) return;
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + TOP_LOAD_THRESHOLD_PX) {
      void loadOlderTurns();
    }
  }, [history?.hasOlder, history?.turns.length, loadOlderTurns, loading, loadingOlder]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = remaining <= BOTTOM_STICK_THRESHOLD_PX;
    if (el.scrollTop <= TOP_LOAD_THRESHOLD_PX) void loadOlderTurns();
  }, [loadOlderTurns]);

  // Effective model + effort to display: live stream wins (it carries the truth
  // for the in-flight turn), then the session's persisted choice, then the
  // agent's runtime default. Always resolves to something so the divider never
  // shows a bare label without context.
  const displayModel = (liveStream?.model || session.model || globalModel) || null;
  const displayEffort = (liveStream?.effort || session.thinkingEffort || globalEffort) || null;
  const displayModelShort = displayModel ? shortenModel(displayModel) : null;

  const rawTurns = history?.turns || [];
  // When a live stream is active, the last turn's assistant response may already be
  // present in fetched history (partial or complete).  Suppress it to avoid rendering
  // the same response twice (once in TurnView, once in LivePreview).
  // BUT: when there's a pending follow-up prompt whose turn hasn't appeared in history
  // yet, the liveStream is for the NEW turn — don't strip the previous turn's response.
  // True when the server's last-turn user matches the optimistic pending message
  // by text but lacks the images we're holding. Claude persists user image blocks
  // only after the turn settles, so text matches mid-stream while images are still
  // missing — without this guard, the dedup would hide the optimistic bubble (with
  // images) and let the server-rendered turn (no images) take over until 'done'.
  const optimisticBridgesImages = useMemo(() => {
    if (!pendingImageUrls.length || !rawTurns.length) return false;
    const last = rawTurns[rawTurns.length - 1];
    if (!last.user) return false;
    if ((last.user.text?.trim() || '') !== (pendingPrompt || '').trim()) return false;
    const serverImages = last.user.blocks.filter(b => b.type === 'image').length;
    return serverImages < pendingImageUrls.length;
  }, [rawTurns, pendingPrompt, pendingImageUrls.length]);

  const turns = useMemo(() => {
    let result = rawTurns;
    // Drop the duplicate user from history while the optimistic bubble is bridging
    // missing server-side images. We keep the assistant — only the user is doubled.
    if (optimisticBridgesImages) {
      const last = result[result.length - 1];
      result = [...result.slice(0, -1), { ...last, user: null }];
    }
    if (!liveStream || !result.length) return result;
    const last = result[result.length - 1];
    if (!last.assistant) return result;
    // If a pending prompt exists and doesn't match the last turn's user message,
    // the live stream is for a new follow-up turn, not the last one in history.
    if (pendingPrompt && last.user?.text?.trim() !== pendingPrompt.trim()) return result;
    return [...result.slice(0, -1), { ...last, assistant: null }];
  }, [rawTurns, liveStream, pendingPrompt, optimisticBridgesImages]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Messages ── */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Spinner className="h-5 w-5 text-fg-4" /></div>
        ) : turns.length === 0 && !pendingPrompt && !pendingImageUrls.length && !liveStream ? (
          <div className="py-20 text-center text-[13px] text-fg-5">{t('hub.noMessages')}</div>
        ) : (
          <div className="max-w-[900px] mx-auto px-6 py-6 space-y-0">
            {(history?.hasOlder || loadingOlder) && (
              <div className="mb-4 flex items-center justify-center gap-2 text-[11px] text-fg-5">
                {loadingOlder ? <Spinner className="h-3 w-3 text-fg-5" /> : <span className="h-1.5 w-1.5 rounded-full bg-fg-5/35" />}
                <span>{loadingOlder ? t('hub.loadingOlderTurns') : t('hub.loadOlderTurnsHint')}</span>
              </div>
            )}
            {session.migratedFrom?.kind === 'fork' && session.migratedFrom.sessionId && (
              <button
                type="button"
                onClick={() => onSessionChange?.({
                  agent: session.migratedFrom!.agent || session.agent || '',
                  sessionId: session.migratedFrom!.sessionId,
                  workdir,
                })}
                className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-edge bg-panel-alt px-2.5 py-1 text-[11px] text-fg-5 transition hover:border-edge-h hover:text-fg-2"
                title={`#${session.migratedFrom.sessionId.slice(0, 8)}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="20" r="2" />
                  <path d="M6 8v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8" /><path d="M12 14v4" />
                </svg>
                <span>{t('hub.forkBadge')}</span>
                <span className="font-mono">#{session.migratedFrom.sessionId.slice(0, 8)}</span>
                {typeof session.migratedFrom.forkedAtTurn === 'number' && (
                  <span className="text-fg-5/70">· {t('hub.forkBadgeAt').replace('{turn}', String(session.migratedFrom.forkedAtTurn + 1))}</span>
                )}
              </button>
            )}
            {turns.map((turn, i) => {
              const absoluteTurnIndex = (history?.startTurn || 0) + i;
              return (
                <TurnView key={`${history?.startTurn || 0}:${i}`}
                  turn={turn}
                  turnIndex={absoluteTurnIndex}
                  agent={session.agent || ''} meta={meta} model={displayModelShort} effort={displayEffort} providerName={byokProviderName} t={t}
                  onResend={(txt) => {
                    scrollToBottomRef.current = true;
                    handleSendStart(txt);
                    api.sendSessionMessage(workdir, session.agent || '', session.sessionId, txt)
                      .then((res) => { if (res.ok) requestStreamPolling(); })
                      .catch(() => { clearPending(); });
                  }}
                  onEdit={(txt) => setEditDraft(txt)}
                  onFork={canFork ? (atTurn) => { setForkPrompt(''); setForkRequest({ atTurn }); } : undefined}
                />
              );
            })}
            {/* Optimistic pending message — represents the RUNNING task's user
                turn until rawTurns picks it up. Deduped against the last loaded
                user turn to avoid double-rendering after history refresh. When
                the server's matching turn lacks images we still hold,
                optimisticBridgesImages keeps this rendered (the matching server
                user is also stripped from `turns` above). Queued sends never
                land in pendingPrompt — they live in `pendingQueuedSends` and
                surface in InputComposer's queue rows instead.
                Note: we deliberately do NOT gate on clearPendingOnLoadRef here.
                That ref signals an in-flight history fetch triggered by 'done',
                and the actual pending clear is batched with setHistory/
                setLiveStream(null) inside loadLatestTurns. Hiding here would
                create a gap between 'done' and fetch completion where neither
                the optimistic bubble nor the server turn is visible. */}
            {(pendingPrompt || pendingImageUrls.length > 0)
              && (optimisticBridgesImages
                  || !(pendingPrompt && rawTurns.length > 0
                       && rawTurns[rawTurns.length - 1]?.user?.text?.trim() === pendingPrompt.trim())) && (
              <div className="session-turn">
                <UserBubble text={pendingPrompt || ''} blocks={pendingImageUrls.map(u => ({ type: 'image' as const, content: u }))} t={t} />
                {!liveStream && (
                  <div className="mt-3 mb-5 animate-in">
                    <ThinkingDots className="text-fg-5" />
                  </div>
                )}
              </div>
            )}
            {/* Live stream preview — skip entirely when the stream has nothing to show
                (no body, no error). Prevents a phantom header above an empty body. */}
            {liveStream && liveStreamShouldRender(liveStream) && (
              <div className="mb-6">
                <TurnDivider agent={session.agent || ''} meta={meta} model={displayModelShort} effort={displayEffort} providerName={byokProviderName} previewMeta={liveStream.previewMeta} />
                <LivePreview stream={liveStream} t={t} />
              </div>
            )}
            <div className="h-4" />
          </div>
        )}
      </div>

      {/* ── Input ── */}
      <InputComposer
        session={session}
        workdir={workdir}
        onStreamQueued={requestStreamPolling}
        onSendStart={handleSendStart}
        onSendTaskAssigned={handleSendTaskAssigned}
        onSessionChange={onSessionChange}
        t={t}
        streamPhase={streamPhase}
        streamTaskId={streamTaskId}
        queuedTaskIds={queuedTaskIds}
        queuedTasks={queuedTasks}
        pendingQueuedSends={pendingQueuedSends}
        onRecall={handleRecallTask}
        onSteer={handleSteerTask}
        onStopAll={handleStopAll}
        editDraft={editDraft}
        onEditDraftConsumed={() => setEditDraft(null)}
      />

      {/* ── Fork composer modal ── */}
      {forkRequest && (
        <Modal open onClose={() => { if (!forkSubmitting) setForkRequest(null); }}>
          <ModalHeader
            title={t('hub.forkPromptTitle')}
            description={t('hub.forkPromptHint')}
            onClose={() => { if (!forkSubmitting) setForkRequest(null); }}
          />
          <textarea
            autoFocus
            value={forkPrompt}
            disabled={forkSubmitting}
            onChange={(e) => setForkPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && forkPrompt.trim() && !forkSubmitting) {
                e.preventDefault();
                void submitForkRef.current?.();
              }
            }}
            placeholder={t('hub.forkPromptPlaceholder')}
            className="w-full min-h-[120px] resize-y rounded-md border border-edge bg-panel-alt px-3 py-2 text-[13px] leading-relaxed text-fg outline-none focus:border-edge-h"
          />
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="ghost" disabled={forkSubmitting} onClick={() => setForkRequest(null)}>
              {t('modal.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={forkSubmitting || !forkPrompt.trim()}
              onClick={() => void submitForkRef.current?.()}
            >
              {forkSubmitting ? t('hub.forkSubmitting') : t('hub.forkSubmit')}
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Human-in-the-loop ask-user modal ──
          Renders the most recently opened active prompt; if multiple are queued,
          we resolve them in LIFO order so a fresh sub-question pops on top. */}
      {active && interactions.length > 0 && (
        <InteractionPromptModal
          key={interactions[interactions.length - 1].promptId}
          snapshot={interactions[interactions.length - 1]}
        />
      )}
    </div>
  );
});
