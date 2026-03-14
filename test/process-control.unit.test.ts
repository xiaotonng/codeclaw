import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn(() => ({ pid: 4321, unref: vi.fn() }));

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

const ORIGINAL_ENV = { ...process.env };

async function loadModule() {
  return import('../src/process-control.ts');
}

beforeEach(() => {
  vi.resetModules();
  spawnMock.mockReset();
  spawnMock.mockReturnValue({ pid: 4321, unref: vi.fn() } as any);
  process.env = { ...ORIGINAL_ENV };
  delete process.env.PIKICLAW_DAEMON_CHILD;
  delete process.env.PIKICLAW_RESTART_STATE_FILE;
  delete process.env.PIKICLAW_RESTART_CMD;
  delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
  delete process.env.FEISHU_ALLOWED_CHAT_IDS;
  delete process.env.npm_config_yes;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('process-control restart flow', () => {
  it('rejects restart while any registered runtime still has active tasks', async () => {
    const mod = await loadModule();
    const cleanupSpy = vi.fn();
    const unregister = mod.registerProcessRuntime({
      label: 'test-runtime',
      getActiveTaskCount: () => 2,
      prepareForRestart: cleanupSpy,
    });
    const exitSpy = vi.fn();

    try {
      const result = await mod.requestProcessRestart({ exit: exitSpy as any });
      expect(result).toEqual({
        ok: false,
        restarting: false,
        error: '2 task(s) still running. Wait for them to finish or try again.',
        activeTasks: 2,
      });
      expect(cleanupSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it('hands restart requests to the supervisor via state file in daemon mode and spawns a replacement process in no-daemon mode', async () => {
    // --- Daemon child scenario ---
    {
      const mod = await loadModule();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-restart-'));
      const stateFile = path.join(tmpDir, 'restart.json');
      process.env.PIKICLAW_DAEMON_CHILD = '1';
      process.env.PIKICLAW_RESTART_STATE_FILE = stateFile;

      const cleanupSpy = vi.fn();
      const unregister = mod.registerProcessRuntime({
        label: 'telegram',
        getActiveTaskCount: () => 0,
        prepareForRestart: cleanupSpy,
        buildRestartEnv: () => ({ TELEGRAM_ALLOWED_CHAT_IDS: '1001,1002' }),
      });
      const exitSpy = vi.fn();

      try {
        const result = await mod.requestProcessRestart({ exit: exitSpy as any });
        expect(result.ok).toBe(true);
        expect(result.restarting).toBe(true);
        expect(cleanupSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(mod.PROCESS_RESTART_EXIT_CODE);
        expect(spawnMock).not.toHaveBeenCalled();
        expect(mod.consumeRestartStateFile(stateFile)).toEqual({
          TELEGRAM_ALLOWED_CHAT_IDS: '1001,1002',
        });
      } finally {
        unregister();
      }
    }

    // Reset for the next scenario
    vi.resetModules();
    spawnMock.mockReset();
    spawnMock.mockReturnValue({ pid: 4321, unref: vi.fn() } as any);
    process.env = { ...ORIGINAL_ENV };
    delete process.env.PIKICLAW_DAEMON_CHILD;
    delete process.env.PIKICLAW_RESTART_STATE_FILE;
    delete process.env.PIKICLAW_RESTART_CMD;
    delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
    delete process.env.FEISHU_ALLOWED_CHAT_IDS;
    delete process.env.npm_config_yes;

    // --- No-daemon scenario ---
    {
      const mod = await loadModule();
      const cleanupSpy = vi.fn();
      const unregisterTelegram = mod.registerProcessRuntime({
        label: 'telegram',
        getActiveTaskCount: () => 0,
        prepareForRestart: cleanupSpy,
        buildRestartEnv: () => ({ TELEGRAM_ALLOWED_CHAT_IDS: '1001' }),
      });
      const unregisterFeishu = mod.registerProcessRuntime({
        label: 'feishu',
        getActiveTaskCount: () => 0,
        buildRestartEnv: () => ({ FEISHU_ALLOWED_CHAT_IDS: 'ou_abc' }),
      });
      const exitSpy = vi.fn();

      try {
        const result = await mod.requestProcessRestart({
          argv: ['--no-daemon', '-c', 'telegram'],
          restartCmd: 'npx tsx src/cli.ts',
          exit: exitSpy as any,
        });
        expect(result.ok).toBe(true);
        expect(cleanupSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(spawnMock).toHaveBeenCalledWith(
          'npx',
          ['--yes', 'tsx', 'src/cli.ts', '--no-daemon', '-c', 'telegram'],
          expect.objectContaining({
            stdio: 'inherit',
            detached: true,
            env: expect.objectContaining({
              TELEGRAM_ALLOWED_CHAT_IDS: '1001',
              FEISHU_ALLOWED_CHAT_IDS: 'ou_abc',
              npm_config_yes: 'true',
            }),
          }),
        );
        const env = spawnMock.mock.calls[0]?.[2]?.env ?? {};
        expect(env.PIKICLAW_DAEMON_CHILD).toBeUndefined();
        expect(env.PIKICLAW_RESTART_STATE_FILE).toBeUndefined();
      } finally {
        unregisterFeishu();
        unregisterTelegram();
      }
    }
  });
});
