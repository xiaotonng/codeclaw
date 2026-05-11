<div align="center">

# pikiclaw

## 把全世界最聪明的 AI Agent 装进你的口袋。

##### *面向「创作者不再需要看代码」时代的开放式 Agent 编排器。*

*接入任何 Agent（Claude · Codex · Gemini · Hermes · …），任何模型（Claude · GPT · Gemini · DeepSeek · 豆包 · MiMo · MiniMax · OpenRouter · 甚至是任意第三方代理），以及任何工具（Skills · MCP · CLI）。通过你最顺手的终端（IM、Web 或未来形态）来驱动它们。pikiclaw 本身就是用 pikiclaw 构建的。*

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
<a href="README.md">English</a> | <b>简体中文</b>
</p>

<img src="docs/workspace.png" alt="工作区" width="780">

</div>

---

## pikiclaw 是什么？

**大多数「AI 开发工具」往往只做局部的创新 —— 绑定一款 IDE、单一 Agent 或某家模型厂商，然后便止步于此。** pikiclaw 则建立在一个截然不同的判断之上：下一代「创造」的过程，不会局限在某个单一的编辑器内部。它会发生在一个**编排器 (Orchestrator)** 中。在这里，创作者可以并发出一个 Agent **集群 (Swarm)**，让它们跑在当前最强大的模型上，并通过手边最方便的终端来掌控全局——而且，你甚至不需要打开任何代码文件。

核心产品就是这个编排器，其它所有组件都可拔插。**更酷的是，这个编排器是由它自己构建出来的** —— pikiclaw 就是我们用来开发 pikiclaw 的工具。

```
   终端层    Telegram · 飞书 · 微信 · Slack · Discord · 钉钉 · 企业微信 · Web Dashboard
                              \__________________________|__________________________/
                                                         v
                                          ┌──────────────────────────────┐
                                          │     pikiclaw 编排器           │
                                          └──────────────────────────────┘
                                                         |
                ┌────────────────────────────────────────┼────────────────────────────────────────┐
                v                                        v                                        v
           Agent 层                                   模型层                                    工具层
   Claude Code · Codex · Gemini · Hermes      Claude · GPT · Gemini · DeepSeek            Skills · MCP · CLI
   (driver registry · ACP · 任意 Agent)       豆包 · MiMo · MiniMax · OpenRouter         (全局 × 工作区)
                                              · 任意 OpenAI 兼容代理 · …
                                                         |
                                                         v
                                                  你的电脑
```

- **终端层 (Terminal)** —— Telegram、飞书、微信、Slack、Discord、钉钉、企业微信以及 Web Dashboard 都是一等公民入口。新的终端形态可以随时接入。
- **Agent 层** —— 官方的 Claude Code / Codex / Gemini / Hermes CLI 作为底层驱动 (driver)。其中 Hermes 使用 ACP (Agent Client Protocol，客户端协议)；注册表机制允许无缝接入任何其他的 Agent。
- **模型层 (Model)** —— Claude / GPT / Gemini、国产系列 (DeepSeek、豆包、MiMo、MiniMax)，外加 OpenRouter 以及任何兼容 OpenAI 接口的代理服务。提供商 (Providers) 与配置项 (Profiles) 是一等公民模块，自带凭据保险箱、models.dev 目录以及面向各个 Agent 专属的环境变量注入能力。
- **工具层 (Tool)** —— Skills、MCP 服务器和 CLI 工具。它们会在全局和工作区两个层级进行智能合并，并被自动注入到每一次会话之中。

---

## 自举：用自己构建自己

> 检验一个 Agent 编排器是否靠谱，最硬核的标准就是看它能不能自举（构建自己）。pikiclaw 做到了。我们日常使用 pikiclaw 来开发、测试、发布和运维 pikiclaw —— 覆盖了每一次 Commit 和每一次版本发布。

在 pikiclaw 里的典型开发日常是这样的：

- 窗口 1 里的 Claude Code 会话正在实现一个全新的 dashboard 路由。
- 窗口 2 里的 Codex 会话正在为它编写配套的单元测试，并在同一个工作区下运行。
- 窗口 3 里的 Gemini 会话在 Review Diff，并起草更新日志。
- 与此同时，第四条线程中的技能 (`/sk_promote`) 正在自动扫描 GitHub 的相关 Issue 并尝试回复。
- 这四个进程完全并行运作；而掌控它们的人，可能只是坐在咖啡馆里用一部手机进行统筹安排。

这个编排器就是产品本身，同时，它也恰好是我们用来构建它的 IDE。

---

## 默认并发集群 (Swarm)

大多数「AI 开发工具」的基本假设是：一个用户，一次只让一个 Agent 做一件事。pikiclaw 的假设则完全相反：**N 个 Agent，N 个窗口，一位指挥官，一套工具箱。**

- **N 路并行会话** —— Dashboard 上的每一个面板都是一条独立的 Agent 流，对应着一个独立的会话工作区；如果接入 IM，还能随时开辟出更多的工作线程。
- **Agent 随意混搭** —— 面板 1 跑 Claude Code，面板 2 跑 Codex，面板 3 跑 Gemini，它们可以在不同的代码仓库和工作区中各司其职。
- **统一的工具箱** —— 全局的 Skills、全局 MCP 服务器以及工作区专属的覆盖配置都会进行统一管理。只需配置一次，后续所有会话即可自动继承。
- **随时随地介入** —— 你可以随时打断运行中的数据流，将新指令插队，或者把控制权顺滑交接给下一个 Agent。
- **群组协作模式** —— 把编排器拉进飞书 / Slack / Discord / 企业微信的聊天群中，团队成员便能集体共享这同一个 Agent 集群。

这正是我们认为最关键的形态：让每个创作者的指尖，都掌控着一支全天候待命的 AI 军队。

---

## 实际演示

> **真实任务** —— 让 pikiclaw 收集并总结今天的 AI 新闻；Agent 自动阅读、撰写，最后通过 Telegram 将结果推送到你的手机上。

<p align="center"><img src="docs/promo-demo.gif" alt="演示：从 Telegram 发起任务，Agent 在本地执行，结果回到聊天" width="780"></p>

> **Web Dashboard** —— 多面板工作区，包含会话列表、对话流、工具调用轨迹以及输入区域（支持 1 / 2 / 3 / 6 面板布局）。

<p align="center"><img src="docs/promo-dashboard-workspace.png" alt="Web Dashboard 工作区" width="780"></p>

<details>
<summary><b>更多细节：基础操作 · IM 接入 · Agent 管理 · 模型配置 · 扩展工具 · 权限 · 系统信息</b></summary>

> 发送消息，观察 Agent 的流式输出，接收返回的文件附件。

<img src="docs/promo-basic-ops.gif" alt="基础操作" width="780">

> **IM 接入** —— Telegram、飞书、微信、Slack、Discord、钉钉、企业微信的频道连接状态与参数配置。

<img src="docs/promo-dashboard-im.png" alt="IM 接入" width="780">

> **Agent 管理** —— 已安装的 Agent CLI 列表、默认 Agent 设定，以及各自独立的模型 / 推理强度配置。

<img src="docs/promo-dashboard-agents.png" alt="Agent" width="780">

> **模型配置** —— 整合了 Provider + Profile 的凭据库（涵盖 Claude、GPT、Gemini、DeepSeek、豆包、MiMo、MiniMax、OpenRouter 及任何兼容 OpenAI 接口的代理），支持通过 models.dev 目录进行验证，并为指定的 Agent 独立进行底层环境变量注入。

> **扩展工具** —— 统一管理全局 MCP 服务器、社区版 Skills、内置托管的浏览器环境及 macOS 桌面（Peekaboo）自动化能力。

<img src="docs/promo-dashboard-extensions.png" alt="扩展" width="780">

> **系统权限** —— macOS 辅助功能、屏幕录制及磁盘访问权限管理。

<img src="docs/promo-dashboard-permissions.png" alt="权限" width="780">

> **系统信息** —— 当前工作目录详情，以及 CPU / 内存 / 磁盘使用率的全天候监控。

<img src="docs/promo-dashboard-system.png" alt="系统信息" width="780">

</details>

---

## 快速开始

**前置要求：** 环境须具备 Node.js 20+，并且在系统中至少登录过一款官方的 Agent CLI：

- [`claude`](https://docs.anthropic.com/en/docs/claude-code) (Claude Code)
- [`codex`](https://github.com/openai/codex) (Codex CLI)
- [`gemini`](https://github.com/google-gemini/gemini-cli) (Gemini CLI)
- `hermes` (Hermes —— 基于 ACP / Agent Client Protocol 协议)

**启动命令：**

```bash
cd your-workspace
npx pikiclaw@latest
```

<p align="center"><img src="docs/promo-install.gif" alt="一行命令安装" width="780"></p>

这条命令会在 `http://localhost:3939` 自动唤起 **Web Dashboard**。随后，你就可以在浏览器里驱动任何会话、接入需要的 IM 渠道、灵活配置 Agent 和模型、快速安装 MCP 服务器与技能 (Skills)，并统筹所有的系统权限。其他一切功能，尽在一键之遥。

<details>
<summary><b>更喜欢传统的纯命令行配置？我们准备了专用的配置向导。</b></summary>

```bash
npx pikiclaw@latest --setup    # 开启交互式终端配置向导
npx pikiclaw@latest --doctor   # 仅检查并诊断当前环境
```

</details>

---

## 典型的应用场景

- **并发运行集群** —— 在 Dashboard 里打开 N 个面板（或者开辟 N 个 IM 线程），每个面板运行不同的 Agent 负责不同的工作区，完全并行运作。一个人，多个 Agent，同一个全局驾驶舱。你可以随时强力介入任何一个工作流。
- **自包含的闭环开发** —— pikiclaw 就是用 pikiclaw 自己开发出来的。这套开发流本身就是这款产品最原始的面貌：甚至可以在外用手机操作编排器，让 Agent 写代码、发布版本并不断迭代。
- **挂机式编程 (Walk-away coding)** —— 发起一个耗时极长的大型重构任务，合上笔记本，外出时直接用手机通过 Telegram 进行监控和控制。Agent 始终在本地机器上运行，结果则会流式实时推回聊天界面中。
- **同工作区多 Agent 接力** —— 先让 Claude Code 写一版功能草稿，无缝切给 Codex 去做深度 Review，最后再交给 Gemini 提供截然不同视角的优化建议。所有这些操作都在同一份代码目录和相同的历史会话中完成。
- **灵活的国产模型路由方案** —— 当你的任务对延迟、成本或合规有硬性要求时，通过模型驱动包装层，可以直接让 Claude Code 跑在实惠又快速的 DeepSeek 或豆包模型之上。
- **群聊协作级 Agent** —— 把 pikiclaw 拉入飞书 / Slack / Discord / 企业微信群聊内；整个团队可以共享这同一个编排器、统一的项目工作区和一系列团队专属技能。
- **完全受控的 Computer-use 能力** —— 开启内置的 Chrome 浏览器托管（基于 Playwright）和 macOS 桌面环境托管（基于 Peekaboo，通过辅助功能和 ScreenCaptureKit）。Agent 瞬间获得「视力」(`see`)、可以自由点击、打字，并管理窗口、菜单栏和 Dock，而你依然可以通过手机远程精准操控它。无论是帮你预定一场会议、抓取某个数据面板信息、跑一通端到端自动测试，还是驱动任何原生的 macOS 本地应用，全都不在话下。
- **基于 Skill 体系的自动化工作流** —— 一次性安装好社区提供的常用技能（例如 `promote`、`snipe`、`review`、`security-review` 等），往后只需在任何连接的终端里输入 `/sk_<name>` 即可实现一键触发。

---

## 核心特性

### 终端层 (Terminal)

- **支持七大主流 IM** —— 全面集成 Telegram、飞书、微信（个人号）、Slack、Discord、钉钉和企业微信。你可以只开启其中一个，也可以多开齐上。底层代码中每个渠道都做到绝对隔离；即使后续再添加新渠道（如 WhatsApp、自有移动 App 等），也丝毫不会影响现有逻辑的稳定性。
- **Web Dashboard 面板** —— 直接在网页浏览器中驱动所有会话，获得与 IM 完全一致的自然对话、工具调用轨迹跟踪和极速的流式反馈体验。面板提供 1 / 2 / 3 / 6 多窗口并发布局、深色/浅色自适应主题，以及纯正的中英文 (i18n) 双语支持。
- **实时流式预览** —— 每当 Agent 开始思考，消息都会实时在原地进行刷新；遇到超长文本能自动进行友好分段；生成的图片与文件也会即刻原样推回前端界面。

### Agent 层

- **官方 CLI 作为原生底层驱动** —— 内置接入 Claude Code、Codex CLI、Gemini CLI 以及 Hermes (通过 ACP 协议)。我们坚决拒绝自己「造一套套壳的 Agent 引擎」——只要上游核心推出了任何更新功能，你就可以在第一时间无损享用。
- **原生拥抱 ACP 协议** —— Hermes 的接入完全基于 [Agent Client Protocol](https://agentclientprotocol.com) 协议，通过系统标准的 JSON-RPC (输入/输出流) 唤起 `hermes acp`。这意味着在未来，任何兼容 ACP 协议的新 Agent 也能立刻无缝空降至平台。
- **自由可插拔的注册表机制** —— 在整套代码库中，这部分唯一的强制契约只有 `src/agent/driver.ts`。不论是基于传统 CLI 还是新兴 ACP 协议开发的各类新 Agent，都能随时加入注册表，与现有的四大核心内置引擎并肩作战。
- **无感会话级 Agent 切换** —— 你甚至不用离开当前代码工作区，就能在会话途中随时顺畅地帮 AI 更换一颗不同特性的「大脑」。
- **接管与干预 (Steer) 控制** —— 你可以随心所欲中断正在执行的繁重任务，让排队的紧急新消息直接插队至最前方处理。
- **Codex 人机协同机制 (Human-in-the-loop)** —— 当 Codex 需要你确认操作细节时，这些提示请求会自动转化发送为 IM 中的互动询问消息。你只需在平常用的聊天框内简单答复，暂停的任务就会完美接续运作。
- **长效目标系统 (Persistent goals)** —— 允许使用 `/goal` 指令，为指定的会话设定出伴有明确 Token 预算的长效终止目标。任务支持智能暂停/恢复，只有当 Agent 靠自行审计判定达到目标要求后，它才会结束自身当前进程。

### 模型层

- **全面涵盖前沿顶流、国产之光与各类代理** —— 囊括 Claude 家族系列、强大的 GPT-5 / Codex 以及 Gemini；国内优秀梯队的 DeepSeek、豆包 (Doubao)、MiMo 与 MiniMax；同时原生兼容 OpenRouter 和任意支持 OpenAI 通用接口格式的第三方代理服务。
- **Providers & Profiles 凭据专属保险箱** —— 构建了高标准隔离的数据保护模型，API 凭据会被单独加密存放在 `~/.pikiclaw/setting.json` 专属区域。你能在只读的 models.dev 目录进行便捷浏览、调用最真实的 API 探针来严谨验证密钥的有效性，最终再把这份 Profile 与指定的任意 Agent 相绑定，从而实现运行阶段环境变量参数的自动隔离注入。
- **极度自由的会话级配置选取** —— 无论是模型本体还是针对特定高难度任务的推理强度，你都能在友好的 Dashboard 界面中，或者直接发送指令 `/models` 与 `/mode` 来即时动态切选。
- **Agent 级别底层强制注入** —— 核心流函数 `resolveAgentInjection(agentId)` 在启动的最初阶段就会将对应的环境变量强行覆盖进去。这意味着，你竟然可以直接指令 Claude Code，让它全程跑在超高性价比的 DeepSeek 或是豆包核心大模型上，并且全程无需去改动其原本上游客户端里任何一行深层配置代码。

### 工具层

- **强大的技能系统 (Skills)** —— 这个系统让每一个工程专属技能被稳稳地存放在 `.pikiclaw/skills/*/SKILL.md` 内（同时也全面向下兼容标准的 `.claude/commands/*.md` 描述格式）。支持快速指定从 GitHub 的公开仓库（`owner/repo`）中实现极速的一键远程拉取并安装；或者去随便逛逛我们收录整理的精选套件包（比如备受好评的 Anthropic 官方包、或是好用的 Vercel Agent Skills 包等）。平时直接发个 `/skills` 探查当前载入的所有技能，挑准目标直接用 `/sk_<name>` 便可秒速触发。
- **最广泛主流的 MCP 服务器加持** —— 可以直接浏览接入 [MCP Registry](https://registry.modelcontextprotocol.io) 全球库或者自由手工增加本地 stdio 和网端 HTTP 服务；框架严格支持实机硬核握手健康侦测机制与 OAuth 2.1 高级动态客户端安全注册，且能精细拆分控制启用哪些作用域范围。目前精选优化的目录已毫无压力地涵盖 GitHub、Atlassian、Notion、Linear、Sentry、Cloudflare、Slack、飞书/Lark、Stripe、Hugging Face、Gamma、Brave Search、Perplexity、本地系统深度文件探测、SQLite 甚至专业的 PostgreSQL。此外，系统更逆天地内置附赠了两个重磅级的强力 Computer-use 级别核心服务（一个是基于大名鼎鼎的 Playwright 来暴躁驱动底层 Chrome 浏览器的 `pikiclaw-browser`；另一个则是依托极客向 Peekaboo 纯正血统，操控整个底层 macOS GUI 交互视窗的超级 `peekaboo` 工具）。
- **无缝衔接各类流行 CLI 神器** —— 底层逻辑强悍地支持自动探测各类版本兼容性并精准校验出授权登入状态。特别是遇到基于浏览器鉴权登录判定的 CLI，我们底层支持 OAuth-web 授权无缝接力。最后统统由 Agent 最原生的调用接口无缝唤起执行操作。
- **全局会话级的 MCP 底层桥接** —— `im_list_files`、`im_send_file`、`im_ask_user` 这些基建指令，再叠加前述的内置浏览器与 macOS 桌面自动化控制工具包（只要一旦开启安全开关），统统都会被全面自动注入进你的每一场会话里。
- **双域极简权限合并机制** —— 所有工具作用范围授权，永远只需遵循这条策略：`全局 (global) < 当前工作区 (workspace) < 内建 (built-in)`。底层引擎每次都能自动执行合并，并丝滑生效进后续发起的对话之中。

<p align="center"><img src="docs/promo-dashboard-extensions-add.png" alt="添加 MCP server" width="780"></p>

### 运行环境与开发者体验 (Runtime & DX)

- **独享会话级项目工作区** —— 每开启一次新的交锋会话，底层引擎都会为它开辟出单独专属的实体文件隔离目录，附件直接落在那里。
- **多轮会话回溯管控** —— 随便怎么恢复、切换，还配上了贴心的语义会话分类体系（快速分为解答、提案、实现，阻塞等清晰状态标识归类）。
- **基建工具流自注入** —— 强悍的 `im_list_files`、`im_send_file`、以及 `im_ask_user`，加上目标追踪管理工具等，会在启动前夕自动挂载。
- **Computer-use (浏览器引擎层)** —— 系统底层内置了 `pikiclaw-browser` MCP。这是二次封装了 `@playwright/mcp` 实现的，使其拥有进程级 Supervisor 监管机制，且达成了跨任务进程共享独立 Chrome 配置。只需要登录认证一次常用网站；在未来的任何任务里，这个工具将直接一键继承数据免签直连！
- **Computer-use (macOS 桌面控制层)** —— 当你在扩展面板启用 `peekaboo` MCP 并在系统设置授予终端“辅助功能”与“屏幕录制”权限后（仅限 macOS）；你即可借助 [Peekaboo](https://peekaboo.sh/) 框架的加持瞬间获得暴露在外的各种工具：视力 (`see`)；精准点击 (`click`)；虚空打字输入 (`type`)；操作滚轮 (`scroll`)；以及操作全系统窗口 (`window`)；主菜单 (`menu`)；程序生命周期 (`app`)；甚至是 Dock (`dock`) 等这一整套系统控制工具集。
- **长效任务坚固防线** —— 核心内置了防休眠系统、看门狗守护模块、异常自动重启涅槃机制、守护进程模式；还有渠道 Supervisor 督军服务。这豪华阵容保证你哪怕挂机跑极其漫长的任务，也能极度稳如磐石！

---

## 到底有什么不同？

| | pikiclaw | IDE 级智能助手<br>(Cursor / Windsurf / Aider) | 云端 Agent<br>(Devin / 网页版 Claude) | 单体 IM 机器人 |
|---|---|---|---|---|
| **操作终端** | 7 大 IM + Web + 持续扩展 | 仅限 IDE 内部 | 局限在专属网页端 | 死绑在单个 IM 内的单个 Bot |
| **Agent 运行地** | 完全在你自己的本地机器上 | 你的本地机器 | 厂商分配的云端沙盒里 | 往往在厂商服务器端 |
| **Agent 的选择** | Claude Code · Codex · Gemini · Hermes (ACP) · …（任你选） | 深度绑定没得选 | 单一 | 单一 |
| **底层模型抉择** | 国外前沿大模型 + 国产全系 + 任何兼容 OpenAI 接口的模型 | 平台控制 | 厂商绑定 | 单一无脑没得换 |
| **并发能力** | **N 个 Agent × N 个窗口 × N 个工作区** | 每个 IDE 窗口只能同时运行一个 | 串行排队 | 单一线程 |
| **文件与工具掌控** | 你主机上的所有本地文件、MCP 资源库、以及本地 CLI 系统 | 本地文件 | 沙盒受限环境 | 极度受限 |
| **接入新终端渠道** | 随便写个 `Channel` 基础实现类就能打通 | 无法实现 | 无法实现 | 需要 Fork 整个项目 |
| **接入新 Agent** | 实现一个简单的 `AgentDriver` 接口（CLI 或 ACP 均可）极速完成 | 无法实现 | 无法实现 | 需要 Fork 整个项目 |
| **能否自举开发** | **能！完全是由它自己一砖一瓦开发出来的！** | 不能 | 不能 | 不能 |

这个表格揭示了最核心的形态差异：**你不需要离开习惯的工作环境，你可以自由选择用哪颗「大脑」，你甚至可以并发操作一整支 AI 军队；而这个编排器本身，就是我们打造它的最佳工具。**

---

## 常用指令

| 指令 | 描述 |
|---|---|
| `/start` | 查看入口信息、当前 Agent 及工作目录 |
| `/sessions` | 查看、切换或新建会话 |
| `/agents` | 切换 Agent（Claude · Codex · Gemini · Hermes） |
| `/models` | 查看并切换当前会话的模型及推理强度 |
| `/mode` | 快捷切换计划模式 (推理强度) |
| `/switch` | 浏览并快速切换工作目录 |
| `/workspaces` | 从 Dashboard 收藏的快捷列表中选择工作区 |
| `/goal` | 设置或检视会话的长效目标（达成后 Agent 自动终止） |
| `/stop` | 强制停止当前会话 |
| `/status` | 检查运行状态、Token 消耗、资源使用及会话摘要 |
| `/host` | 监控主机的 CPU / 内存 / 磁盘 / 电池状态 |
| `/skills` | 浏览当前项目可用的所有技能 (Skills) |
| `/ext` | 快速查看扩展状态 |
| `/restart` | 重启并重新加载 Bot 服务 |
| `/sk_<name>` | 快速触发某个指定的项目技能 |

*注：不带斜杠的纯文本将作为普通消息直接发送给当前的 Agent。*

---

## 配置管理

- 核心持久化配置文件：`~/.pikiclaw/setting.json` —— 负责存储渠道、Agent、Providers/Profiles、工作区历史及 MCP 扩展等信息。
- Dashboard 是主要的配置入口；交互式的终端向导 (`--setup`) 与体检脚本 (`--doctor`) 主要为无 UI (headless) 环境准备。
- 全局 MCP 扩展配置存放于 `setting.json` 的 `extensions.mcp` 字段下。
- 工作区 MCP 扩展：遵循标准约定，存放于项目根目录的 `.mcp.json` 中。
- 项目专属技能：统一保存在 `.pikiclaw/skills/*/SKILL.md` 中（同时也兼容和加载 `.claude/commands/*.md` 格式）。

**Computer-use 的权限开关**需要在扩展面板独立控制：

- `browserEnabled` —— 开启后启用托管 Chrome（Playwright）。当 Agent 首次调用 Chrome 时，pikiclaw 会在 `~/.pikiclaw` 下生成专属配置文件，供后续会话跨任务复用。只需登录一次常用站点，今后即可免扫码直连。
- `peekabooEnabled` —— 开启后启用 macOS 桌面控制（Peekaboo）。该功能仅支持 macOS，开启后 pikiclaw 会拉起 `@steipete/peekaboo` 的 `peekaboo-mcp` 进程并挂载相关工具。*开启前，请务必前往 macOS 的「系统设置 → 隐私与安全性」，为启动 pikiclaw 的终端授予**辅助功能**和**屏幕录制**权限。*

---

## 产品路线图 (Roadmap)

我们已交付：Hermes 驱动支持 · ACP (Agent Client Protocol) 协议底层集成 · Provider/Profile 模型保险箱机制 · 七大 IM 渠道打通 · Computer-use 的落地（Playwright 浏览器托管 + Peekaboo macOS 桌面托管）。

- **接入更多 ACP Agent** —— 确保任何新的兼容 ACP 协议的 Agent 都能免代码零配置顺滑接入。
- **拓展终端生态** —— 将支持 WhatsApp、独立的移动端 App 以及语音交互模块。
- **深化模型层包装** —— 构建基于任意模型的通用 Agent Wrapper，以便无缝驱动更多优秀的国产模型。
- **完善工具生态** —— 推出官方推荐的 MCP 插件合集、Skill 模版库及社区应用市场。
- **全平台的 Computer-use** —— 在已有的 macOS Peekaboo 驱动之外，加入适配 Windows / Linux 操作系统的桌面控制支持。

想了解协议层的下一步动作，请参阅 [ACP 迁移计划](docs/acp-migration.md)。

---

## 本地开发

```bash
git clone https://github.com/xiaotonng/pikiclaw.git
cd pikiclaw
npm install
npm run build
npm test
```

```bash
npm run dev                       # 启动本地开发服务（--no-daemon，实时日志输出到 ~/.pikiclaw/dev/dev.log）
npm run build                     # 生产环境编译（Dashboard 构建 + tsc）
npm test                          # 运行 Vitest 测试套件
npx pikiclaw@latest --doctor      # 检测本机环境健康度
```

想要深度了解架构与集成细节，请参阅：[ARCHITECTURE.md](ARCHITECTURE.md) · [INTEGRATION.md](INTEGRATION.md) · [TESTING.md](TESTING.md)。

---

## 参与贡献

这个项目架构中的每一个分层，生来就是为了被**扩展**的。接入一个新终端、编写一个新 Agent、打造一款模型 Wrapper 或是增加实用的 MCP 工具 —— 这些全都是一等公民级别的贡献。

- 请先阅读 **[贡献指南](CONTRIBUTING.md)** 开始你的第一步。
- 欢迎关注贴有 [`good first issue`](https://github.com/xiaotonng/pikiclaw/labels/good%20first%20issue) 和 [`help wanted`](https://github.com/xiaotonng/pikiclaw/labels/help%20wanted) 标签的任务。
- 如果打算进行较大幅度的修改，请先提交 Issue 以便大家确认技术方案。

| 模块位置 | 你能拓展什么 |
|---|---|
| `src/agent/driver.ts`, `src/agent/drivers/*.ts`, `src/agent/acp-client.ts` | 增加一个新的 Agent Driver（基于 CLI 或是 ACP 协议） |
| `src/channels/base.ts`, `src/channels/*/` | 对接一个新的终端或 IM 渠道 |
| `src/model/`, `src/model/injector.ts` | 新增模型提供商，或者定制 Agent 环境的注入规则 |
| `src/dashboard/routes/*.ts` | 扩充 Dashboard 后端的 API 接口 |
| `src/agent/mcp/tools/*.ts`, `src/agent/mcp/bridge.ts` | 添加供单个会话专用的 MCP 工具 |
| `src/catalog/*.ts` | 向我们推荐优秀的 MCP Server、CLI 实用工具或优质技能仓库 |

---

## Star 历史趋势

<a href="https://www.star-history.com/#xiaotonng/pikiclaw&Date">
  <img src="https://api.star-history.com/svg?repos=xiaotonng/pikiclaw&type=Date" alt="Star 历史" width="640">
</a>

---

## 许可证

[MIT](LICENSE) —— 坚持开放构建。尽情使用、Fork 它，或者插入你自己开发的任意图层吧！
