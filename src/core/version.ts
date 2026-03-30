/**
 * Reads the package version from package.json at startup.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');

function readPackageVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
  const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
  if (!version) throw new Error(`Missing version in ${packageJsonPath}`);
  return version;
}

export const VERSION = readPackageVersion();
