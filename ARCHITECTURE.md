# Architecture

## File Structure

```
src/
  cli.ts                 CLI entry point: arg parsing, env mapping, channel dispatch
  bot.ts                 Shared bot base: config, state, data methods, streaming, keep-alive
  bot-menu.ts            Telegram menu composition: welcome copy + skill command mapping
  bot-streaming.ts       Stream preview summarizers: prompt cleanup, plan/activity summaries
  bot-telegram.ts        Telegram bot orchestration: commands, callbacks, lifecycle
  bot-telegram-render.ts Telegram HTML/render helpers: markdown, status/final reply formatting
  bot-telegram-directory.ts Telegram workdir browser state + inline keyboards
  bot-telegram-live-preview.ts Telegram live preview controller: throttled edits + typing pulses
  channel-base.ts        Transport abstraction: lifecycle + outgoing primitives + capability helpers
  channel-telegram.ts    Telegram transport: API, polling, file download, message dispatch
  code-agent.ts          AI agent abstraction: spawn claude/codex CLI, parse JSON stream
```

## Layering

```
┌──────────────────────────────────────────────────────────────┐
│  cli.ts                                                      │
│  Parse args → resolve channel → map env → dispatch bot       │
├──────────────────────────────────────────────────────────────┤
│  bot.ts  (shared base, channel-agnostic)                     │
│  ├ Config         workdir, agent, model, timeout             │
│  ├ State          chats, activeTasks, stats                  │
│  ├ Data methods   getStatusData(), getHostData()             │
│  ├ Actions        switchWorkdir(), runStream()               │
│  ├ Data access    fetchSessions(), fetchAgents()             │
│  ├ Session state  resetChatConversation(), adoptSession()    │
│  ├ Keep-alive     caffeinate / systemd-inhibit               │
│  └ Helpers        fmtTokens, fmtUptime, thinkLabel, ...     │
├──────────────────────────────────────────────────────────────┤
│  bot-telegram.ts  (Telegram orchestration, extends Bot)      │
│  ├ Commands       cmdStart/Status/Host/Sessions/Switch/Agents│
│  ├ Callbacks      sw:/sess:/ag:/mod: routing                 │
│  ├ Artifacts      upload after final reply                   │
│  └ Lifecycle      run() → connect, drain, menu, poll, signal│
├──────────────────────────────────────────────────────────────┤
│  bot-telegram-render.ts  (Telegram rendering helpers)        │
│  ├ HTML           escapeHtml(), mdToTgHtml()                 │
│  ├ Status/menu    formatMenuLines(), formatProviderUsageLines│
│  ├ Preview        buildInitialPreviewHtml(), buildStreamPreviewHtml() │
│  └ Final reply    buildFinalReplyRender()                    │
├──────────────────────────────────────────────────────────────┤
│  bot-telegram-directory.ts  (Telegram workdir browser)       │
│  ├ Registry       compact callback-data path registry        │
│  ├ View           buildSwitchWorkdirView()                   │
│  └ Lookup         resolveRegisteredPath()                    │
├──────────────────────────────────────────────────────────────┤
│  bot-telegram-live-preview.ts  (stream UI controller)        │
│  ├ Timing         throttle edits + stalled heartbeats        │
│  ├ Feedback       typing pulse lifecycle                     │
│  ├ State          latest text / thinking / activity / plan   │
│  └ Flush          settle() / dispose()                       │
├──────────────────────────────────────────────────────────────┤
│  channel-base.ts  (transport abstraction)                    │
│  ├ Channel        connect / listen / disconnect              │
│  ├ Outgoing       send / editMessage / deleteMessage         │
│  └ Helpers        splitText, sleep, supportsChannelCapability│
├──────────────────────────────────────────────────────────────┤
│  channel-telegram.ts  (Telegram transport, extends Channel)  │
│  ├ Telegram API   getMe, getUpdates, sendMessage, ...        │
│  ├ Dispatch       command/message/callback routing to hooks  │
│  ├ File download  photo/document → local path                │
│  ├ File upload    sendPhoto/sendDocument/sendFile routing    │
│  ├ Group filter   @mention / reply-to-bot detection          │
│  └ Smart behavior parseMode fallback, message splitting      │
├──────────────────────────────────────────────────────────────┤
│  code-agent.ts  (AI agent abstraction)                       │
│  ├ doStream()     spawn claude/codex CLI, parse JSONL        │
│  ├ getSessions()  list local sessions by engine + workdir    │
│  ├ getUsage()     inspect local Codex/Claude usage telemetry │
│  └ listAgents()   detect installed CLIs + versions           │
└──────────────────────────────────────────────────────────────┘
```

## Design Principles

**Data / render split** — bot.ts provides data methods (`getStatusData`, `getHostData`,
`fetchSessions`, `fetchAgents`), while Telegram HTML and preview assembly live in
`bot-telegram-render.ts`. Adding a new IM means writing bot-xxx.ts plus renderer/view
helpers for that channel, not re-embedding shared state logic.

**Channel = transport only** — channel-telegram.ts handles Telegram API communication
(polling, sending, file download/upload routing, message dispatch). It knows nothing
about commands, sessions, or agents. It is independently testable.

**Bot = business logic** — bot.ts holds shared state and session mutation helpers.
bot-telegram.ts is now primarily orchestration: command/callback routing, channel calls,
and composition of smaller Telegram-specific helpers.

**Stream UI controller** — live preview timing, typing pulses, and throttled edits are
stateful UI concerns, so they live in `bot-telegram-live-preview.ts` instead of being
inlined inside `handleMessage()`.

**Env var scoping** — bot.ts only reads channel-agnostic env vars (`CODECLAW_*`).
Channel-specific env vars (`TELEGRAM_*`, `FEISHU_*`) are read in the corresponding
bot-xxx.ts constructor.

## Adding a New IM Channel

1. Create `channel-xxx.ts` extending `Channel` from channel-base.ts
2. Create `bot-xxx.ts` extending `Bot` from bot.ts
   - Render commands using `this.getStatusData()`, `this.getHostData()`, etc.
   - Implement channel-specific interaction (cards, buttons, menus)
   - Read channel-specific env vars in constructor
3. Add dispatch case in `cli.ts`

## Bot Commands

| Command     | Description                          |
|-------------|--------------------------------------|
| `/start`    | Welcome + command list               |
| `/sessions` | List / switch sessions (inline keys) |
| `/agents`   | List / switch AI agents              |
| `/status`   | Bot status, uptime, provider usage, token usage |
| `/host`     | Host machine info (CPU, memory, disk, battery) |
| `/switch`   | Browse and change working directory   |
| `/restart`  | Restart with latest version via non-interactive `npx --yes` |

Direct messages (no command prefix) are forwarded to the current AI agent.

## Test Files

| File                              | Tests                              | API calls? |
|-----------------------------------|------------------------------------|------------|
| `test/e2e/codeclaw.e2e.test.ts`       | Bot commands + callbacks (real fs)  | No         |
| `test/e2e/channel-telegram.e2e.test.ts` | Telegram channel (real API)       | Yes        |
| `test/channel-telegram.unit.test.ts` | Telegram channel (mocked)        | No         |
| `test/e2e/code-agent.e2e.test.ts`     | Real claude/codex CLI              | Yes        |
| `test/code-agent.unit.test.ts`    | Stream parsing (fake scripts)      | No         |
| `test/e2e/restart.e2e.test.ts`        | Restart: PID change (standalone)   | Yes        |
