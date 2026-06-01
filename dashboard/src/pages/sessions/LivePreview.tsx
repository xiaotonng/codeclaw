import { useState, useRef, useLayoutEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { CollapsibleCard, CountBadge } from '../../components/ui';
import { PlanProgressCard, hasPlan } from '../../components/PlanProgressCard';
import { mdComponents, mdPlugins } from './markdown';
import { lastNLines } from './utils';
import { shortenModel } from '../../utils';
import { formatTokens } from './TurnView';
import type { StreamPlan, StreamSubAgent, StreamPreviewMeta } from '../../types';

export interface LiveStreamView {
  phase: 'streaming' | 'done';
  text: string;
  thinking: string;
  activity?: string;
  plan?: StreamPlan | null;
  subAgents?: StreamSubAgent[] | null;
  error?: string | null;
  /** Number of image-generation calls in flight — drives the
   *  "Generating image…" chip while bytes have yet to land. */
  generatingImages?: number;
  /** Live token/usage meta for the in-flight turn. `outputTokens` climbs during
   *  the opening extended-thinking phase (before any text), letting us show a
   *  "Thinking… · <n>" chip so the turn doesn't look frozen. */
  previewMeta?: StreamPreviewMeta | null;
}

export function liveStreamHasBody(stream: LiveStreamView): boolean {
  return !!stream.text
    || !!stream.thinking
    || !!(stream.activity && stream.activity.split('\n').filter(Boolean).length)
    || hasPlan(stream.plan)
    || !!(stream.subAgents && stream.subAgents.length);
}

/** True when the live preview will render any visible element (body or error tile). */
export function liveStreamShouldRender(stream: LiveStreamView): boolean {
  if (liveStreamHasBody(stream)) return true;
  // Streaming with no body yet — still render so the TurnDivider header and the
  // internal ThinkingDots fill the "waiting for the first token" window. Without
  // this branch, IM-initiated turns (no pendingPrompt to bridge) show nothing
  // between session-start and the first text chunk.
  if (stream.phase === 'streaming') return true;
  return stream.phase === 'done' && !!stream.error;
}

/* ── Live streaming preview ── */
export function LivePreview({
  stream,
  t,
}: {
  stream: LiveStreamView;
  t: (k: string) => string;
}) {
  const showPlan = hasPlan(stream.plan);
  const hasAnyBody = liveStreamHasBody(stream);
  const [activityOpen, setActivityOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  // Stream finished with no body — surface the error inline so the user sees
  // *why* the assistant turn is empty instead of a silent phantom.
  const renderEmptyFailure = stream.phase === 'done' && !hasAnyBody;
  // Live output-token count for the in-flight turn. The newest Claude opens a
  // turn with an extended-thinking phase that burns output tokens before any
  // text/thinking lands; surfacing the count keeps the card from looking idle.
  // 0 unless actively streaming.
  const thinkingTokens = stream.phase === 'streaming' ? (stream.previewMeta?.outputTokens ?? 0) : 0;

  const activityLines = useMemo(() =>
    (stream.activity || '').split('\n').filter(Boolean),
    [stream.activity],
  );
  const lastActivity = activityLines[activityLines.length - 1] || '';

  // Auto-scroll activity detail to bottom when content updates
  useLayoutEffect(() => {
    const el = activityScrollRef.current;
    if (el && activityOpen) el.scrollTop = el.scrollHeight;
  }, [activityOpen, stream.activity]);

  // Auto-scroll thinking detail to bottom when content updates
  useLayoutEffect(() => {
    const el = thinkingScrollRef.current;
    if (el && thinkingOpen) el.scrollTop = el.scrollHeight;
  }, [thinkingOpen, stream.thinking]);

  const subAgents = stream.subAgents ?? null;

  return (
    <div className="space-y-3 animate-in">
      {/* Plan — prominent card at top */}
      {showPlan && (
        <PlanProgressCard plan={stream.plan!} t={t} className="mb-1 max-w-[760px]" />
      )}

      {/* Sub-agent invocations — each Task tool gets its own discrete card so
          its model and tool stream stay isolated from the parent's activity. */}
      {subAgents && subAgents.length > 0 && subAgents.map(sub => (
        <SubAgentCard key={sub.id} sub={sub} t={t} />
      ))}

      {/* Activity — expandable, shows latest line as preview */}
      {activityLines.length > 0 && (
        <CollapsibleCard
          open={activityOpen}
          onToggle={() => setActivityOpen(v => !v)}
          dot={{ color: 'bg-cyan-400/60', pulse: true }}
          label={t('hub.activity')}
          preview={<span className="text-[12px] text-fg-4 truncate">{lastActivity}</span>}
          badge={activityLines.length > 1 ? <CountBadge>{activityLines.length}</CountBadge> : undefined}
        >
          <div ref={activityScrollRef} className="px-3.5 py-2.5 space-y-0.5 max-h-[240px] overflow-y-auto">
            {activityLines.map((line, i) => (
              <div key={i} className="flex items-center gap-1.5 py-[2px]">
                <span className="w-1 h-1 rounded-full shrink-0 bg-fg-5/30" />
                <span className="text-[11px] font-mono text-fg-5/60 truncate">{line}</span>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {/* Thinking — 3-line preview, expandable */}
      {stream.thinking && (
        <CollapsibleCard
          open={thinkingOpen}
          onToggle={() => setThinkingOpen(v => !v)}
          dot={{ color: 'bg-violet-400/50', pulse: true }}
          label={thinkingTokens > 0 ? `${t('hub.thinking')} · ${formatTokens(thinkingTokens)}` : t('hub.thinking')}
          collapsedContent={
            <div className="px-3.5 pb-2.5 -mt-0.5 text-[12px] text-fg-4 leading-[1.65] whitespace-pre-wrap break-words line-clamp-3">
              {lastNLines(stream.thinking, 3)}
            </div>
          }
        >
          <div ref={thinkingScrollRef} className="px-3.5 py-3 text-[12px] text-fg-4 leading-[1.7] whitespace-pre-wrap break-words max-h-[280px] overflow-y-auto">
            {stream.thinking}
          </div>
        </CollapsibleCard>
      )}

      {/* Response text with thinking dots */}
      {stream.text && (
        <div className="session-md text-[13.5px] leading-[1.75] text-fg-2">
          <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
            {stream.text}
          </ReactMarkdown>
          {stream.phase === 'streaming' && <ThinkingDots className="ml-1 inline-flex align-text-bottom text-fg-4" />}
        </div>
      )}

      {/* Loading dots — shown whenever the stream is live but no text body is
          rendered yet. Inline dots (above) only appear once stream.text exists,
          so this fills the gap when activity / thinking / plan are shown alone
          or when no content has arrived at all. */}
      {!stream.text && stream.phase === 'streaming' && (
        <div className="py-1 flex items-center gap-2">
          <ThinkingDots className="text-fg-5" />
          {thinkingTokens > 0 && (
            <span className="text-[12px] text-fg-4 font-mono">
              {t('hub.thinkingLive')} · {formatTokens(thinkingTokens)}
            </span>
          )}
        </div>
      )}

      {/* Image generation in flight — surfaced as a distinct chip so the user
          knows why the turn is taking longer than a typical text reply
          (image_gen wall time is 60-90s). Disappears when the assistant block
          arrives with the actual image. */}
      {stream.phase === 'streaming' && (stream.generatingImages ?? 0) > 0 && (
        <div className="flex items-center gap-2 text-[12px] text-fg-4">
          <span className="relative inline-flex items-center justify-center w-3 h-3">
            <span className="absolute inline-flex w-3 h-3 rounded-full bg-cyan-400/40 animate-ping" />
            <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-cyan-400/80" />
          </span>
          <span>
            {stream.generatingImages === 1
              ? 'Generating image…'
              : `Generating ${stream.generatingImages} images…`}
          </span>
        </div>
      )}

      {/* Stream finished with no body — surface the error inline so the user
          sees *why* the assistant turn is empty instead of a silent phantom. */}
      {renderEmptyFailure && stream.error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12.5px] leading-[1.7] text-fg-3">
          <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-rose-400/70 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wide text-rose-300/80">{t('hub.streamFailed') || 'Stream ended without a reply'}</div>
            <div className="mt-0.5 break-words">{stream.error}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Animated ··· indicator for streaming / thinking states */
export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span className={`thinking-dots inline-flex items-center gap-[3px] ${className || ''}`}>
      <span /><span /><span />
    </span>
  );
}

/**
 * Discrete card for a sub-agent (Claude Task tool). Shows its own model, kind
 * (e.g. "Explore"), description, and tool stream — visually separated from the
 * parent agent's activity so the two contexts don't blur into one.
 */
export function SubAgentCard({ sub, t }: { sub: StreamSubAgent; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const status = sub.status;
  const dotColor = status === 'failed' ? 'bg-rose-400/60'
    : status === 'done' ? 'bg-emerald-400/55'
      : 'bg-amber-400/60';
  const pulse = status === 'running';
  const tools = sub.tools;
  const uniqueToolNames = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const tool of tools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      list.push(tool.name);
    }
    return list;
  }, [tools]);
  const headerLabel = sub.kind ? `${t('hub.subAgent') || 'Sub-agent'} · ${sub.kind}` : (t('hub.subAgent') || 'Sub-agent');
  const modelLabel = sub.model ? shortenModel(sub.model) : null;
  return (
    <CollapsibleCard
      open={open}
      onToggle={() => setOpen(v => !v)}
      dot={{ color: dotColor, pulse }}
      label={headerLabel}
      preview={
        <span className="flex items-center gap-1.5 min-w-0 text-[12px] text-fg-4">
          {sub.description && <span className="truncate">{sub.description}</span>}
          {modelLabel && <span className="text-[10px] font-mono text-fg-5/55 shrink-0">{modelLabel}</span>}
          {!sub.description && uniqueToolNames.length > 0 && (
            <span className="font-mono text-fg-5/60 truncate">{uniqueToolNames.join(' · ')}</span>
          )}
        </span>
      }
      badge={tools.length > 0 ? <CountBadge>{tools.length}</CountBadge> : undefined}
    >
      <div className="px-3.5 py-2.5 space-y-1 max-h-[260px] overflow-y-auto">
        {sub.description && (
          <div className="mb-1.5 text-[12px] text-fg-3 leading-[1.55]">{sub.description}</div>
        )}
        {tools.length === 0 ? (
          <div className="text-[11px] font-mono text-fg-5/50">— {t('hub.subAgentWaiting') || 'waiting for first tool…'}</div>
        ) : (
          tools.map(tool => (
            <div key={tool.id} className="flex items-center gap-1.5 py-[2px]">
              <span className="w-1 h-1 rounded-full shrink-0 bg-fg-5/30" />
              <span className="text-[11px] font-mono text-fg-5/65 truncate">{tool.summary}</span>
            </div>
          ))
        )}
      </div>
    </CollapsibleCard>
  );
}
