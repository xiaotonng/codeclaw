# Pikiclaw

IM-driven bridge for local coding agents. Users talk in Telegram or Feishu, pikiclaw runs the task on the local machine, streams progress back, and returns files or screenshots when needed.

## Project Structure

```text
src/
  cli.ts                        Entry point: daemon mode, dashboard, channel launch
  cli-channels.ts               Channel resolution from config/env

  bot.ts                        Shared bot runtime and session state
  bot-commands.ts               Shared command data layer
  bot-command-ui.ts             Shared command selection views and action execution
  bot-handler.ts                Generic message pipeline
  bot-menu.ts                   Menu commands and skill command naming
  bot-streaming.ts              Stream preview parsing

  bot-telegram.ts               Telegram orchestration
  bot-telegram-render.ts        Telegram rendering
  bot-telegram-live-preview.ts  Channel-agnostic live preview controller
  bot-telegram-directory.ts     Telegram workdir browser helpers

  bot-feishu.ts                 Feishu orchestration
  bot-feishu-render.ts          Feishu rendering

  channel-base.ts               Abstract transport + capabilities
  channel-telegram.ts           Telegram transport
  channel-feishu.ts             Feishu transport

  agent-driver.ts               AgentDriver interface and registry
  code-agent.ts                 Shared agent layer and session workspace management
  driver-claude.ts              Claude driver
  driver-codex.ts               Codex driver
  driver-gemini.ts              Gemini driver

  mcp-bridge.ts                 Per-stream MCP bridge
  mcp-session-server.ts         Stdio MCP server launched by agent CLIs
  tools/
    workspace.ts                im_list_files / im_send_file
    capture.ts                  take_screenshot
    gui.ts                      Reserved GUI tool module
    types.ts                    MCP tool types

  dashboard.ts                  Web dashboard server and API
  dashboard-ui.ts               Dashboard frontend bundle
  session-status.ts             Runtime session status helpers
  channel-states.ts             Channel validation cache
  config-validation.ts          Credential validation helpers

  user-config.ts                ~/.pikiclaw/setting.json persistence
  onboarding.ts                 Setup state and doctor output
  setup-wizard.ts               Interactive terminal wizard
  process-control.ts            Restart/watchdog/process utilities
  run.ts                        Standalone local inspection commands
```

## Architecture Layers

```text
cli.ts
  -> dashboard.ts + bot-{platform}.ts
  -> bot.ts
  -> code-agent.ts
  -> driver registry

bot-{platform}.ts
  -> bot-commands.ts
  -> bot-command-ui.ts
  -> bot-handler.ts
  -> channel-{platform}.ts
```

- `bot.ts` is the shared runtime: workdir, agent/model config, sessions, `runStream()`, keep-alive.
- `bot-commands.ts` returns structured command data with no rendering.
- `bot-command-ui.ts` builds shared UI models for sessions, agents, models, and skills.
- `bot-handler.ts` runs the generic stream lifecycle, including MCP-backed file send callbacks.
- `code-agent.ts` manages session workspaces, staged files, skills, MCP bridge setup, and driver dispatch.
- `agent-driver.ts` keeps agent integration pluggable.

## Current Capabilities

- Channels: Telegram and Feishu
- Agents: Claude Code, Codex CLI, Gemini CLI
- Project skills: `.pikiclaw/skills` plus `.claude/commands` compatibility
- Session-scoped MCP tools:
  - `im_list_files`
  - `im_send_file`
  - `take_screenshot`
- Dashboard-based setup and monitoring

## Important Notes

- Persistent config lives in `~/.pikiclaw/setting.json`
- The dashboard is the main config surface; env vars still work, but docs and code assume config-first
- MCP tools are currently injected per stream, not as a top-level global tool registry
- `src/tools/gui.ts` is a placeholder extension point and does not yet expose real GUI tools
- The machine always has a production/self-bootstrap communication path via `npx pikiclaw@latest`; do not kill, replace, or "clean up" that chain when working on dev-only changes
- `npm run dev` is a local-only development path: it runs with `--no-daemon`, stays on the checked-out source tree, and writes a fresh log file to `~/.pikiclaw/dev/dev.log` on each launch

## Testing Rules

- Unit tests: `npm test`
- Live E2E: `npm run test:e2e`
- E2E tests should not mock the external system being tested
- If a test or validation step needs to launch `pikiclaw`, use `npm run dev`; that is the only approved local startup path for dev/test work on this machine
- The one explicit daemon exception is `test/e2e/restart.e2e.test.ts`; it still must stay on the local source chain and never use the production `npx pikiclaw@latest` runtime

## Common Commands

```bash
npm run dev
npm run build
npm test
npm run test:e2e
npx pikiclaw@latest --doctor
npx pikiclaw@latest --setup
```

When validating `npm run dev`, only observe the dev chain. Do not touch the long-lived production `npx pikiclaw@latest` process that keeps IM connectivity alive on this machine.
