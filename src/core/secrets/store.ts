/**
 * OS keychain access — lazy import of @napi-rs/keyring (optional dep).
 * If keychain is unavailable, callers fall back to inline-seal.
 */

import { KEYCHAIN_SERVICE } from './ref.js';

interface KeyringEntryLike {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntryLike;
}

let keyringModule: KeyringModule | null | undefined; // undefined = not tried, null = failed

async function loadKeyring(): Promise<KeyringModule | null> {
  if (keyringModule !== undefined) return keyringModule;
  try {
    // Optional dep — tsc can't see it without the package installed; use a
    // dynamic, untyped import so the build succeeds with or without it.
    const importer = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
    const mod = await importer('@napi-rs/keyring');
    keyringModule = (mod as unknown as KeyringModule);
  } catch {
    keyringModule = null;
  }
  return keyringModule;
}

/** Reset the cached module — used by tests. */
export function _resetKeychainCache(): void {
  keyringModule = undefined;
}

export async function isKeychainAvailable(): Promise<boolean> {
  return (await loadKeyring()) !== null;
}

export async function readKeychain(account: string): Promise<string | null> {
  const mod = await loadKeyring();
  if (!mod) throw new Error('OS keychain unavailable (install @napi-rs/keyring)');
  try {
    const entry = new mod.Entry(KEYCHAIN_SERVICE, account);
    const value = entry.getPassword();
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch (e: any) {
    // keyring-rs returns NoEntry as an error — treat as missing
    if (/NoEntry|no.such|not.found/i.test(e?.message || '')) return null;
    throw e;
  }
}

export async function writeKeychain(account: string, value: string): Promise<void> {
  const mod = await loadKeyring();
  if (!mod) throw new Error('OS keychain unavailable (install @napi-rs/keyring)');
  const entry = new mod.Entry(KEYCHAIN_SERVICE, account);
  entry.setPassword(value);
}

export async function deleteKeychain(account: string): Promise<boolean> {
  const mod = await loadKeyring();
  if (!mod) return false;
  try {
    const entry = new mod.Entry(KEYCHAIN_SERVICE, account);
    return !!entry.deletePassword();
  } catch {
    return false;
  }
}
