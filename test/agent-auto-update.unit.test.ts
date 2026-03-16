import { afterEach, describe, expect, it } from 'vitest';
import { agentAutoUpdateEnabled, extractAgentSemver, resolveAgentUpdateStrategy } from '../src/agent-auto-update.ts';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.PIKICLAW_AGENT_AUTO_UPDATE;
});

describe('agent auto update', () => {
  it('extracts semver from agent version text', () => {
    expect(extractAgentSemver('2.1.76 (Claude Code)')).toBe('2.1.76');
    expect(extractAgentSemver('codex-cli 0.115.0')).toBe('0.115.0');
    expect(extractAgentSemver('')).toBeNull();
  });

  it('prefers env override for enablement', () => {
    process.env.PIKICLAW_AGENT_AUTO_UPDATE = 'false';
    expect(agentAutoUpdateEnabled({ agentAutoUpdate: true })).toBe(false);

    process.env.PIKICLAW_AGENT_AUTO_UPDATE = 'true';
    expect(agentAutoUpdateEnabled({ agentAutoUpdate: false })).toBe(true);
  });

  it('updates npm-managed agents and skips non-npm installs', () => {
    expect(resolveAgentUpdateStrategy(
      { agent: 'codex', path: '/opt/homebrew/bin/codex' },
      '/Users/xiaoxiao/.nvm/versions/node/v23.3.0',
    )).toEqual({ kind: 'skip', reason: 'non-npm install path' });

    expect(resolveAgentUpdateStrategy(
      { agent: 'gemini', path: '/Users/xiaoxiao/.nvm/versions/node/v23.3.0/bin/gemini' },
      '/Users/xiaoxiao/.nvm/versions/node/v23.3.0',
    )).toEqual({ kind: 'npm', pkg: '@google/gemini-cli' });

    expect(resolveAgentUpdateStrategy(
      { agent: 'claude', path: '/Users/xiaoxiao/.nvm/versions/node/v23.3.0/bin/claude' },
      null,
    )).toEqual({ kind: 'skip', reason: 'non-npm install path' });
  });
});
