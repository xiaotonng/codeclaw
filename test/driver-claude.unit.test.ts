import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: execSyncMock,
  };
});

describe('Claude usage resolution', () => {
  const originalHome = process.env.HOME;
  let homeDir = '';

  beforeEach(() => {
    vi.resetModules();
    execSyncMock.mockReset();
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-claude-usage-'));
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    if (originalHome == null) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it('falls through to telemetry when OAuth API returns a rate_limit_error', async () => {
    // OAuth returns an error object — the code intentionally ignores this
    // (it's a query-API rate limit, not the user's actual usage) and falls
    // through to telemetry.
    const telemetryDir = path.join(homeDir, '.claude', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(path.join(telemetryDir, 'events.json'), JSON.stringify({
      event_type: 'ClaudeCodeInternalEvent',
      event_data: {
        event_name: 'tengu_claudeai_limits_status_changed',
        client_timestamp: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
        model: 'claude-opus-4-6',
        additional_metadata: JSON.stringify({ status: 'allowed_warning', hoursTillReset: 39 }),
      },
    }));

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('security find-generic-password')) {
        return JSON.stringify({ claudeAiOauth: { accessToken: 'oauth-token' } });
      }
      if (cmd.includes('api/oauth/usage')) {
        return JSON.stringify({
          error: {
            type: 'rate_limit_error',
            message: 'Rate limited. Please try again later.',
          },
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const { getUsage } = await import('../src/code-agent.ts');
    const usage = getUsage({ agent: 'claude', model: 'claude-opus-4-6' });

    // Should fall through to telemetry, not report the OAuth error
    expect(usage.ok).toBe(true);
    expect(usage.source).toBe('telemetry');
    expect(usage.status).toBe('warning');
  });

  it('generates age-based labels for telemetry fallback', async () => {
    const telemetryDir = path.join(homeDir, '.claude', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    // Write a recent telemetry event (5 minutes ago) so label is deterministic
    fs.writeFileSync(path.join(telemetryDir, 'events.json'), JSON.stringify({
      event_type: 'ClaudeCodeInternalEvent',
      event_data: {
        event_name: 'tengu_claudeai_limits_status_changed',
        client_timestamp: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 minutes ago
        model: 'claude-opus-4-6',
        additional_metadata: JSON.stringify({ status: 'allowed_warning', hoursTillReset: 39 }),
      },
    }));

    execSyncMock.mockImplementation(() => {
      throw new Error('No OAuth token');
    });

    const { getUsage } = await import('../src/code-agent.ts');
    const usage = getUsage({ agent: 'claude', model: 'claude-opus-4-6' });

    expect(usage.ok).toBe(true);
    expect(usage.source).toBe('telemetry');
    expect(usage.windows[0]?.label).toMatch(/^\d+m ago$/); // e.g. "5m ago"
    expect(usage.windows[0]?.status).toBe('warning');
  });
});
