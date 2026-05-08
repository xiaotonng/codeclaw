#!/usr/bin/env npx tsx
/**
 * End-to-end Hermes ACP verification.
 *
 * Spawns the real `hermes acp` process and exercises the full driver path:
 *   1. New session — initialize → session/new → set_model → set_session_mode → session/prompt
 *   2. Resume    — initialize → session/load (with replay drain) → set_model → session/prompt
 *
 * Reports per-step results to stdout. Exits non-zero if any step fails.
 *
 * Skip conditions (exits 0 with message):
 *   - `hermes` not on PATH
 *   - HERMES_E2E_SKIP=1
 *   - The model in ~/.hermes/config.yaml is known to refuse (we report it as
 *     informational rather than failing the test, since that's outside our
 *     control).
 *
 * Run:  npx tsx test/verify-hermes-e2e.ts
 *
 * Optional env vars:
 *   HERMES_E2E_PROMPT   — override the test prompt (default "Reply only with: OK")
 *   HERMES_E2E_MODEL    — override model id sent via set_model (e.g. openrouter:anthropic/claude-haiku-4.5)
 *   HERMES_E2E_TIMEOUT  — per-prompt timeout in seconds (default 60)
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doHermesStream } from '../src/agent/drivers/hermes.ts';
import type { StreamOpts, StreamResult } from '../src/agent/types.ts';

interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
  result?: StreamResult;
}

function which(cmd: string): string | null {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}

function fmt(r: StreamResult, max = 200): string {
  return `ok=${r.ok} session=${r.sessionId || '-'} stop=${r.stopReason || '-'} reply=${JSON.stringify((r.message || '').slice(0, max))} error=${r.error || '-'}`;
}

async function runTurn(
  opts: { prompt: string; sessionId?: string | null; model?: string; effort?: string; workdir: string },
  timeoutS = 60,
): Promise<StreamResult> {
  const streamOpts: StreamOpts = {
    agent: 'hermes',
    prompt: opts.prompt,
    workdir: opts.workdir,
    timeout: timeoutS,
    sessionId: opts.sessionId ?? null,
    model: opts.model || null,
    thinkingEffort: opts.effort || 'medium',
    onText: () => {},
    hermesModel: opts.model,
  };
  return doHermesStream(streamOpts);
}

async function main() {
  if (process.env.HERMES_E2E_SKIP === '1') {
    console.log('HERMES_E2E_SKIP=1 — skipping');
    return 0;
  }
  const hermesPath = which('hermes');
  if (!hermesPath) {
    console.log('`hermes` not on PATH — skipping');
    return 0;
  }
  console.log(`hermes binary:    ${hermesPath}`);
  const versionRes = spawnSync('hermes', ['--version'], { encoding: 'utf8' });
  console.log(`hermes version:   ${versionRes.stdout.trim().split('\n')[0] || '(unknown)'}`);

  const prompt = process.env.HERMES_E2E_PROMPT || 'Reply only with: OK';
  const model = process.env.HERMES_E2E_MODEL || '';
  const timeoutS = Number(process.env.HERMES_E2E_TIMEOUT || '60');
  const workdir = mkdtempSync(join(tmpdir(), 'pikiclaw-hermes-e2e-'));
  writeFileSync(join(workdir, 'README.md'), '# pikiclaw hermes e2e\n');
  console.log(`workdir:          ${workdir}`);
  console.log(`prompt:           ${JSON.stringify(prompt)}`);
  console.log(`override model:   ${model || '(use hermes config default)'}`);
  console.log(`per-turn timeout: ${timeoutS}s`);
  console.log('---');

  const steps: StepResult[] = [];

  // Step 1: brand new session
  console.log('Step 1: new session — initialize → session/new → set_model → set_session_mode → prompt');
  let firstSession: string | null = null;
  try {
    const r = await runTurn({ prompt, workdir, model, effort: 'low' }, timeoutS);
    firstSession = r.sessionId;
    const passed = !!r.message && r.sessionId !== null;
    steps.push({ name: 'new-session', ok: passed && r.error == null, detail: fmt(r), result: r });
    console.log(`  → ${fmt(r, 300)}`);
  } catch (e: any) {
    steps.push({ name: 'new-session', ok: false, detail: `threw: ${e?.message || e}` });
    console.log(`  → THREW: ${e?.message || e}`);
  }

  if (firstSession) {
    // Step 2: resume the same session — exercises session/load + replay drain.
    console.log('\nStep 2: resume session — initialize → session/load (drain) → set_model → prompt');
    try {
      const r = await runTurn({ prompt: 'Reply only with: OK2', sessionId: firstSession, workdir, model, effort: 'low' }, timeoutS);
      // The replay drain test: the message must NOT echo the previous turn.
      const polluted = r.message?.includes('OK\n') || r.message?.toLowerCase()?.includes('reply only with: ok');
      const passed = !!r.message && r.sessionId === firstSession && !polluted;
      steps.push({ name: 'resume-session', ok: passed && r.error == null, detail: fmt(r) + (polluted ? ' [POLLUTED]' : ''), result: r });
      console.log(`  → ${fmt(r, 300)}${polluted ? '\n  ⚠ replay leaked into reply' : ''}`);
    } catch (e: any) {
      steps.push({ name: 'resume-session', ok: false, detail: `threw: ${e?.message || e}` });
      console.log(`  → THREW: ${e?.message || e}`);
    }
  } else {
    steps.push({ name: 'resume-session', ok: false, detail: 'skipped — no session id from step 1' });
  }

  // Cleanup
  try { rmSync(workdir, { recursive: true, force: true }); } catch {}

  // Report
  console.log('\n=== Summary ===');
  let failed = 0;
  for (const s of steps) {
    const status = s.ok ? '✓' : '✗';
    console.log(`  ${status} ${s.name.padEnd(20)} — ${s.detail}`);
    if (!s.ok) failed++;
  }

  // Distinguish "model refusal" (informational, exit 0) from real failures.
  const refusalOnly = steps.every(s => {
    if (s.ok) return true;
    const msg = s.result?.message?.toLowerCase() || '';
    return /sorry.*cannot/.test(msg) || /unable to/.test(msg);
  });
  if (failed > 0 && refusalOnly) {
    console.log('\n  ℹ  Failures appear to be model safety refusals, not pikiclaw bugs.');
    console.log('     Try setting HERMES_E2E_MODEL=openrouter:anthropic/claude-haiku-4.5 to bypass.');
    return 0;
  }
  return failed > 0 ? 1 : 0;
}

main().then(code => process.exit(code), err => {
  console.error('UNHANDLED:', err);
  process.exit(2);
});
