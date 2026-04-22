/**
 * CLI detector — checks whether a CLI binary is on PATH, what version it is,
 * and whether the user is already signed in.
 *
 * Results are cached with a short TTL so catalog rendering stays snappy.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { RecommendedCli } from './registry.js';

export type CliState = 'not_installed' | 'installed_not_auth' | 'ready' | 'unknown';

export interface CliStatus {
  id: string;
  binary: string;
  state: CliState;
  version?: string;
  authDetail?: string;
  error?: string;
  checkedAt: number;
}

const DETECT_TTL_MS = 30_000;
const cache = new Map<string, CliStatus>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runArgv(argv: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const [cmd, ...rest] = argv;
    execFile(cmd, rest, {
      timeout: timeoutMs,
      env: { ...process.env, NO_COLOR: '1', CLICOLOR: '0', TERM: 'dumb' },
      shell: false,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      const code = (err as NodeJS.ErrnoException)?.code;
      const exitCode = typeof code === 'number' ? code : (err ? 1 : 0);
      resolve({
        ok: !err,
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
        code: typeof exitCode === 'number' ? exitCode : null,
      });
    });
  });
}

function which(binary: string): string | null {
  const isWin = process.platform === 'win32';
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  const sep = isWin ? ';' : ':';
  const pathDirs = (process.env.PATH || '').split(sep);
  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch { /* next */ }
    }
  }
  return null;
}

function extractVersion(stdout: string, stderr: string): string | undefined {
  const text = (stdout || stderr).trim();
  if (!text) return undefined;
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  // Common patterns: "gh version 2.56.0 (...)" / "1.2.3" / "aws-cli/2.x ..."
  const m = firstLine.match(/\b(\d+\.\d+(?:\.\d+)?(?:[-.+][0-9A-Za-z.]+)?)\b/);
  return m ? m[1] : firstLine.slice(0, 80);
}

function trimDetail(s: string): string | undefined {
  const text = s.trim();
  if (!text) return undefined;
  const first = text.split(/\r?\n/, 1)[0].trim();
  return first.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function getCachedCliStatus(id: string): CliStatus | undefined {
  const cached = cache.get(id);
  if (!cached) return undefined;
  if (Date.now() - cached.checkedAt > DETECT_TTL_MS) return undefined;
  return cached;
}

export function invalidateCliStatus(id?: string): void {
  if (id) cache.delete(id);
  else cache.clear();
}

export async function detectCli(cli: RecommendedCli): Promise<CliStatus> {
  const binaryPath = which(cli.binary);
  if (!binaryPath) {
    const status: CliStatus = {
      id: cli.id, binary: cli.binary, state: 'not_installed', checkedAt: Date.now(),
    };
    cache.set(cli.id, status);
    return status;
  }

  // Installed — read version, best-effort.
  let version: string | undefined;
  if (cli.versionArgv && cli.versionArgv.length) {
    const v = await runArgv(cli.versionArgv, 5_000);
    version = extractVersion(v.stdout, v.stderr);
  }

  if (cli.auth.type === 'none' || !cli.auth.statusArgv || cli.auth.statusArgv.length === 0) {
    const status: CliStatus = {
      id: cli.id, binary: cli.binary, state: 'ready', version, checkedAt: Date.now(),
    };
    cache.set(cli.id, status);
    return status;
  }

  const result = await runArgv(cli.auth.statusArgv, 6_000);
  const state: CliState = result.ok ? 'ready' : 'installed_not_auth';
  const status: CliStatus = {
    id: cli.id, binary: cli.binary, state, version,
    authDetail: state === 'ready' ? trimDetail(result.stdout) : trimDetail(result.stderr || result.stdout),
    checkedAt: Date.now(),
  };
  cache.set(cli.id, status);
  return status;
}

/** Best-effort platform key for picking install commands. */
export function currentPlatform(): 'darwin' | 'linux' | 'win' {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'win32') return 'win';
  return 'linux';
}

/** Where AWS credentials go for the `token` auth flow. */
export function awsCredentialsPath(): string {
  return path.join(os.homedir(), '.aws', 'credentials');
}
