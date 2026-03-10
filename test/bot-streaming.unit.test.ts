import { describe, expect, it } from 'vitest';
import {
  formatActivityCommandSummary,
  hasPreviewMeta,
  parseActivitySummary,
  renderPlanForPreview,
  samePreviewMeta,
  samePreviewPlan,
  summarizeActivityForPreview,
  summarizePromptForStatus,
} from '../src/bot-streaming.ts';

describe('bot-streaming', () => {
  it('strips injected artifact prompts when summarizing running prompts', () => {
    const prompt = [
      '进度怎么样',
      '第二行',
      '',
      '[Session Workspace]',
      '/tmp/codeclaw/session',
      '',
      '[Artifact Return]',
      '/tmp/codeclaw/return.json',
    ].join('\n');

    expect(summarizePromptForStatus(prompt)).toBe('进度怎么样 第二行');
  });

  it('summarizes mixed command activity without leaking raw shell lines', () => {
    const summary = parseActivitySummary([
      'Reading files',
      'Run shell: Check auth',
      'Run shell: Check auth -> github.com',
      'Ran: /bin/zsh -lc npm test',
      '$ /bin/zsh -lc npm run build',
      'Command failed (1): /bin/zsh -lc vitest',
    ].join('\n'));

    expect(summary).toEqual({
      narrative: ['Reading files'],
      failedCommands: 1,
      completedCommands: 2,
      activeCommands: 1,
    });
    expect(formatActivityCommandSummary(2, 1, 1)).toBe('commands: 1 failed, 2 done, 1 running');
    expect(summarizeActivityForPreview('Ran: /bin/zsh -lc npm test')).toBe('commands: 1 done');
  });

  it('compares preview metadata and renders structured plans', () => {
    expect(hasPreviewMeta({ contextPercent: 21.5 } as any)).toBe(true);
    expect(samePreviewMeta({ contextPercent: 21.5 } as any, { contextPercent: 21.5 } as any)).toBe(true);
    expect(samePreviewMeta({ contextPercent: 21.5 } as any, { contextPercent: 22 } as any)).toBe(false);

    const plan = {
      explanation: 'Investigating',
      steps: [
        { step: 'Inspect streaming paths', status: 'completed' },
        { step: 'Update tests', status: 'inProgress' },
      ],
    } as any;
    expect(samePreviewPlan(plan, { ...plan })).toBe(true);
    expect(renderPlanForPreview(plan)).toContain('Plan 1/2');
    expect(renderPlanForPreview(plan)).toContain('[x] Inspect streaming paths');
    expect(renderPlanForPreview(plan)).toContain('[>] Update tests');
  });
});
