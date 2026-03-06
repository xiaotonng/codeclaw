---
name: install
description: This skill should be used when the user asks to "install codeclaw", "build and install", "deploy locally", "update local install", or mentions installing codeclaw globally via npm link.
version: 2.0.0
---

# Install codeclaw locally

Install the codeclaw Node.js project globally via `npm link` so it's available as a `codeclaw` command system-wide.

## Workflow

1. Run `npm link` in the project root to create a global symlink.
2. Verify the installation by running `codeclaw --version`.
3. Report the installed version to the user.

## Notes

- `npm link` creates a global symlink pointing to the project directory, so any code changes take effect immediately without reinstalling.
- Requires Node.js 18+.
- To uninstall: `npm unlink -g codeclaw`.
- Alternative: users can always run directly with `npx codeclaw` without installing.
