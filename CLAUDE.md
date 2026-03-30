# Pikiclaw

IM-driven bridge for local coding agents. Messages arrive from Telegram, Feishu, or WeChat, pikiclaw streams them into a local agent session, and sends output, files, and screenshots back through the chat channel.

## Project Structure

```text
src/
  core/                              # Zero-business-logic infrastructure
    constants.ts                     Centralized timeouts, retries, numeric constants
    logging.ts                       Structured logging with scoped writers
    version.ts                       Package version from package.json
    process-control.ts               Restart coordination, watchdog, process tree kill
    utils.ts                         Pure utilities: env parsing, formatting, shell helpers
    config/
      user-config.ts                 ~/.pikiclaw/setting.json load/save/sync
      runtime-config.ts              Runtime agent model and effort resolution
      validation.ts                  Channel credential validation

  agent/                             # Agent abstraction layer
    index.ts                         Barrel re-export (loads drivers, exposes public API)
    types.ts                         All shared type definitions (StreamOpts, SessionInfo, …)
    utils.ts                         Agent utilities: logging, error normalization, tool summaries
    session.ts                       Session workspace CRUD, classification, export/import
    stream.ts                        CLI spawn framework, stream orchestration, detection
    driver.ts                        AgentDriver interface + pluggable registry
    skills.ts                        Project skill discovery (.pikiclaw/skills)
    auto-update.ts                   Background agent CLI version checking
    npm.ts                           NPM helpers for agent package management
    drivers/
      claude.ts                      Claude Code CLI driver
      codex.ts                       Codex CLI driver
      gemini.ts                      Gemini CLI driver
    mcp/
      bridge.ts                      Per-stream MCP bridge orchestration
      session-server.ts              Stdio MCP server for agent CLIs
      playwright-proxy.ts            Playwright MCP proxy for browser automation
      tools/
        workspace.ts                 im_list_files / im_send_file
        desktop.ts                   Desktop GUI automation via Appium
        types.ts                     MCP tool type definitions

  bot/                               # Channel-agnostic bot orchestration
    bot.ts                           Bot base class: chat state, task queue, streaming
    host.ts                          Host system data: battery, CPU, memory
    commands.ts                      Channel-agnostic command data layer
    command-ui.ts                    Interactive selection UI and action executor
    orchestration.ts                 Session/message orchestration helpers
    menu.ts                          Menu command definitions, skill mapping
    streaming.ts                     Stream preview parsing
    render-shared.ts                 Shared rendering utilities
    human-loop.ts                    Human-in-the-loop prompt state machine
    human-loop-codex.ts              Codex user-input → IM prompt mapping
    session-hub.ts                   Cross-agent session querying
    session-status.ts                Runtime session status for dashboard

  channels/                          # IM channel implementations (physically isolated)
    base.ts                          Abstract Channel transport + capability flags
    states.ts                        Channel validation caching
    telegram/
      channel.ts                     Telegram transport layer
      bot.ts                         Telegram bot orchestration
      render.ts                      Telegram message rendering
      live-preview.ts                Live preview controller
      directory.ts                   Workdir browser
    feishu/
      channel.ts                     Feishu transport layer
      bot.ts                         Feishu bot orchestration
      render.ts                      Feishu card rendering
      markdown.ts                    Feishu markdown helpers
    weixin/
      channel.ts                     WeChat transport layer
      api.ts                         WeChat API integration
      bot.ts                         WeChat bot orchestration

  dashboard/                         # Dashboard server + API
    server.ts                        Hono HTTP server
    runtime.ts                       Runtime singleton (bot ref, prefs, cache)
    platform.ts                      Platform detection helpers
    session-control.ts               Public session task control surface
    routes/
      config.ts                      Config/channel/extension API routes
      agents.ts                      Agent/model API routes
      sessions.ts                    Session/workspace API routes

  cli/                               # CLI entry points
    main.ts                          Entry point: daemon, args, setup, channel launch
    channels.ts                      Channel resolution helpers
    setup-wizard.ts                  Interactive terminal setup
    onboarding.ts                    Setup/doctor state assessment
    run.ts                           Standalone local commands

  browser-profile.ts                 Managed browser profile for Playwright
```

## Layered Architecture

Dependencies flow strictly downward:

```
cli/  →  dashboard/  →  channels/*  →  bot/  →  agent/  →  core/
```

- **core/** has zero business-logic dependencies
- **agent/** depends only on core/
- **bot/** depends on agent/ and core/
- **channels/** depend on bot/, agent/, and core/
- **dashboard/** and **cli/** sit at the top

## Key Concepts

- `bot/bot.ts` owns shared runtime state and `runStream()`
- `agent/index.ts` is the barrel entry point for all agent functionality
- `agent/session.ts` handles all session workspace CRUD and classification
- `agent/stream.ts` contains the CLI spawn framework and `doStream()` orchestration
- `agent/mcp/bridge.ts` injects session-scoped MCP tools into each stream
- Each channel in `channels/*/` is physically isolated — modifying Telegram never requires touching Feishu code
- Dashboard frontend uses react-router-dom (Vite + React SPA served as static files)

## Quick Reference: Where to Look

| Task | Files to read |
|------|---------------|
| Add a new agent driver | `agent/driver.ts`, any `agent/drivers/*.ts` as example |
| Modify session management | `agent/session.ts`, `agent/types.ts` |
| Change streaming behavior | `agent/stream.ts`, `bot/bot.ts` (runStream) |
| Add a Telegram command | `channels/telegram/bot.ts`, `bot/commands.ts` |
| Modify Feishu rendering | `channels/feishu/render.ts`, `bot/render-shared.ts` |
| Add a dashboard API route | `dashboard/routes/*.ts`, `dashboard/runtime.ts` |
| Change MCP tool behavior | `agent/mcp/tools/*.ts`, `agent/mcp/bridge.ts` |
| Modify user config schema | `core/config/user-config.ts` |

## Test Commands

```bash
npm run dev
npm test
npx vitest run test/code-agent.unit.test.ts
```

## Notes

- Persistent config is `~/.pikiclaw/setting.json`
- The dashboard is part of the normal runtime, not just a setup helper
- This machine always has a production/self-bootstrap communication path via `npx pikiclaw@latest`; do not kill, replace, or "clean up" that process when the task only concerns dev mode
- `npm run dev` is the local-only development path: it runs with `--no-daemon`, stays on the checked-out source tree, and rewrites `~/.pikiclaw/dev/dev.log` from scratch on each launch
- If a test or validation step needs a running `pikiclaw` process, use `npm run dev`
