<div align="center">

# pikiclaw

**Run Claude Code / Codex / Gemini on your own computer from Telegram or Feishu.**

*把 IM 变成你电脑上的远程 Agent 控制台。*

```bash
npx pikiclaw@latest
```

<p align="center">
<a href="https://www.npmjs.com/package/pikiclaw"><img src="https://img.shields.io/npm/v/pikiclaw" alt="npm"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
<a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-18+-green.svg" alt="Node.js 18+"></a>
</p>

</div>

---

## Why pikiclaw?

很多“IM 接 Agent”的方案，本质上还是在绕路：

- 要么自己造 Agent，效果不如官方 CLI
- 要么跑在远端沙盒里，不是你的环境
- 要么只能短对话，不适合长任务

pikiclaw 的目标很直接：

- 用官方 Agent CLI，而不是重新发明一套
- 用你自己的电脑，而不是陌生沙盒
- 用你已经在用的 IM，而不是再学一套远程控制方式

```
  你（Telegram / 飞书）
          │
          ▼
       pikiclaw
          │
          ▼
  Claude Code / Codex / Gemini
          │
          ▼
       你的电脑
```

它适合的不是“演示一次 AI”，而是你离开电脑以后，Agent 还能继续在本机把事做完。

---

## Quick Start

### 准备

- Node.js 18+
- 本机已安装并登录任意一个 Agent CLI
  - [`claude`](https://docs.anthropic.com/en/docs/claude-code)
  - [`codex`](https://github.com/openai/codex)
  - [`gemini`](https://github.com/google-gemini/gemini-cli)
- Telegram Bot Token 或飞书应用凭证

### 启动

```bash
cd your-workspace
npx pikiclaw@latest
```

默认会打开 Web Dashboard：`http://localhost:3939`

你可以在 Dashboard 里完成：

- 渠道配置
- 默认 Agent / 模型设置
- 工作目录切换
- 会话和运行状态查看

如果你更喜欢终端向导：

```bash
npx pikiclaw@latest --setup
```

如果只是检查环境：

```bash
npx pikiclaw@latest --doctor
```

---

## What Exists Today

### Channels

- Telegram 已可用
- 飞书已可用
- 两个渠道可以同时启动

### Agents

- Claude Code
- Codex CLI
- Gemini CLI

Agent 通过 driver registry 接入，模型列表、会话列表、usage 展示都走统一接口。

### Runtime

- 流式预览和持续消息更新
- 会话切换、恢复和多轮续聊
- 工作目录浏览与切换
- 长任务防休眠
- watchdog 守护和自动重启
- 长文本自动拆分，文件和图片自动回传

### Skills

- 支持项目级 `.pikiclaw/skills/*/SKILL.md`
- 兼容 `.claude/commands/*.md`
- IM 内可通过 `/skills` 和 `/sk_<name>` 触发

### MCP Session Bridge

每次 Agent stream 会启动一个会话级 MCP server，把 IM 能力暴露给 Agent。

当前已接入的工具：

- `im_list_files`：列出 session workspace 文件
- `im_send_file`：把文件实时发回 IM
- `take_screenshot`：跨平台截图并返回路径

当前 `guiTools` 模块已经预留，但点击、输入、窗口控制等顶级 GUI 工具还没接上。

---

## Commands

| 命令 | 说明 |
|---|---|
| `/start` | 显示入口信息、当前 Agent、工作目录 |
| `/sessions` | 查看、切换或新建会话 |
| `/agents` | 切换 Agent |
| `/models` | 查看并切换模型 / reasoning effort |
| `/switch` | 浏览并切换工作目录 |
| `/status` | 查看运行状态、tokens、usage、会话信息 |
| `/host` | 查看主机 CPU / 内存 / 磁盘 / 电量 |
| `/skills` | 浏览项目 skills |
| `/restart` | 重启并重新拉起 bot |
| `/sk_<name>` | 运行项目 skill |

普通文本消息会直接转给当前 Agent。

---

## Skills And MCP

项目里现在有两条能力扩展线：

- Skills：偏“高层工作流提示词”，来源于 `.pikiclaw/skills` 和 `.claude/commands`
- MCP tools：偏“可执行工具能力”，目前是会话级 bridge，由 pikiclaw 在每次 stream 时注入

这两条线已经能工作，但都还是偏“session / project 内部接入”，还不是仓库级统一入口。

---

## Status

### 已完成

| 项目 | 状态 |
|---|---|
| Telegram 渠道 | ✅ |
| 飞书渠道 | ✅ |
| Claude Code driver | ✅ |
| Codex CLI driver | ✅ |
| Gemini CLI driver | ✅ |
| Web Dashboard | ✅ |
| 项目级 Skills | ✅ |
| 会话级 MCP bridge | ✅ |
| 文件回传 / 截图回传 | ✅ |
| 守护重启 / 防休眠 | ✅ |

### 待办

| 项目 | 说明 |
|---|---|
| 顶级 Skills 接入 | 把 skills 从当前项目级入口提升为更统一的顶级接入能力 |
| 顶级 MCP 工具接入 | 把当前会话级 MCP bridge 扩展成更完整的顶级工具接入层 |
| GUI 自动化工具补全 | 在 `src/tools/gui.ts` 上接入点击、输入、聚焦、窗口控制等工具 |
| 更多渠道 | WhatsApp 仍在规划中 |

---

## Development

```bash
git clone https://github.com/xiaotonng/pikiclaw.git
cd pikiclaw
npm install
npm run build
npm test
```

常用命令：

```bash
npm run dev
npm run build
npm test
npm run test:e2e
npx vitest run test/channel-feishu.unit.test.ts
npx pikiclaw@latest --doctor
```

更多实现细节见：

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [INTEGRATION.md](INTEGRATION.md)
- [TESTING.md](TESTING.md)

---

## License

[MIT](LICENSE)
