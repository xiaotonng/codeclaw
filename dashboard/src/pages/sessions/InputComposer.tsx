import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { AGENT_ACCEPTED_PROVIDER_KINDS, cn, EFFORT_OPTIONS, getAgentMeta, shortenModel } from '../../utils';
import { api } from '../../api';
import { useStore } from '../../store';
import { Spinner } from '../../components/ui';
import { BrandIcon } from '../../components/BrandIcon';
import {
  makeComposerImageAttachment,
  revokeComposerAttachments,
  formatFileSize,
  copyImageFile,
  parseSessionKey,
  type ComposerImageAttachment,
} from './utils';
import type { SessionInfo, AgentRuntimeStatus, SkillInfo } from '../../types';

type CascadeStep = 'closed' | 'agent' | 'model' | 'effort';

/* ── Draft persistence across session switches ── */
const draftStore = new Map<string, { text: string; files: File[] }>();
function draftKey(agent: string, sessionId: string) { return `${agent}:${sessionId}`; }

/**
 * Pick a BrandIcon id for a configured Provider based on its base URL / kind.
 * Mirrors the logic used in AgentTab / ModelsTab so the same provider shows
 * the same logo everywhere.
 */
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

export const InputComposer = memo(function InputComposer({ session, workdir, onStreamQueued, onSendStart, onSendTaskAssigned, onSessionChange, t, streamPhase, streamTaskId, queuedTaskIds, queuedTasks, pendingQueuedSends, onRecall, onSteer, onStopAll, editDraft, onEditDraftConsumed, onSelectionChange }: {
  session: SessionInfo;
  workdir: string;
  onStreamQueued: () => void;
  onSendStart: (prompt: string, imageUrls?: string[]) => void;
  onSendTaskAssigned?: (taskId: string) => void;
  onSessionChange?: (next: { agent: string; sessionId: string; workdir: string }) => void;
  t: (k: string) => string;
  streamPhase: string | null;
  streamTaskId?: string | null;
  queuedTaskIds?: string[];
  queuedTasks?: Array<{ taskId: string; prompt: string }>;
  /** Optimistic fallback for queued sends — used by each queued row while the
   *  server snapshot's `queuedTasks` hasn't yet caught up. `imageUrls` are
   *  blob previews surfaced as inline thumbnails so the user can recognize
   *  the queued message at a glance (server-side queued state has no image
   *  data, so older rows after a refresh fall back to text only). */
  pendingQueuedSends?: Array<{ taskId: string | null; prompt: string; imageUrls?: string[] }>;
  onRecall?: (taskId: string) => void;
  onSteer?: (taskId: string) => void;
  /** Stop the running stream AND cancel every queued task for this session. */
  onStopAll?: () => void | Promise<void>;
  editDraft?: string | null;
  onEditDraftConsumed?: () => void;
  /** Reports the composer's currently-resolved model + effort (the per-session
   *  cascade pick, or the agent's global default) so actions owned by the parent
   *  — e.g. the message "rerun" button — can send with the same selection the
   *  user sees in the chip instead of the stale session-runtime values. */
  onSelectionChange?: (sel: { model: string | null; effort: string | null }) => void;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [localTaskId, setLocalTaskId] = useState<string | null>(null);
  // Per-task in-flight tracking. A global boolean would freeze every row's
  // button when one recall completes but other tasks remain queued/streaming
  // (the "did the target resolve?" check can't distinguish which row's
  // operation finished). Tracking the target taskId lets us clear the flag
  // when that specific task disappears and disable only that row's button.
  const [recallingIds, setRecallingIds] = useState<Set<string>>(() => new Set());
  const [steeringIds, setSteeringIds] = useState<Set<string>>(() => new Set());
  // Stash last-sent content so recall can restore it to the input field
  const lastSentRef = useRef<{ prompt: string; files: File[] }>({ prompt: '', files: [] });
  const storeAgents = useStore(s => s.agentStatus?.agents ?? null);
  const [agents, setAgents] = useState<AgentRuntimeStatus[]>(storeAgents || []);
  // User's applied cascade choice for this session. Empty = fall back to runtime
  // default. These are intentionally per-session and never written back to the
  // global runtime prefs — picking a model in the composer must NOT change other
  // sessions' defaults. Reset on session change (see session-key effect below).
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedEffort, setSelectedEffort] = useState('');
  const [imageAttachments, setImageAttachments] = useState<ComposerImageAttachment[]>([]);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [queuedPreviewUrl, setQueuedPreviewUrl] = useState<string | null>(null);
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [pendingEffort, setPendingEffort] = useState<string | null>(null);
  // Tracks the staged Profile id while the user steps through the cascade.
  // `null` (after the user touches the model step) means "switching to native";
  // `undefined` means "user hasn't picked yet — leave the existing binding
  // untouched on apply." This three-state semantics matters because applying
  // the cascade should be a no-op for the agent's Profile binding when the
  // user only changed the effort.
  const [pendingProfileSelection, setPendingProfileSelection] = useState<string | null | undefined>(undefined);
  const [cascadeStep, setCascadeStep] = useState<CascadeStep>('closed');
  const [cascadePos, setCascadePos] = useState<{ left: number; bottom: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const attachmentsRef = useRef<ComposerImageAttachment[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillMenuIndex, setSkillMenuIndex] = useState(0);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const refreshAgentStatus = useStore(s => s.refreshAgentStatus);

  // Model layer — Providers + Profiles + current bindings. Fetched lazily on
  // cascade open so the dropdown can list "我的模型" (Profile shortcuts) next
  // to the agent's native model catalogue. Kept local to InputComposer since
  // this is the only session-scoped consumer; the dashboard agents page has
  // its own `useModelLayer` hook with the same shape.
  const [profiles, setProfiles] = useState<Array<{
    id: string; name: string; providerId: string; modelId: string; effort?: string | null;
  }>>([]);
  const [providers, setProviders] = useState<Array<{ id: string; name: string; kind: string; baseURL: string }>>([]);
  const [activeProfiles, setActiveProfiles] = useState<Record<string, string | null>>({});

  const refreshModelLayer = useCallback(async () => {
    try {
      const [pRes, profRes, bRes] = await Promise.all([
        fetch('/api/models/providers').then(r => r.json()),
        fetch('/api/models/profiles').then(r => r.json()),
        fetch('/api/models/agents').then(r => r.json()),
      ]);
      if (pRes?.ok) setProviders(pRes.providers || []);
      if (profRes?.ok) setProfiles(profRes.profiles || []);
      if (bRes?.ok) {
        const map: Record<string, string | null> = {};
        for (const b of bRes.bindings || []) map[b.agent] = b.activeProfileId;
        setActiveProfiles(map);
      }
    } catch { /* network blip — leave previous snapshot in place */ }
  }, []);

  useEffect(() => { if (storeAgents?.length) setAgents(storeAgents); }, [storeAgents]);
  useEffect(() => { attachmentsRef.current = imageAttachments; }, [imageAttachments]);

  // Restore draft on mount, save on unmount
  const dk = draftKey(session.agent || '', session.sessionId);
  const dkRef = useRef(dk);
  dkRef.current = dk;
  useEffect(() => {
    const saved = draftStore.get(dk);
    if (saved) {
      draftStore.delete(dk);
      if (saved.text) setInput(saved.text);
      if (saved.files.length) setImageAttachments(saved.files.map(makeComposerImageAttachment));
    }
    return () => {
      const text = inputRef.current?.value || '';
      const files = attachmentsRef.current.map(a => a.file);
      // Save draft — revoke preview URLs but keep File objects
      for (const a of attachmentsRef.current) URL.revokeObjectURL(a.previewUrl);
      if (text || files.length) draftStore.set(dkRef.current, { text, files });
      else draftStore.delete(dkRef.current);
    };
  }, [dk]);

  // Reset applied cascade choice + transient pending state when session changes.
  useEffect(() => {
    setSelectedAgent('');
    setSelectedModel('');
    setSelectedEffort('');
    setPendingAgent(null);
    setPendingModel(null);
    setPendingEffort(null);
    setCascadeStep('closed');
  }, [session.agent, session.sessionId]);

  // Consume editDraft — populate the input when user clicks "Edit" on a message
  useEffect(() => {
    if (editDraft != null) {
      setInput(editDraft);
      onEditDraftConsumed?.();
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) { el.focus(); el.setSelectionRange(editDraft.length, editDraft.length); }
      });
    }
  }, [editDraft, onEditDraftConsumed]);

  // Fetch available skills when workdir changes
  useEffect(() => {
    if (!workdir) return;
    let cancelled = false;
    api.getSkills(workdir).then(res => {
      if (!cancelled && res.ok) setSkills(res.skills);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [workdir]);

  // Compute filtered skills for the autocomplete menu
  const skillQuery = skillMenuOpen ? (() => {
    const match = input.match(/^\/(\S*)$/);
    return match ? match[1].toLowerCase() : null;
  })() : null;
  const filteredSkills = skillQuery !== null
    ? skills.filter(s => s.name.toLowerCase().includes(skillQuery) || (s.label && s.label.toLowerCase().includes(skillQuery)))
    : [];

  // Reset selected index when filtered list changes
  useEffect(() => { setSkillMenuIndex(0); }, [skillMenuOpen, input]);

  // Scroll skill menu to keep selected item visible
  useEffect(() => {
    if (!skillMenuOpen || !skillMenuRef.current) return;
    const item = skillMenuRef.current.querySelector(`[data-skill-idx="${skillMenuIndex}"]`);
    if (item) (item as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [skillMenuIndex, skillMenuOpen]);

  // Close skill menu on outside click
  useEffect(() => {
    if (!skillMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (skillMenuRef.current?.contains(e.target as Node)) return;
      if (inputRef.current?.contains(e.target as Node)) return;
      setSkillMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [skillMenuOpen]);

  // Close cascade on outside click — check both trigger and portal
  useEffect(() => {
    if (cascadeStep === 'closed') return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking inside the trigger button
      if (triggerRef.current?.contains(target)) return;
      // Don't close if clicking inside the portal dropdown
      const portal = document.getElementById('cascade-portal');
      if (portal?.contains(target)) return;
      setCascadeStep('closed'); setPendingAgent(null); setPendingModel(null); setPendingEffort(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [cascadeStep]);

  // Position the cascade portal above the trigger button
  useLayoutEffect(() => {
    if (cascadeStep === 'closed' || !triggerRef.current) { setCascadePos(null); return; }
    const rect = triggerRef.current.getBoundingClientRect();
    setCascadePos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
  }, [cascadeStep]);

  const firstQueuedFromSnapshot = queuedTaskIds && queuedTaskIds.length ? queuedTaskIds[0] : null;
  // Clear local taskId once the real snapshot has the info
  useEffect(() => {
    if (localTaskId) {
      if (firstQueuedFromSnapshot) setLocalTaskId(null);
      else if (streamPhase !== null && streamPhase !== 'queued') setLocalTaskId(null);
    }
  }, [streamPhase, localTaskId, firstQueuedFromSnapshot]);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const addImageAttachments = useCallback((files: ArrayLike<File> | null | undefined) => {
    const nextFiles = Array.from(files || []).filter(file => file.type.startsWith('image/'));
    if (!nextFiles.length) return;
    setImageAttachments(prev => [...prev, ...nextFiles.map(makeComposerImageAttachment)]);
  }, []);

  const clearImageAttachments = useCallback(() => {
    setPreviewImageId(null);
    setImageAttachments(prev => {
      revokeComposerAttachments(prev);
      return [];
    });
  }, []);

  const removeImageAttachment = useCallback((id: string) => {
    setImageAttachments(prev => {
      const target = prev.find(item => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(item => item.id !== id);
    });
    setPreviewImageId(current => current === id ? null : current);
  }, []);

  const handleSend = useCallback(() => {
    const prompt = input.trim();
    const attachments = imageAttachments.map(item => item.file);
    if ((!prompt && attachments.length === 0) || sending) return;
    const targetAgent = selectedAgent
      || session.agent
      || agents.find(a => a.isDefault)?.agent
      || '';
    if (!targetAgent) return;
    const targetStatus = agents.find(a => a.agent === targetAgent) || null;
    // Per-session pick wins over the global runtime default. selectedModel/Effort
    // is set by applyCascade and only applies to this session's React state.
    const targetModel = (selectedModel || targetStatus?.selectedModel || '').trim() || null;
    const targetEffort = targetAgent === 'gemini'
      ? null
      : ((selectedEffort || targetStatus?.selectedEffort || '').trim() || null);
    const isAgentSwitch = targetAgent !== session.agent;
    const targetSessionId = isAgentSwitch ? '' : session.sessionId;
    // When switching agent, pass the live session of the outgoing agent so the
    // backend can compact it and seed the new session's first turn — see
    // `compactForHandover` in src/agent/handover.ts. We deliberately don't send
    // these when the session id is unchanged: same-agent continuation goes via
    // the agent's own --resume.
    const previousAgent = isAgentSwitch && session.agent ? session.agent : null;
    const previousSessionId = isAgentSwitch && session.sessionId ? session.sessionId : null;
    setSending(true);
    // Stash content for potential recall restoration
    lastSentRef.current = { prompt, files: attachments };
    setInput('');
    draftStore.delete(dkRef.current);
    // Create fresh preview URLs before clearing (clearing revokes the originals)
    const previewUrls = attachments.length ? attachments.map(f => URL.createObjectURL(f)) : undefined;
    clearImageAttachments();
    onSendStart(prompt, previewUrls);
    onStreamQueued(); // Start polling immediately — don't wait for API response
    api.sendSessionMessage(workdir, targetAgent, targetSessionId, prompt, {
      attachments,
      model: targetModel,
      effort: targetEffort,
      previousAgent,
      previousSessionId,
    })
      .then(res => {
        if (res.taskId) {
          setLocalTaskId(res.taskId);
          onSendTaskAssigned?.(res.taskId);
        }
        if (!res.ok) return;
        const nextSession = typeof res.sessionKey === 'string' ? parseSessionKey(res.sessionKey) : null;
        const switchedSession = !!nextSession
          && (nextSession.agent !== session.agent || nextSession.sessionId !== session.sessionId);
        if (switchedSession && nextSession) {
          onSessionChange?.({ ...nextSession, workdir });
        }
      })
      .catch(() => {})
      .finally(() => setSending(false));
  }, [
    agents,
    clearImageAttachments,
    imageAttachments,
    input,
    onSendStart,
    onSendTaskAssigned,
    onSessionChange,
    onStreamQueued,
    selectedAgent,
    selectedEffort,
    selectedModel,
    sending,
    session.agent,
    session.sessionId,
    workdir,
  ]);

  // Task bar state — derived from snapshot + optimistic local state.
  // `effectiveQueuedIds` aggregates every queued task we know about so each one
  // gets its own row (instead of collapsing many queued tasks into one banner).
  const isActiveStream = streamPhase === 'streaming';
  const effectiveQueuedIds: string[] = (() => {
    const ids: string[] = [];
    if (queuedTaskIds && queuedTaskIds.length) ids.push(...queuedTaskIds);
    // When the snapshot itself is in `queued` phase the visible task is the
    // queued one — surface it as a queued row.
    if (streamPhase === 'queued' && streamTaskId && !ids.includes(streamTaskId)) {
      ids.unshift(streamTaskId);
    }
    // Optimistic local id for messages we just sent before the backend has
    // emitted the queued event yet.
    if (localTaskId && !ids.includes(localTaskId)) {
      const optimisticAllowed = streamPhase === 'queued' || (!streamPhase);
      if (optimisticAllowed) ids.push(localTaskId);
    }
    return ids;
  })();
  const effectiveQueuedId = effectiveQueuedIds[effectiveQueuedIds.length - 1] || null;
  const hasQueuedTask = effectiveQueuedIds.length > 0;
  const showTaskBar = hasQueuedTask || isActiveStream;

  // Clear per-task pending flags as their target tasks resolve.
  // A target is "resolved" once it's no longer in the queued list and is no
  // longer the active stream — i.e. the recall/steer landed on the server.
  useEffect(() => {
    const isLive = (id: string) => effectiveQueuedIds.includes(id) || id === streamTaskId;
    setRecallingIds(prev => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) { if (isLive(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
    setSteeringIds(prev => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) { if (isLive(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
  }, [effectiveQueuedIds, streamTaskId]);
  // Clear stashed files once queued task starts streaming (no longer recallable)
  useEffect(() => {
    if (!hasQueuedTask && lastSentRef.current.files.length) {
      lastSentRef.current = { prompt: '', files: [] };
    }
  }, [hasQueuedTask]);

  const handleRecallQueued = useCallback((taskId: string) => {
    if (recallingIds.has(taskId)) return;
    setRecallingIds(prev => { const next = new Set(prev); next.add(taskId); return next; });
    // Only the most-recent queued task corresponds to the input the user just
    // sent; restoring stash for an older queued task would dump someone else's
    // prompt into the composer.
    if (taskId === effectiveQueuedId) {
      const stash = lastSentRef.current;
      if (stash.prompt) setInput(stash.prompt);
      if (stash.files.length) setImageAttachments(stash.files.map(makeComposerImageAttachment));
      lastSentRef.current = { prompt: '', files: [] };
    }
    onRecall?.(taskId);
    if (taskId === localTaskId) setLocalTaskId(null);
  }, [recallingIds, effectiveQueuedId, localTaskId, onRecall]);

  const [stoppingAll, setStoppingAll] = useState(false);
  // "Stop" means halt the conversation, not "recall this one taskId". We call
  // the session-scoped stop endpoint so:
  //   1. queued follow-ups don't keep firing after the user hits stop, and
  //   2. the button still works in the brief window after a fresh send where
  //      `streamTaskId` is still null (no WS snapshot yet). The endpoint takes
  //      (agent, sessionId), which the panel always has.
  const handleStop = useCallback(async () => {
    if (stoppingAll || !onStopAll) return;
    setStoppingAll(true);
    try { await onStopAll(); }
    finally { setStoppingAll(false); }
  }, [stoppingAll, onStopAll]);

  const handleSteerQueued = useCallback((taskId: string) => {
    if (steeringIds.has(taskId)) return;
    setSteeringIds(prev => { const next = new Set(prev); next.add(taskId); return next; });
    onSteer?.(taskId);
    if (taskId === localTaskId) setLocalTaskId(null);
  }, [steeringIds, localTaskId, onSteer]);

  const selectSkill = useCallback((skill: SkillInfo) => {
    setInput(`/${skill.name} `);
    setSkillMenuOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    // Open skill menu when input is a single slash-command token (no spaces yet)
    const isSlashCmd = /^\/\S*$/.test(value) && skills.length > 0;
    setSkillMenuOpen(isSlashCmd);
  }, [skills.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (skillMenuOpen && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSkillMenuIndex(i => (i + 1) % filteredSkills.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSkillMenuIndex(i => (i - 1 + filteredSkills.length) % filteredSkills.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !composingRef.current)) {
        e.preventDefault();
        selectSkill(filteredSkills[skillMenuIndex]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setSkillMenuOpen(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) { e.preventDefault(); handleSend(); }
  };

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((file): file is File => !!file);
    if (!files.length) return;
    e.preventDefault();
    addImageAttachments(files);
  }, [addImageAttachments]);

  const effectiveAgent = selectedAgent
    || session.agent
    || agents.find(a => a.isDefault)?.agent
    || agents.find(a => a.installed)?.agent
    || agents[0]?.agent
    || '';
  const currentAgent = agents.find(a => a.agent === effectiveAgent) || null;
  const cascadeAgentId = pendingAgent || effectiveAgent;
  const cascadeAgent = agents.find(a => a.agent === cascadeAgentId) || currentAgent;
  // Unified model list — native catalogue + "我的模型" Profiles the agent can
  // route through. Each row carries kind + profileId so the click handler
  // knows whether to clear the active Profile binding (native) or set it
  // (profile). The previous shape mixed native vs byok in one untyped
  // ModelInfo array which couldn't express the distinction.
  type CascadeModelRow = {
    id: string;
    /** What renders in the row. For Profiles this is the user-set name. */
    label: string;
    /** Discriminates the click handler. Native rows clear the Profile binding. */
    kind: 'native' | 'profile';
    /** Profile id when kind='profile'; the model id to send is `id`. */
    profileId?: string;
    /** Secondary line — provider name for Profile rows, alias for native. */
    description?: string;
  };
  const models = useMemo<CascadeModelRow[]>(() => {
    if (!cascadeAgent) return [];
    const out: CascadeModelRow[] = [];
    // Native section — the agent CLI's own model list. byokModels is no longer
    // used here because Profiles are now first-class entries below.
    for (const m of cascadeAgent.models || []) {
      out.push({
        id: m.id,
        label: m.id,
        kind: 'native',
        description: m.alias && m.alias.toLowerCase() !== m.id.toLowerCase() ? m.alias : undefined,
      });
    }
    // 我的模型 section — Profiles compatible with this agent's BYOK kinds.
    const acceptedKinds = new Set(AGENT_ACCEPTED_PROVIDER_KINDS[cascadeAgentId] || []);
    for (const p of profiles) {
      const provider = providers.find(x => x.id === p.providerId);
      if (!provider || !acceptedKinds.has(provider.kind)) continue;
      const showModelId = p.name.trim().toLowerCase() !== p.modelId.trim().toLowerCase();
      out.push({
        id: p.modelId,
        label: p.name,
        kind: 'profile',
        profileId: p.id,
        description: showModelId ? `${provider.name} · ${p.modelId}` : provider.name,
      });
    }
    return out;
  }, [cascadeAgent, cascadeAgentId, profiles, providers]);
  // First Profile row index for inserting the "我的模型" group header.
  const firstProfileIdx = useMemo(() => models.findIndex(m => m.kind === 'profile'), [models]);
  // Index of the currently-active Profile in the unified list (or -1).
  const activeProfileIdForAgent = activeProfiles[cascadeAgentId] || null;
  // Per-session cascade choice wins over the global runtime default. Falling
  // back to currentAgent fields means an unset session shows the user's global
  // default; once they pick from the cascade, that pick scopes to this session.
  const currentModel = selectedModel || currentAgent?.selectedModel || '';
  const currentEffort = effectiveAgent === 'gemini'
    ? ''
    : (selectedEffort || currentAgent?.selectedEffort || '');
  // Surface the resolved selection to the parent so the rerun action sends with
  // the model/effort the user currently sees, not the stale session runtime.
  useEffect(() => {
    onSelectionChange?.({ model: currentModel || null, effort: currentEffort || null });
  }, [currentModel, currentEffort, onSelectionChange]);
  const effortLevels = EFFORT_OPTIONS[cascadeAgentId as keyof typeof EFFORT_OPTIONS] || [];
  const previewAttachment = previewImageId ? imageAttachments.find(item => item.id === previewImageId) || null : null;
  const activePreview: LightboxSource | null = previewAttachment
    ? {
        key: previewAttachment.id,
        url: previewAttachment.previewUrl,
        name: previewAttachment.file.name,
        size: previewAttachment.file.size,
        file: previewAttachment.file,
        onRemove: () => removeImageAttachment(previewAttachment.id),
      }
    : queuedPreviewUrl
      ? { key: queuedPreviewUrl, url: queuedPreviewUrl }
      : null;
  const canSend = (!!input.trim() || imageAttachments.length > 0) && !sending && !!effectiveAgent;

  const resetCascade = () => {
    setPendingAgent(null);
    setPendingModel(null);
    setPendingEffort(null);
    setPendingProfileSelection(undefined);
  };

  const applyCascade = useCallback(async (agent: string, model: string, effort: string | null) => {
    const nextEffort = agent === 'gemini' ? '' : (effort || '');
    // Profile binding is intentionally global (one binding per agent across
    // all sessions). When the user picks a Profile row in this cascade we
    // POST it through; native picks clear the binding. Per-session model and
    // effort overrides still flow only into local state and never touch
    // /api/runtime-agent, so other sessions keep their own pick.
    if (pendingProfileSelection !== undefined) {
      try {
        await fetch(`/api/models/agents/${agent}/active`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: pendingProfileSelection }),
        });
        void refreshModelLayer();
        void refreshAgentStatus();
      } catch { /* fall through — the per-session model id still applies */ }
    }
    setSelectedAgent(agent);
    setSelectedModel(model);
    setSelectedEffort(nextEffort);
    resetCascade();
    setCascadeStep('closed');
  }, [pendingProfileSelection, refreshModelLayer, refreshAgentStatus]);

  const toggleCascade = () => {
    if (cascadeStep === 'closed') {
      resetCascade();
      refreshAgentStatus();
      void refreshModelLayer();
      setCascadeStep('agent');
    } else { resetCascade(); setCascadeStep('closed'); }
  };

  // Build summary label for the cascade trigger
  const displayAgent = pendingAgent || effectiveAgent;
  const displayMeta = getAgentMeta(displayAgent);
  const displayModel = pendingModel ?? currentModel;
  const displayEffort = pendingEffort ?? currentEffort;
  const shortModel = displayModel ? shortenModel(displayModel) : '';

  // BYOK binding for the agent currently shown in the chip. When present we
  // splice in a provider chip (logo + user-set name) between the agent label
  // and the model id so the chip surfaces both pieces of identity.
  const displayProfile = (() => {
    const id = activeProfiles[displayAgent];
    return id ? profiles.find(p => p.id === id) ?? null : null;
  })();
  const displayProvider = displayProfile
    ? providers.find(p => p.id === displayProfile.providerId) ?? null
    : null;
  const displayProviderBrand = displayProvider ? brandIdForProvider(displayProvider) : null;
  // When a Profile is bound, prefer the user-set Profile name over the raw
  // model id. Matches the cascade row label. Fall back to the shortened model
  // id when there's no Profile (native auth) or when the user named the
  // Profile identical to its modelId.
  const displayModelLabel = displayProfile
    && displayProfile.name.trim().toLowerCase() !== displayProfile.modelId.trim().toLowerCase()
    ? displayProfile.name
    : shortModel;

  // Plain-text fallback used as the button tooltip when the user hovers.
  const cascadeLabel = [
    displayMeta.shortLabel,
    displayProvider ? displayProvider.name : null,
    displayModelLabel || null,
    displayEffort ? displayEffort.charAt(0).toUpperCase() + displayEffort.slice(1) : null,
  ].filter(Boolean).join(' / ');

  return (
    <div className="shrink-0" ref={composerRef}>
      {/* Floating centered input area */}
      <div className="max-w-[680px] mx-auto px-5 pb-4 pt-2">
        {/* Task control bar — stacked rows when streaming + queued coexist */}
        {showTaskBar && (
          <div className="mb-2 space-y-1.5">
            {/* Row 1: Active stream — always visible when streaming */}
            {isActiveStream && (
              <div className="flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.04] px-3.5 py-1.5 transition-colors">
                <Spinner className="h-3 w-3 text-primary shrink-0" />
                <span className="flex-1 min-w-0 text-[12px] font-medium text-fg-3 truncate">{t('hub.running')}</span>
                <button
                  onClick={handleStop}
                  disabled={stoppingAll}
                  title={t('hub.stopHint')}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-fg-4 hover:text-err hover:bg-err/10 transition-colors disabled:opacity-30 disabled:pointer-events-none shrink-0"
                >
                  {stoppingAll
                    ? <Spinner className="h-2.5 w-2.5" />
                    : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>}
                  {t('hub.stop')}
                </button>
              </div>
            )}
            {/* Rows 2..N: one row per queued task — each carries its own steer/recall */}
            {effectiveQueuedIds.map((taskId, idx) => {
              const isLatest = idx === effectiveQueuedIds.length - 1;
              const positionLabel = effectiveQueuedIds.length > 1 ? `${t('hub.queued')} #${idx + 1}` : t('hub.queued');
              // Per-task prompt + images come from pendingQueuedSends (client-
              // only blob URLs) with the server snapshot as the text fallback.
              // Server queue state doesn't carry image data, so an older
              // queued row that survives a refresh just shows the text.
              const optimistic = pendingQueuedSends?.find(p => p.taskId === taskId)
                || (isLatest ? pendingQueuedSends?.find(p => !p.taskId) : undefined);
              const taskPrompt = queuedTasks?.find(qt => qt.taskId === taskId)?.prompt
                || optimistic?.prompt
                || null;
              const taskImages = optimistic?.imageUrls?.length ? optimistic.imageUrls : [];
              return (
                <div
                  key={taskId}
                  className="flex items-center gap-2.5 rounded-lg border border-warn/25 bg-warn/[0.04] px-3.5 py-1.5 transition-colors"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-warn animate-pulse shrink-0" />
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-[12px] font-medium text-warn shrink-0">{positionLabel}</span>
                    {taskImages.length > 0 && (
                      <div className="flex items-center gap-1 shrink-0">
                        {taskImages.slice(0, 3).map((url, i) => (
                          <button
                            key={`${url}-${i}`}
                            type="button"
                            onClick={() => setQueuedPreviewUrl(url)}
                            title={t('hub.previewImage')}
                            className="block h-5 w-5 shrink-0 overflow-hidden rounded border border-warn/30 transition-opacity hover:opacity-80"
                          >
                            <img src={url} alt="" className="h-full w-full object-cover" />
                          </button>
                        ))}
                        {taskImages.length > 3 && (
                          <span className="text-[10px] text-fg-5/60">+{taskImages.length - 3}</span>
                        )}
                      </div>
                    )}
                    {taskPrompt && (
                      <span className="text-[11px] text-fg-5/60 truncate">{taskPrompt}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleSteerQueued(taskId)}
                      disabled={steeringIds.has(taskId)}
                      title={t('hub.steerHint')}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-fg-4 hover:text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      {steeringIds.has(taskId)
                        ? <Spinner className="h-2.5 w-2.5" />
                        : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 6 15 12 9 18" /></svg>}
                      {t('hub.steer')}
                    </button>
                    <button
                      onClick={() => handleRecallQueued(taskId)}
                      disabled={recallingIds.has(taskId)}
                      title={t('hub.recallHint')}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-fg-4 hover:text-err hover:bg-err/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      {recallingIds.has(taskId)
                        ? <Spinner className="h-2.5 w-2.5" />
                        : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>}
                      {t('hub.recall')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="relative rounded-xl border border-edge/40 bg-panel shadow-sm transition-[border-color,box-shadow] duration-200 focus-within:border-fg-5/40 focus-within:shadow-md">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              addImageAttachments(e.target.files);
              e.target.value = '';
            }}
          />

          {imageAttachments.length > 0 && (
            <div className="px-3 pt-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {imageAttachments.map(item => (
                  <div key={item.id} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewImageId(item.id)}
                      title={t('hub.previewImage')}
                      className="group relative h-[72px] w-[72px] overflow-hidden rounded-lg border border-edge/30 bg-panel-alt/30"
                    >
                      <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent px-1.5 pb-1 pt-3 text-left">
                        <div className="truncate text-[8px] font-medium text-white/90 leading-tight">{item.file.name}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImageAttachment(item.id);
                      }}
                      title={t('hub.removeImage')}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-black/65 text-white/75 transition-colors hover:bg-black/80 hover:text-white"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M18 6 6 18" />
                        <path d="M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skill autocomplete popup */}
          {skillMenuOpen && filteredSkills.length > 0 && (
            <div
              ref={skillMenuRef}
              className="absolute bottom-full left-0 right-0 mb-1.5 z-50 max-h-[200px] overflow-y-auto rounded-xl border border-edge/40 bg-[var(--th-dropdown)] backdrop-blur-xl shadow-lg animate-in"
            >
              <div className="px-3 pt-2 pb-1 border-b border-edge/20">
                <span className="text-[10px] font-semibold text-fg-5 uppercase tracking-wider">{t('hub.skills')}</span>
              </div>
              <div className="py-1">
                {filteredSkills.map((skill, idx) => (
                  <button
                    key={skill.name}
                    data-skill-idx={idx}
                    onMouseDown={e => { e.preventDefault(); selectSkill(skill); }}
                    onMouseEnter={() => setSkillMenuIndex(idx)}
                    className={cn(
                      'flex flex-col w-full px-3 py-1.5 text-left transition-colors',
                      idx === skillMenuIndex
                        ? 'bg-panel-h text-fg'
                        : 'text-fg-3 hover:bg-panel-alt/50',
                    )}
                  >
                    <span className="text-[12.5px] font-medium">/{skill.name}</span>
                    {(skill.label || skill.description) && (
                      <span className="text-[11px] text-fg-5 truncate">{skill.label || skill.description}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            placeholder={t('hub.inputPlaceholder')}
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[13.5px] text-fg outline-none placeholder:text-fg-5/25 leading-[1.6]"
            style={{ maxHeight: 200, overflow: input.split('\n').length > 6 ? 'auto' : 'hidden' }}
          />

          {/* Bottom bar: cascade selector + send */}
          <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title={t('hub.addImages')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-5/50 transition-colors hover:bg-panel-h/60 hover:text-fg-3"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>

            {/* Cascade config trigger */}
            <button
              ref={triggerRef}
              onClick={toggleCascade}
              disabled={!agents.length}
              title={agents.length ? cascadeLabel : undefined}
              className={cn(
                'flex items-center gap-1.5 h-[28px] px-2.5 rounded-lg text-[11px] font-medium transition-all duration-200 select-none',
                cascadeStep !== 'closed'
                  ? 'bg-panel-h border border-edge-h text-fg-3'
                  : 'text-fg-5/60 hover:text-fg-4 hover:bg-panel-h/50 border border-transparent',
              )}
            >
              {agents.length
                ? <BrandIcon brand={displayAgent} size={12} />
                : <Spinner className="h-3 w-3" />}
              {agents.length ? (
                <span className="flex items-center gap-1 max-w-[460px] min-w-0 truncate">
                  <span className="shrink-0">{displayMeta.shortLabel}</span>
                  {displayProvider && (
                    <>
                      <span className="text-fg-5/40 shrink-0">/</span>
                      <BrandIcon brand={displayProviderBrand || 'custom'} size={12} />
                      <span className="shrink-0 truncate max-w-[140px]">{displayProvider.name}</span>
                    </>
                  )}
                  {displayModelLabel && (
                    <>
                      <span className="text-fg-5/40 shrink-0">/</span>
                      <span className="truncate" title={displayModel || undefined}>{displayModelLabel}</span>
                    </>
                  )}
                  {displayEffort && (
                    <>
                      <span className="text-fg-5/40 shrink-0">/</span>
                      <span className="shrink-0">{displayEffort.charAt(0).toUpperCase() + displayEffort.slice(1)}</span>
                    </>
                  )}
                </span>
              ) : (
                <span className="max-w-[420px] truncate">{t('hub.selectAgent')}</span>
              )}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className={cn('text-fg-5/30 transition-transform duration-200', cascadeStep !== 'closed' && 'rotate-180')}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* Cascade dropdown — rendered via portal to escape overflow:hidden */}
            {cascadeStep !== 'closed' && cascadePos && createPortal(
              <div
                id="cascade-portal"
                className="fixed z-[200] w-[300px] rounded-xl border border-edge/40 bg-[var(--th-dropdown)] backdrop-blur-xl shadow-lg overflow-hidden animate-in"
                style={{ left: cascadePos.left, bottom: cascadePos.bottom }}
              >
                {/* Step header */}
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 border-b border-edge/20">
                  {cascadeStep !== 'agent' && (
                    <button
                      onClick={() => {
                        if (cascadeStep === 'effort') {
                          // For agents that don't support model switching the
                          // model step was skipped on the way in, so back from
                          // effort goes straight to agent.
                          const supportsModelSwitch = cascadeAgent?.capabilities?.modelSwitch !== false;
                          setCascadeStep(supportsModelSwitch ? 'model' : 'agent');
                        } else {
                          setCascadeStep('agent');
                        }
                      }}
                      className="p-0.5 rounded text-fg-5/50 hover:text-fg-3 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                  )}
                  <span className="text-[10px] font-semibold text-fg-5 uppercase tracking-wider">
                    {cascadeStep === 'agent' ? t('hub.selectAgent') : cascadeStep === 'model' ? t('hub.selectModel') : t('hub.selectEffort')}
                  </span>
                  <div className="ml-auto flex items-center gap-0.5">
                    {(() => {
                      const supportsModelSwitch = cascadeAgent?.capabilities?.modelSwitch !== false;
                      const steps = supportsModelSwitch
                        ? (['agent', 'model', 'effort'] as const)
                        : (['agent', 'effort'] as const);
                      const activeIdx = steps.indexOf(cascadeStep as any);
                      return steps.map((step, idx) => (
                        <span key={step} className={cn(
                          'w-1.5 h-1.5 rounded-full transition-colors',
                          cascadeStep === step ? 'bg-primary' : idx < activeIdx ? 'bg-primary/40' : 'bg-fg-5/15',
                        )} />
                      ));
                    })()}
                  </div>
                </div>

                {/* Step content */}
                <div className="max-h-[200px] overflow-y-auto py-1">
                  {cascadeStep === 'agent' && agents.filter(a => a.installed).map(a => {
                    const am = getAgentMeta(a.agent);
                    return (
                      <CascadeItem key={a.agent} selected={a.agent === (pendingAgent || effectiveAgent)} onClick={() => {
                        setPendingAgent(a.agent);
                        setPendingModel(a.selectedModel || '');
                        setPendingEffort(a.selectedEffort || '');
                        // Agents that lock the model at profile-binding time skip the
                        // model step. We jump straight to effort (or close if the
                        // agent has no effort knob either).
                        const supportsModelSwitch = a.capabilities?.modelSwitch !== false;
                        if (!supportsModelSwitch) {
                          const efforts = EFFORT_OPTIONS[a.agent as keyof typeof EFFORT_OPTIONS] || [];
                          if (efforts.length) setCascadeStep('effort');
                          else { void applyCascade(a.agent, a.selectedModel || '', null); }
                          return;
                        }
                        setCascadeStep('model');
                      }}>
                        <BrandIcon brand={a.agent} size={14} />
                        <span style={{ color: am.color }}>{am.label}</span>
                      </CascadeItem>
                    );
                  })}
                  {cascadeStep === 'model' && (
                    <>
                      {models.map((m, idx) => {
                        // Group header: insert a small label row before the first
                        // native row and before the first Profile row so the user
                        // can see at a glance which catalogue they're picking from.
                        const showNativeHeader = idx === 0 && m.kind === 'native';
                        const showProfileHeader = idx === firstProfileIdx && m.kind === 'profile';
                        // "Current" highlighting:
                        //  - Profile rows light up when the row's profileId is the
                        //    one the agent is currently bound to (or staged this turn).
                        //  - Native rows light up when no Profile is bound (or the
                        //    user just staged "switch to native") AND the model id
                        //    matches.
                        const stagedProfile = pendingProfileSelection !== undefined
                          ? pendingProfileSelection
                          : activeProfileIdForAgent;
                        const isSelected = m.kind === 'profile'
                          ? !!m.profileId && m.profileId === stagedProfile
                          : !stagedProfile && m.id === (pendingModel ?? currentModel);
                        return (
                          <div key={`${m.kind}:${m.profileId || m.id}`}>
                            {showNativeHeader && (
                              <div className="px-3 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-5">{t('hub.modelGroupNative')}</div>
                            )}
                            {showProfileHeader && (
                              <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-fg-5">{t('hub.modelGroupProfiles')}</div>
                            )}
                            <CascadeItem selected={isSelected} onClick={() => {
                              const finalAgent = pendingAgent || effectiveAgent;
                              setPendingModel(m.id);
                              setPendingProfileSelection(m.profileId ?? null);
                              if (EFFORT_OPTIONS[finalAgent as keyof typeof EFFORT_OPTIONS]?.length) {
                                setCascadeStep('effort');
                                return;
                              }
                              void applyCascade(finalAgent, m.id, null);
                            }}>
                              <div className="min-w-0 flex-1">
                                <div className={cn('truncate text-[11.5px]', m.kind === 'native' && 'font-mono text-[11px]')} title={m.id}>
                                  {m.label}
                                </div>
                                {m.description && (
                                  <div className="truncate text-[10px] text-fg-5/80">{m.description}</div>
                                )}
                              </div>
                            </CascadeItem>
                          </div>
                        );
                      })}
                      {models.length === 0 && <div className="px-3 py-3 text-[11px] text-fg-5 text-center">{t('config.noModel')}</div>}
                    </>
                  )}
                  {cascadeStep === 'effort' && effortLevels.map(e => (
                    <CascadeItem key={e} selected={e === (pendingEffort || currentEffort)} onClick={() => {
                      setPendingEffort(e);
                      const finalAgent = pendingAgent || effectiveAgent;
                      const finalModel = pendingModel ?? currentModel;
                      void applyCascade(finalAgent, finalModel, e);
                    }}>
                      {e.charAt(0).toUpperCase() + e.slice(1)}
                    </CascadeItem>
                  ))}
                </div>
              </div>,
              document.body,
            )}

            <div className="flex-1" />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                'flex items-center justify-center w-[30px] h-[30px] rounded-lg transition-all duration-200',
                canSend
                  ? 'bg-primary text-primary-fg hover:brightness-110 shadow-sm'
                  : 'bg-fg/6 text-fg-5/20',
              )}
            >
              {sending
                ? <Spinner className="h-3.5 w-3.5" />
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
              }
            </button>
          </div>
        </div>
      </div>

      <ComposerImageLightbox
        source={activePreview}
        onClose={() => { setPreviewImageId(null); setQueuedPreviewUrl(null); }}
        t={t}
      />
    </div>
  );
});

type LightboxSource = {
  key: string;
  url: string;
  name?: string;
  size?: number;
  file?: File;
  onRemove?: () => void;
};

function ComposerImageLightbox({ source, onClose, t }: {
  source: LightboxSource | null;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => { setCopied(false); }, [source?.key]);

  useEffect(() => {
    if (!source) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [source, onClose]);

  if (!source) return null;

  const file = source.file;
  const onRemove = source.onRemove;

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/72 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[1024px]" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2 text-[11px] text-white/72">
          {source.name && <span className="truncate font-medium text-white/90">{source.name}</span>}
          {typeof source.size === 'number' && <span>{formatFileSize(source.size)}</span>}
          <div className="ml-auto flex items-center gap-2">
            {file && (
              <button
                type="button"
                onClick={async () => {
                  if (!await copyImageFile(file)) return;
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
                className="rounded-lg border border-white/12 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/88 transition-colors hover:bg-white/14"
              >
                {copied ? t('hub.copied') : t('hub.copyImage')}
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="rounded-lg border border-white/12 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/88 transition-colors hover:bg-white/14"
              >
                {t('hub.removeImage')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/10 text-white/88 transition-colors hover:bg-white/14"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/35 shadow-[0_20px_70px_rgba(0,0,0,0.45)]">
          <img src={source.url} alt={source.name || ''} className="max-h-[80vh] w-full object-contain" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ═══════════════════════════════════════════════════════════════
   Cascade item
   ═══════════════════════════════════════════════════════════════ */
export function CascadeItem({ selected, onClick, children }: {
  selected?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-2 text-[12px] text-left transition-colors',
        selected ? 'text-fg bg-panel-h font-medium' : 'text-fg-3 hover:bg-panel-alt/50 hover:text-fg-2',
      )}
    >
      {children}
      {selected && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ml-auto text-ok">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {!selected && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto text-fg-5/20">
          <polyline points="9 6 15 12 9 18" />
        </svg>
      )}
    </button>
  );
}
