/**
 * Resolve a CredentialRef to a plaintext secret.
 *
 * Resolved values are returned to the caller and immediately consumed (e.g.
 * injected into a child process env at spawn time). Pikiclaw never persists
 * the resolved plaintext in long-lived state.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CredentialRef } from './ref.js';
import { readKeychain } from './store.js';
import { unsealInline } from './inline-seal.js';

const execFileP = promisify(execFile);

export interface ResolveOptions {
  /** Optional override for env lookups (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Hard timeout for `command` source (ms). Default 5000. */
  commandTimeoutMs?: number;
}

export async function resolveCredential(ref: CredentialRef, opts: ResolveOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;
  switch (ref.source) {
    case 'keychain': {
      const value = await readKeychain(ref.account);
      if (!value) throw new Error(`Keychain entry not found: ${ref.account}`);
      return value;
    }
    case 'env': {
      const value = env[ref.varName];
      if (!value) throw new Error(`Environment variable not set: ${ref.varName}`);
      return value;
    }
    case 'command': {
      if (!ref.argv.length) throw new Error('Empty command argv');
      const [cmd, ...args] = ref.argv;
      try {
        const { stdout } = await execFileP(cmd, args, {
          timeout: opts.commandTimeoutMs ?? 5000,
          encoding: 'utf8',
          env,
        });
        const value = String(stdout).trim();
        if (!value) throw new Error(`Command produced empty output: ${cmd}`);
        return value;
      } catch (e: any) {
        throw new Error(`Credential command failed (${cmd}): ${e?.message || e}`);
      }
    }
    case 'inline': {
      try {
        return unsealInline(ref.sealed);
      } catch (e: any) {
        throw new Error(`Inline credential decryption failed: ${e?.message || e}`);
      }
    }
  }
}

/** Resolve to null on error rather than throwing — useful for status checks. */
export async function tryResolveCredential(ref: CredentialRef, opts: ResolveOptions = {}): Promise<string | null> {
  try {
    return await resolveCredential(ref, opts);
  } catch {
    return null;
  }
}
