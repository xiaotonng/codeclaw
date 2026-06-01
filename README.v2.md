<div align="center">

# 🐾 pikiclaw

### Put the world's smartest AI agents in your pocket.

**The open orchestrator for driving a _swarm_ of coding agents — any agent, any model, any tool — from whatever screen is closest: your IM, your browser, your phone.**

```bash
npx pikiclaw@latest
```

<p>
<a href="https://www.npmjs.com/package/pikiclaw"><img src="https://img.shields.io/npm/v/pikiclaw?label=npm&color=cb3837" alt="npm"></a>
<a href="https://www.npmjs.com/package/pikiclaw"><img src="https://img.shields.io/npm/dm/pikiclaw?label=downloads&color=success" alt="npm downloads"></a>
<a href="https://github.com/xiaotonng/pikiclaw/stargazers"><img src="https://img.shields.io/github/stars/xiaotonng/pikiclaw?style=flat&color=yellow" alt="GitHub stars"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
<a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A520-green.svg" alt="Node 20+"></a>
</p>

<p>
<b>English</b> | <a href="README.zh-CN.md">简体中文</a>
</p>

<img src="docs/promo-orchestrator.png" alt="pikiclaw — the open Agent orchestrator" width="820">

</div>

---

## Drive your agents from your phone

> Ask from Telegram. The agent works on your machine. Results come back to the chat.

<p align="center"><img src="docs/promo-demo.gif" alt="Ask from Telegram, agent works locally, result returns to chat" width="780"></p>

pikiclaw turns **whatever messenger you already have open** into a control surface for the agents running on your own computer. Kick off a refactor, close the laptop, steer it from a coffee shop. Same agents, same files, streamed to your pocket.

---

## What is pikiclaw?

The agents themselves are becoming extraordinary — they plan, spawn sub-agents, run their own workflows. **pikiclaw doesn't try to out-think them. It sets them free.**

It's a deliberately thin layer that wraps best-in-class agents (Claude Code · Codex · Gemini · Hermes · …) and gives them the three things they can't give themselves:

- **Reach** — drive them from any messenger or browser, not just a terminal on one machine.
- **Freedom** — run them on any model: frontier, Chinese domestic, or fully local.
- **Parallelism** — a whole swarm at once, each on its own workspace, steered by one operator.

We never rewrite the brain. When an agent ships a new capability — a workflow engine, a sharper planner, a new tool — your pikiclaw sessions inherit it **the same day, for free**. Our job is everything *around* the agent: the terminals, the models, the tools, and the orchestration across them. The orchestrator is the product — and it's **built with itself**.

> **Thin on purpose.** As the frontier agents get smarter, pikiclaw gets stronger — for free. We never race the brain; we widen its reach.

```
            ┌─────────────────────────────────────────────┐
 Terminals  │  Telegram · Feishu · WeChat · Slack · Discord │  ← drive from anywhere
            │  DingTalk · WeCom · Web Dashboard · CLI       │
            ├─────────────────────────────────────────────┤
 Agents     │  Claude Code · Codex · Gemini · Hermes (ACP)  │  ← swap the brain
            ├─────────────────────────────────────────────┤
 Models     │  Frontier · Chinese domestic · local · proxy  │  ← run it on anything
            ├─────────────────────────────────────────────┤
 Tools      │  Skills · MCP · CLIs · browser · macOS GUI    │  ← merged into every session
            └─────────────────────────────────────────────┘
                   ▲ one orchestrator core routes it all ▲
```

---

## Why people use it

🐝 **A swarm of _different_ agents.** A single agent already fans out its own sub-agents inside one task — pikiclaw runs _different_ agents across _different_ tasks. Claude in pane 1, Codex in pane 2, Gemini in pane 3, each on its own workspace, one operator steering them all.

📱 **Walk-away coding.** Start a long task, then watch and steer it from your phone over Telegram/Feishu/Slack. It runs locally and streams back.

🧠 **Bring your own brain.** Frontier (Claude · GPT · Gemini), Chinese domestic (DeepSeek · Doubao · MiMo · MiniMax · Qwen), local (Ollama / mlx-lm), or any OpenAI-compatible proxy. Run Claude Code *on top of DeepSeek or a local model* without touching its config.

🖥️ **Computer use, controlled by you.** Hand the agent a real browser (Playwright) and the macOS desktop (Peekaboo) — it can see the screen, click, type, and drive apps while you watch from your phone.

🧩 **One toolkit, everywhere.** Skills, MCP servers, and CLIs configured once, auto-injected into every session, across every terminal.

♻️ **Self-bootstrapped.** The most honest test of an orchestrator is whether it can build itself. This one does — every commit and release.

---

## Quick Start

**Prerequisites:** Node.js 20+, and at least one agent CLI installed & authenticated — [`claude`](https://docs.anthropic.com/en/docs/claude-code), [`codex`](https://github.com/openai/codex), [`gemini`](https://github.com/google-gemini/gemini-cli), or `hermes`.

```bash
cd your-workspace
npx pikiclaw@latest
```

That's it — the **Web Dashboard** opens at `http://localhost:3939`. From there you drive sessions, connect IM channels, pick agents and models, and install skills & MCP servers. Everything is one click away.

<details>
<summary><b>Prefer the terminal, or running on a server?</b></summary>

```bash
npx pikiclaw@latest --setup     # interactive terminal setup wizard
npx pikiclaw@latest --doctor    # environment health check

# Docker (multi-arch, bakes in claude-code + codex + gemini-cli)
docker run -d --name pikiclaw -p 3939:3939 \
  -e TELEGRAM_BOT_TOKEN=... \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v pikiclaw-config:/home/piki/.pikiclaw \
  -v pikiclaw-workspace:/workspace \
  ghcr.io/xiaotonng/pikiclaw:latest
```

On a headless box you can also point the agent at a **remote browser** over CDP (`PIKICLAW_BROWSER_CDP_URL`) instead of a local Chrome. Full reference: [docs/DOCKER.md](docs/DOCKER.md).

</details>

---

## How is this different?

A small, healthy ecosystem now connects coding agents to your chat apps — [cc-connect](https://github.com/chenhg5/cc-connect) is the closest peer, and it's genuinely good. We're not here to win a feature-checklist war: most of these tools (pikiclaw included) already do multi-agent, multi-channel, parallel sessions, a web dashboard, and model switching. That's table stakes now — and we'd rather be honest about it than invent a column where we win.

| | **pikiclaw** | **cc-connect & peers** |
|---|:---:|:---:|
| Multiple agents (Claude · Codex · Gemini · …) | ✅ | ✅ |
| Many IM channels **+** Web Dashboard | ✅ | ✅ |
| Parallel sessions | ✅ | ✅ |
| Model / provider switching | ✅ | ✅ |
| Skills & MCP | ✅ | ✅ |
| **Computer-use — a real browser _and_ the macOS desktop** | ✅ | ❌ |

Two things we actually bet on, neither of which a checklist can capture:

- **We hand the agent a body.** Built-in computer-use lets it drive a real browser (Playwright) and the macOS desktop (Peekaboo) — see the screen, click, type, run apps — not just read and write files.
- **Execution is the moat.** How the swarm *feels* in one cockpit, how cleanly it streams and lets you steer mid-task, how little it makes you think about plumbing. That's why we lead with the demo, not the table — and why pikiclaw is built with itself, every commit and release.

Everything else, we don't fight for — we inherit it. As the agents and the chat platforms get better, so does pikiclaw, for free.

---

## The Web Dashboard

> Multi-pane workspace — session list, live conversation, tool-use traces, file/image attachments, queued-task chips, one unified composer. 1 / 2 / 3 / 6 pane layouts · light & dark · EN / 中文.

<p align="center"><img src="docs/promo-dashboard-workspace.png" alt="Web Dashboard workspace" width="780"></p>

<details>
<summary><b>More screens: IM · Agents · Models · Extensions · Permissions · System</b></summary>

> **IM** — connection status & setup for Telegram, Feishu, WeChat, Slack, Discord, DingTalk, WeCom.

<img src="docs/promo-dashboard-im.png" alt="IM Access" width="780">

> **Agents** — manage agent CLIs, set the default, configure per-agent model & reasoning effort, bind a Profile to run an agent on a non-native model.

<img src="docs/promo-dashboard-agents.png" alt="Agents" width="780">

> **Extensions** — global MCP servers, community skills, and built-in computer-use (headless browser + macOS Peekaboo). Add servers via stdio, HTTP, or OAuth 2.1 with Dynamic Client Registration.

<img src="docs/promo-dashboard-extensions.png" alt="Extensions" width="780">

> **Permissions** — macOS Accessibility, Screen Recording & Disk Access, handled inline.

<img src="docs/promo-dashboard-permissions.png" alt="Permissions" width="780">

> **System** — working directory plus real-time CPU, memory & disk.

<img src="docs/promo-dashboard-system.png" alt="System Info" width="780">

</details>

---

<details>
<summary><b>📋 Full feature list (Terminal · Agent · Model · Tool)</b></summary>

### Terminal Layer
- **7 native IM channels** — Telegram, Feishu, WeChat, Slack, Discord, DingTalk, WeCom. Run one or all; each is code-isolated, so adding a new one touches nothing else.
- **Web Dashboard** — same conversational flow, tool-use tracing, and streaming as IM. Multi-pane (1/2/3/6), light/dark, full EN/中文.
- **Live streaming** — messages update in place; thinking traces, tool calls, and plans surface as collapsible cards; images & files stream back in real time.
- **Queue & steer from one composer** — send while a stream runs; new messages line up as chips you can preview, recall, or hand-steer; one click stops the turn and drains the queue.

### Agent Layer
- **Official CLIs as drivers** — Claude Code, Codex, Gemini, Hermes (via ACP). We don't rewrite the agent core, so you inherit upstream capabilities and Day-0 updates.
- **Pluggable registry** — the only contract is `src/agent/driver.ts`; any CLI- or ACP-based agent drops in.
- **Per-session switching** — swap the brain mid-task; the same history follows you.
- **Steer & interrupt** — jump a queued message to the front, or stop everything in one click.
- **Codex human-in-the-loop** — when Codex asks a question, it's forwarded to your terminal; reply inline and it resumes.
- **Persistent goals** — `/goal <objective>` keeps a session working until it self-audits completion (Codex native budget/pause-resume · Claude Stop-hook with a Haiku judge · portable loop for others).
- **Image generation, surfaced end-to-end** — generated images arrive as real attachments, not base64, with a click-to-reveal prompt.

### Model Layer
- **Frontier + domestic + local + proxies** — Claude · GPT/Codex · Gemini · DeepSeek · Doubao · MiMo · MiniMax · Qwen · Ollama · mlx-lm · OpenRouter · any OpenAI-compatible endpoint.
- **Providers & Profiles vault** — API keys are sealed into the OS keychain (with a sealed-inline / env / shell-command fallback chain), validated against a read-only `models.dev` catalog, and injected per-agent at spawn time.
- **Local models, zero-config** — detected Ollama / mlx-lm backends auto-attach, with install hints and RAM-headroom warnings.
- **Per-session model & effort** — switch live via Dashboard, `/models`, or `/mode`.
- **Deep injection** — run Claude Code on DeepSeek, Doubao, or a local model without editing the upstream client's config.

### Tool Layer
- **Skills** — project skills in `.pikiclaw/skills/*/SKILL.md` (legacy `.claude/commands/*.md` still works); one-click install from any GitHub `owner/repo` or a curated set. Trigger anywhere with `/skills` and `/sk_<name>`.
- **MCP ecosystem** — browse the MCP Registry; add stdio/HTTP servers; OAuth 2.1 + Dynamic Client Registration; real-handshake health checks. Plus two built-in computer-use servers: `pikiclaw-browser` (Chrome via Playwright) and `peekaboo` (macOS GUI).
- **CLI tools** — auto-detects versions & auth for gh, brew, npm, uv, …; OAuth-web login routes through the agent's normal tool surface.
- **Session-scoped bridge** — `im_*`, `goal_*`, and computer-use tools auto-injected into every session.
- **Three-way merge** — `global < workspace < built-in`, resolved silently per session.

### Runtime
- **Dedicated session workspaces** — each session gets an isolated dir; uploads & generated assets land there.
- **Computer-use (browser)** — `pikiclaw-browser` wraps `@playwright/mcp` with a process-level supervisor and a shared, persistent Chrome profile; can also attach to a **remote browser over CDP** for servers/Docker.
- **Computer-use (macOS)** — `peekaboo` exposes `see`/`click`/`type`/`window`/`menu`/`app`/`dock` plus a goal-directed sub-agent (needs Accessibility + Screen Recording).
- **Hardened for long tasks** — sleep prevention, watchdog, auto-restart, daemon mode, channel supervisor; restart is blocked while tasks run, so a hot reload never kills a marathon job.

</details>

<details>
<summary><b>⌨️ Command reference</b></summary>

| Command | Description |
|---|---|
| `/start` | Entry info, active agent, working directory |
| `/sessions` | View, switch, or create sessions |
| `/agents` | Switch the active agent |
| `/models` | Switch model or reasoning effort |
| `/mode` | Toggle plan mode / reasoning effort |
| `/switch` · `/workspaces` | Change or pick a working directory |
| `/goal` | Set or inspect a long-running, self-terminating goal |
| `/stop` | Force-stop the current session |
| `/status` · `/host` | Runtime status / host CPU·memory·disk·battery |
| `/skills` · `/sk_<name>` | Browse / run a project skill |
| `/ext` | Extensions overview |
| `/restart` | Restart the bot service |

*Plain text without a slash goes straight to the current agent.*

</details>

<details>
<summary><b>⚙️ Configuration</b></summary>

- **Persistent config:** `~/.pikiclaw/setting.json` (channels, agents, workspaces, MCP extensions, Profiles). **API keys are not stored here** — they're sealed into the OS keychain when available.
- The **Dashboard** is the primary config UI; `--setup` and `--doctor` cover headless/CLI-first users.
- Global MCP extensions live under `extensions.mcp`; workspace MCP follows `.mcp.json` in the project root.
- Project skills load from `.pikiclaw/skills/*/SKILL.md` (legacy `.claude/commands/*.md` supported).
- **Computer-use toggles** (Extensions dashboard): `browserEnabled` (managed Chrome), `peekabooEnabled` (macOS desktop — requires Accessibility + Screen Recording).

</details>

---

## Roadmap

**SupporterAgent** — a meta-agent layered on top of the stack that owns a complex objective end-to-end: decompose, schedule the right sub-agents on the right models with the right tools, watch their streams, and step in when one stalls or drifts — so pikiclaw can drive long-horizon, multi-agent work without a human babysitting every turn.

---

## Development & Contributing

```bash
git clone https://github.com/xiaotonng/pikiclaw.git
cd pikiclaw && npm install && npm run build && npm test
npm run dev    # local dev server (logs to ~/.pikiclaw/dev/dev.log)
```

Every layer is built to be extended — a new terminal, agent driver, model wrapper, or MCP tool is a first-class contribution. Start with the **[Contributing Guide](CONTRIBUTING.md)** and the [`good first issue`](https://github.com/xiaotonng/pikiclaw/labels/good%20first%20issue) label. Deep dives: [ARCHITECTURE.md](ARCHITECTURE.md) · [INTEGRATION.md](INTEGRATION.md) · [TESTING.md](TESTING.md).

| Extend | Where |
|---|---|
| A new agent driver (CLI or ACP) | `src/agent/driver.ts`, `src/agent/drivers/*.ts`, `src/agent/acp-client.ts` |
| A new terminal / IM channel | `src/channels/base.ts`, `src/channels/*/` |
| A new model provider / injection rule | `src/model/`, `src/model/injector.ts` |
| Dashboard backend API | `src/dashboard/routes/*.ts` |
| Session-scoped MCP tools | `src/agent/mcp/tools/*.ts`, `src/agent/mcp/bridge.ts` |
| Recommended MCP / CLI / skills | `src/catalog/*.ts` |

---

## Star History

<a href="https://www.star-history.com/#xiaotonng/pikiclaw&Date">
  <img src="https://api.star-history.com/svg?repos=xiaotonng/pikiclaw&type=Date" alt="Star History" width="640">
</a>

---

## License

[MIT](LICENSE) — Built in the open. Use it, fork it, plug in your own layers.
