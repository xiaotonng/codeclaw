import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuChannel, type FeishuCardView } from '../src/channel-feishu.ts';
import { makeTmpDir } from './support/env.ts';
import * as lark from '@larksuiteoapi/node-sdk';

function makeButton(label: string, action: string) {
  return {
    tag: 'button' as const,
    text: { tag: 'plain_text' as const, content: label },
    value: { action },
  };
}

function createTestChannel() {
  const ch = new FeishuChannel({
    appId: 'app-id',
    appSecret: 'app-secret',
    workdir: makeTmpDir('feishu-test-'),
  });

  const createCalls: any[] = [];
  const patchCalls: any[] = [];

  (ch as any).client = {
    im: {
      message: {
        create: vi.fn(async (payload: any) => {
          createCalls.push(payload);
          return { data: { message_id: `msg-${createCalls.length}` } };
        }),
        patch: vi.fn(async (payload: any) => {
          patchCalls.push(payload);
          return { data: {} };
        }),
        delete: vi.fn(async () => ({ data: {} })),
      },
      image: { create: vi.fn() },
      file: { create: vi.fn() },
      messageResource: { get: vi.fn() },
    },
    request: vi.fn(async () => ({ data: {} })),
  };

  return { ch, createCalls, patchCalls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FeishuChannel cards', () => {
  it('chunks legacy keyboard actions, preserves explicit card rows, and retries websocket startup failures', async () => {
    // Scenario 1: chunks legacy keyboard actions into visible action rows
    {
      const { ch, createCalls } = createTestChannel();

      await ch.send('chat-1', '**Available Agents**', {
        keyboard: {
          actions: [
            makeButton('claude', 'ag:claude'),
            makeButton('codex', 'ag:codex'),
            makeButton('gemini', 'ag:gemini'),
            makeButton('new', 'ag:new'),
          ],
        },
      });

      const payload = JSON.parse(createCalls[0].data.content);
      const actionRows = payload.elements.filter((element: any) => element.tag === 'action');

      expect(actionRows).toHaveLength(2);
      expect(actionRows[0]).toMatchObject({
        tag: 'action',
        layout: 'trisection',
        actions: [
          { value: { action: 'ag:claude' } },
          { value: { action: 'ag:codex' } },
          { value: { action: 'ag:gemini' } },
        ],
      });
      expect(actionRows[1]).toMatchObject({
        tag: 'action',
        actions: [{ value: { action: 'ag:new' } }],
      });
      expect(actionRows[1].layout).toBeUndefined();
    }

    // Scenario 2: preserves explicit command card rows on send and edit
    {
      const { ch, createCalls, patchCalls } = createTestChannel();
      const card: FeishuCardView = {
        markdown: '**Available Agents**\n\nUse the controls below.',
        rows: [
          { actions: [makeButton('claude', 'ag:claude'), makeButton('codex', 'ag:codex')] },
          { actions: [makeButton('gemini', 'ag:gemini')] },
        ],
      };

      await ch.sendCard('chat-1', card);
      await ch.editCard('chat-1', 'msg-9', card);

      const sent = JSON.parse(createCalls[0].data.content);
      const edited = JSON.parse(patchCalls[0].data.content);

      expect(sent.elements.filter((element: any) => element.tag === 'action')).toHaveLength(2);
      expect(sent.elements[1].layout).toBe('bisected');
      expect(sent.elements[2].layout).toBeUndefined();
      expect(edited.elements[1].actions[0].value.action).toBe('ag:claude');
      expect(edited.elements[2].actions[0].value.action).toBe('ag:gemini');
    }

    // Scenario 3: retries retryable websocket startup failures
    {
      const wsStart = vi.fn()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockImplementationOnce(async () => {});
      const wsClose = vi.fn();

      const wsSpy = vi.spyOn(lark, 'WSClient').mockImplementation(class {
        start = wsStart;
        close = wsClose;
      } as any);

      const sleepSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as typeof setTimeout);

      const { ch } = createTestChannel();
      const listenPromise = ch.listen();
      for (let i = 0; i < 10 && wsStart.mock.calls.length < 2; i++) {
        await Promise.resolve();
      }
      ch.disconnect();
      await listenPromise;

      expect(wsSpy).toHaveBeenCalledTimes(2);
      expect(wsStart).toHaveBeenCalledTimes(2);
      expect(wsClose).toHaveBeenCalled();
      expect(sleepSpy).toHaveBeenCalled();
    }
  });
});

describe('FeishuChannel files', () => {
  it('falls back to a file message when image upload is rejected', async () => {
    const { ch, createCalls } = createTestChannel();
    const pngPath = path.join(makeTmpDir('feishu-file-'), 'desktop.png');
    fs.writeFileSync(pngPath, 'fake-png');

    const uploadImage = vi.spyOn(ch, 'uploadImage').mockRejectedValue(new Error('Image upload failed: invalid image'));
    const uploadFile = vi.spyOn(ch, 'uploadFile').mockResolvedValue('file-key-1');

    expect(await ch.sendFile('chat-1', pngPath, { asPhoto: true })).toBe('msg-1');
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].data.msg_type).toBe('file');
    expect(JSON.parse(createCalls[0].data.content)).toEqual({ file_key: 'file-key-1' });
  });
});
