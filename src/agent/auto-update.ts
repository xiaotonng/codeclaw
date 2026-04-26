/**
 * Background agent CLI version checking and update prompts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AgentInfo } from './index.js';
import { getAgentLabel, getAgentPackage, getAgentBrewCask } from './npm.js';
import type { UserConfig } from '../core/config/user-config.js';
import { AGENT_UPDATE_TIMEOUTS } from '../core/constants.js';

const AGENT_UPDATE_LOCK_STALE_MS = AGENT_UPDATE_TIMEOUTS.lockStale;
const AGENT_UPDATE_COMMAND_TIMEOUT_MS = AGENT_UPDATE_TIMEOUTS.commandTimeout;

type AgentUpdateStrategy =
  | { kind: 'npm'; pkg: string }
  | { kind: 'brew'; cask: string }
  | { kind: 'skip'; reason: string };

// ---------------------------------------------------------------------------
// Shared update state — queryable by the dashboard
// ---------------------------------------------------------------------------

export interface AgentUpdateState {
  latestVersion: string | null;
  currentVersion: string | null;
  updateAvailable: boolean;
  /** 'idle' | 'checking' | 'updating' | 'up-to-date' | 'updated' | 'skipped' | 'failed' */
  status: string;
  /** Human-readable detail for skip/failure reasons. */
  detail: string | null;
  checkedAt: number | null;
}

const updateStates = new Map<string, AgentUpdateState>();

function emptyState(): AgentUpdateState {
  return { latestVersion: null, currentVersion: null, updateAvailable: false, status: 'idle', detail: null, checkedAt: null };
}

function setUpdateState(agent: string, patch: Partial<AgentUpdateState>) {
  const current = updateStates.get(agent) || emptyState();
  updateStates.set(agent, { ...current, ...patch });
}

/** Returns the cached update state for a specific agent (or null). */
export function getAgentUpdateState(agent: string): AgentUpdateState | null {
  return updateStates.get(agent) || null;
}

/** Returns all cached update states. */
export function getAllAgentUpdateStates(): Record<string, AgentUpdateState> {
  const result: Record<string, AgentUpdateState> = {};
  for (const [key, value] of updateStates) result[key] = value;
  return result;
}

function updaterLockPath(): string {
  return path.join(os.homedir(), '.pikiclaw', 'agent-auto-update.lock');
}

function normalizeBooleanEnv(value: string | undefined): boolean | null {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^(1|true|yes|on)$/i.test(text)) return true;
  if (/^(0|false|no|off)$/i.test(text)) return false;
  return null;
}

export function agentAutoUpdateEnabled(config: Partial<UserConfig>): boolean {
  const env = normalizeBooleanEnv(process.env.PIKICLAW_AGENT_AUTO_UPDATE);
  if (env != null) return env;
  if (typeof config.agentAutoUpdate === 'boolean') return config.agentAutoUpdate;
  return true;
}

export function extractAgentSemver(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match?.[0] || null;
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function realPathOrNull(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function packageDirFromNpmRoot(npmRoot: string, pkg: string): string {
  return path.join(path.resolve(npmRoot), ...pkg.split('/'));
}

function isNpmPackageOwnedBinary(binPath: string, pkg: string, npmRoot: string | null): boolean {
  if (!npmRoot) return false;
  const packageDir = packageDirFromNpmRoot(npmRoot, pkg);
  if (!fs.existsSync(packageDir)) return false;

  const realPackageDir = realPathOrNull(packageDir) || path.resolve(packageDir);
  const realBinPath = realPathOrNull(binPath);
  if (realBinPath && isPathInside(realPackageDir, realBinPath)) return true;
  return isPathInside(realPackageDir, binPath);
}

/**
 * Check if a binary was installed via Homebrew by resolving its real path.
 * Homebrew cask binaries typically symlink through Caskroom or Cellar.
 */
function isBrewInstalledBinary(binPath: string): boolean {
  const realPath = realPathOrNull(binPath);
  const target = realPath || binPath;
  return /\/(Caskroom|Cellar)\//.test(target);
}

export function resolveAgentUpdateStrategy(
  agent: Pick<AgentInfo, 'agent' | 'path'>,
  npmPrefix: string | null,
  npmRoot: string | null = null,
): AgentUpdateStrategy {
  const id = String(agent.agent || '').trim();
  const pkg = getAgentPackage(id);
  if (!pkg) return { kind: 'skip', reason: 'unsupported agent' };

  const binPath = String(agent.path || '').trim();
  if (!binPath) return { kind: 'skip', reason: 'no binary path' };

  // Check for Homebrew install first (binary resolves to Caskroom/Cellar).
  if (isBrewInstalledBinary(binPath)) {
    const cask = getAgentBrewCask(id);
    if (cask) return { kind: 'brew', cask };
    return { kind: 'skip', reason: 'brew-installed but no known cask' };
  }

  // Check for npm global install.
  const npmBinDir = npmPrefix ? path.join(path.resolve(npmPrefix), 'bin') : null;
  const npmManaged = !!(npmBinDir && isPathInside(npmBinDir, binPath));
  if (!npmManaged) return { kind: 'skip', reason: 'non-npm install path' };
  if (!isNpmPackageOwnedBinary(binPath, pkg, npmRoot)) {
    return { kind: 'skip', reason: 'binary is not owned by the npm package' };
  }
  return { kind: 'npm', pkg };
}

function labelForAgent(agent: string): string {
  return getAgentLabel(agent);
}

async function runCommand(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; error: string | null }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, npm_config_yes: 'true' },
    });
    const timeoutMs = Math.max(500, opts.timeoutMs ?? AGENT_UPDATE_COMMAND_TIMEOUT_MS);
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGTERM');
      resolve({ ok: false, code: null, stdout, stderr, error: `Timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);

    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr, error: err.message });
    });
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        error: code === 0 ? null : (stderr.trim() || stdout.trim() || `Exited with code ${code}`),
      });
    });
  });
}

async function getNpmGlobalPrefix(): Promise<string | null> {
  const result = await runCommand('npm', ['prefix', '-g'], { timeoutMs: AGENT_UPDATE_TIMEOUTS.npmPrefix });
  return result.ok ? result.stdout.trim().split('\n')[0] || null : null;
}

async function getNpmGlobalRoot(): Promise<string | null> {
  const result = await runCommand('npm', ['root', '-g'], { timeoutMs: AGENT_UPDATE_TIMEOUTS.npmPrefix });
  return result.ok ? result.stdout.trim().split('\n')[0] || null : null;
}

async function getLatestPackageVersion(pkg: string): Promise<string | null> {
  // `--prefer-online` bypasses the local npm metadata cache so we always see
  // the registry's current `latest` tag. Without it, `npm view` can serve a
  // stale version for several minutes after a release.
  const result = await runCommand(
    'npm',
    ['view', pkg, 'version', '--json', '--prefer-online'],
    { timeoutMs: AGENT_UPDATE_TIMEOUTS.npmView },
  );
  if (!result.ok) return null;
  const raw = result.stdout.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed.trim() || null : null;
  } catch {
    return raw.replace(/^"+|"+$/g, '').trim() || null;
  }
}

function acquireUpdateLock(log: (message: string) => void): (() => void) | null {
  const filePath = updaterLockPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > AGENT_UPDATE_LOCK_STALE_MS) fs.rmSync(filePath, { force: true });
  } catch {}

  try {
    fs.writeFileSync(filePath, `${process.pid}\n`, { flag: 'wx' });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      try { fs.rmSync(filePath, { force: true }); } catch {}
    };
  } catch {
    log('agent auto-update already running in another process; skipping this startup check');
    return null;
  }
}

async function updateViaNpm(pkg: string): Promise<{ ok: boolean; detail: string | null }> {
  const result = await runCommand('npm', ['install', '-g', `${pkg}@latest`]);
  return { ok: result.ok, detail: result.ok ? result.stdout.trim() || null : result.error };
}

// ---------------------------------------------------------------------------
// Homebrew helpers
// ---------------------------------------------------------------------------

/** Get latest available version for a Homebrew cask.
 *
 * Queries Homebrew's public formulae API rather than `brew info`, because the
 * local cask metadata is only refreshed by `brew update` — without it, a
 * just-published cask version can stay invisible for hours/days. The HTTPS API
 * always returns the current cask manifest. Falls back to local `brew info`
 * if the network call fails. */
async function getLatestBrewCaskVersion(cask: string): Promise<string | null> {
  const apiVersion = await fetchBrewCaskVersionFromApi(cask);
  if (apiVersion) return apiVersion;

  const result = await runCommand('brew', ['info', '--json=v2', '--cask', cask], { timeoutMs: AGENT_UPDATE_TIMEOUTS.npmView });
  if (!result.ok) return null;
  try {
    const data = JSON.parse(result.stdout);
    const version = data?.casks?.[0]?.version;
    return typeof version === 'string' ? version.trim() || null : null;
  } catch {
    return null;
  }
}

async function fetchBrewCaskVersionFromApi(cask: string): Promise<string | null> {
  const url = `https://formulae.brew.sh/api/cask/${encodeURIComponent(cask)}.json`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_UPDATE_TIMEOUTS.npmView);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json() as { version?: unknown };
    return typeof data.version === 'string' ? data.version.trim() || null : null;
  } catch {
    return null;
  }
}

async function updateViaBrew(cask: string): Promise<{ ok: boolean; detail: string | null }> {
  const result = await runCommand('brew', ['upgrade', '--cask', cask], {
    timeoutMs: AGENT_UPDATE_COMMAND_TIMEOUT_MS,
  });
  return { ok: result.ok, detail: result.ok ? result.stdout.trim() || null : result.error };
}

export function startAgentAutoUpdate(opts: {
  config: Partial<UserConfig>;
  agents: AgentInfo[];
  log: (message: string) => void;
}) {
  if (!agentAutoUpdateEnabled(opts.config)) return;
  const installedAgents = opts.agents.filter(agent => agent.installed && agent.path);
  if (!installedAgents.length) return;
  const releaseLock = acquireUpdateLock(opts.log);
  if (!releaseLock) return;

  void (async () => {
    try {
      opts.log(`agent auto-update: checking ${installedAgents.length} installed agent${installedAgents.length === 1 ? '' : 's'} in background`);
      const npmPrefix = await getNpmGlobalPrefix();
      const npmRoot = await getNpmGlobalRoot();

      for (const agent of installedAgents) {
        const id = String(agent.agent || '').trim();
        const pkg = getAgentPackage(id);
        if (!pkg) continue;

        const label = labelForAgent(id);
        const currentVersion = extractAgentSemver(agent.version);
        setUpdateState(id, { currentVersion, status: 'checking' });

        const strategy = resolveAgentUpdateStrategy(agent, npmPrefix, npmRoot);
        if (strategy.kind === 'skip') {
          opts.log(`agent auto-update: ${label} skipped (${strategy.reason})`);
          setUpdateState(id, { status: 'skipped', detail: strategy.reason, checkedAt: Date.now() });
          continue;
        }

        // Use brew version check for brew installs, npm for npm installs.
        const latestVersion = strategy.kind === 'brew'
          ? await getLatestBrewCaskVersion(strategy.cask)
          : await getLatestPackageVersion(pkg);
        if (!latestVersion) {
          opts.log(`agent auto-update: ${label} latest version lookup failed`);
          setUpdateState(id, { status: 'failed', detail: 'latest version lookup failed', checkedAt: Date.now() });
          continue;
        }
        if (currentVersion === latestVersion) {
          opts.log(`agent auto-update: ${label} is already up to date (${latestVersion})`);
          setUpdateState(id, { latestVersion, updateAvailable: false, status: 'up-to-date', checkedAt: Date.now() });
          continue;
        }

        setUpdateState(id, { latestVersion, updateAvailable: true, status: 'updating' });
        opts.log(`agent auto-update: updating ${label} ${currentVersion || 'unknown'} -> ${latestVersion} via ${strategy.kind}`);

        const result = strategy.kind === 'brew'
          ? await updateViaBrew(strategy.cask)
          : await updateViaNpm(strategy.pkg);
        if (result.ok) {
          opts.log(`agent auto-update: ${label} update completed`);
          setUpdateState(id, { updateAvailable: false, status: 'updated', detail: null, checkedAt: Date.now() });
        } else {
          opts.log(`agent auto-update: ${label} update failed: ${result.detail || 'unknown error'}`);
          setUpdateState(id, { status: 'failed', detail: result.detail || 'unknown error', checkedAt: Date.now() });
        }
      }

      opts.log('agent auto-update: finished');
    } finally {
      releaseLock();
    }
  })();
}

// ---------------------------------------------------------------------------
// On-demand version check (called from dashboard)
// ---------------------------------------------------------------------------

/** Check latest version for a single agent. Uses brew or npm depending on install method. */
export async function checkAgentLatestVersion(
  agent: Pick<AgentInfo, 'agent' | 'path' | 'version'>,
): Promise<AgentUpdateState> {
  const id = String(agent.agent || '').trim();
  const pkg = getAgentPackage(id);
  if (!pkg) return { ...emptyState(), status: 'skipped', detail: 'unsupported agent', checkedAt: Date.now() };

  const currentVersion = extractAgentSemver(agent.version);
  setUpdateState(id, { currentVersion, status: 'checking' });

  // Detect brew install and use brew version check.
  const binPath = String(agent.path || '').trim();
  const brewCask = binPath && isBrewInstalledBinary(binPath) ? getAgentBrewCask(id) : null;
  const latestVersion = brewCask
    ? await getLatestBrewCaskVersion(brewCask)
    : await getLatestPackageVersion(pkg);

  if (!latestVersion) {
    const state: AgentUpdateState = { currentVersion, latestVersion: null, updateAvailable: false, status: 'failed', detail: 'latest version lookup failed', checkedAt: Date.now() };
    setUpdateState(id, state);
    return state;
  }

  const updateAvailable = !!(currentVersion && latestVersion && currentVersion !== latestVersion);
  const state: AgentUpdateState = {
    currentVersion,
    latestVersion,
    updateAvailable,
    status: updateAvailable ? 'update-available' : 'up-to-date',
    detail: null,
    checkedAt: Date.now(),
  };
  setUpdateState(id, state);
  return state;
}

/** Manually trigger an update for a specific agent (auto-detects brew vs npm). */
export async function manualAgentUpdate(
  agent: Pick<AgentInfo, 'agent' | 'path' | 'version'>,
  log: (message: string) => void,
): Promise<{ ok: boolean; error: string | null }> {
  const id = String(agent.agent || '').trim();
  const pkg = getAgentPackage(id);
  if (!pkg) return { ok: false, error: 'Unsupported agent' };

  const label = labelForAgent(id);
  const binPath = String(agent.path || '').trim();
  const brewCask = binPath && isBrewInstalledBinary(binPath) ? getAgentBrewCask(id) : null;

  setUpdateState(id, { status: 'updating' });

  let result: { ok: boolean; detail: string | null };
  if (brewCask) {
    log(`manual update: updating ${label} via brew upgrade --cask ${brewCask}`);
    result = await updateViaBrew(brewCask);
  } else {
    log(`manual update: updating ${label} via npm install -g ${pkg}@latest`);
    result = await updateViaNpm(pkg);
  }

  if (result.ok) {
    log(`manual update: ${label} update completed`);
    setUpdateState(id, { updateAvailable: false, status: 'updated', detail: null, checkedAt: Date.now() });
    return { ok: true, error: null };
  }

  const error = result.detail || 'unknown error';
  log(`manual update: ${label} update failed: ${error}`);
  setUpdateState(id, { status: 'failed', detail: error, checkedAt: Date.now() });
  return { ok: false, error };
}
