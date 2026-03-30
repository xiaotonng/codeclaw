/**
 * Stream preview parsing helpers for live message updates.
 */

import type { StreamPreviewMeta, StreamPreviewPlan } from '../agent/index.js';

export interface ActivitySummary {
  narrative: string[];
  failedCommands: number;
  completedCommands: number;
  activeCommands: number;
}

const INJECTED_PROMPT_MARKERS = [
  '\n[Session Workspace]',
  '\n[Telegram Artifact Return]',
  '\n[Artifact Return]',
];

export function stripInjectedPrompts(text: string): string {
  for (const marker of INJECTED_PROMPT_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx >= 0) return text.slice(0, idx).trim();
  }
  return text.trim();
}

export function summarizePromptForStatus(prompt: string, maxLen = 50): string {
  const clean = stripInjectedPrompts(prompt).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, Math.max(0, maxLen - 3)).trimEnd() + '...';
}

function parseClaudeShellActivity(line: string): {
  key: string;
  status: 'active' | 'done' | 'failed';
} | null {
  const prefix = 'Run shell: ';
  if (!line.startsWith(prefix)) return null;

  const detail = line.slice(prefix.length).trim();
  if (!detail) return { key: prefix.trim(), status: 'active' };

  const doneIdx = detail.indexOf(' -> ');
  if (doneIdx > 0) {
    return {
      key: detail.slice(0, doneIdx).trim(),
      status: 'done',
    };
  }

  const failed = detail.match(/^(.*)\sfailed(?::.*)?$/);
  if (failed?.[1]?.trim()) {
    return {
      key: failed[1].trim(),
      status: 'failed',
    };
  }

  if (detail.endsWith(' done')) {
    const key = detail.slice(0, -' done'.length).trim();
    return { key: key || detail, status: 'done' };
  }

  return { key: detail, status: 'active' };
}

export function parseActivitySummary(activity: string): ActivitySummary {
  const narrative: string[] = [];
  let failedCommands = 0;
  let activeCommands = 0;
  let completedCommands = 0;
  const activeClaudeShells = new Map<string, number>();

  for (const rawLine of activity.split('\n')) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const claudeShell = parseClaudeShellActivity(line);
    if (claudeShell) {
      const key = claudeShell.key || 'Run shell';
      const current = activeClaudeShells.get(key) || 0;
      if (claudeShell.status === 'active') {
        activeClaudeShells.set(key, current + 1);
      } else {
        if (current > 0) activeClaudeShells.set(key, current - 1);
        if (claudeShell.status === 'done') completedCommands++;
        else failedCommands++;
      }
      continue;
    }
    if (line.startsWith('$ ')) {
      activeCommands++;
      continue;
    }
    if (line.startsWith('Ran: ')) {
      completedCommands++;
      continue;
    }
    const executed = line.match(/^Executed (\d+) command(?:s)?\.$/);
    if (executed) {
      completedCommands = Math.max(completedCommands, parseInt(executed[1], 10) || 0);
      continue;
    }
    const running = line.match(/^Running (\d+) command(?:s)?\.\.\.$/);
    if (running) {
      activeCommands = Math.max(activeCommands, parseInt(running[1], 10) || 0);
      continue;
    }
    const failed = line.match(/^Command failed \((\d+)\):/);
    if (failed) {
      failedCommands++;
      continue;
    }
    if (/^Command failed \(\d+\)$/.test(line)) {
      failedCommands++;
      continue;
    }
    narrative.push(line);
  }

  for (const pending of activeClaudeShells.values()) {
    activeCommands += pending;
  }

  return { narrative, failedCommands, completedCommands, activeCommands };
}

export function formatActivityCommandSummary(completedCommands: number, activeCommands: number, failedCommands = 0): string {
  const parts: string[] = [];
  if (failedCommands > 0) parts.push(`${failedCommands} failed`);
  if (completedCommands > 0) parts.push(`${completedCommands} done`);
  if (activeCommands > 0) parts.push(`${activeCommands} running`);
  return parts.length ? `commands: ${parts.join(', ')}` : '';
}

export function summarizeActivityForPreview(activity: string): string {
  const summary = parseActivitySummary(activity);
  const lines = [...summary.narrative];

  const commandSummary = formatActivityCommandSummary(
    summary.completedCommands,
    summary.activeCommands,
    summary.failedCommands,
  );
  if (commandSummary) lines.push(commandSummary);

  return lines.join('\n');
}

export function hasPreviewMeta(meta: StreamPreviewMeta | null | undefined): boolean {
  return meta?.contextPercent != null;
}

export function samePreviewMeta(a: StreamPreviewMeta | null, b: StreamPreviewMeta | null): boolean {
  return (a?.contextPercent ?? null) === (b?.contextPercent ?? null);
}

export function samePreviewPlan(a: StreamPreviewPlan | null, b: StreamPreviewPlan | null): boolean {
  if ((a?.explanation ?? null) !== (b?.explanation ?? null)) return false;
  const aSteps = a?.steps ?? [];
  const bSteps = b?.steps ?? [];
  if (aSteps.length !== bSteps.length) return false;
  for (let i = 0; i < aSteps.length; i++) {
    if (aSteps[i].status !== bSteps[i].status) return false;
    if (aSteps[i].step !== bSteps[i].step) return false;
  }
  return true;
}

function normalizePlanStep(step: string): string {
  return step.replace(/\s+/g, ' ').trim();
}

export function renderPlanForPreview(plan: StreamPreviewPlan | null): string {
  if (!plan?.steps.length) return '';
  const completed = plan.steps.filter(step => step.status === 'completed').length;
  const total = plan.steps.length;
  const lines = [`Plan ${completed}/${total}`];
  for (const step of plan.steps.slice(0, 4)) {
    const prefix = step.status === 'completed' ? '[x]' : step.status === 'inProgress' ? '[>]' : '[ ]';
    lines.push(`${prefix} ${normalizePlanStep(step.step)}`);
  }
  if (plan.steps.length > 4) lines.push(`... +${plan.steps.length - 4} more`);
  return lines.join('\n');
}
