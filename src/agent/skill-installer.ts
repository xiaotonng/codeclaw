/**
 * Skill installer — wrapper around `npx skills` CLI.
 *
 * Skills are installed via the community-standard `npx skills add` command.
 * Global skills go to ~/.pikiclaw/skills/, project skills to <workdir>/.pikiclaw/skills/.
 *
 * The upstream CLI doesn't recognize `pikiclaw` as an agent, so we install with
 * `--agent claude-code` (the driver pikiclaw runs by default) and rely on
 * ~/.claude/skills → ~/.pikiclaw/skills being symlinked to the same directory.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInstallOpts {
  /** Install globally (all projects) or project-scoped. */
  global?: boolean;
  /** If the repo has multiple skills, install a specific one. */
  skill?: string;
  /** Project working directory (required for project-scoped installs). */
  workdir?: string;
}

export interface SkillInstallResult {
  ok: boolean;
  error?: string;
  output?: string;
}

export interface SkillRemoveResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), '.pikiclaw', 'skills');
const INSTALL_TIMEOUT_MS = 60_000;
const REMOVE_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make sure the global skills directory exists, and that the agent-specific
 * dirs that the upstream skills CLI writes to (`~/.claude/skills`,
 * `~/.agents/skills`) resolve back to it. This is what lets us install with
 * `--agent claude-code` and still read the results from `~/.pikiclaw/skills`.
 */
function ensureGlobalSkillsDir(): void {
  fs.mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
  for (const linkDir of [
    path.join(os.homedir(), '.claude', 'skills'),
    path.join(os.homedir(), '.agents', 'skills'),
  ]) {
    try {
      const stat = fs.lstatSync(linkDir);
      if (stat.isSymbolicLink()) {
        const real = fs.realpathSync(linkDir);
        if (real === fs.realpathSync(GLOBAL_SKILLS_DIR)) continue;
      }
      // Existing dir/link doesn't match — leave it alone rather than destroy user data.
      continue;
    } catch {
      try {
        fs.mkdirSync(path.dirname(linkDir), { recursive: true });
        fs.symlinkSync(GLOBAL_SKILLS_DIR, linkDir, 'dir');
      } catch { /* best effort */ }
    }
  }
}

function runNpx(args: string[], cwd: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile('npx', args, {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      shell: process.platform === 'win32',
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
      });
    });
    // Prevent child from keeping parent alive
    child.unref?.();
  });
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Install a skill from a source (GitHub owner/repo, URL, or local path).
 *
 * Uses `npx skills add <source>` with appropriate flags.
 */
export async function installSkill(source: string, opts: SkillInstallOpts = {}): Promise<SkillInstallResult> {
  const { global: isGlobal, skill, workdir } = opts;

  if (!isGlobal && !workdir) {
    return { ok: false, error: 'workdir is required for project-scoped skill installation' };
  }

  const cwd = isGlobal ? os.homedir() : workdir!;
  const args = ['-y', 'skills', 'add', source, '--yes', '--agent', 'claude-code'];

  if (isGlobal) {
    args.push('-g');
    ensureGlobalSkillsDir();
  }

  if (skill) {
    args.push('-s', skill);
  }

  const result = await runNpx(args, cwd, INSTALL_TIMEOUT_MS);

  if (!result.ok) {
    const errorMsg = result.stderr.trim().split('\n').pop()?.trim() || 'installation failed';
    return { ok: false, error: errorMsg, output: result.stdout + result.stderr };
  }

  return { ok: true, output: result.stdout };
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

/**
 * Remove an installed skill by name.
 * Deletes the skill directory from the appropriate location.
 */
export function removeSkill(skillName: string, opts: { global?: boolean; workdir?: string } = {}): SkillRemoveResult {
  const { global: isGlobal, workdir } = opts;

  if (!isGlobal && !workdir) {
    return { ok: false, error: 'workdir is required for project-scoped skill removal' };
  }

  // Security: prevent path traversal — skill name must be a plain directory name
  const sanitized = path.basename(skillName);
  if (!sanitized || sanitized === '.' || sanitized === '..' || sanitized !== skillName) {
    return { ok: false, error: 'invalid skill name' };
  }

  const parentDir = isGlobal
    ? GLOBAL_SKILLS_DIR
    : path.join(workdir!, '.pikiclaw', 'skills');
  const skillDir = path.join(parentDir, sanitized);

  // Double-check the resolved path is inside the expected parent
  const realParent = path.resolve(parentDir);
  const realSkill = path.resolve(skillDir);
  if (!realSkill.startsWith(realParent + path.sep)) {
    return { ok: false, error: 'invalid skill path' };
  }

  try {
    if (!fs.existsSync(skillDir)) {
      return { ok: false, error: `skill "${sanitized}" not found` };
    }
    fs.rmSync(skillDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'removal failed' };
  }
}

// ---------------------------------------------------------------------------
// List installed (enhanced)
// ---------------------------------------------------------------------------

export function getGlobalSkillsDir(): string {
  return GLOBAL_SKILLS_DIR;
}

// ---------------------------------------------------------------------------
// Check for updates
// ---------------------------------------------------------------------------

export async function checkSkillUpdates(opts: { global?: boolean; workdir?: string } = {}): Promise<SkillInstallResult> {
  const cwd = opts.global ? os.homedir() : (opts.workdir || process.cwd());
  const args = ['-y', 'skills', 'check'];
  if (opts.global) args.push('-g');
  return runNpx(args, cwd, INSTALL_TIMEOUT_MS).then(r => ({
    ok: r.ok,
    output: r.stdout,
    error: r.ok ? undefined : r.stderr,
  }));
}
