import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSessionMessages, shutdownCodexServer } from '../src/code-agent.ts';
import { withTempHome } from './support/env.ts';

afterEach(() => {
  shutdownCodexServer();
});

describe('Codex session history', () => {
  it('reconstructs commentary, tools, plan, and persisted thinking for rich history', async () => {
    await withTempHome(async homeDir => {
      const workdir = path.join(homeDir, 'project');
      const workspacePath = path.join(workdir, '.pikiclaw', 'sessions', 'codex', 'sess-rich', 'workspace');
      const rolloutDir = path.join(homeDir, '.codex', 'sessions', '2026', '03', '29');
      fs.mkdirSync(workdir, { recursive: true });
      fs.mkdirSync(workspacePath, { recursive: true });
      fs.mkdirSync(rolloutDir, { recursive: true });

      const rolloutPath = path.join(rolloutDir, 'rollout-2026-03-29T10-25-14-test.jsonl');
      fs.writeFileSync(rolloutPath, [
        JSON.stringify({
          timestamp: '2026-03-29T10:25:14.000Z',
          type: 'session_meta',
          payload: { id: 'sess-rich', cwd: workdir },
        }),
        JSON.stringify({
          timestamp: '2026-03-29T10:25:15.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Please fix the live preview.' },
        }),
        JSON.stringify({
          timestamp: '2026-03-29T10:25:16.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'Tracing the Codex stream pipeline first.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-29T10:25:17.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            call_id: 'call_exec_1',
            arguments: JSON.stringify({ cmd: 'rg -n "activity|thinking|plan" src dashboard' }),
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-29T10:25:18.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_exec_1',
            output: 'src/bot.ts:610:          snap.plan = event.plan?.steps?.length ? event.plan : null;',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-29T10:25:19.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'update_plan',
            call_id: 'call_plan_1',
            arguments: JSON.stringify({
              explanation: 'Keep completion previews and rebuild Codex rich history.',
              plan: [
                { step: 'Preserve done snapshot text/thinking/activity', status: 'completed' },
                { step: 'Parse rollout response items into rich messages', status: 'completed' },
                { step: 'Render historical plan blocks in SessionPanel', status: 'completed' },
              ],
            }),
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-29T10:25:20.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call_plan_1',
            output: 'Plan updated',
          },
        }),
        JSON.stringify({
          timestamp: '2026-03-29T10:25:21.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'Fixed the panel to keep activity, thinking, and plan after completion.' }],
          },
        }),
      ].join('\n'));

      const sessionIndexPath = path.join(workdir, '.pikiclaw', 'sessions', 'index.json');
      fs.mkdirSync(path.dirname(sessionIndexPath), { recursive: true });
      fs.writeFileSync(sessionIndexPath, JSON.stringify({
        version: 1,
        sessions: [
          {
            sessionId: 'sess-rich',
            agent: 'codex',
            workdir,
            workspacePath,
            threadId: 'legacy:codex:sess-rich',
            createdAt: '2026-03-29T10:25:14.000Z',
            updatedAt: '2026-03-29T10:25:22.000Z',
            title: 'Fix Codex live preview',
            model: 'gpt-5.4',
            stagedFiles: [],
            runState: 'completed',
            runDetail: null,
            runUpdatedAt: '2026-03-29T10:25:22.000Z',
            classification: null,
            userStatus: null,
            userNote: null,
            lastQuestion: 'Please fix the live preview.',
            lastAnswer: 'Fixed the panel to keep activity, thinking, and plan after completion.',
            lastMessageText: 'Fixed the panel to keep activity, thinking, and plan after completion.',
            lastThinking: 'Overlay thinking recovered from session metadata.',
            lastPlan: null,
            migratedFrom: null,
            migratedTo: null,
            linkedSessions: [],
          },
        ],
      }, null, 2));

      const result = await getSessionMessages({
        agent: 'codex',
        sessionId: 'sess-rich',
        workdir,
        rich: true,
      });

      expect(result.ok).toBe(true);
      expect(result.messages).toEqual([
        { role: 'user', text: 'Please fix the live preview.' },
        { role: 'assistant', text: 'Fixed the panel to keep activity, thinking, and plan after completion.' },
      ]);

      const assistant = result.richMessages?.[1];
      expect(assistant).toBeTruthy();
      expect(assistant?.blocks.map(block => block.type)).toEqual([
        'text',
        'tool_use',
        'tool_result',
        'plan',
        'thinking',
        'text',
      ]);
      expect(assistant?.blocks[0]).toMatchObject({
        type: 'text',
        phase: 'commentary',
        content: 'Tracing the Codex stream pipeline first.',
      });
      expect(assistant?.blocks[1]).toMatchObject({
        type: 'tool_use',
        toolName: 'exec_command',
      });
      expect(assistant?.blocks[2]).toMatchObject({
        type: 'tool_result',
        toolId: 'call_exec_1',
      });
      expect(assistant?.blocks[3].plan).toEqual({
        explanation: 'Keep completion previews and rebuild Codex rich history.',
        steps: [
          { step: 'Preserve done snapshot text/thinking/activity', status: 'completed' },
          { step: 'Parse rollout response items into rich messages', status: 'completed' },
          { step: 'Render historical plan blocks in SessionPanel', status: 'completed' },
        ],
      });
      expect(assistant?.blocks[4]).toMatchObject({
        type: 'thinking',
        content: 'Overlay thinking recovered from session metadata.',
      });
      expect(assistant?.blocks[5]).toMatchObject({
        type: 'text',
        phase: 'final_answer',
        content: 'Fixed the panel to keep activity, thinking, and plan after completion.',
      });
    });
  });
});
