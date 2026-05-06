import { useState, useRef, useLayoutEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { CollapsibleCard, CountBadge } from '../../components/ui';
import { PlanProgressCard, hasPlan } from '../../components/PlanProgressCard';
import { mdComponents, mdPlugins } from './markdown';
import { lastNLines } from './utils';
import { shortenModel } from '../../utils';
import type { StreamPlan, StreamSubAgent } from '../../types';

/* ── Live streaming preview ── */
export function LivePreview({
  stream,
  t,
}: {
  stream: {
    phase: 'streaming' | 'done';
    text: string;
    thinking: string;
    activity?: string;
    plan?: StreamPlan | null;
    subAgents?: StreamSubAgent[] | null;
  };
  t: (k: string) => string;
}) {
  const showPlan = hasPlan(stream.plan);
  const [activityOpen, setActivityOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);

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
          label={t('hub.thinking')}
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
        <div className="py-1">
          <ThinkingDots className="text-fg-5" />
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
