import { describe, expect, it } from 'vitest';
import { hasConfiguredChannelToken, resolveConfiguredChannels } from '../src/cli-channels.ts';

describe('cli channel resolution', () => {
  it('prefers explicit channels over saved config', () => {
    const channels = resolveConfiguredChannels({
      explicitChannels: 'telegram,feishu',
      config: {
        channels: ['feishu'],
        telegramBotToken: 'tg-token',
        feishuAppId: 'cli_app',
      },
    });

    expect(channels).toEqual(['telegram', 'feishu']);
  });

  it('falls back to configured channel list', () => {
    const channels = resolveConfiguredChannels({
      config: {
        channels: ['feishu', 'telegram'],
      },
    });

    expect(channels).toEqual(['feishu', 'telegram']);
  });

  it('auto-detects ready channels from config', () => {
    const channels = resolveConfiguredChannels({
      config: {
        telegramBotToken: 'tg-token',
        feishuAppId: 'cli_app',
      },
    });

    expect(channels).toEqual(['feishu', 'telegram']);
  });

  it('treats CLI token override as configured token', () => {
    expect(hasConfiguredChannelToken({}, 'feishu', 'cli_app:secret')).toBe(true);
    expect(hasConfiguredChannelToken({}, 'telegram', 'tg-token')).toBe(true);
    expect(hasConfiguredChannelToken({}, 'whatsapp', 'wa-token')).toBe(true);
  });
});
