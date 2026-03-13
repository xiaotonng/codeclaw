<div align="center">

# pikiclaw

**One command. Turn any computer into a world-class productivity machine.**

*一行命令，让你的老电脑变成世界顶级生产力。*
*最好的 IM（Telegram / 飞书）× 最强的 Agent（Claude Code / Codex / Gemini CLI）× 你自己的电脑。*

```bash
npx pikiclaw@latest
```

[![npm](https://img.shields.io/npm/v/pikiclaw)](https://www.npmjs.com/package/pikiclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)

<!-- TODO: 替换为实际 demo GIF -->
<!-- ![demo](docs/assets/demo.gif) -->

</div>

---

## Why pikiclaw?

市面上有很多 IM-to-Agent 桥接方案。它们要么自己造引擎（质量不如官方），要么什么都接（质量参差不齐）。

pikiclaw 的思路不同：**只挑最好的，然后把它们组合到极致。**

- **最好的 Agent** — Claude Code、Codex CLI、Gemini CLI，都是各家官方出品，不造轮子
- **最好的 IM** — Telegram（全球）+ 飞书（国内），不追求数量，每个都打磨到位
- **最好的执行环境** — 你自己的电脑，不是云端沙盒，什么都能干

结果就是：你在手机上发一句话，你的电脑就开始干活——小到改一行代码，大到通宵重构整个项目、整理几十份文档、跑完所有测试。

```
  你（手机 IM）──→ pikiclaw ──→ 本地 Agent ──→ 你的电脑
       ↑                                          │
       └──────── 流式进度 / 文件 / 截图 ←──────────┘
```

---

## Quick Start

### 准备

- Node.js 18+
- 本机已安装 [`claude`](https://docs.anthropic.com/en/docs/claude-code)、[`codex`](https://github.com/openai/codex) 或 [`gemini`](https://github.com/google-gemini/gemini-cli) 中的任意一个
- 一个 [Telegram Bot Token](https://t.me/BotFather) 或[飞书应用](https://open.feishu.cn)凭证

### 一行启动

```bash
cd your-workspace/
npx pikiclaw@latest
```

启动后自动打开 **Web Dashboard**（`localhost:3939`），引导你完成全部配置。也可以用终端向导：

```bash
npx pikiclaw@latest --setup
```

### 开始派活

给你的 bot 发消息：

> "把 docs/ 目录下所有零散文档整理汇总，提取核心指标，输出一份报告。"

**就这样。你的电脑现在是一个随时待命的远程执行中枢。**

---

## Features

### Agent Engines

| Agent | 特点 |
|-------|------|
| **Claude Code** | Anthropic 官方 CLI · Thinking 展示 · 多模态 · 缓存优化 |
| **Codex CLI** | OpenAI 官方 CLI · Reasoning 展示 · 计划步骤追踪 · 实时用量 |
| **Gemini CLI** | Google 官方 CLI · 工具调用 · 流式输出 |

通过 `/agents` 随时切换引擎，`/models` 切换模型。

### IM Channels

| 渠道 | 消息编辑 | 文件上传 | 回调按钮 | 表情回应 | 消息线程 |
|------|---------|---------|---------|---------|---------|
| **Telegram** | ✅ | ✅ | ✅ | — | — |
| **飞书** | ✅ | ✅ | ✅ | ✅ | ✅ |

两个渠道可以**同时启动**。

### Core Capabilities

| 能力 | 说明 |
|------|------|
| 实时流式输出 | Agent 工作时消息持续更新 |
| Thinking / Reasoning | 实时查看 Agent 的思考和推理过程 |
| Token 追踪 | 输入/输出/缓存统计，上下文使用率实时显示 |
| 产物回传 | 截图、日志、生成文件自动发回 |
| 长程防休眠 | 系统级防休眠，小时级任务不中断 |
| 守护进程 | 崩溃自动重启，指数退避（3s → 60s） |
| 长文本处理 | 超长输出自动拆分或打包为 `.md` |
| 多会话管理 | 随时切换、恢复历史会话 |
| 图片/文件输入 | 截图、PDF、文档直接发给 Agent |
| 项目 Skills | `.pikiclaw/skills/` 自定义技能，兼容 `.claude/commands/` |
| 安全模式 | 危险操作推送确认卡片，白名单访问控制 |
| Web Dashboard | 可视化配置、会话浏览、主机监控 |

---

## Comparison

### pikiclaw vs. 其他方案

```
          在你的环境里执行
               │
    终端 CLI   │   pikiclaw
    (人要守着)  │   (人可以走)
               │
  ─────────────┼─────────────
    不方便控制  │  随时随地控制
               │
    SSH+tmux   │   云端 Agent
    (手机上很痛苦) │ (不是你的环境)
               │
          在沙盒/远端执行
```

| | 终端直接跑 | SSH + tmux | 云端 Agent | **pikiclaw** |
|---|---|---|---|---|
| 执行环境 | ✅ 本地 | ✅ 本地 | ❌ 沙盒 | ✅ 本地 |
| 走开后还能跑 | ❌ 合盖就断 | ⚠️ 要配 tmux | ✅ | ✅ 防休眠 + 守护进程 |
| 手机可控 | ❌ | ⚠️ 打字痛苦 | ✅ | ✅ IM 原生 |
| 实时看进度 | ✅ 终端 | ⚠️ 得连上去看 | ❌ 多数是黑盒 | ✅ 流式推到聊天 |
| 结果自动回传 | ❌ | ❌ | ⚠️ 看平台 | ✅ 截图/文件/长文本 |
| 配置门槛 | 无 | SSH/穿透/tmux | 注册/付费 | `npx` 一行 |

### pikiclaw vs. 同类项目

| | **pikiclaw** | OpenClaw | cc-connect |
|---|---|---|---|
| **理念** | **精选最好的工具，组合到极致** | 开源自主 AI 智能体生态 | 多渠道多端连接器 |
| **Agent** | Claude Code / Codex / Gemini CLI（官方出品） | 内置 Agent（自接模型） | 多种本地 CLI |
| **IM** | Telegram + 飞书（深度打磨） | Web / 移动端 | Slack / Discord / LINE 等 |
| **长程任务** | ✅ 防休眠 · 守护进程 · 异常自愈 | ❌ 偏即时任务 | ❌ 偏短对话 |
| **产物回传** | ✅ 截图 · 文件 · 长文本打包 | ⚠️ 依赖客户端 | ⚠️ 基础附件 |
| **流式体验** | ✅ IM 内实时流式 | ✅ | ⚠️ 看桥接能力 |
| **上手成本** | **一行 `npx`** | 需部署后端 | 需安装服务端 |

---

## Use Cases

pikiclaw 不限于编程。你的 Agent 能做什么，pikiclaw 就能远程调度什么。

**工程重构** — "把整个项目从 JS 迁移到 TS，跑测试直到全部通过。搞定告诉我。"

**文档处理** — "把 docs/ 下所有零散文档整理汇总，提取核心指标，输出一份报告。"

**研究分析** — "下载这 5 篇论文的 PDF，逐篇阅读，写一份 3000 字综述。"

**批量任务** — "把 data/ 下所有旧版报表转换成新格式，汇总成一份，确认数据条数。"

**巡检自愈** — "跑一下数据同步任务，把报错自动修好，直到全部通过。"

**竞品分析** — "分析竞品网站的落地页，把我们的页面改成类似风格，改完截图发我。"

---

## Commands

| 命令 | 说明 |
|------|------|
| `/start` | 菜单、当前 Agent 和工作目录 |
| `/agents` | 切换 Agent |
| `/models` | 查看并切换模型 |
| `/sessions` | 查看并切换历史会话 |
| `/switch` | 浏览并切换工作目录 |
| `/status` | 状态、会话信息、Token 统计 |
| `/host` | 主机 CPU / 内存 / 磁盘 / 电量 |
| `/skills` | 浏览项目 skills |
| `/restart` | 拉取最新版本并重启 |
| `/sk_<name>` | 执行项目技能 |

> 普通文本直接发给当前 Agent。

---

## Configuration

### 常见用法

```bash
npx pikiclaw@latest                       # 自动检测，打开 Dashboard
npx pikiclaw@latest -a claude             # 指定 Agent
npx pikiclaw@latest -a gemini             # 使用 Gemini
npx pikiclaw@latest -w ~/workspace        # 指定工作目录
npx pikiclaw@latest -m claude-sonnet-4-6  # 指定模型
npx pikiclaw@latest --safe-mode           # 安全模式
npx pikiclaw@latest --allowed-ids ID      # 白名单
npx pikiclaw@latest --doctor              # 检查环境
```

### CLI 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-t, --token` | — | Bot Token |
| `-a, --agent` | `codex` | 默认 Agent |
| `-m, --model` | Agent 默认 | 覆盖模型 |
| `-w, --workdir` | 已保存或当前目录 | 工作目录 |
| `--safe-mode` | `false` | Agent 自身权限模型 |
| `--full-access` | `true` | 无确认执行 |
| `--allowed-ids` | — | 限制 chat/user ID |
| `--timeout` | `1800` | 单次请求最大秒数 |
| `--no-daemon` | — | 禁用守护进程 |
| `--no-dashboard` | — | 不启动 Dashboard |
| `--dashboard-port` | `3939` | Dashboard 端口 |
| `--doctor` | — | 检查环境 |
| `--setup` | — | Setup Wizard |

<details>
<summary>环境变量</summary>

**通用：**

| 变量 | 说明 |
|------|------|
| `DEFAULT_AGENT` | 默认 Agent |
| `PIKICLAW_WORKDIR` | 默认工作目录 |
| `PIKICLAW_TIMEOUT` | 请求超时（秒） |
| `PIKICLAW_ALLOWED_IDS` | 白名单 |
| `PIKICLAW_FULL_ACCESS` | 完全访问模式 |
| `PIKICLAW_RESTART_CMD` | 自定义重启命令 |

**Telegram：**

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Bot Token |
| `TELEGRAM_ALLOWED_CHAT_IDS` | 白名单 |

**飞书：**

| 变量 | 说明 |
|------|------|
| `FEISHU_APP_ID` | App ID |
| `FEISHU_APP_SECRET` | App Secret |
| `FEISHU_DOMAIN` | API 域名（默认 `https://open.feishu.cn`） |
| `FEISHU_ALLOWED_CHAT_IDS` | 白名单 |

**Claude：**

| 变量 | 说明 |
|------|------|
| `CLAUDE_MODEL` | 模型 |
| `CLAUDE_PERMISSION_MODE` | 权限模式 |
| `CLAUDE_EXTRA_ARGS` | 额外参数 |

**Codex：**

| 变量 | 说明 |
|------|------|
| `CODEX_MODEL` | 模型 |
| `CODEX_REASONING_EFFORT` | 推理强度 |
| `CODEX_FULL_ACCESS` | 完全访问 |
| `CODEX_EXTRA_ARGS` | 额外参数 |

**Gemini：**

| 变量 | 说明 |
|------|------|
| `GEMINI_MODEL` | 模型 |
| `GEMINI_EXTRA_ARGS` | 额外参数 |

</details>

---

## Status

| 维度 | 状态 |
|------|------|
| IM | Telegram ✅ · 飞书 ✅ · WhatsApp（规划中） |
| Agent | Claude Code ✅ · Codex CLI ✅ · Gemini CLI ✅ |
| 面板 | Web Dashboard ✅ |
| 国际化 | 中文 ✅ · English ✅ |
| 平台 | macOS ✅ · Linux ✅ |

---

## Development

```bash
git clone https://github.com/nicepkg/pikiclaw.git
cd pikiclaw
npm install
echo "TELEGRAM_BOT_TOKEN=your_token" > .env
set -a && source .env && npx tsx src/cli.ts
npm test
```

架构详情见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## License

[MIT](LICENSE)
