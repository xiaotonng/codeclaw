# Testing Guide

`pikiclaw` uses Vitest for both unit tests and live integration/E2E tests.

## Test Commands

```sh
# Manual runtime / startup validation (preferred for anything that launches pikiclaw)
npm run dev

# Unit tests plus top-level direct-handler tests
npm test

# Watch mode
npm run test:watch

# Live E2E suite under test/e2e/
npm run test:e2e

# One file
npx vitest run test/channel-feishu.unit.test.ts
```

## Startup Rule

If a test or validation step needs to launch `pikiclaw` itself, use `npm run dev`.

- `npm run dev` is the local-only startup path
- It runs with `--no-daemon`, so it stays on the checked-out source tree
- It rewrites `~/.pikiclaw/dev/dev.log` on each launch
- Do not kill or reuse the long-lived production/self-bootstrap `npx pikiclaw@latest` process on this machine as part of dev testing

The one deliberate exception is the daemon lifecycle test `test/e2e/restart.e2e.test.ts`. That test exists specifically to verify restart behavior, but it must still stay on the local source chain and never point at the production `npx pikiclaw@latest` runtime.

## Test Split

### `npm test`

Runs `vitest.config.ts`, which excludes only `test/e2e/**`.

That means it includes:

- regular unit tests
- direct-handler tests like `test/pikiclaw.e2e.test.ts`

### `npm run test:e2e`

Runs `vitest.e2e.config.ts` against `test/e2e/**`.

These are the real network / real CLI / real environment tests.

## Environment Setup

For live tests, load `.env` first:

```sh
set -a && source .env && set +a
```

Useful environment variables:

| Variable | Used by |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram channel and bot live tests |
| `TELEGRAM_TEST_CHAT_ID` | Telegram live test target chat |
| `TELEGRAM_INTERACTIVE` | Interactive Telegram bot E2E flows |
| `FEISHU_APP_ID` | Feishu runtime setup when testing locally |
| `FEISHU_APP_SECRET` | Feishu runtime setup when testing locally |

Agent live tests also require the corresponding CLI to be installed and authenticated.

## Current Test Files

### Unit and local tests

| File | Scope |
|---|---|
| `test/bot-telegram-ui.unit.test.ts` | Telegram command UI and rendering behavior |
| `test/bot-telegram.unit.test.ts` | Telegram bot orchestration |
| `test/bot.unit.test.ts` | Shared bot helpers and state |
| `test/channel-feishu.unit.test.ts` | Feishu transport behavior |
| `test/channel-telegram.unit.test.ts` | Telegram transport behavior |
| `test/code-agent.unit.test.ts` | Shared agent layer and stream handling |
| `test/dashboard-api.unit.test.ts` | Dashboard API behavior |
| `test/driver-claude.unit.test.ts` | Claude-specific driver behavior |
| `test/mcp-bridge.unit.test.ts` | MCP bridge path resolution and validation |
| `test/process-control.unit.test.ts` | Restart and process management |
| `test/project-skills.unit.test.ts` | Project skill discovery and compatibility |
| `test/setup-wizard.unit.test.ts` | Terminal setup wizard |
| `test/pikiclaw.e2e.test.ts` | Direct command-handler tests against real bot logic, outside `test/e2e/` |

### Live E2E tests

Startup / runtime E2E:

| File / Flow | Scope |
|---|---|
| `npm run dev` + real Telegram/Feishu interaction | Full local runtime startup, dashboard, channel connection, and message flow |
| `test/e2e/restart.e2e.test.ts` | Local daemon/restart lifecycle only; intentionally exercises process replacement, never the production chain |

In-process / non-startup E2E:

| File | Scope |
|---|---|
| `test/e2e/bot-telegram.e2e.test.ts` | Full Telegram bot flows with a real bot and real agent |
| `test/e2e/channel-telegram.e2e.test.ts` | Telegram transport against real Bot API |
| `test/e2e/code-agent.e2e.test.ts` | Real CLI streams for Claude/Codex |
| `test/e2e/getSessions.e2e.test.ts` | Reads real local session stores |
| `test/e2e/list-models.e2e.test.ts` | Live model discovery |
| `test/e2e/switch-workdir.e2e.test.ts` | Real workdir switching against live agents |

## Common Runs

```sh
# Local startup validation with fresh dev log
npm run dev

# One unit file
npx vitest run test/mcp-bridge.unit.test.ts

# One live Telegram transport file
set -a && source .env && set +a && npx vitest run test/e2e/channel-telegram.e2e.test.ts

# One live bot file
set -a && source .env && set +a && npx vitest run test/e2e/bot-telegram.e2e.test.ts

# Interactive Telegram scenarios
set -a && source .env && set +a && TELEGRAM_INTERACTIVE=1 \
  npx vitest run test/e2e/bot-telegram.e2e.test.ts

# One live agent file
npx vitest run test/e2e/code-agent.e2e.test.ts
```

## Testing Rules

### Unit tests

- Mocks are allowed
- Prefer focused coverage around one module or behavior
- Good fit for parsers, renderers, config logic, and transport branching

### E2E tests

- Do not mock the external system being tested
- Use real CLIs, real API calls, and real files where applicable
- Skip cleanly when the required runtime is unavailable

Examples:

- Telegram E2E should hit the real Telegram Bot API
- code-agent E2E should hit the real `claude` / `codex` CLI
- session-listing E2E should read real session stores on disk

## Suggested Workflow

1. Run `npm test`
2. Run the specific unit file for the area you changed
3. If your change touches channels, drivers, or process control, run the matching live test when possible
4. If your change affects docs only, a build or test run is optional but still useful for quick sanity

## Notes

- `test/support/` contains shared helpers for Telegram and stream assertions
- `npm run test:e2e` is broader than `npm test` and may consume tokens or send real messages
- Some root-level files still use `*.e2e.test.ts` naming even though they are not under `test/e2e/`
- For any manual or IM-driven end-to-end validation that requires a running bot, start the local runtime with `npm run dev` and inspect `~/.pikiclaw/dev/dev.log`
- `test/e2e/restart.e2e.test.ts` is the only automated test that should intentionally exercise daemon behavior; all other startup-style validation should stay on the local dev path
