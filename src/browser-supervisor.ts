/**
 * Process-level singleton supervisor for the managed browser.
 *
 * Owns the lifecycle decisions for the managed Chrome instance so that all
 * agent streams in this pikiclaw process share one browser. Replaces the old
 * per-stream `prepareManagedBrowserForAutomation` call inside the MCP bridge,
 * which was relaunching Chrome at the start of every task.
 *
 * Three operations:
 *   - probe(): non-launching health check; returns the current CDP endpoint
 *     iff a managed Chrome is already reachable.
 *   - ensure(): idempotent prepare with singleflight; launches Chrome only
 *     when no healthy instance is reachable. Caches the result for re-use
 *     across streams.
 *   - invalidate(): drop the cache after a confirmed downstream failure
 *     (e.g. CDP socket closed mid-stream).
 */

import {
  getManagedBrowserProfileDir,
  prepareManagedBrowserForAutomation,
} from './browser-profile.js';
import { writeScopedLog } from './core/logging.js';

export type ManagedBrowserConnectionMode = 'attach' | 'launch' | 'unavailable';

export interface ManagedBrowserSnapshot {
  cdpEndpoint: string | null;
  connectionMode: ManagedBrowserConnectionMode;
}

export interface EnsureManagedBrowserOptions {
  headless?: boolean;
  /** Skip the cache and re-prepare unconditionally. */
  force?: boolean;
}

interface CachedState {
  cdpEndpoint: string | null;
  connectionMode: ManagedBrowserConnectionMode;
  validatedAt: number;
}

const HEALTH_CACHE_MS = 30_000;
const CDP_PROBE_TIMEOUT_MS = 1_500;

let cached: CachedState | null = null;
let inflight: Promise<ManagedBrowserSnapshot> | null = null;

function log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'debug'): void {
  writeScopedLog('browser-supervisor', message, { level, stream: 'stderr' });
}

function snapshotFromCache(state: CachedState): ManagedBrowserSnapshot {
  return { cdpEndpoint: state.cdpEndpoint, connectionMode: state.connectionMode };
}

async function pingCdpEndpoint(endpoint: string): Promise<boolean> {
  if (!endpoint) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CDP_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: controller.signal });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null) as { webSocketDebuggerUrl?: unknown } | null;
    return typeof payload?.webSocketDebuggerUrl === 'string';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function freshenCacheIfPossible(now: number): Promise<ManagedBrowserSnapshot | null> {
  if (!cached?.cdpEndpoint) return null;
  if (now - cached.validatedAt < HEALTH_CACHE_MS) return snapshotFromCache(cached);
  const healthy = await pingCdpEndpoint(cached.cdpEndpoint);
  if (healthy) {
    cached.validatedAt = now;
    return snapshotFromCache(cached);
  }
  log(`cached endpoint ${cached.cdpEndpoint} no longer reachable; clearing cache`, 'warn');
  cached = null;
  return null;
}

/**
 * Non-launching probe. Returns the current CDP endpoint iff a managed Chrome
 * is already reachable. Never starts a new Chrome process.
 */
export async function probeManagedBrowser(): Promise<ManagedBrowserSnapshot> {
  const fresh = await freshenCacheIfPossible(Date.now());
  if (fresh) return fresh;
  return { cdpEndpoint: null, connectionMode: 'unavailable' };
}

/**
 * Idempotent prepare. Returns a healthy CDP endpoint, launching Chrome only
 * when no reachable managed instance is available. Concurrent callers share
 * one in-flight preparation promise (singleflight).
 */
export async function ensureManagedBrowser(
  opts: EnsureManagedBrowserOptions = {},
): Promise<ManagedBrowserSnapshot> {
  const { headless = false, force = false } = opts;
  const now = Date.now();

  if (!force) {
    const fresh = await freshenCacheIfPossible(now);
    if (fresh) return fresh;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const result = await prepareManagedBrowserForAutomation(
        getManagedBrowserProfileDir(),
        { headless },
      );
      const state: CachedState = {
        cdpEndpoint: result.cdpEndpoint,
        connectionMode: result.cdpEndpoint ? result.connectionMode : 'unavailable',
        validatedAt: Date.now(),
      };
      if (state.cdpEndpoint) {
        cached = state;
        log(`prepared managed browser: mode=${state.connectionMode} endpoint=${state.cdpEndpoint}`);
      } else {
        cached = null;
        log(`managed browser unavailable (mode=${result.connectionMode}); will fall back to upstream-managed launch`, 'warn');
      }
      return snapshotFromCache(state);
    } catch (err: any) {
      cached = null;
      log(`ensure failed: ${err?.message || err}`, 'error');
      return { cdpEndpoint: null, connectionMode: 'unavailable' };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Drop any cached endpoint, e.g. after a confirmed CDP failure mid-stream. */
export function invalidateManagedBrowser(): void {
  if (cached) log(`invalidating cached endpoint ${cached.cdpEndpoint}`);
  cached = null;
}

/** Synchronous accessor for the cached endpoint without any I/O. */
export function getCachedManagedBrowserEndpoint(): string | null {
  return cached?.cdpEndpoint || null;
}

/** Test-only: reset module state. */
export function _resetManagedBrowserSupervisor(): void {
  cached = null;
  inflight = null;
}
