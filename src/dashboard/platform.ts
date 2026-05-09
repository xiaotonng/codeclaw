/**
 * Platform detection helpers.
 *
 * macOS permission checks, terminal detection, JXA scripts, and other OS-level utilities.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import {
  DASHBOARD_PERMISSION_TIMEOUTS,
} from '../core/constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PermissionStatus { granted: boolean; checkable: boolean; detail: string }

export type DashboardPermissionKey = 'screenRecording' | 'fullDiskAccess';
export type PermissionRequestAction = 'already_granted' | 'prompted' | 'opened_settings' | 'unsupported';

export interface PermissionRequestResult {
  ok: boolean;
  action: PermissionRequestAction;
  granted: boolean;
  requiresManualGrant: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Permission pane URLs (macOS)
// ---------------------------------------------------------------------------

const permissionPaneUrls: Record<DashboardPermissionKey, string> = {
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  fullDiskAccess: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
};

// ---------------------------------------------------------------------------
// JXA helpers
// ---------------------------------------------------------------------------

function runJxa(script: string, timeout = DASHBOARD_PERMISSION_TIMEOUTS.jxaDefault): string | null {
  try {
    return String(execFileSync('osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8', timeout })).trim().toLowerCase();
  } catch {
    return null;
  }
}

function checkScreenRecordingPermission(): boolean | null {
  const screenshotPath = path.join(os.tmpdir(), `.pikiclaw_perm_test_${process.pid}_${Date.now()}.png`);
  try {
    execFileSync('screencapture', ['-x', screenshotPath], { stdio: 'ignore', timeout: DASHBOARD_PERMISSION_TIMEOUTS.screenRecordingProbe });
    return true;
  } catch {} finally {
    try { fs.rmSync(screenshotPath, { force: true }); } catch {}
  }
  const output = runJxa(
    'ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]); console.log($.CGPreflightScreenCaptureAccess());',
    DASHBOARD_PERMISSION_TIMEOUTS.screenRecordingPreflight,
  );
  if (output == null) return null;
  return output === 'true';
}

function requestScreenRecordingPermission(): boolean {
  return runJxa(
    'ObjC.bindFunction("CGRequestScreenCaptureAccess", ["bool", []]); console.log($.CGRequestScreenCaptureAccess());',
    DASHBOARD_PERMISSION_TIMEOUTS.screenRecordingRequest,
  ) !== null;
}

function openPermissionSettings(permission: DashboardPermissionKey): boolean {
  const pane = permissionPaneUrls[permission];
  if (!pane) return false;
  try {
    execFileSync('open', [pane], { stdio: 'ignore', timeout: DASHBOARD_PERMISSION_TIMEOUTS.openSystemPreferences });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Permission checks
// ---------------------------------------------------------------------------

export function checkPermissions(): Record<string, PermissionStatus> {
  const r: Record<string, PermissionStatus> = {};
  if (process.platform !== 'darwin') {
    r.screenRecording = { granted: true, checkable: false, detail: 'N/A' };
    r.fullDiskAccess = { granted: true, checkable: false, detail: 'N/A' };
    return r;
  }
  const screenRecordingGranted = checkScreenRecordingPermission();
  r.screenRecording = {
    granted: screenRecordingGranted === true,
    checkable: true,
    detail: screenRecordingGranted === true ? '已授权' : '未授权',
  };

  try {
    execSync(`ls "${os.homedir()}/Library/Mail" 2>/dev/null`, { timeout: 3000 });
    r.fullDiskAccess = { granted: true, checkable: true, detail: '已授权' };
  } catch { r.fullDiskAccess = { granted: false, checkable: true, detail: '未授权' }; }
  return r;
}

export function requestPermission(permission: DashboardPermissionKey): PermissionRequestResult {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      action: 'unsupported',
      granted: true,
      requiresManualGrant: false,
      error: 'Permission requests are only supported on macOS.',
    };
  }

  const current = checkPermissions()[permission];
  if (current?.granted) {
    return {
      ok: true,
      action: 'already_granted',
      granted: true,
      requiresManualGrant: false,
    };
  }

  if (permission === 'screenRecording') {
    const prompted = requestScreenRecordingPermission();
    if (!prompted) {
      const openedSettings = openPermissionSettings(permission);
      return openedSettings
        ? { ok: true, action: 'opened_settings', granted: false, requiresManualGrant: true }
        : { ok: false, action: 'unsupported', granted: false, requiresManualGrant: true, error: 'Failed to trigger Screen Recording permission request.' };
    }
    return {
      ok: true,
      action: 'prompted',
      granted: !!checkPermissions().screenRecording?.granted,
      requiresManualGrant: true,
    };
  }

  if (permission === 'fullDiskAccess') {
    const openedSettings = openPermissionSettings(permission);
    return openedSettings
      ? { ok: true, action: 'opened_settings', granted: false, requiresManualGrant: true }
      : { ok: false, action: 'unsupported', granted: false, requiresManualGrant: true, error: 'Failed to open Full Disk Access settings.' };
  }

  return { ok: false, action: 'unsupported', granted: false, requiresManualGrant: true, error: 'Unknown permission.' };
}

export function isValidPermissionKey(value: string): value is DashboardPermissionKey {
  return value in permissionPaneUrls;
}

// ---------------------------------------------------------------------------
// Terminal detection
// ---------------------------------------------------------------------------

/** Walk the process tree upward to find the host terminal / IDE that launched pikiclaw. Works on macOS and Linux. */
export function detectHostTerminalApp(): string | null {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return null;
  try {
    // Patterns to match in the comm/exe name (case-insensitive on Linux where names vary)
    // macOS: Terminal, iTerm2, Warp; Linux: gnome-terminal, konsole, xfce4-terminal, xterm, tilix, foot, sakura, terminology
    // Cross-platform: Alacritty, kitty, WezTerm, Hyper, VS Code, Cursor, Windsurf
    const patterns = [
      'Terminal', 'iTerm', 'Warp',
      'Alacritty', 'alacritty', 'kitty', 'WezTerm', 'wezterm', 'Hyper',
      'Code', 'Cursor', 'Windsurf',
      'konsole', 'xfce4-terminal', 'xterm', 'tilix', 'foot', 'sakura', 'terminology', 'tmux', 'screen',
    ];
    const caseList = patterns.map(p => `*${p}*`).join('|');
    const output = execSync(
      `pid=${process.pid} ; while [ "$pid" != "1" ] && [ -n "$pid" ]; do pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' '); comm=$(ps -o comm= -p "$pid" 2>/dev/null); case "$comm" in ${caseList}) echo "$comm"; exit 0;; esac; done`,
      { encoding: 'utf8', timeout: DASHBOARD_PERMISSION_TIMEOUTS.detectTerminal, shell: '/bin/sh' },
    ).trim();
    if (!output) return null;
    const base = path.basename(output);
    // Map comm name → human-readable display name
    const nameMap: [string, string][] = [
      // macOS
      ['iTerm', 'iTerm2'],
      ['Code Helper', 'VS Code'],
      ['Cursor Helper', 'Cursor'],
      ['Windsurf Helper', 'Windsurf'],
      // Cross-platform IDE wrappers (Linux uses "code" binary directly)
      ['code', 'VS Code'],
      ['cursor', 'Cursor'],
      ['windsurf', 'Windsurf'],
      // Terminal emulators
      ['gnome-terminal', 'GNOME Terminal'],
      ['xfce4-terminal', 'Xfce Terminal'],
      ['Terminal', 'Terminal'],
      ['Warp', 'Warp'],
      ['Alacritty', 'Alacritty'],
      ['alacritty', 'Alacritty'],
      ['kitty', 'kitty'],
      ['WezTerm', 'WezTerm'],
      ['wezterm', 'WezTerm'],
      ['Hyper', 'Hyper'],
      ['konsole', 'Konsole'],
      ['xterm', 'xterm'],
      ['tilix', 'Tilix'],
      ['foot', 'foot'],
      ['sakura', 'Sakura'],
      ['terminology', 'Terminology'],
      ['tmux', 'tmux'],
      ['screen', 'screen'],
    ];
    for (const [key, name] of nameMap) {
      if (base.includes(key)) return name;
    }
    return base;
  } catch {
    return null;
  }
}

