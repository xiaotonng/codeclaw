import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentAutoUpdateEnabled, extractAgentSemver, resolveAgentUpdateStrategy } from '../src/agent-auto-update.ts';

const ORIGINAL_ENV = { ...process.env };
const TMP_DIRS: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikiclaw-agent-update-'));
  TMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.PIKICLAW_AGENT_AUTO_UPDATE;
  for (const dir of TMP_DIRS.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    const npmRootDir = makeTmpDir();
    const npmPrefix = path.join(npmRootDir, 'opt', 'homebrew');
    const npmRoot = path.join(npmPrefix, 'lib', 'node_modules');
    const npmPkgDir = path.join(npmRoot, '@google', 'gemini-cli');
    const npmTarget = path.join(npmPkgDir, 'bin', 'gemini.js');
    fs.mkdirSync(path.dirname(npmTarget), { recursive: true });
    fs.mkdirSync(path.join(npmPrefix, 'bin'), { recursive: true });
    fs.writeFileSync(npmTarget, '#!/usr/bin/env node\n');
    const npmBinPath = path.join(npmPrefix, 'bin', 'gemini');
    fs.symlinkSync(npmTarget, npmBinPath);

    const brewRootDir = makeTmpDir();
    const brewPrefix = path.join(brewRootDir, 'opt', 'homebrew');
    const brewRoot = path.join(brewPrefix, 'lib', 'node_modules');
    const brewTarget = path.join(brewPrefix, 'Caskroom', 'codex', '0.114.0', 'codex-aarch64-apple-darwin');
    fs.mkdirSync(path.dirname(brewTarget), { recursive: true });
    fs.mkdirSync(path.join(brewPrefix, 'bin'), { recursive: true });
    fs.mkdirSync(brewRoot, { recursive: true });
    fs.writeFileSync(brewTarget, 'binary');
    const brewBinPath = path.join(brewPrefix, 'bin', 'codex');
    fs.symlinkSync(brewTarget, brewBinPath);

    expect(resolveAgentUpdateStrategy(
      { agent: 'codex', path: brewBinPath },
      brewPrefix,
      brewRoot,
    )).toEqual({ kind: 'skip', reason: 'binary is not owned by the npm package' });

    expect(resolveAgentUpdateStrategy(
      { agent: 'gemini', path: npmBinPath },
      npmPrefix,
      npmRoot,
    )).toEqual({ kind: 'npm', pkg: '@google/gemini-cli' });

    expect(resolveAgentUpdateStrategy(
      { agent: 'claude', path: '/Users/xiaoxiao/.nvm/versions/node/v23.3.0/bin/claude' },
      null,
      null,
    )).toEqual({ kind: 'skip', reason: 'non-npm install path' });
  });
});
