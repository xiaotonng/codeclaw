/**
 * Barrel for the pikiclaw credential vault.
 *
 * Pikiclaw owns its own credential layer rather than delegating to per-agent
 * config files: when an agent is spawned, the active Profile's credentials
 * are resolved on the fly and injected as env vars / generated config files.
 * This means setting.json never holds a raw secret in the default flow, and
 * adding a new agent (Hermes, OpenCode, …) does not duplicate credential UX.
 */

export type { CredentialRef } from './ref.js';
export { KEYCHAIN_SERVICE, isCredentialRef, describeCredentialRef } from './ref.js';
export { resolveCredential, tryResolveCredential, type ResolveOptions } from './resolver.js';
export {
  isKeychainAvailable, readKeychain, writeKeychain, deleteKeychain,
} from './store.js';
export { sealInline, unsealInline } from './inline-seal.js';

import { writeKeychain, deleteKeychain, isKeychainAvailable } from './store.js';
import { sealInline } from './inline-seal.js';
import type { CredentialRef } from './ref.js';

/**
 * Convenience: store a freshly-pasted secret using the safest available
 * backend. Returns the CredentialRef the caller should persist alongside
 * the Provider record.
 */
export async function persistSecret(account: string, plaintext: string): Promise<CredentialRef> {
  if (await isKeychainAvailable()) {
    try {
      await writeKeychain(account, plaintext);
      return { source: 'keychain', account };
    } catch {
      // fall through to inline seal
    }
  }
  return { source: 'inline', sealed: sealInline(plaintext) };
}

/** Best-effort cleanup when a Provider is deleted. */
export async function forgetSecret(ref: CredentialRef): Promise<void> {
  if (ref.source === 'keychain') {
    try { await deleteKeychain(ref.account); } catch {}
  }
  // env / command / inline references have nothing to clean
}
