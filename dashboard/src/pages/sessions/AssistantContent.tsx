import { useState, useRef, useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '../../utils';
import { CollapsibleCard, CountBadge } from '../../components/ui';
import { PlanProgressCard, hasPlan } from '../../components/PlanProgressCard';
import { mdComponents, mdPlugins } from './markdown';
import { lastNLines, summarizeToolResult, summarizeToolUse } from './utils';
import { ImageLightbox } from './TurnView';
import { SubAgentCard } from './LivePreview';
import type { RichMessage, MessageBlock } from '../../types';

/* ═══════════════════════════════════════════════════════════════
   Assistant message — separated activity, thinking, output
   ═══════════════════════════════════════════════════════════════ */
export function AssistantMsg({ message, t }: { message: RichMessage; t: (k: string) => string }) {
  const { activityBlocks, thinkingBlocks, planBlocks, subAgentBlocks, outputBlocks } = categorizeAssistantBlocks(message.blocks);
  const latestPlan = [...planBlocks].reverse().find(block => hasPlan(block.plan));
  return (
    <div className="space-y-3">
      {activityBlocks.length > 0 && <ActivitySection blocks={activityBlocks} t={t} />}
      {subAgentBlocks.map(block => block.subAgent ? (
        <SubAgentCard key={block.toolId || block.subAgent.id} sub={block.subAgent} t={t} />
      ) : null)}
      {latestPlan?.plan && <PlanProgressCard plan={latestPlan.plan} t={t} className="max-w-[760px]" />}
      {thinkingBlocks.length > 0 && <ThinkingSection blocks={thinkingBlocks} t={t} />}
      {outputBlocks.length > 0 && <OutputBlock blocks={outputBlocks} />}
    </div>
  );
}

export function categorizeAssistantBlocks(blocks: MessageBlock[]): {
  activityBlocks: MessageBlock[];
  thinkingBlocks: MessageBlock[];
  planBlocks: MessageBlock[];
  subAgentBlocks: MessageBlock[];
  outputBlocks: MessageBlock[];
} {
  const normalized = blocks.filter(block =>
    block.type === 'plan'
    || block.type === 'tool_use'
    || block.type === 'tool_result'
    || block.type === 'image'
    || block.type === 'sub_agent'
    || !!block.content.trim(),
  );
  return {
    activityBlocks: normalized.filter(b => b.type === 'tool_use' || b.type === 'tool_result'),
    thinkingBlocks: normalized.filter(b => b.type === 'thinking'),
    planBlocks: normalized.filter(b => b.type === 'plan' && hasPlan(b.plan)),
    subAgentBlocks: normalized.filter(b => b.type === 'sub_agent'),
    outputBlocks: normalized.filter(b => b.type === 'text' || b.type === 'image'),
  };
}

/* ═══════════════════════════════════════════════════════════════
   Activity section — collapsible tool call summary (cyan accent)
   ═══════════════════════════════════════════════════════════════ */
export function ActivitySection({ blocks, t }: { blocks: MessageBlock[]; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const useBlocks = blocks.filter(b => b.type === 'tool_use');
  const totalOps = useBlocks.length;
  const lastUse = useBlocks[useBlocks.length - 1];
  const preview = lastUse ? summarizeToolUse(lastUse) : '';

  return (
    <CollapsibleCard
      open={open}
      onToggle={() => setOpen(v => !v)}
      dot={{ color: 'bg-cyan-400/60' }}
      label={t('hub.activity')}
      preview={<span className="text-[11.5px] font-mono text-fg-4 truncate">{preview}</span>}
      badge={totalOps > 0 ? <CountBadge>{totalOps}</CountBadge> : undefined}
    >
      <div className="px-3.5 py-2.5 space-y-0.5">
        {blocks.map((block, i) => <ActivityLine key={i} block={block} />)}
      </div>
    </CollapsibleCard>
  );
}

export function ActivityLine({ block }: { block: MessageBlock }) {
  const [open, setOpen] = useState(false);
  const isUse = block.type === 'tool_use';
  const summary = isUse ? summarizeToolUse(block) : summarizeToolResult(block);
  return (
    <div>
      <button onClick={() => block.content && setOpen(v => !v)} className={cn('flex items-center gap-2 py-[3px] w-full text-left group rounded-sm transition-colors', block.content && 'hover:bg-panel-h/30')}>
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', isUse ? 'bg-fg-5/40' : 'bg-ok/40')} />
        <span className="text-[11px] font-mono text-fg-5/60 group-hover:text-fg-3 transition-colors truncate">
          {summary}
        </span>
      </button>
      {open && block.content && (
        <pre className="ml-3 mt-1 mb-2 p-3 rounded-md bg-inset border border-edge text-[11px] leading-[1.6] text-fg-4 font-mono whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto">
          {block.content.length > 3000 ? block.content.slice(0, 3000) + '\n\u2026' : block.content}
        </pre>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Thinking section — collapsible, last 3 lines preview
   ═══════════════════════════════════════════════════════════════ */
export function ThinkingSection({ blocks, t }: { blocks: MessageBlock[]; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const text = blocks.map(b => b.content).filter(Boolean).join('\n\n').trim();
  if (!text) return null;

  const preview = lastNLines(text, 3);

  return (
    <CollapsibleCard
      open={open}
      onToggle={() => setOpen(v => !v)}
      dot={{ color: 'bg-violet-400/50' }}
      label={t('hub.thinking')}
      collapsedContent={
        preview ? (
          <div className="px-3.5 pb-2.5 -mt-0.5 text-[12px] text-fg-4 leading-[1.65] whitespace-pre-wrap break-words line-clamp-3">
            {preview}
          </div>
        ) : undefined
      }
    >
      <ThinkingExpandedContent scrollRef={scrollRef} text={text} />
    </CollapsibleCard>
  );
}

/** Expanded thinking content — scrolls to bottom on mount. */
export function ThinkingExpandedContent({ scrollRef, text }: { scrollRef: React.RefObject<HTMLDivElement | null>; text: string }) {
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollRef]);

  return (
    <div ref={scrollRef} className="px-3.5 py-3 text-[12px] text-fg-4 leading-[1.7] whitespace-pre-wrap break-words max-h-[320px] overflow-y-auto">
      {text}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Output — markdown
   ═══════════════════════════════════════════════════════════════ */
export function OutputBlock({ blocks }: { blocks: MessageBlock[] }) {
  const textBlocks = blocks.filter(b => b.type === 'text');
  const imageBlocks = blocks.filter(b => b.type === 'image');
  const text = textBlocks.map(b => b.content).filter(Boolean).join('\n\n');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  if (!text.trim() && imageBlocks.length === 0) return null;
  return (
    <>
      {text.trim() && (
        <div className="session-md text-[13.5px] leading-[1.75] text-fg-2">
          <ReactMarkdown remarkPlugins={mdPlugins} components={mdComponents}>
            {text}
          </ReactMarkdown>
        </div>
      )}
      {imageBlocks.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {imageBlocks.map((img, i) => (
            <img
              key={i}
              src={img.content}
              className="max-w-[400px] max-h-[300px] rounded-md border border-fg-6/50 object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
              onClick={() => setLightboxSrc(img.content)}
            />
          ))}
        </div>
      )}
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  );
}
