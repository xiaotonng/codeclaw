<div align="center">

# codeclaw

**Turn your laptop into a chat-controlled AI agent.**

Super-light local agent control plane for Telegram.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/codeclaw)](https://www.npmjs.com/package/codeclaw)

[English](#english) | [中文](#中文)

</div>

---

<a id="english"></a>

## What is codeclaw?

`codeclaw` runs on **your machine** and lets you control local AI agents from **Telegram**.

It is not a hosted platform and not a giant agent operating system. It is a small, execution-first control layer for your own laptop:

- **Chat-native** — send tasks from Telegram instead of living in a terminal window
- **Local-first** — agents run against your real machine, real files, real browser, real tools
- **Execution-first** — optimized for getting work done, not just chatting about work
- **Coding-strong** — Claude Code + Codex CLI make software tasks the strongest use case
- **General-purpose** — also useful for browser tasks, file review, screenshots, host inspection, and project-specific workflows

If you want “an AI assistant in chat”, there are many options.
If you want “my laptop, remotely, with strong agents attached”, that is what `codeclaw` is for.

## Why it exists

Most remote agent setups break in one of four ways:

- **Too heavy** — too much setup, too many moving parts
- **Too weak** — the control layer is fine, but the underlying agent cannot really execute hard tasks
- **Too black-box** — you send a task and wait with no idea what is happening
- **Too fragile** — long tasks die when the laptop sleeps or the session gets interrupted

`codeclaw` focuses on a tighter loop:

- **Use the best local agents you already trust** — Claude Code and Codex CLI
- **Control them from the chat app you already open all day** — Telegram today
- **See progress while the task is running** — streaming previews, activity, reasoning, token stats
- **Get actual outputs back** — screenshots, logs, documents, long markdown responses

## Best-fit scenarios

### 1. Remote coding from your phone

Ask your machine to:

- inspect a repo
- modify files
- run tests
- summarize failures
- continue a multi-turn session

This is the strongest use case because `codeclaw` plugs directly into `claude` and `codex`.

### 2. Continuous browser / GUI tasks

When the underlying agent can operate browser or desktop tools, `codeclaw` makes those tasks usable over chat:

- you start the task from Telegram
- you see streaming progress instead of waiting blindly
- the machine stays awake during long runs
- screenshots or generated files can be returned to Telegram

This is especially valuable for multi-step GUI verification and “go do it and show me what happened” workflows.

### 3. Visual triage

Send a screenshot, diagram, or document and ask the agent to:

- explain what is wrong
- compare UI states
- inspect a design
- summarize an attached file

### 4. Host-side assistance

Use chat to inspect the machine itself:

- CPU / memory / disk
- top processes
- current workdir
- active session
- provider usage windows

### 5. Project-defined workflows

Expose custom project skills from `.claude/commands/` or `.claude/skills/` as Telegram commands.

## What makes it different

- **Runs locally** — no server, no Docker, no hosted control plane
- **Starts fast** — `npx codeclaw -t ...`
- **Built for long-running work** — session persistence, keep-alive, streaming updates
- **Strong by default** — uses Claude Code and Codex CLI instead of a weaker built-in agent
- **Practical over chat** — file input, image input, artifact return, long-output handling, quick replies

## Current scope

- **Production-ready channel:** Telegram
- **Supported agents:** Claude Code, Codex CLI
- **Planned channels:** Feishu / WhatsApp
- **Platform note:** keep-alive support is implemented for macOS and Linux

## Features

- **Telegram control surface** — use Telegram as the remote front-end for your local agent
- **Multi-agent switching** — switch between Claude Code and Codex via `/agents`
- **Model switching** — list and switch models with `/models`
- **Real-time streaming** — live message updates while the agent is working
- **Multi-session continuity** — resume named sessions instead of starting over every turn
- **Workdir switching** — browse directories and switch projects from chat
- **Image and file input** — send screenshots and documents to the agent
- **Artifact return** — send screenshots, logs, and generated files back to Telegram
- **Long-output fallback** — oversized replies are split and attached as a `.md` file when needed
- **Reasoning display** — show Claude/Codex thinking or reasoning blocks when available
- **Provider usage visibility** — inspect recent Codex / Claude usage windows
- **Host status** — view CPU, memory, disk, and top processes
- **Access control** — restrict the bot to specific Telegram chat IDs
- **Safe mode** — require confirmation for destructive operations
- **Project skills** — auto-expose custom workflows from `.claude/commands/` and `.claude/skills/`
- **Restart flow** — update and restart from Telegram

## How it works

```text
Telegram
  ↕
codeclaw
  ↕
claude / codex CLI
  ↕
your laptop: files, browser, shell, project
```

`codeclaw` is the bridge between an IM channel and your local agent runtime.

## Quick start

### Using `npx`

```bash
cd your-project/
npx codeclaw -t YOUR_BOT_TOKEN
```

### Global install

```bash
npm install -g codeclaw
cd your-project/
codeclaw -t YOUR_BOT_TOKEN
```

### Example configurations

```bash
# Telegram + Claude Code
npx codeclaw -t $BOT_TOKEN -a claude

# Telegram + Codex
npx codeclaw -t $BOT_TOKEN -a codex

# Safe mode + restricted chat IDs
npx codeclaw -t $BOT_TOKEN --safe-mode --allowed-ids 123456,789012

# Start in a specific project
npx codeclaw -t $BOT_TOKEN -w ~/projects/my-app
```

### Requirements

- Node.js 18+
- a Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- `claude` and/or `codex` installed on the same machine
- authenticated local agent CLI(s)

## Commands

Once running in Telegram:

| Command | Description |
| --- | --- |
| `/start` | Show menu and current agent/workdir |
| `/sessions` | List and switch sessions |
| `/agents` | List and switch agents |
| `/models` | List and switch models |
| `/switch` | Browse and switch working directory |
| `/status` | Show bot status, session, usage, and token stats |
| `/host` | Show host CPU, memory, disk, and top processes |
| `/restart` | Restart with the latest package version |
| `/sk_<name>` | Run a project-defined skill exposed from `.claude/` |

Notes:

- In private Telegram chats, plain text is forwarded directly to the current agent.
- Unknown slash commands are forwarded as prompts.
- Skill commands are generated dynamically from the current project.

## CLI options

```text
codeclaw [options]
```

| Flag | Default | Description |
| --- | --- | --- |
| `-c, --channel` | `telegram` | IM channel; only Telegram is implemented today |
| `-t, --token` | — | Channel token |
| `-a, --agent` | `claude` | Default agent: `claude` or `codex` |
| `-m, --model` | agent-specific | Override the default model |
| `-w, --workdir` | current dir | Working directory |
| `--full-access` | `true` | Let the agent run without confirmation |
| `--safe-mode` | `false` | Require confirmation before destructive actions |
| `--allowed-ids` | — | Restrict access to Telegram chat/user IDs |
| `--timeout` | `900` | Max seconds per agent request |

Important environment variables:

| Variable | Description |
| --- | --- |
| `CODECLAW_TOKEN` | Channel token fallback |
| `DEFAULT_AGENT` | Default agent |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Telegram allowlist |
| `CODECLAW_WORKDIR` | Default working directory |
| `CODECLAW_TIMEOUT` | Per-turn timeout in seconds |
| `CLAUDE_MODEL` | Claude model |
| `CLAUDE_PERMISSION_MODE` | Claude permission mode |
| `CLAUDE_EXTRA_ARGS` | Extra args passed to `claude` |
| `CODEX_MODEL` | Codex model |
| `CODEX_REASONING_EFFORT` | Codex reasoning effort |
| `CODEX_FULL_ACCESS` | Codex full-access mode |
| `CODEX_EXTRA_ARGS` | Extra args passed to `codex` |

## Development

```bash
npm install
echo "TELEGRAM_BOT_TOKEN=your_token_here" > .env
set -a && source .env && npx tsx src/cli.ts
npm test
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md).

```text
cli.ts → bot-telegram.ts → bot.ts → code-agent.ts
                ↓
         channel-telegram.ts
```

- `bot.ts` — shared bot logic, state, keep-alive, stream orchestration
- `bot-telegram.ts` — Telegram rendering, menus, callbacks, artifact flow
- `channel-telegram.ts` — Telegram transport layer
- `code-agent.ts` — Claude/Codex process + stream handling

## Philosophy

`codeclaw` is not trying to be the biggest agent platform.

It is trying to be the fastest way to turn:

- **your laptop**
- **your preferred strong agent**
- **your existing chat app**

into a practical remote execution loop.

## License

[MIT](LICENSE)

---

<a id="中文"></a>

## codeclaw 是什么？

`codeclaw` 是一个跑在**你自己电脑上**的本地 Agent 控制层，让你可以直接通过 **Telegram** 远程调度本机 AI Agent。

它不是一个托管平台，也不是一个很重的 Agent OS。它更像一个小而狠的执行层：

- **IM 原生**：直接在聊天窗口里派任务
- **本地优先**：操作你真实的文件、浏览器、终端和项目
- **执行优先**：重点不是“陪聊”，而是“把事做完”
- **编码最强**：接 Claude Code 和 Codex CLI，技术任务上限非常高
- **不止编码**：也适合浏览器任务、截图分析、文件处理、主机巡检、项目自定义工作流

如果你想要的是“聊天里的 AI 助手”，有很多产品。
如果你想要的是“我电脑上的强 Agent，可以随时在聊天里被调度”，这就是 `codeclaw`。

## 为什么做它

很多远程 Agent 产品会卡在下面几件事里：

- **太重**：安装和运行链路太长
- **太弱**：控制层看起来不错，但底层 Agent 真正做事能力不够
- **太黑盒**：任务发出去后，不知道做到哪一步
- **太脆**：长任务一休眠、一中断就挂

`codeclaw` 只抓一个更紧的闭环：

- 用你已经认可的强 Agent：Claude Code / Codex CLI
- 放进你本来就在用的聊天入口：现在是 Telegram
- 做任务时能看到进度：流式预览、活动状态、reasoning、token 统计
- 做完以后能带结果回来：截图、日志、文件、长文本

## 最适合的场景

### 1. 远程编码

这是当前最强场景。你可以在手机上让电脑去：

- 看代码库
- 改文件
- 跑测试
- 总结报错
- 基于同一会话连续推进任务

原因很简单：`codeclaw` 直接接的是 `claude` 和 `codex`。

### 2. 连续 GUI / 浏览器任务

如果底层 Agent 本身具备浏览器或桌面操作能力，`codeclaw` 会把这类任务变得适合在 IM 里使用：

- 从 Telegram 发起任务
- 过程中能看到流式进展
- 长任务期间尽量防止电脑休眠
- 截图、日志、生成文件可以回传到 Telegram

所以它很适合那种“你去做一串 GUI 操作，然后把结果发我”的场景。

### 3. 视觉输入与分析

直接发截图、设计图、文档给 Agent：

- 分析界面问题
- 对比页面状态
- 看图理解上下文
- 总结附件内容

### 4. 主机侧协助

直接在聊天里查看：

- CPU / 内存 / 磁盘
- Top 进程
- 当前工作目录
- 当前会话
- Provider 用量窗口

### 5. 项目自定义工作流

把项目里的 `.claude/commands/` 和 `.claude/skills/` 暴露成 Telegram 命令。

## 它和一般 IM Agent 工具的区别

- **本地运行**：没有服务端，没有 Docker，没有 hosted control plane
- **极轻启动**：`npx codeclaw -t ...`
- **适合长任务**：会话持续、保活、流式进度、回传产物
- **底层足够强**：直接使用 Claude Code / Codex CLI
- **更适合真实执行**：图片输入、文件输入、长文本、快捷回复、artifact 回传

## 当前能力边界

- **已完成渠道**：Telegram
- **已支持 Agent**：Claude Code、Codex CLI
- **规划中的渠道**：Feishu / WhatsApp
- **平台说明**：保活当前在 macOS / Linux 上实现

## 功能特性

- **Telegram 控制台**：把 Telegram 作为本机 Agent 的远程前端
- **多 Agent 切换**：通过 `/agents` 在 Claude Code 和 Codex 之间切换
- **模型切换**：通过 `/models` 查看并切换模型
- **实时流式输出**：Agent 运行时持续更新消息
- **多会话延续**：在同一会话上继续推进任务
- **工作目录切换**：直接在聊天里切换项目目录
- **图片 / 文件输入**：把截图和文档发给 Agent
- **产物回传**：把截图、日志、生成文件发回 Telegram
- **长文本处理**：超长回复自动拆分，必要时附 `.md` 文件
- **思考 / 推理展示**：展示 Claude / Codex 可用的 reasoning 内容
- **Provider 用量展示**：查看最近 Codex / Claude 用量窗口
- **主机状态查看**：查看 CPU、内存、磁盘和进程
- **访问控制**：可限制 Telegram chat/user ID
- **安全模式**：危险操作前要求确认
- **项目技能命令**：自动暴露 `.claude/` 里的项目技能
- **远程重启**：直接在 Telegram 更新并重启

## 工作方式

```text
Telegram
  ↕
codeclaw
  ↕
claude / codex CLI
  ↕
你的电脑：文件、浏览器、终端、项目
```

`codeclaw` 的角色，就是把 IM 和本地 Agent 运行时连接起来。

## 快速开始

### 用 `npx`

```bash
cd your-project/
npx codeclaw -t YOUR_BOT_TOKEN
```

### 全局安装

```bash
npm install -g codeclaw
cd your-project/
codeclaw -t YOUR_BOT_TOKEN
```

### 常见启动方式

```bash
# Telegram + Claude Code
npx codeclaw -t $BOT_TOKEN -a claude

# Telegram + Codex
npx codeclaw -t $BOT_TOKEN -a codex

# 安全模式 + 限制聊天 ID
npx codeclaw -t $BOT_TOKEN --safe-mode --allowed-ids 123456,789012

# 指定项目目录启动
npx codeclaw -t $BOT_TOKEN -w ~/projects/my-app
```

### 前置条件

- Node.js 18+
- 从 [@BotFather](https://t.me/BotFather) 获取 Telegram Bot Token
- 本机安装 `claude` 和/或 `codex`
- 本机已完成对应 CLI 登录

## Telegram 命令

| 命令 | 说明 |
| --- | --- |
| `/start` | 显示菜单和当前 agent/workdir |
| `/sessions` | 查看并切换会话 |
| `/agents` | 查看并切换 agent |
| `/models` | 查看并切换模型 |
| `/switch` | 浏览并切换工作目录 |
| `/status` | 查看 bot 状态、会话、用量和 token 信息 |
| `/host` | 查看宿主机 CPU、内存、磁盘和进程 |
| `/restart` | 拉取最新版本并重启 |
| `/sk_<name>` | 执行项目在 `.claude/` 中定义的技能 |

说明：

- 在 Telegram 私聊里，普通文本会直接转发给当前 Agent。
- 未识别的 `/命令` 会被当作 prompt 转发。
- 技能命令会根据当前项目动态生成。

## CLI 参数

```text
codeclaw [options]
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-c, --channel` | `telegram` | IM 渠道；当前真正可用的是 Telegram |
| `-t, --token` | — | 渠道 token |
| `-a, --agent` | `claude` | 默认 agent：`claude` 或 `codex` |
| `-m, --model` | agent-specific | 覆盖默认模型 |
| `-w, --workdir` | 当前目录 | 工作目录 |
| `--full-access` | `true` | 允许 agent 无确认执行 |
| `--safe-mode` | `false` | 危险操作前需要确认 |
| `--allowed-ids` | — | 限制 Telegram chat/user ID |
| `--timeout` | `900` | 单次请求最大秒数 |

常用环境变量：

| 环境变量 | 说明 |
| --- | --- |
| `CODECLAW_TOKEN` | 通用渠道 token 回退值 |
| `DEFAULT_AGENT` | 默认 agent |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Telegram allowlist |
| `CODECLAW_WORKDIR` | 默认工作目录 |
| `CODECLAW_TIMEOUT` | 单轮请求超时 |
| `CLAUDE_MODEL` | Claude 模型 |
| `CLAUDE_PERMISSION_MODE` | Claude 权限模式 |
| `CLAUDE_EXTRA_ARGS` | 传给 `claude` 的额外参数 |
| `CODEX_MODEL` | Codex 模型 |
| `CODEX_REASONING_EFFORT` | Codex 推理强度 |
| `CODEX_FULL_ACCESS` | Codex 完全访问模式 |
| `CODEX_EXTRA_ARGS` | 传给 `codex` 的额外参数 |

## 本地开发

```bash
npm install
echo "TELEGRAM_BOT_TOKEN=your_token_here" > .env
set -a && source .env && npx tsx src/cli.ts
npm test
```

## 架构

详见 [ARCHITECTURE.md](ARCHITECTURE.md)。

```text
cli.ts → bot-telegram.ts → bot.ts → code-agent.ts
                ↓
         channel-telegram.ts
```

- `bot.ts` — 通用 bot 逻辑、状态、保活、流式编排
- `bot-telegram.ts` — Telegram 渲染、菜单、回调、artifact 回传
- `channel-telegram.ts` — Telegram 传输层
- `code-agent.ts` — Claude/Codex 进程与流处理

## 项目理念

`codeclaw` 不想成为最大的 Agent 平台。

它想做的是：把

- **你的电脑**
- **你偏好的强 Agent**
- **你已经在用的聊天入口**

拼成一个真正能远程执行任务的闭环。

## License

[MIT](LICENSE)
