---
name: install
description: This skill should be used when the user asks to "install codeclaw", "build and install", "compile the binary", "deploy locally", "update local binary", or mentions building codeclaw and putting it in ~/.local/bin.
version: 4.0.0
---

# Install & Publish codeclaw

Every time this skill is invoked, execute ALL steps below in order:

## 1. Bump patch version

1. Read current version from `package.json`.
2. Increment the **patch** number (e.g. `0.2.0` → `0.2.1`).
3. Update **both** `package.json` `"version"` field and `src/codeclaw.js` `VERSION` constant to the new version.
4. Update the version examples in **this file** (SKILL.md) step 2's comments to reflect the new base version.

## 2. Local install & verify

1. Run `npm link` in the project root.
2. Run `codeclaw --version` and confirm output matches the new version.
3. If verification fails, diagnose and fix before proceeding.

## 3. Git commit & push

1. Stage: `package.json`, `package-lock.json` (if changed), `src/codeclaw.js`, `.claude/skills/install/SKILL.md`.
2. Commit with message: `chore: release v<new-version>`.
3. Create a git tag: `git tag v<new-version>`.
4. Push: `git push origin main --tags`.

## 4. Publish to npm

1. Run `npm publish --dry-run` to verify package contents.
2. Load token and publish:
   ```
   source .env
   npm publish --//registry.npmjs.org/:_authToken=$NPM_TOKEN
   ```
3. Verify: `npx codeclaw@latest --version`.

## Prerequisites

- Node.js 18+.
- npm auth token with **bypass 2fa** stored in `.env` as `NPM_TOKEN`.
- `npm whoami` to verify login.

## Notes

- `npm link` creates a global symlink — code changes take effect immediately.
- The `files` field in `package.json` controls what gets published: `bin/`, `src/`, `LICENSE`, `README.md`.
- CI auto-publish: `.github/workflows/release.yml` publishes on GitHub releases (needs `NPM_TOKEN` secret).
- To uninstall locally: `npm unlink -g codeclaw`.
