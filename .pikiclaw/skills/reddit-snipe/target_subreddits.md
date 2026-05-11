# Reddit-snipe 目标 sub 白名单

每个 sub 记录：URL · 主题契合度 · mod 严格度 · 评论形态 · 备注。

**评论形态**（用于 SKILL.md Step 5 选模板）：
- `link` — 允许在评论里贴 `npx pikiclaw@latest` + GitHub 链接
- `no-link` — 只口头提 pikiclaw 名字（automod 会过滤含外链的评论 / sub rule 禁止）
- `skip` — 不评论。mod 极严，任何第三方工具评论都会删 — 不浪费 ammo

身份永远是 pikiclaw builder（不存在"隐藏身份攒 karma"模式）；唯一变化的是评论里是否带链接。

## Tier 1 · 高契合度 · 主战场

| Sub | 主题契合 | mod 严格度 | 评论形态 | 备注 |
|-----|---------|-----------|---------|------|
| [r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/) | ★★★★★ | 中 | link | Claude 用户大本营。允许 "I built X"，禁纯广告 |
| [r/ChatGPTCoding](https://www.reddit.com/r/ChatGPTCoding/) | ★★★★★ | 中 | link | coding agent / Cursor / Aider / Cline 讨论密集 |
| [r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/) | ★★★★ | 中偏严 | link | 偏自托管 + 本地 LLM。pikiclaw 本地运行属性正中靶心 |
| [r/AI_Agents](https://www.reddit.com/r/AI_Agents/) | ★★★★★ | 中 | link | agent 主题最直接的 sub。规模不大但高纯度 |
| [r/cursor](https://www.reddit.com/r/cursor/) | ★★★★ | 中 | link | Cursor 用户群，部分人在找替代/补充 |

## Tier 2 · Launch-friendly — 适合 Show & Tell

| Sub | 主题契合 | mod 严格度 | 评论形态 | 备注 |
|-----|---------|-----------|---------|------|
| [r/SideProject](https://www.reddit.com/r/SideProject/) | ★★★★ | 宽 | link | 周末 launch thread。评论也活跃 |
| [r/coolgithubprojects](https://www.reddit.com/r/coolgithubprojects/) | ★★★★ | 宽 | link | 直接展示 GitHub 项目 |
| [r/opensource](https://www.reddit.com/r/opensource/) | ★★★ | 中 | link | 强调 OSS 属性时打 |
| [r/selfhosted](https://www.reddit.com/r/selfhosted/) | ★★★ | 中 | link | "runs entirely local" 是契合点 |

## Tier 3 · 同领域 · 严格 — 谨慎进入

| Sub | 主题契合 | mod 严格度 | 评论形态 | 备注 |
|-----|---------|-----------|---------|------|
| [r/Anthropic](https://www.reddit.com/r/Anthropic/) | ★★★ | 严 | no-link | Anthropic 官方氛围。禁第三方工具推广链接；口头提 ok |
| [r/OpenAI](https://www.reddit.com/r/OpenAI/) | ★★ | 中偏严 | no-link | 体量大但话题分散，转化率低；automod 删外链激进 |
| [r/ChatGPT](https://www.reddit.com/r/ChatGPT/) | ★ | 中 | no-link | 太广，多是新手讨论 ROI 低 |
| [r/programming](https://www.reddit.com/r/programming/) | ★★ | 极严 | skip | 99% 工具评论被删 — 不浪费 ammo |
| [r/MachineLearning](https://www.reddit.com/r/MachineLearning/) | ★★ | 极严 | skip | 学术氛围，明确禁 self-promotion |

## Tier 4 · 通道类 sub — 体验差异化时用

| Sub | 主题契合 | mod 严格度 | 评论形态 | 备注 |
|-----|---------|-----------|---------|------|
| [r/TelegramBots](https://www.reddit.com/r/TelegramBots/) | ★★★ | 中 | link | "Claude Code over Telegram" 角度 |
| [r/Notion](https://www.reddit.com/r/Notion/) | ★ | 中 | no-link | 偶尔 cross-tool 讨论，非主战场 |

## 关键词 ⇄ Sub 映射（路由提示）

| 关键词出现于帖子时 | 优先在这些 sub 找 |
|-------------------|------------------|
| `claude code`, `claude on mobile`, `remote claude` | r/ClaudeAI, r/Anthropic, r/ChatGPTCoding |
| `codex cli`, `gpt-5 coding` | r/ChatGPTCoding, r/OpenAI |
| `gemini cli`, `gemini coding` | r/Bard, r/ChatGPTCoding |
| `coding agent`, `multi-agent` | r/AI_Agents, r/LocalLLaMA, r/ChatGPTCoding |
| `dashboard`, `orchestrator`, `manager` | r/AI_Agents, r/SideProject |
| `mcp`, `skill`, `plugin` | r/ClaudeAI, r/AI_Agents |
| `self host`, `local`, `offline` | r/LocalLLaMA, r/selfhosted, r/opensource |
| `telegram bot`, `feishu`, `wechat` | r/TelegramBots, r/SideProject |

## 巡逻顺序建议（默认 sweep 时）

每个 sub **同时**抓三个视图（hot / new / top-week 或 top-month）— Reddit 老帖 evergreen 价值高，不要只看 new。

1. **r/ClaudeAI** — hot + new + top-week — 最直接的 Claude Code 讨论池
2. **r/AI_Agents** — new + top-month — agent 主题纯度最高，但 sub 较小、top-month 才能看到真高热度帖
3. **r/ChatGPTCoding** — hot + top-week — coding agent 横向比较密集，时效低不影响
4. **r/LocalLLaMA** — hot + top-week — 自托管视角
5. **r/cursor** — new + hot — 找正在评估替代方案的用户
6. **r/SideProject + r/coolgithubprojects** — new + top-week — 同行 builder 之间互相串门

每个视图抓一页（25 条左右），合并 + 去重后统一过滤。**优先级 1（OP 求解具体痛点）的旧帖比优先级 5（泛讨论）的新帖更值得回复。**

## 维护

- 发现新有用 sub → 加入对应 Tier
- 某 sub 评论被删 → 评论形态降级（`link` → `no-link`；`no-link` → `skip`）
- 每 2-4 周回看一次，根据实际命中率调整 Tier 和形态
