#!/usr/bin/env npx tsx
/**
 * E2E test for /restart — standalone script, run directly:
 *
 *   set -a && source .env && set +a && npx tsx test/restart.e2e.test.ts
 *
 * Requires env:
 *   TELEGRAM_BOT_TOKEN — bot token
 *
 * Flow:
 *   1. Spawn daemon process, record the first child PID
 *   2. Wait for child #1 to start polling
 *   3. Send SIGUSR2 to trigger restart (same code path as /restart command)
 *   4. Wait for daemon to spawn child #2 and extract PID2
 *   5. Assert PID1 !== PID2 and old child is gone
 *   6. Wait for child #2 to start polling
 *   7. Assert PID2 is alive
 *   8. Clean up the daemon via SIGTERM
 *
 * This is the one startup/daemon E2E that intentionally exercises process
 * replacement. Keep it on the local source chain only; never aim it at the
 * long-lived production/self-bootstrap `npx pikiclaw@latest` runtime.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN not set. Aborting.');
  process.exit(1);
}

const CLI_PATH = path.resolve('src/cli.ts');
const TIMEOUT = 90_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForLine(
  proc: ChildProcess,
  pattern: string | RegExp,
  timeoutMs = 60_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout (${timeoutMs}ms) waiting for: ${pattern}`)),
      timeoutMs,
    );
    const check = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const hit = typeof pattern === 'string' ? line.includes(pattern) : pattern.test(line);
        if (hit) { clearTimeout(timer); resolve(line); return; }
      }
    };
    proc.stdout?.on('data', check);
    proc.stderr?.on('data', check);
  });
}

function waitForExit(proc: ChildProcess, timeoutMs = 30_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    if (proc.exitCode !== null) { resolve(proc.exitCode); return; }
    const timer = setTimeout(() => reject(new Error('Timeout waiting for process exit')), timeoutMs);
    proc.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor(predicate: () => boolean, timeoutMs = 30_000, intervalMs = 200): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for predicate`);
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const timer = setTimeout(() => { console.error('FAIL: global timeout'); process.exit(1); }, TIMEOUT);

console.log('--- restart e2e test ---\n');

// 1. Spawn daemon with PIKICLAW_RESTART_CMD pointing to local code
const child = spawn('npx', ['tsx', CLI_PATH, '-c', 'telegram', '-t', TOKEN], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PIKICLAW_RESTART_CMD: `npx tsx ${CLI_PATH}` },
  cwd: process.cwd(),
});

console.log(`[1] spawned daemon  PID=${child.pid}`);

child.stdout?.on('data', d => process.stdout.write(`     [child] ${d}`));
child.stderr?.on('data', d => process.stderr.write(`     [child] ${d}`));

// 2. Capture child #1 PID and wait for bot to be ready
const child1Line = await waitForLine(child, /child running \(pid=(\d+)\)/);
const child1Match = child1Line.match(/pid=(\d+)/);
assert(!!child1Match, 'could not extract first child PID');
const pid1 = parseInt(child1Match![1], 10);
console.log(`[2] child1 spawned  PID=${pid1}`);

await waitForLine(child, 'polling started');
console.log(`[3] child1 ready    (polling started)`);

// 3. Send SIGUSR2
child.kill('SIGUSR2');
console.log(`[4] sent SIGUSR2`);

// 4. Extract child #2 PID from daemon log
await waitForLine(child, 'child requested restart, respawning immediately');
const child2Line = await waitForLine(child, /child running \(pid=(\d+)\)/);
const child2Match = child2Line.match(/pid=(\d+)/);
assert(!!child2Match, 'could not extract second child PID');
const pid2 = parseInt(child2Match![1], 10);
console.log(`[5] child2 spawned  PID=${pid2}`);

// 5. Verify PIDs differ
assert(pid2 !== pid1, `PID did not change: ${pid1} === ${pid2}`);
console.log(`[6] PIDs differ     ${pid1} -> ${pid2}  OK`);

// 6. Wait for the old child to be gone
await waitFor(() => !isAlive(pid1), 30_000);
console.log(`[7] child1 stopped  PID=${pid1}  OK`);

// 7. Wait for new child to start polling (inherits same stdout pipe)
await waitForLine(child, 'polling started');
console.log(`[8] child2 ready    (polling started)`);

// 8. Verify new process is alive
assert(isAlive(pid2), `child2 (PID ${pid2}) is not alive`);
console.log(`[9] child2 alive    OK`);

// 9. Clean up daemon + current child
child.kill('SIGTERM');
const exitCode = await waitForExit(child);
assert(exitCode === 143, `daemon exit code = ${exitCode}, expected 143`);
console.log(`[10] daemon stopped code=${exitCode}  OK`);

clearTimeout(timer);
console.log('\n--- PASS ---');
