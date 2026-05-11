<div align="center">

# pikiclaw

## Put the world's smartest AI agents in your pocket.

##### *The open Agent orchestrator for the era when creators no longer need to read code.*

*Plug in any agent (Claude · Codex · Gemini · Hermes · …), any model (Claude · GPT · Gemini · DeepSeek · Doubao · MiMo · MiniMax · OpenRouter · or any third-party proxy), and any tool (Skills · MCP · CLI). Drive them seamlessly from your favorite terminal—whether it's an IM, Web Dashboard, or future interfaces. pikiclaw is built using pikiclaw.*

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

<img src="docs/workspace.png" alt="Workspace" width="780">

</div>

---

## What is pikiclaw?

**Most "AI dev tools" settle for a narrow slice of the pie—binding you to a single IDE, a specific agent, or a closed model ecosystem.** pikiclaw is built on a fundamentally different premise: the next era of software creation won't be confined to a single code editor. It happens within an **Orchestrator** that empowers a creator to drive a *swarm* of agents—in parallel, from one console—running on the best models available, through whichever terminal is closest at hand. And you might never need to open a code file.

The product is the orchestrator itself. Everything else simply plugs in. **And what's cooler is that this orchestrator is entirely self-bootstrapped**—pikiclaw is what we use to build pikiclaw.

```text
   Terminal Layer    Telegram · Feishu · WeChat · Slack · Discord · DingTalk · WeCom · Web Dashboard
                              \__________________________|__________________________/
                                                         v
                                          ┌──────────────────────────────┐
                                          │     pikiclaw orchestrator    │
                                          └──────────────────────────────┘
                                                         |
                ┌────────────────────────────────────────┼────────────────────────────────────────┐
                v                                        v                                        v
           Agent Layer                              Model Layer                               Tool Layer
   Claude Code · Codex · Gemini · Hermes    Claude · GPT · Gemini · DeepSeek           Skills · MCP · CLI
   (driver registry · ACP · any agent)      Doubao · MiMo · MiniMax · OpenRouter       (global × workspace)
                                            · any OpenAI-compatible proxy · …
                                                         |
                                                         v
                                                   Your Machine
```

- **Terminal Layer** — Telegram, Feishu, WeChat, Slack, Discord, DingTalk, WeCom, and the Web Dashboard are all first-class, co-equal entry points. New terminals plug right in.
- **Agent Layer** — We use the official Claude Code, Codex, Gemini, and Hermes CLIs as underlying drivers. Hermes communicates via ACP (Agent Client Protocol); our flexible registry can accommodate virtually any agent.
- **Model Layer** — Access Claude, GPT, Gemini, leading Chinese domestic models (DeepSeek, Doubao, MiMo, MiniMax), plus OpenRouter and any OpenAI-compatible proxy. Providers and Profiles are treated as a first-class layer with their own credential vault, a read-only models.dev catalog, and per-agent environment injection.
- **Tool Layer** — Skills, MCP servers, and CLI tools are intelligently merged across global and workspace scopes, automatically injected into every session.

---

## Built with Itself

> The most credible test of an Agent orchestrator is whether it can build itself. pikiclaw can. We use pikiclaw to develop, test, release, and operate pikiclaw—driving every commit and every release.

A typical day of development inside pikiclaw:

- A Claude Code session in pane 1 implements a new dashboard route.
- A Codex session in pane 2 writes the matching unit tests against the same workspace.
- A Gemini session in pane 3 reviews the diffs and drafts the changelog.
- Meanwhile, a background skill (`/sk_promote`) sweeps GitHub for relevant issues and automatically drafts replies in a fourth thread.
- All four streams run entirely in parallel; a single human steers them all from a phone in a coffee shop.

The orchestrator is the product. It also happens to be the ultimate IDE in which the orchestrator itself is built.

---

## A Swarm by Default

Most "AI dev tools" assume a 1:1:1 ratio: one user, one agent, one task at a time. pikiclaw assumes the exact opposite: **N agents, N windows, one operator, one unified toolkit.**

- **N Parallel Sessions** — Every dashboard pane represents an independent agent stream tied to an independent session workspace. Add IM threads, and you scale effortlessly.
- **Mix-and-Match Agents** — Run Claude Code in pane 1, Codex in pane 2, and Gemini in pane 3, all working simultaneously on different repositories or workspaces.
- **One Unified Toolkit** — Global skills, global MCP servers, and per-workspace overrides apply uniformly. Configure it once, and every session inherits the power.
- **Steer from Anywhere** — Interrupt any running stream, queue a follow-up instruction, or hand over control to the next agent in line seamlessly.
- **Group Collaboration Mode** — Drop the orchestrator into a Feishu, Slack, Discord, or WeCom group, and let your entire team share and steer the same agent swarm.

This is the shape that matters: one creator, with a swarm of AI agents at their fingertips.

---

## See It in Action

> **Real-world Task** — Ask pikiclaw to gather and summarize today's AI news; the agent reads, writes, and ships the results back through Telegram, all controlled from your phone.

<p align="center"><img src="docs/promo-demo.gif" alt="Demo: Ask Telegram, agent works locally, result returns to chat" width="780"></p>

> **Web Dashboard** — A multi-pane workspace featuring a session list, conversation threads, tool-use traces, and an input composer (supporting 1, 2, 3, or 6-pane layouts).

<p align="center"><img src="docs/promo-dashboard-workspace.png" alt="Web Dashboard workspace" width="780"></p>

<details>
<summary><b>More: Basic Ops · IM Access · Agents · Models · Extensions · Permissions · System Info</b></summary>

> Send a message, watch the agent stream its thoughts, and receive files back instantly.

<img src="docs/promo-basic-ops.gif" alt="Basic operations" width="780">

> **IM Access** — Check and configure connection statuses for Telegram, Feishu, WeChat, Slack, Discord, DingTalk, and WeCom.

<img src="docs/promo-dashboard-im.png" alt="IM Access" width="780">

> **Agents** — Manage installed agent CLIs, set your default agent, and configure per-agent models and reasoning effort levels.

<img src="docs/promo-dashboard-agents.png" alt="Agents" width="780">

> **Models** — A secure Providers + Profiles vault (supporting Claude, GPT, Gemini, DeepSeek, Doubao, MiMo, MiniMax, OpenRouter, and any OpenAI-compatible proxy), validated against the models.dev catalog and injected directly per agent.

> **Extensions** — Manage global MCP servers, community skills, and built-in automation for headless browsers and macOS desktop (Peekaboo).

<img src="docs/promo-dashboard-extensions.png" alt="Extensions" width="780">

> **System Permissions** — Handle macOS Accessibility, Screen Recording, and Disk Access permissions seamlessly.

<img src="docs/promo-dashboard-permissions.png" alt="Permissions" width="780">

> **System Info** — Monitor your working directory alongside real-time CPU, memory, and disk usage.

<img src="docs/promo-dashboard-system.png" alt="System Info" width="780">

</details>

---

## Quick Start

**Prerequisites:** Node.js 20+, plus at least one official Agent CLI installed and authenticated on your system:

- [`claude`](https://docs.anthropic.com/en/docs/claude-code) (Claude Code)
- [`codex`](https://github.com/openai/codex) (Codex CLI)
- [`gemini`](https://github.com/google-gemini/gemini-cli) (Gemini CLI)
- `hermes` (Hermes — via ACP / Agent Client Protocol)

**Launch:**

```bash
cd your-workspace
npx pikiclaw@latest
```

<p align="center"><img src="docs/promo-install.gif" alt="One-command install" width="780"></p>

This instantly opens the **Web Dashboard** at `http://localhost:3939`. From there, you can drive sessions in the browser, connect IM channels, configure agents and models, install MCP servers and skills, and manage system permissions. Everything else is just one click away.

<details>
<summary><b>Prefer the terminal? We have a setup wizard.</b></summary>

```bash
npx pikiclaw@latest --setup    # Interactive terminal setup wizard
npx pikiclaw@latest --doctor   # Environment health check only
```

</details>

---

## How People Are Using It

- **Run a Swarm in Parallel** — Open N sessions in N dashboard panes (or N IM threads), each running a different agent on a different workspace, all executing simultaneously. One person, many agents, one unified cockpit. Steer any of them at any moment.
- **Self-Hosted Dev Loop** — pikiclaw was built using pikiclaw. The dev workflow *is* the product: drive the orchestrator from your phone, write code, ship a release, and iterate.
- **Walk-Away Coding** — Kick off a massive refactoring task, close your laptop, and monitor/steer it from your phone over Telegram. The agent continues running locally, streaming results back to your chat.
- **Multi-Agent Tag Team** — Let Claude Code draft an initial implementation, switch to Codex for an in-depth review, and finally hand it over to Gemini for a fresh perspective. Same files, same continuous session history.
- **Domestic Model Routing** — When latency, cost, or compliance demands a non-frontier model, use a wrapper driver to run Claude Code effortlessly on DeepSeek or Doubao.
- **The Group Chat Agent** — Drop pikiclaw into a Feishu, Slack, Discord, or WeCom workgroup. The entire team shares one orchestrator, one project workspace, and a unified set of powerful skills.
- **Computer-Use, Controlled by You** — Enable the managed Chrome (Playwright) and macOS desktop (Peekaboo, via Accessibility + ScreenCaptureKit) capabilities. The agent can suddenly `see` the screen, click, type, and manage windows, menus, and the Dock—while you steer it from your phone. Book a meeting, scrape a complex dashboard, run end-to-end tests, or drive any native macOS application.
- **Skill-Driven Workflows** — Install community skills (`promote`, `snipe`, `review`, `security-review`, etc.) once, and trigger them instantly from any connected terminal using `/sk_<name>`.

---

## Core Features

### Terminal Layer

- **Seven Native IM Channels** — Telegram, Feishu, WeChat (personal), Slack, Discord, DingTalk, and WeCom. Run one, several, or all of them simultaneously. Each channel is strictly isolated at the code level; adding a new one (like WhatsApp or a mobile app) requires zero changes to the others.
- **Web Dashboard** — Drive sessions directly from your browser with the exact same conversational flow, tool-use tracing, and streaming experience as IM. Enjoy a multi-pane workspace (1/2/3/6 panes), light/dark themes, and full EN/中文 i18n support.
- **Live Streaming Preview** — Watch messages update in place as the agent thinks. Long text auto-splits beautifully; images and files stream back to the UI in real time.

### Agent Layer

- **Official CLIs as Drivers** — Powered directly by Claude Code, Codex CLI, Gemini CLI, and Hermes (via ACP). We don't rewrite the agent core—you inherit upstream capabilities and Day-0 updates automatically.
- **ACP-Native Architecture** — Hermes integrates natively through the [Agent Client Protocol](https://agentclientprotocol.com), spawning `hermes acp` over JSON-RPC stdio. Any future ACP-compatible agent plugs in the exact same way.
- **Pluggable Driver Registry** — The only contract is `src/agent/driver.ts`. New CLI- or ACP-based agents can drop right in alongside our four built-in drivers.
- **Per-Session Agent Switching** — Swap the "brain" on the fly without leaving your workspace.
- **Steer & Interrupt** — Interrupt a heavy running task and force a queued message to the front of the line.
- **Codex Human-in-the-Loop** — When Codex pauses to ask you a question, it forwards the prompt interactively to your IM. Reply directly in the chat, and the task resumes seamlessly.
- **Persistent Goals** — Use `/goal` to set a long-running, session-scoped objective complete with a token budget. Supports pause/resume, and the agent will autonomously self-terminate only when it verifies the goal is complete.

### Model Layer

- **Frontier + Domestic + Proxies** — Supports the Claude 4 family, GPT-5 / Codex, Gemini, DeepSeek, Doubao, MiMo, MiniMax, OpenRouter, and any custom OpenAI-compatible proxy endpoint.
- **Providers & Profiles Vault** — A first-class data model that securely isolates credentials in `~/.pikiclaw/setting.json`. Browse a read-only models.dev catalog, validate keys with real provider probes, and bind a profile to an agent for automatic environment injection at spawn-time.
- **Per-Session Model & Reasoning Effort** — Switch models or adjust reasoning capabilities dynamically via the Dashboard, `/models`, or `/mode`.
- **Per-Agent Deep Injection** — `resolveAgentInjection(agentId)` forces the active profile's environment variables down at spawn time. This means you can run Claude Code on top of DeepSeek or Doubao without ever touching the upstream client's config.

### Tool Layer

- **Robust Skills System** — Project-specific skills live safely in `.pikiclaw/skills/*/SKILL.md` (and we fully support legacy `.claude/commands/*.md` formats). Install community packages with one click from GitHub (`owner/repo`) or browse our curated packs (like Anthropic Official, Vercel Agent Skills, etc.). Trigger them anywhere with `/skills` and `/sk_<name>`.
- **Massive MCP Server Ecosystem** — Browse the [MCP Registry](https://registry.modelcontextprotocol.io), add custom stdio or HTTP servers, enforce real handshake health-checks, and utilize OAuth 2.1 with Dynamic Client Registration. Our recommended catalog flawlessly covers GitHub, Atlassian, Notion, Linear, Sentry, Cloudflare, Slack, Feishu/Lark, Stripe, Hugging Face, Gamma, Brave Search, Perplexity, Filesystem, SQLite, and PostgreSQL. Furthermore, we ship with two built-in, hyper-powerful computer-use servers: `pikiclaw-browser` (driving Chrome via Playwright) and `peekaboo` (driving the macOS GUI via Peekaboo).
- **Seamless CLI Tool Integration** — Auto-detects versions and authentication states for popular CLIs. We natively support OAuth-web login handoffs for browser-based authentications, routing everything smoothly through the agent's standard tool surface.
- **Session-Scoped MCP Bridge** — Foundational tools like `im_list_files`, `im_send_file`, `im_ask_user`, alongside the managed browser and macOS desktop tools (when enabled), are automatically injected deep into every single session you launch.
- **Two-Tier Merge Resolution** — Tool scopes follow a simple rule: `global < workspace < built-in`. The engine automatically resolves and merges these, applying them silently to every session.

<p align="center"><img src="docs/promo-dashboard-extensions-add.png" alt="Add MCP server" width="780"></p>

### Runtime & Developer Experience

- **Dedicated Session Workspaces** — Every session gets its own isolated directory; file attachments and generated assets drop there automatically.
- **Resume, Switch, and Classify** — Flawless multi-turn conversation support with smart session classification (identifying answers, proposals, implementations, or blocked states).
- **Auto-Injected Base Tools** — Core MCP tools like file listing, sending, user prompting, and goal tracking are hard-wired into every stream.
- **Computer-Use (Browser Engine)** — The built-in `pikiclaw-browser` MCP is a hyper-charged wrapper over `@playwright/mcp`. It includes a process-level supervisor and shares an isolated Chrome profile. Log in to your tools once, and reuse those authenticated sessions across all future tasks!
- **Computer-Use (macOS Desktop)** — Enable the `peekaboo` MCP built-in server (macOS only) to unleash the [Peekaboo](https://peekaboo.sh/) framework over Accessibility and ScreenCaptureKit APIs. It exposes a god-mode suite of tools: `see`, `click`, `type`, `scroll`, `window`, `menu`, `app`, and `dock`. Requires explicit OS-level permissions but grants unprecedented control.
- **Hardened for Long Tasks** — Built with sleep prevention, watchdog timers, auto-restarts, daemon modes, and a robust channel supervisor. You can walk away knowing your marathon tasks are protected by an ironclad runtime.

---

## How Is This Different?

| Feature | pikiclaw | IDE Assistants<br>(Cursor / Windsurf / Aider) | Cloud Agents<br>(Devin / Web Claude) | Single-Agent IM Bots |
|---|---|---|---|---|
| **Terminal Access** | 7 IM channels + Web + Extensible | Locked inside the IDE | Confined to a Web app | One specific IM app |
| **Execution Environment** | Your local machine | Your local machine | Vendor's remote sandbox | Usually vendor servers |
| **Agent Flexibility** | Claude Code, Codex, Gemini, Hermes (ACP), etc. | Locked in | Single | Single |
| **Model Freedom** | Frontier models, domestic giants, OpenAI-proxies | Controlled by the platform | Controlled by the vendor | Single, hardcoded |
| **Concurrency Power** | **N Agents × N Windows × N Workspaces** | One agent per IDE window | Strictly sequential | Single thread |
| **Files & Tools Access** | Your entire local disk, your MCPs, your CLIs | Local project files | Heavily sandboxed | None or extremely limited |
| **Add a New Terminal** | Drop in a simple `Channel` class | Impossible | Impossible | Requires a hard fork |
| **Add a New Agent** | Implement a simple `AgentDriver` (CLI or ACP) | Impossible | Impossible | Requires a hard fork |
| **Self-Bootstrapping** | **Yes — completely built using itself** | No | No | No |

The shape that truly matters: **You never have to leave your preferred environment, you retain total choice over the "brain", you can drive a massive swarm in parallel, and the orchestrator is the exact same tool we use to build the orchestrator.**

---

## Command Reference

| Command | Description |
|---|---|
| `/start` | View entry info, the active agent, and your working directory |
| `/sessions` | View, switch, or create new sessions |
| `/agents` | Switch the active Agent (Claude · Codex · Gemini · Hermes) |
| `/models` | View and switch the model or reasoning effort for the session |
| `/mode` | Toggle plan mode / reasoning effort |
| `/switch` | Browse and switch the working directory |
| `/workspaces` | Pick a saved workspace from the Dashboard's quick-pick list |
| `/goal` | Set or inspect a long-running, self-terminating session goal |
| `/stop` | Force-stop the current session |
| `/status` | Check runtime status, token usage, resource consumption, and session info |
| `/host` | Monitor host CPU, memory, disk, and battery levels |
| `/skills` | Browse available project skills |
| `/ext` | View the extensions overview |
| `/restart` | Restart and re-launch the underlying Bot service |
| `/sk_<name>` | Instantly run a specific project skill |

*Note: Plain text without a slash is forwarded directly to the current agent.*

---

## Configuration

- **Persistent Configuration:** `~/.pikiclaw/setting.json` stores your channels, agents, Providers/Profiles, workspaces, and MCP extensions.
- The **Dashboard** is the primary UI for configuration. The terminal wizard (`--setup`) and the doctor script (`--doctor`) are available for headless or CLI-first users.
- Global MCP extensions are stored under the `extensions.mcp` key in the setting file.
- Workspace MCP extensions follow standard conventions and are read from `.mcp.json` in the project root.
- Project skills are loaded automatically from `.pikiclaw/skills/*/SKILL.md` (and we also support legacy `.claude/commands/*.md` formats).

**Computer-Use Toggles** (managed via the Extensions dashboard):

- `browserEnabled` — Enables managed Chrome (Playwright). Upon first use, pikiclaw creates a dedicated profile in `~/.pikiclaw` and reuses it for subsequent sessions. Log in once, and never scan a QR code or enter a password for those tools again.
- `peekabooEnabled` — Enables macOS desktop automation (Peekaboo). Available on macOS only. Activating this launches `@steipete/peekaboo`'s `peekaboo-mcp` binary and injects its UI-controlling tools. *Note: You must grant your terminal **Accessibility** and **Screen Recording** permissions in System Settings → Privacy & Security before enabling this.*

---

## Roadmap

**Already Shipped:** Hermes driver integration · ACP (Agent Client Protocol) · Secure Provider/Profile vault · Seven native IM channels · Computer-use via Playwright and Peekaboo (macOS).

- **More ACP Agents** — Ensuring any new ACP-compatible agent can drop in with zero code changes.
- **Broader Terminal Ecosystem** — Adding support for WhatsApp, a dedicated mobile app, and voice interfaces.
- **Deeper Model Wrapping** — Building agent-on-arbitrary-model wrappers to support a wider array of domestic and open-source models seamlessly.
- **Richer Tool Ecosystem** — Releasing official MCP packs, skill templates, and a community marketplace.
- **Cross-Platform Computer-Use** — Extending desktop control drivers beyond macOS to support Windows and Linux.

For protocol-level insights, see our [ACP Migration Plan](docs/acp-migration.md).

---

## Development

```bash
git clone https://github.com/xiaotonng/pikiclaw.git
cd pikiclaw
npm install
npm run build
npm test
```

```bash
npm run dev                       # Start local dev server (--no-daemon, logs to ~/.pikiclaw/dev/dev.log)
npm run build                     # Production build (Dashboard + tsc)
npm test                          # Run Vitest suite
npx pikiclaw@latest --doctor      # Environment health check
```

For deep dives into the architecture and integration, see: [ARCHITECTURE.md](ARCHITECTURE.md) · [INTEGRATION.md](INTEGRATION.md) · [TESTING.md](TESTING.md).

---

## Contributing

Every layer of this project was designed from the ground up to be **extended**. Adding a new terminal, writing a new agent driver, wrapping a new model, or building a killer MCP tool—these are all first-class contributions.

- Read the **[Contributing Guide](CONTRIBUTING.md)** to get started.
- Check out issues tagged with [`good first issue`](https://github.com/xiaotonng/pikiclaw/labels/good%20first%20issue) and [`help wanted`](https://github.com/xiaotonng/pikiclaw/labels/help%20wanted).
- For major architectural changes, please open an issue first to align on the technical approach.

| Module | What You Can Extend |
|---|---|
| `src/agent/driver.ts`, `src/agent/drivers/*.ts`, `src/agent/acp-client.ts` | Add a new Agent Driver (CLI-based or ACP-compatible) |
| `src/channels/base.ts`, `src/channels/*/` | Integrate a new Terminal or IM channel |
| `src/model/`, `src/model/injector.ts` | Add a new model provider or customize agent environment injection rules |
| `src/dashboard/routes/*.ts` | Expand the Dashboard backend API |
| `src/agent/mcp/tools/*.ts`, `src/agent/mcp/bridge.ts` | Add new session-scoped MCP tools |
| `src/catalog/*.ts` | Recommend high-quality MCP servers, CLI tools, or Skill repositories |

---

## Star History

<a href="https://www.star-history.com/#xiaotonng/pikiclaw&Date">
  <img src="https://api.star-history.com/svg?repos=xiaotonng/pikiclaw&type=Date" alt="Star History" width="640">
</a>

---

## License

[MIT](LICENSE) — Built in the open. Use it, fork it, and plug in your own layers.
