/**
 * Credential reference — never store raw secrets in setting.json.
 *
 * Each credential is described by a small reference that can be dereferenced
 * at use time:
 *   - keychain: stored in OS keychain, looked up by service+account
 *   - env:      read from process.env at use time
 *   - command:  exec a command and use its stdout (e.g. `op read`, `gh auth token`)
 *   - inline:   AES-GCM sealed blob bound to this machine (fallback)
 */

export type CredentialRef =
  | { source: 'keychain'; account: string }
  | { source: 'env';      varName: string }
  | { source: 'command';  argv: string[] }
  | { source: 'inline';   sealed: string };

/** Stable service name used when writing to the OS keychain. */
export const KEYCHAIN_SERVICE = 'pikiclaw';

export function isCredentialRef(value: unknown): value is CredentialRef {
  if (!value || typeof value !== 'object') return false;
  const r = value as { source?: unknown };
  switch (r.source) {
    case 'keychain': return typeof (value as any).account === 'string';
    case 'env':      return typeof (value as any).varName === 'string';
    case 'command':  return Array.isArray((value as any).argv);
    case 'inline':   return typeof (value as any).sealed === 'string';
    default: return false;
  }
}

/** Short, non-sensitive description of a credential reference for UI display. */
export function describeCredentialRef(ref: CredentialRef): string {
  switch (ref.source) {
    case 'keychain': return `keychain:${ref.account}`;
    case 'env':      return `env:${ref.varName}`;
    case 'command':  return `cmd:${ref.argv[0] || '?'}…`;
    case 'inline':   return 'inline (sealed)';
  }
}
