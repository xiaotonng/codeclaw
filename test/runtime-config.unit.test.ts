import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AGENT_EFFORTS,
  DEFAULT_AGENT_MODELS,
  resolveAgentEffort,
  resolveAgentModel,
  setAgentEffortEnv,
  setAgentModelEnv,
} from '../src/runtime-config.ts';

const ENV_KEYS = [
  'CLAUDE_MODEL',
  'CODEX_MODEL',
  'GEMINI_MODEL',
  'CLAUDE_REASONING_EFFORT',
  'CODEX_REASONING_EFFORT',
] as const;

const envSnapshot = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('runtime-config', () => {
  it('resolves models from config before env and falls back to defaults', () => {
    delete process.env.CLAUDE_MODEL;
    process.env.CODEX_MODEL = 'env-codex';

    expect(resolveAgentModel({ claudeModel: 'opus' }, 'claude')).toBe('opus');
    expect(resolveAgentModel({}, 'codex')).toBe('env-codex');
    delete process.env.CODEX_MODEL;
    expect(resolveAgentModel({}, 'codex')).toBe(DEFAULT_AGENT_MODELS.codex);
    expect(resolveAgentModel({}, 'gemini')).toBe(DEFAULT_AGENT_MODELS.gemini);
  });

  it('resolves efforts and writes env vars through shared helpers', () => {
    delete process.env.CLAUDE_REASONING_EFFORT;
    process.env.CODEX_REASONING_EFFORT = 'medium';

    expect(resolveAgentEffort({ claudeReasoningEffort: 'HIGH' }, 'claude')).toBe('high');
    expect(resolveAgentEffort({}, 'codex')).toBe('medium');
    delete process.env.CODEX_REASONING_EFFORT;
    expect(resolveAgentEffort({}, 'codex')).toBe(DEFAULT_AGENT_EFFORTS.codex);
    expect(resolveAgentEffort({}, 'gemini')).toBeNull();

    setAgentModelEnv('claude', 'claude-sonnet-4-6');
    setAgentEffortEnv('codex', 'high');
    expect(process.env.CLAUDE_MODEL).toBe('claude-sonnet-4-6');
    expect(process.env.CODEX_REASONING_EFFORT).toBe('high');
  });
});
