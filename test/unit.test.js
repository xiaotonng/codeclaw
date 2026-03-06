/**
 * Unit tests for codeclaw core functions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Helper exports from codeclaw.js
import {
  envBool,
  envInt,
  parseAllowedChatIds,
  normalizeReasoningEffort,
  normalizeSessionName,
  normalizeEngine,
  VALID_ENGINES,
  VERSION,
} from '../src/codeclaw.js';

// ---------------------------------------------------------------------------
// envBool
// ---------------------------------------------------------------------------
describe('envBool', () => {
  it('returns default when env var is undefined', () => {
    delete process.env.TEST_BOOL;
    expect(envBool('TEST_BOOL', true)).toBe(true);
    expect(envBool('TEST_BOOL', false)).toBe(false);
  });

  it('parses truthy values', () => {
    for (const val of ['1', 'true', 'yes', 'on', 'TRUE', 'Yes']) {
      process.env.TEST_BOOL = val;
      expect(envBool('TEST_BOOL', false)).toBe(true);
    }
  });

  it('parses falsy values', () => {
    for (const val of ['0', 'false', 'no', 'off', '']) {
      process.env.TEST_BOOL = val;
      expect(envBool('TEST_BOOL', true)).toBe(false);
    }
  });

  afterEach(() => { delete process.env.TEST_BOOL; });
});

// ---------------------------------------------------------------------------
// envInt
// ---------------------------------------------------------------------------
describe('envInt', () => {
  afterEach(() => { delete process.env.TEST_INT; });

  it('returns default when env var is undefined', () => {
    expect(envInt('TEST_INT', 42)).toBe(42);
  });

  it('parses integers', () => {
    process.env.TEST_INT = '100';
    expect(envInt('TEST_INT', 0)).toBe(100);
  });

  it('returns default for non-numeric', () => {
    process.env.TEST_INT = 'abc';
    expect(envInt('TEST_INT', 7)).toBe(7);
  });

  it('returns default for empty string', () => {
    process.env.TEST_INT = '';
    expect(envInt('TEST_INT', 5)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// parseAllowedChatIds
// ---------------------------------------------------------------------------
describe('parseAllowedChatIds', () => {
  it('parses comma-separated IDs', () => {
    const ids = parseAllowedChatIds('123,456,789');
    expect(ids).toEqual(new Set([123, 456, 789]));
  });

  it('handles empty string', () => {
    expect(parseAllowedChatIds('')).toEqual(new Set());
  });

  it('ignores non-numeric tokens', () => {
    const ids = parseAllowedChatIds('123,abc,456');
    expect(ids).toEqual(new Set([123, 456]));
  });

  it('handles negative IDs (group chats)', () => {
    const ids = parseAllowedChatIds('-100123456,789');
    expect(ids).toEqual(new Set([-100123456, 789]));
  });

  it('trims whitespace', () => {
    const ids = parseAllowedChatIds(' 123 , 456 ');
    expect(ids).toEqual(new Set([123, 456]));
  });
});

// ---------------------------------------------------------------------------
// normalizeReasoningEffort
// ---------------------------------------------------------------------------
describe('normalizeReasoningEffort', () => {
  it('accepts valid values', () => {
    for (const val of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']) {
      expect(normalizeReasoningEffort(val)).toBe(val);
    }
  });

  it('normalizes case', () => {
    expect(normalizeReasoningEffort('HIGH')).toBe('high');
    expect(normalizeReasoningEffort('  Medium  ')).toBe('medium');
  });

  it('throws on invalid value', () => {
    expect(() => normalizeReasoningEffort('ultra')).toThrow('Invalid CODEX_REASONING_EFFORT');
  });
});

// ---------------------------------------------------------------------------
// normalizeSessionName
// ---------------------------------------------------------------------------
describe('normalizeSessionName', () => {
  it('returns default for empty', () => {
    expect(normalizeSessionName('')).toBe('default');
    expect(normalizeSessionName('  ')).toBe('default');
  });

  it('normalizes valid names', () => {
    expect(normalizeSessionName('MySession')).toBe('mysession');
    expect(normalizeSessionName('test-1')).toBe('test-1');
    expect(normalizeSessionName('a_b')).toBe('a_b');
  });

  it('throws on invalid names', () => {
    expect(() => normalizeSessionName('-bad')).toThrow('Invalid session name');
    expect(() => normalizeSessionName('a'.repeat(33))).toThrow('Invalid session name');
    expect(() => normalizeSessionName('has space')).toThrow('Invalid session name');
  });
});

// ---------------------------------------------------------------------------
// normalizeEngine
// ---------------------------------------------------------------------------
describe('normalizeEngine', () => {
  it('accepts valid engines', () => {
    expect(normalizeEngine('codex')).toBe('codex');
    expect(normalizeEngine('claude')).toBe('claude');
  });

  it('normalizes case', () => {
    expect(normalizeEngine('CLAUDE')).toBe('claude');
    expect(normalizeEngine('  Codex  ')).toBe('codex');
  });

  it('throws on invalid engine', () => {
    expect(() => normalizeEngine('gpt4')).toThrow('Invalid engine');
  });
});

// ---------------------------------------------------------------------------
// VALID_ENGINES
// ---------------------------------------------------------------------------
describe('VALID_ENGINES', () => {
  it('contains codex and claude', () => {
    expect(VALID_ENGINES.has('codex')).toBe(true);
    expect(VALID_ENGINES.has('claude')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VERSION
// ---------------------------------------------------------------------------
describe('VERSION', () => {
  it('matches package.json', async () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    expect(VERSION).toBe(pkg.version);
  });
});

// ---------------------------------------------------------------------------
// CodeClaw core class (state management, sessions, engines)
// ---------------------------------------------------------------------------
describe('CodeClaw', () => {
  let CodeClaw;
  let tmpDir;
  let origEnv;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeclaw-test-'));
    origEnv = { ...process.env };
    // Minimal env to construct CodeClaw
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
    process.env.CODECLAW_WORKDIR = tmpDir;
    process.env.CODECLAW_STATE_DIR = path.join(tmpDir, 'state');
    process.env.DEFAULT_ENGINE = 'claude';
    process.env.CODEX_REASONING_EFFORT = 'high';
    const mod = await import('../src/codeclaw.js');
    CodeClaw = mod.CodeClaw;
  });

  afterEach(() => {
    process.env = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes with correct defaults', () => {
    const claw = new CodeClaw();
    expect(claw.token).toBe('test-token-123');
    expect(claw.workdir).toBe(tmpDir);
    expect(claw.defaultEngine).toBe('claude');
    expect(claw.running).toBe(true);
  });

  // -- Session management --

  describe('session management', () => {
    it('creates default chat state', () => {
      const claw = new CodeClaw();
      const cs = claw._ensureChatState(100);
      expect(cs.active).toBe('default');
      expect(cs.engine).toBe('claude');
      expect(cs.threads).toHaveProperty('default');
    });

    it('sets and gets active session', () => {
      const claw = new CodeClaw();
      claw._setActiveSession(100, 'feature1');
      const cs = claw._ensureChatState(100);
      expect(cs.active).toBe('feature1');
      expect(cs.threads).toHaveProperty('feature1');
    });

    it('switches sessions preserving thread IDs', () => {
      const claw = new CodeClaw();
      claw._setActiveSession(100, 'a');
      claw._setSessionThread(100, 'a', 'thread-aaa');
      claw._setActiveSession(100, 'b');
      claw._setSessionThread(100, 'b', 'thread-bbb');

      // Switch back to a
      claw._setActiveSession(100, 'a');
      const [name, tid] = claw._sessionForChat(100);
      expect(name).toBe('a');
      expect(tid).toBe('thread-aaa');
    });

    it('deletes sessions', () => {
      const claw = new CodeClaw();
      claw._setActiveSession(100, 'temp');
      claw._setSessionThread(100, 'temp', 'tid-temp');
      claw._deleteSession(100, 'temp');
      const cs = claw._ensureChatState(100);
      expect(cs.threads).not.toHaveProperty('temp');
      expect(cs.active).toBe('default');
    });

    it('handles deleting active session gracefully', () => {
      const claw = new CodeClaw();
      claw._setActiveSession(200, 'active1');
      claw._deleteSession(200, 'active1');
      const [name] = claw._sessionForChat(200);
      expect(name).toBe('default');
    });
  });

  // -- Engine management --

  describe('engine management', () => {
    it('returns default engine for new chat', () => {
      const claw = new CodeClaw();
      expect(claw._engineForChat(300)).toBe('claude');
    });

    it('switches engine per chat', () => {
      const claw = new CodeClaw();
      claw._setEngineForChat(300, 'codex');
      expect(claw._engineForChat(300)).toBe('codex');
      // Other chats unaffected
      expect(claw._engineForChat(301)).toBe('claude');
    });

    it('throws on invalid engine', () => {
      const claw = new CodeClaw();
      expect(() => claw._setEngineForChat(300, 'gpt4')).toThrow('Invalid engine');
    });
  });

  // -- State persistence --

  describe('state persistence', () => {
    it('saves and loads state', () => {
      const claw = new CodeClaw();
      claw._setActiveSession(400, 'persist');
      claw._setSessionThread(400, 'persist', 'thread-persist');
      claw._saveState();

      // Verify state file exists
      expect(fs.existsSync(claw.stateFile)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(claw.stateFile, 'utf-8'));
      expect(saved.chats['400'].threads.persist).toBe('thread-persist');
    });
  });

  // -- Command builders --

  describe('command builders', () => {
    it('builds codex command without thread', () => {
      const claw = new CodeClaw();
      const cmd = claw._buildCodexCmd(null);
      expect(cmd[0]).toBe('codex');
      expect(cmd).toContain('--json');
      expect(cmd).toContain('-');
      expect(cmd).not.toContain('resume');
    });

    it('builds codex command with thread (resume)', () => {
      const claw = new CodeClaw();
      const cmd = claw._buildCodexCmd('thread-123');
      expect(cmd).toContain('resume');
      expect(cmd).toContain('thread-123');
    });

    it('builds claude command without thread', () => {
      const claw = new CodeClaw();
      const cmd = claw._buildClaudeCmd(null);
      expect(cmd[0]).toBe('claude');
      expect(cmd).toContain('-p');
      expect(cmd).toContain('--verbose');
      expect(cmd).not.toContain('--resume');
    });

    it('builds claude command with thread (resume)', () => {
      const claw = new CodeClaw();
      const cmd = claw._buildClaudeCmd('session-abc');
      expect(cmd).toContain('--resume');
      expect(cmd).toContain('session-abc');
    });

    it('includes model in codex command', () => {
      const claw = new CodeClaw();
      const cmd = claw._buildCodexCmd(null);
      expect(cmd).toContain('-m');
      const modelIdx = cmd.indexOf('-m');
      expect(cmd[modelIdx + 1]).toBe(claw.codexModel);
    });

    it('includes model in claude command', () => {
      const claw = new CodeClaw();
      const cmd = claw._buildClaudeCmd(null);
      expect(cmd).toContain('--model');
      const modelIdx = cmd.indexOf('--model');
      expect(cmd[modelIdx + 1]).toBe(claw.claudeModel);
    });
  });
});

// ---------------------------------------------------------------------------
// CLI argument parsing (main function)
// ---------------------------------------------------------------------------
describe('CLI', () => {
  let origArgv, origEnv;

  beforeEach(() => {
    origArgv = process.argv;
    origEnv = { ...process.env };
  });

  afterEach(() => {
    process.argv = origArgv;
    process.env = origEnv;
  });

  it('--version prints version and exits 0', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.argv = ['node', 'codeclaw', '--version'];
    const { main } = await import('../src/codeclaw.js');
    const code = await main();
    expect(code).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining(VERSION));
    writeSpy.mockRestore();
  });

  it('--help prints usage and exits 0', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.argv = ['node', 'codeclaw', '--help'];
    const { main } = await import('../src/codeclaw.js');
    const code = await main();
    expect(code).toBe(0);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    writeSpy.mockRestore();
  });
});
