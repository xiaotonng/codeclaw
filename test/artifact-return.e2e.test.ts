import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TelegramBot } from '../src/bot-telegram.ts';
import type { TgContext } from '../src/channel-telegram.ts';

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

describe.sequential('artifact return e2e', () => {
  let tmpDir = '';
  let fakeBin = '';
  let oldPath = '';
  let oldToken: string | undefined;
  let oldWorkdir: string | undefined;
  let oldAgent: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-e2e-'));
    fakeBin = path.join(tmpDir, 'bin');
    fs.mkdirSync(fakeBin, { recursive: true });

    oldPath = process.env.PATH || '';
    oldToken = process.env.TELEGRAM_BOT_TOKEN;
    oldWorkdir = process.env.CODECLAW_WORKDIR;
    oldAgent = process.env.DEFAULT_AGENT;

    process.env.PATH = `${fakeBin}:${oldPath}`;
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.CODECLAW_WORKDIR = tmpDir;
    process.env.DEFAULT_AGENT = 'claude';
  });

  afterEach(() => {
    process.env.PATH = oldPath;
    if (oldToken == null) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldWorkdir == null) delete process.env.CODECLAW_WORKDIR;
    else process.env.CODECLAW_WORKDIR = oldWorkdir;
    if (oldAgent == null) delete process.env.DEFAULT_AGENT;
    else process.env.DEFAULT_AGENT = oldAgent;

    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs the fake agent, collects artifacts, and uploads them back through Telegram helpers', async () => {
    const manifestRecord = path.join(tmpDir, 'manifest-path.txt');
    const script = `#!/bin/sh
PROMPT=$(cat)
MANIFEST=$(printf "%s" "$PROMPT" | sed -n 's/^When you want a file returned, also write this JSON manifest: //p' | head -n 1)
if [ -z "$MANIFEST" ]; then
  echo "manifest missing" >&2
  exit 1
fi
echo "$MANIFEST" > ${shQuote(manifestRecord)}
DIR=$(dirname "$MANIFEST")
printf 'png-bytes' > "$DIR/screenshot.png"
printf 'console output' > "$DIR/console.txt"
cat > "$MANIFEST" <<'JSON'
{"files":[{"path":"screenshot.png","kind":"photo","caption":"Captured page"},{"path":"console.txt","kind":"document","caption":"Console log"}]}
JSON
echo '${JSON.stringify({ type: 'system', session_id: 'sess-e2e', model: 'claude-opus-4-6' })}'
echo '${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Artifacts delivered.' } } })}'
echo '${JSON.stringify({ type: 'result', session_id: 'sess-e2e', usage: { input_tokens: 7, output_tokens: 4 } })}'
`;
    fs.writeFileSync(path.join(fakeBin, 'claude'), script, { mode: 0o755 });

    const edits: Array<{ text: string; opts?: any }> = [];
    const sends: Array<{ text: string; opts?: any }> = [];
    const files: Array<{ filePath: string; opts?: any }> = [];
    const docs: Array<{ filename: string; opts?: any }> = [];

    const channel = {
      editMessage: async (_chatId: number, _msgId: number, text: string, opts?: any) => {
        edits.push({ text, opts });
      },
      send: async (_chatId: number, text: string, opts?: any) => {
        sends.push({ text, opts });
        return 777;
      },
      sendFile: async (_chatId: number, filePath: string, opts?: any) => {
        files.push({ filePath, opts });
        return 778;
      },
      sendDocument: async (_chatId: number, _content: string | Buffer, filename: string, opts?: any) => {
        docs.push({ filename, opts });
        return 779;
      },
    };

    const bot = new TelegramBot();
    (bot as any).channel = channel;

    const ctx: TgContext = {
      chatId: 500,
      messageId: 600,
      from: { id: 700, username: 'artifact_e2e' },
      reply: async () => 123,
      editReply: async () => {},
      answerCallback: async () => {},
      channel: channel as any,
      raw: {},
    };

    await (bot as any).handleMessage({ text: 'Capture a screenshot and send back the files.', files: [] }, ctx);

    expect(files).toHaveLength(2);
    expect(files[0].filePath).toContain('screenshot.png');
    expect(files[0].opts).toMatchObject({ caption: 'Captured page', replyTo: 123, asPhoto: true });
    expect(files[1].filePath).toContain('console.txt');
    expect(files[1].opts).toMatchObject({ caption: 'Console log', replyTo: 123, asPhoto: false });
    expect(edits.some(item => item.text.includes('Artifacts delivered.'))).toBe(true);
    expect(docs).toHaveLength(0);
    expect(sends).toHaveLength(0);
    expect((bot as any).chat(ctx.chatId).sessionId).toBe('sess-e2e');

    const manifestPath = fs.readFileSync(manifestRecord, 'utf-8').trim();
    expect(manifestPath).toContain('manifest.json');
    expect(fs.existsSync(path.dirname(manifestPath))).toBe(false);
  });
});
