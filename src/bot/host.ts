/**
 * Host system data collection: battery, CPU, memory, display name.
 * Platform-adaptive with macOS, Linux, and Windows support.
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export interface HostBatteryData {
  percent: string;
  state: string;
}

export interface HostCpuUsageData {
  userPercent: number;
  sysPercent: number;
  idlePercent: number;
  usedPercent: number;
}

export interface HostMemoryUsageData {
  usedBytes: number;
  availableBytes: number;
  percent: number;
  source: 'os' | 'vm_stat';
}

function normalizeBatteryState(raw: string | null | undefined): string {
  const state = (raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!state) return 'unknown';
  if (state === 'finishing charge') return 'charging';
  if (state === 'ac attached') return 'plugged in';
  return state;
}

function getMacBatteryData(): HostBatteryData | null {
  try {
    const output = execSync('pmset -g batt', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (!output || /no batteries/i.test(output)) return null;

    const line = output.split('\n').find(v => /\d+%/.test(v));
    if (!line) return null;

    const percent = line.match(/(\d+)%/)?.[1];
    if (!percent) return null;

    const states = line
      .split(';')
      .slice(1)
      .map(segment => segment.replace(/\bpresent:\s*(true|false)\b/ig, '').trim())
      .filter(Boolean);
    const state = states.find(segment => /(charging|discharging|charged|not charging|finishing charge|full)/i.test(segment))
      ?? states.find(segment => !/remaining/i.test(segment))
      ?? 'unknown';

    return { percent: `${percent}%`, state: normalizeBatteryState(state) };
  } catch {
    return null;
  }
}

function getLinuxBatteryData(): HostBatteryData | null {
  try {
    const powerDir = '/sys/class/power_supply';
    const batteries = fs.readdirSync(powerDir).filter(name => /^BAT/i.test(name));
    for (const battery of batteries) {
      const batteryDir = path.join(powerDir, battery);
      const capacityPath = path.join(batteryDir, 'capacity');
      if (!fs.existsSync(capacityPath)) continue;

      const capacity = fs.readFileSync(capacityPath, 'utf-8').trim();
      if (!capacity) continue;

      const statusPath = path.join(batteryDir, 'status');
      const state = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf-8').trim() : 'unknown';
      return {
        percent: capacity.endsWith('%') ? capacity : `${capacity}%`,
        state: normalizeBatteryState(state),
      };
    }
  } catch {}

  try {
    const output = execSync(
      'upower -e | grep -m1 battery | xargs -I{} upower -i "{}"',
      { encoding: 'utf-8', timeout: 3000 },
    ).trim();
    if (!output) return null;

    const percent = output.match(/percentage:\s*(\d+%)/i)?.[1];
    if (!percent) return null;
    const state = output.match(/state:\s*([^\n]+)/i)?.[1];
    return { percent, state: normalizeBatteryState(state) };
  } catch {
    return null;
  }
}

function getWindowsBatteryData(): HostBatteryData | null {
  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress"',
      { encoding: 'utf-8', timeout: 3000 },
    ).trim();
    if (!output || output === 'null') return null;

    const parsed = JSON.parse(output);
    const percent = Number(parsed?.EstimatedChargeRemaining);
    if (!Number.isFinite(percent)) return null;

    const status = Number(parsed?.BatteryStatus);
    const state = status === 6 ? 'charging'
      : status === 3 ? 'charged'
      : status === 2 ? 'plugged in'
      : status === 1 ? 'discharging'
      : 'unknown';

    return { percent: `${percent}%`, state };
  } catch {
    return null;
  }
}

export function getHostBatteryData(): HostBatteryData | null {
  if (process.platform === 'darwin') return getMacBatteryData();
  if (process.platform === 'linux') return getLinuxBatteryData();
  if (process.platform === 'win32') return getWindowsBatteryData();
  return null;
}

function parsePercent(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value.trim());
  return Number.isFinite(n) ? n : null;
}

function getMacCpuUsageData(): HostCpuUsageData | null {
  try {
    const output = execSync('top -l 1 -n 0 | sed -n \'1,6p\'', { encoding: 'utf-8', timeout: 3000 });
    const line = output.split('\n').find(entry => /^CPU usage:/i.test(entry.trim()));
    if (!line) return null;
    const match = line.match(/CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle/i);
    if (!match) return null;
    const userPercent = parsePercent(match[1]);
    const sysPercent = parsePercent(match[2]);
    const idlePercent = parsePercent(match[3]);
    if (userPercent == null || sysPercent == null || idlePercent == null) return null;
    return {
      userPercent,
      sysPercent,
      idlePercent,
      usedPercent: Math.max(0, userPercent + sysPercent),
    };
  } catch {
    return null;
  }
}

function getMacMemoryUsageData(totalMem: number): HostMemoryUsageData | null {
  try {
    const output = execSync('vm_stat', { encoding: 'utf-8', timeout: 3000 });
    const pageSize = Number.parseInt(output.match(/page size of (\d+) bytes/i)?.[1] || '', 10);
    if (!Number.isFinite(pageSize) || pageSize <= 0) return null;

    const pages = new Map<string, number>();
    for (const line of output.split('\n')) {
      const match = line.match(/^Pages ([^:]+):\s+(\d+)\./);
      if (!match) continue;
      pages.set(match[1].trim().toLowerCase(), Number.parseInt(match[2], 10));
    }

    const reclaimablePages =
      (pages.get('free') || 0) +
      (pages.get('inactive') || 0) +
      (pages.get('speculative') || 0) +
      (pages.get('purgeable') || 0);
    const availableBytes = Math.max(0, reclaimablePages * pageSize);
    const usedBytes = Math.max(0, Math.min(totalMem, totalMem - availableBytes));
    const percent = totalMem > 0 ? (usedBytes / totalMem) * 100 : 0;
    return { usedBytes, availableBytes, percent, source: 'vm_stat' };
  } catch {
    return null;
  }
}

export function getHostCpuUsageData(): HostCpuUsageData | null {
  if (process.platform === 'darwin') return getMacCpuUsageData();
  return null;
}

export function getHostDisplayName(): string {
  if (process.platform === 'darwin') {
    try {
      const name = execSync('scutil --get ComputerName', { encoding: 'utf-8', timeout: 3000 }).trim();
      if (name) return name;
    } catch { /* fall through */ }
  }
  return os.hostname();
}

export function getHostMemoryUsageData(totalMem: number, freeMem: number): HostMemoryUsageData {
  if (process.platform === 'darwin') {
    const macData = getMacMemoryUsageData(totalMem);
    if (macData) return macData;
  }

  const usedBytes = Math.max(0, totalMem - freeMem);
  const availableBytes = Math.max(0, freeMem);
  const percent = totalMem > 0 ? (usedBytes / totalMem) * 100 : 0;
  return { usedBytes, availableBytes, percent, source: 'os' };
}
