import type { Agent, StreamPreviewMeta, StreamPreviewPlan, StreamResult } from './bot.js';
import type { SkillsListData } from './bot-commands.js';
import type {
  CommandActionButton,
  CommandItemState,
  CommandNotice,
  CommandSelectionItem,
  CommandSelectionView,
} from './bot-command-ui.js';
import { encodeCommandAction } from './bot-command-ui.js';
import { fmtUptime, formatThinkingForDisplay, thinkLabel } from './bot.js';
import { formatActivityCommandSummary, parseActivitySummary, renderPlanForPreview, summarizeActivityForPreview } from './bot-streaming.js';

export type FooterStatus = 'running' | 'done' | 'failed';

export interface ProviderUsageSnapshot {
  ok: boolean;
  capturedAt: string | null;
  status: string | null;
  windows: Array<{
    label: string;
    usedPercent: number | null;
    remainingPercent: number | null;
    resetAfterSeconds: number | null;
    status: string | null;
  }>;
  error: string | null;
}

export interface StreamPreviewRenderInput {
  agent: Agent;
  elapsedMs: number;
  bodyText: string;
  thinking: string;
  activity: string;
  meta?: StreamPreviewMeta | null;
  plan?: StreamPreviewPlan | null;
}

export interface FinalReplyRender {
  fullHtml: string;
  headerHtml: string;
  bodyHtml: string;
  footerHtml: string;
}

export function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncateMiddle(text: string, maxChars = 36): string {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  const visible = maxChars - 3;
  const head = Math.ceil(visible / 2);
  const tail = Math.floor(visible / 2);
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function compactCode(text: string, maxChars = 36): string {
  return `<code>${escapeHtml(truncateMiddle(text, maxChars))}</code>`;
}

export function buildCompactSelectionTitle(title: string, detail?: string | null): string {
  const cleanDetail = String(detail || '').trim();
  if (!cleanDetail) return `<b>${escapeHtml(title)}</b>`;
  return `<b>${escapeHtml(title)}</b> · ${compactCode(cleanDetail, 20)}`;
}

export function buildCompactSelectionNotice(
  title: string,
  value: string,
  detail?: string | null,
  codeMaxChars = 40,
): string {
  const lines = [`<b>${escapeHtml(title)}</b>`, compactCode(value, codeMaxChars)];
  const cleanDetail = String(detail || '').trim();
  if (cleanDetail) lines.push(`<i>${escapeHtml(cleanDetail)}</i>`);
  return lines.join('\n');
}

function selectionStateSymbol(state: CommandItemState | undefined): string {
  switch (state) {
    case 'current': return '●';
    case 'running': return '◐';
    case 'unavailable': return '✕';
    default: return '○';
  }
}

function formatCommandItemHtml(item: CommandSelectionItem, index: number): string {
  const parts = [
    selectionStateSymbol(item.state),
    `<b>${index + 1}.</b>`,
    escapeHtml(item.label),
  ];
  if (item.detail) parts.push(escapeHtml(item.detail));
  return parts.join(' ');
}

function formatCommandButtonLabel(button: CommandActionButton, maxChars = 24): string {
  const prefix = button.state && button.state !== 'default'
    ? `${selectionStateSymbol(button.state)} `
    : '';
  return truncateMiddle(`${prefix}${button.label}`.trim(), maxChars);
}

export function renderCommandNoticeHtml(notice: CommandNotice): string {
  const lines = [`<b>${escapeHtml(notice.title)}</b>`];
  if (notice.value) {
    if (notice.valueMode === 'plain') lines.push(escapeHtml(notice.value));
    else lines.push(compactCode(notice.value, 40));
  }
  if (notice.detail) lines.push(`<i>${escapeHtml(notice.detail)}</i>`);
  return lines.join('\n');
}

export function renderCommandSelectionHtml(view: CommandSelectionView): string {
  const lines = [buildCompactSelectionTitle(view.title, view.detail)];
  if (view.metaLines.length) lines.push(...view.metaLines.map(line => `<i>${escapeHtml(line)}</i>`));

  if (view.items.length) {
    lines.push('', ...view.items.map((item, index) => formatCommandItemHtml(item, index)));
  } else if (view.emptyText) {
    lines.push('', `<i>${escapeHtml(view.emptyText)}</i>`);
  }

  if (view.helperText) lines.push('', `<i>${escapeHtml(view.helperText)}</i>`);
  return lines.join('\n');
}

export function renderCommandSelectionKeyboard(view: CommandSelectionView): { inline_keyboard: { text: string; callback_data: string }[][] } | undefined {
  if (!view.rows.length) return undefined;
  return {
    inline_keyboard: view.rows.map(row => row.map(button => ({
      text: formatCommandButtonLabel(button),
      callback_data: encodeCommandAction(button.action),
    }))),
  };
}

function mdInline(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.includes('`')) {
    const a = rest.indexOf('`');
    const b = rest.indexOf('`', a + 1);
    if (b === -1) break;
    parts.push(formatMarkdownSegment(rest.slice(0, a)));
    parts.push(`<code>${escapeHtml(rest.slice(a + 1, b))}</code>`);
    rest = rest.slice(b + 1);
  }
  parts.push(formatMarkdownSegment(rest));
  return parts.join('');
}

function formatMarkdownSegment(text: string): string {
  let value = escapeHtml(text);
  value = value.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  value = value.replace(/__(.+?)__/g, '<b>$1</b>');
  value = value.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
  value = value.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');
  value = value.replace(/~~(.+?)~~/g, '<s>$1</s>');
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return value;
}

export function mdToTgHtml(text: string): string {
  const result: string[] = [];
  const lines = text.split('\n');
  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();
    if (stripped.startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeLang = stripped.slice(3).trim().split(/\s/)[0] || '';
        codeLines = [];
      } else {
        inCode = false;
        const content = escapeHtml(codeLines.join('\n'));
        result.push(codeLang
          ? `<pre><code class="language-${escapeHtml(codeLang)}">${content}</code></pre>`
          : `<pre>${content}</pre>`);
      }
      i++;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      i++;
      continue;
    }

    if (stripped.startsWith('|') && stripped.endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length) {
        const tableLine = lines[i].trim();
        if (!tableLine.startsWith('|')) break;
        if (/^\|[\s\-:|]+\|$/.test(tableLine)) {
          i++;
          continue;
        }
        tableLines.push(tableLine);
        i++;
      }
      if (tableLines.length) result.push(`<pre>${escapeHtml(tableLines.join('\n'))}</pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      result.push(`<b>${mdInline(heading[2])}</b>`);
      i++;
      continue;
    }

    result.push(mdInline(line));
    i++;
  }

  if (inCode && codeLines.length) result.push(`<pre>${escapeHtml(codeLines.join('\n'))}</pre>`);
  return result.join('\n');
}

export function renderSessionTurnHtml(userText: string | null | undefined, assistantText: string | null | undefined): string {
  const parts: string[] = [];
  const user = String(userText || '').trim();
  const assistant = String(assistantText || '').trim();
  if (user || assistant) parts.push('<b>Recent Context</b>');
  if (user) parts.push(`<blockquote expandable>${escapeHtml(user)}</blockquote>`);
  if (assistant) parts.push(mdToTgHtml(assistant));
  return parts.join('\n\n');
}

export function formatMenuLines(commands: { command: string; description: string }[]): string[] {
  return commands.map(cmd => `/${cmd.command} — ${escapeHtml(cmd.description)}`);
}

export function renderSkillsListHtml(d: SkillsListData): string {
  const lines = [
    `<b>Project Skills</b> (${d.skills.length})`,
    '',
    `<b>Agent:</b> ${escapeHtml(d.agent)}`,
    `<b>Workdir:</b> <code>${escapeHtml(d.workdir)}</code>`,
  ];

  if (!d.skills.length) {
    lines.push('', '<i>No project skills found in .pikiclaw/skills/ or .claude/commands/.</i>');
    return lines.join('\n');
  }

  lines.push('');
  for (const skill of d.skills) {
    lines.push(`<b>/${escapeHtml(skill.command)}</b> — ${escapeHtml(skill.label)}`);
    if (skill.description) lines.push(escapeHtml(skill.description));
  }
  return lines.join('\n');
}

function fmtCompactUptime(ms: number): string {
  return fmtUptime(ms).replace(/\s+/g, '');
}

function footerStatusSymbol(status: FooterStatus): string {
  switch (status) {
    case 'running': return '●';
    case 'done': return '✓';
    case 'failed': return '✗';
  }
}

function formatFooterSummary(
  agent: Agent,
  elapsedMs: number,
  meta?: StreamPreviewMeta | null,
  contextPercent?: number | null,
): string {
  const parts: string[] = [agent];
  const ctx = contextPercent ?? meta?.contextPercent ?? null;
  if (ctx != null) parts.push(`${ctx}%`);
  parts.push(fmtCompactUptime(Math.max(0, Math.round(elapsedMs))));
  return parts.join(' · ');
}

export function formatPreviewFooterHtml(agent: Agent, elapsedMs: number, meta?: StreamPreviewMeta | null): string {
  return escapeHtml(`${footerStatusSymbol('running')} ${formatFooterSummary(agent, elapsedMs, meta)}`);
}

function formatFinalFooterHtml(status: FooterStatus, agent: Agent, elapsedMs: number, contextPercent?: number | null): string {
  return escapeHtml(`${footerStatusSymbol(status)} ${formatFooterSummary(agent, elapsedMs, null, contextPercent ?? null)}`);
}

function rawUsageLine(parts: Array<string | null | undefined>): string {
  return parts.filter(part => !!part && String(part).trim()).join(' ');
}

export function formatProviderUsageLines(usage: ProviderUsageSnapshot): string[] {
  const lines = ['', '<b>Provider Usage</b>'];

  if (!usage.ok) {
    lines.push(`  Unavailable: ${escapeHtml(usage.error || 'No recent usage data found.')}`);
    return lines;
  }

  if (usage.capturedAt) {
    const capturedAtMs = Date.parse(usage.capturedAt);
    if (Number.isFinite(capturedAtMs)) {
      lines.push(`  Updated: ${fmtUptime(Math.max(0, Date.now() - capturedAtMs))} ago`);
    }
  }

  if (!usage.windows.length) {
    lines.push(`  ${escapeHtml(usage.status ? `status=${usage.status}` : 'No window data')}`);
    return lines;
  }

  for (const window of usage.windows) {
    const details = rawUsageLine([
      window.usedPercent != null ? `${window.usedPercent}% used` : null,
      window.status ? `status=${window.status}` : null,
      window.resetAfterSeconds != null ? `resetAfterSeconds=${window.resetAfterSeconds}` : null,
    ]);
    lines.push(`  ${escapeHtml(window.label)}: ${escapeHtml(details || 'No details')}`);
  }

  return lines;
}

function trimActivityForPreview(text: string, maxChars = 900): string {
  if (text.length <= maxChars) return text;

  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length <= 1) return text.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';

  const tailCount = Math.min(2, Math.max(1, lines.length - 1));
  const tail = lines.slice(-tailCount);
  const headCandidates = lines.slice(0, Math.max(0, lines.length - tailCount));
  const reserved = tail.join('\n').length + 5;
  const budget = Math.max(0, maxChars - reserved);
  const head: string[] = [];
  let used = 0;

  for (const line of headCandidates) {
    const extra = line.length + (head.length ? 1 : 0);
    if (used + extra > budget) break;
    head.push(line);
    used += extra;
  }

  if (!head.length) return text.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
  return [...head, '...', ...tail].join('\n');
}

export function buildInitialPreviewHtml(agent: Agent): string {
  return formatPreviewFooterHtml(agent, 0);
}

export function buildStreamPreviewHtml(input: StreamPreviewRenderInput): string {
  const maxBody = 2400;
  const display = input.bodyText.trim();
  const rawThinking = input.thinking.trim();
  const thinkDisplay = formatThinkingForDisplay(input.thinking, maxBody);
  const planDisplay = renderPlanForPreview(input.plan ?? null);
  const activityDisplay = summarizeActivityForPreview(input.activity);
  const maxActivity = !display && !thinkDisplay && !planDisplay ? 2400 : 1400;
  const parts: string[] = [];
  const label = thinkLabel(input.agent);

  if (planDisplay) {
    parts.push(`<blockquote><b>Plan</b>\n${escapeHtml(planDisplay)}</blockquote>`);
  }

  if (activityDisplay) {
    parts.push(`<blockquote><b>Activity</b>\n${escapeHtml(trimActivityForPreview(activityDisplay, maxActivity))}</blockquote>`);
  }

  if (thinkDisplay && !display) {
    parts.push(`<blockquote><b>${escapeHtml(label)}</b>\n${escapeHtml(thinkDisplay)}</blockquote>`);
  } else if (display) {
    if (rawThinking) {
      const thinkSnippet = formatThinkingForDisplay(input.thinking, 600);
      parts.push(`<blockquote><b>${escapeHtml(label)}</b>\n${escapeHtml(thinkSnippet)}</blockquote>`);
    }
    const preview = display.length > maxBody ? '(...truncated)\n' + display.slice(-maxBody) : display;
    parts.push(mdToTgHtml(preview));
  }

  parts.push(formatPreviewFooterHtml(input.agent, input.elapsedMs, input.meta ?? null));
  return parts.join('\n\n');
}

export function buildFinalReplyRender(agent: Agent, result: StreamResult): FinalReplyRender {
  const footerStatus: FooterStatus = result.incomplete || !result.ok ? 'failed' : 'done';
  const footerHtml = `\n\n${formatFinalFooterHtml(footerStatus, agent, result.elapsedS * 1000, result.contextPercent ?? null)}`;

  let activityHtml = '';
  let activityNoteHtml = '';
  if (result.activity) {
    const summary = parseActivitySummary(result.activity);
    const narrative = summary.narrative.join('\n');
    if (narrative) {
      let display = narrative;
      if (display.length > 1600) display = '...\n' + display.slice(-1600);
      activityHtml = `<blockquote><b>Activity</b>\n${escapeHtml(display)}</blockquote>\n\n`;
    }
    const commandSummary = formatActivityCommandSummary(
      summary.completedCommands,
      summary.activeCommands,
      summary.failedCommands,
    );
    if (commandSummary) activityNoteHtml = `<i>${escapeHtml(commandSummary)}</i>\n\n`;
  }

  let thinkingHtml = '';
  if (result.thinking) {
    thinkingHtml = `<blockquote><b>${thinkLabel(agent)}</b>\n${escapeHtml(formatThinkingForDisplay(result.thinking, 1600))}</blockquote>\n\n`;
  }

  let statusHtml = '';
  if (result.incomplete) {
    const statusLines: string[] = [];
    if (result.stopReason === 'max_tokens') statusLines.push('Output limit reached. Response may be truncated.');
    if (result.stopReason === 'timeout') {
      statusLines.push(`Timed out after ${fmtUptime(Math.max(0, Math.round(result.elapsedS * 1000)))} before the agent reported completion.`);
    }
    if (!result.ok) {
      const detail = result.error?.trim();
      if (detail && detail !== result.message.trim() && !statusLines.includes(detail)) statusLines.push(detail);
      else if (result.stopReason !== 'timeout') statusLines.push('Agent exited before reporting completion.');
    }
    statusHtml = `<blockquote expandable><b>Incomplete Response</b>\n${statusLines.map(escapeHtml).join('\n')}</blockquote>\n\n`;
  }

  const headerHtml = `${activityHtml}${activityNoteHtml}${statusHtml}${thinkingHtml}`;
  const bodyHtml = mdToTgHtml(result.message);
  return {
    fullHtml: `${headerHtml}${bodyHtml}${footerHtml}`,
    headerHtml,
    bodyHtml,
    footerHtml,
  };
}
