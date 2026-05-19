# Pikiclaw on Docker

> 中文版在文末 ↓ — [中文文档](#中文文档)

Pikiclaw ships an official multi-arch image so you can run the bot on a
Linux server (or any Docker host) without installing Node or the agent CLIs
on the host itself. The image bakes in `claude-code`, `codex`, and
`gemini-cli` and exposes the web dashboard on port `3939`.

| Tag                        | When it's pushed                              |
|----------------------------|-----------------------------------------------|
| `ghcr.io/xiaotonng/pikiclaw:latest`  | newest tagged release                |
| `ghcr.io/xiaotonng/pikiclaw:vX.Y.Z`  | exact version (recommended in production)     |
| `ghcr.io/xiaotonng/pikiclaw:X.Y`     | latest patch on the X.Y line                  |
| `ghcr.io/xiaotonng/pikiclaw:edge`    | rolling build from `main` — for early adopters |

Supported platforms: `linux/amd64`, `linux/arm64`.

---

## 1. Quick start (docker run)

```bash
docker run -d --name pikiclaw --restart unless-stopped \
  -p 3939:3939 \
  -e TELEGRAM_BOT_TOKEN=123456:replace_me \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v pikiclaw-config:/home/piki/.pikiclaw \
  -v pikiclaw-workspace:/workspace \
  ghcr.io/xiaotonng/pikiclaw:latest
```

Then open `http://<host>:3939` and finish setup from the dashboard.

## 2. docker compose (recommended)

The repo ships a ready-to-use `docker-compose.yml`. Put your secrets in a
`.env` next to it:

```bash
cp .env.example .env
# edit .env — at minimum one IM token + one agent API key
docker compose up -d
docker compose logs -f
```

The compose file declares two named volumes:

- `pikiclaw-config` → `/home/piki/.pikiclaw` — `setting.json`, MCP/CLI
  state, sessions, etc. Keep this across upgrades.
- `pikiclaw-workspace` → `/workspace` — the project tree the agent reads
  and writes. Swap to a host bind mount if you want to edit it from your
  IDE on the host.

## 3. Authentication

The image bakes the agent CLIs but ships with **zero credentials**. Pick one
path per agent:

### A. API keys via env vars (simplest, recommended for headless servers)

| Agent  | Env var |
|--------|---------|
| Claude Code | `ANTHROPIC_API_KEY` *or* `CLAUDE_CODE_OAUTH_TOKEN` |
| Codex  | `OPENAI_API_KEY` |
| Gemini | `GEMINI_API_KEY` |

For Claude, you can obtain a long-lived OAuth token on a host with a browser
by running `claude setup-token`, then paste it as `CLAUDE_CODE_OAUTH_TOKEN`
into the container env.

### B. Reuse an existing host OAuth login (bind mount)

If you already ran `claude login` / `codex login` on the same host the
container runs on, you can mount the per-CLI config dirs:

```yaml
volumes:
  - ${HOME}/.claude:/home/piki/.claude
  - ${HOME}/.codex:/home/piki/.codex
  - ${HOME}/.gemini:/home/piki/.gemini
```

This also makes **agent session history sync** between the host and the
container — codex / claude / gemini each store their per-session transcripts
under these directories (`~/.codex/sessions/`, `~/.claude/projects/`, …), so a
conversation you started on the host can be resumed inside the container and
vice-versa. If you don't bind-mount (i.e. you keep the default named-volume
layout), each environment keeps its own independent session history.

⚠️ The container runs as **uid 1000**. If your host user has a different uid,
either rebuild the image with `--build-arg PUID=<your-uid> --build-arg PGID=<your-gid>`,
or `chown` the mounted directories.

### C. Log in from inside the container (one-off)

For OAuth flows that print a device code, you can run the login command
interactively without a host browser:

```bash
docker exec -it pikiclaw claude /login
# or
docker exec -it pikiclaw codex login
```

Tokens land in `/home/piki/.{claude,codex,gemini}` and survive container
restarts as long as that path is on a volume (it is, by default in
compose).

## 4. Environment variables

All pikiclaw env vars from `pikiclaw --help` are honored. The most useful
ones inside Docker:

| Var | Default in image | Purpose |
|-----|------------------|---------|
| `PIKICLAW_WORKDIR`   | `/workspace` | Where the agent reads/writes |
| `PIKICLAW_TIMEOUT`   | `1800`       | Max seconds per agent request |
| `PIKICLAW_FULL_ACCESS` | `true`     | Codex full-access + Claude bypassPermissions |
| `PIKICLAW_DOCKER`    | `1`          | Suppresses host-side actions (xdg-open, launchd) |
| `PIKICLAW_OPEN_BROWSER` | `0`       | Don't try to open a host browser at boot |
| `DEFAULT_AGENT`      | `claude`     | `claude` / `codex` / `gemini` |
| `CLAUDE_MODEL` / `CODEX_MODEL` / `GEMINI_MODEL` | — | Override default model |
| `TELEGRAM_BOT_TOKEN` | —            | Telegram channel |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | — | Feishu channel |

You can also configure everything from the web dashboard — settings persist
to `/home/piki/.pikiclaw/setting.json`.

## 5. Pin agent CLI versions

Build a custom image pinning each agent CLI exactly:

```bash
docker build \
  --build-arg CLAUDE_CODE_VERSION=2.4.10 \
  --build-arg CODEX_VERSION=0.135.1 \
  --build-arg GEMINI_CLI_VERSION=0.74.0 \
  -t pikiclaw:pinned .
```

This is the path we recommend for production — the floating `latest` tags
of each agent CLI can introduce breaking changes between pikiclaw releases.

Agent CLIs live under `/home/piki/.npm-global` (a per-user npm prefix), so the
dashboard's auto-updater and `npm install -g <pkg>@latest` from inside the
container both work without `sudo`. Skills installed via the Extensions tab
land under `/home/piki/.pikiclaw/skills/` (persisted on the `pikiclaw-config`
volume) so they also survive restarts and upgrades.

The image bundles **`gh`** (GitHub CLI) for agent skills that lean on it
(release / PR triage, issue automation, …). Run `docker exec -it pikiclaw gh
auth login` once to attach a token, or pass `GH_TOKEN` as a container env var.

## 6. Reverse proxy / TLS

The dashboard speaks plain HTTP. For internet-facing deployments put a TLS
terminator in front (Caddy, Nginx, Traefik). Example Caddy snippet:

```caddyfile
pikiclaw.example.com {
  reverse_proxy localhost:3939
}
```

The dashboard speaks WebSocket on `/ws`; most reverse proxies upgrade it
transparently, but verify your proxy isn't stripping `Upgrade` headers.

## 7. Updating

```bash
docker compose pull && docker compose up -d
```

The named volumes are preserved across pulls, so your `setting.json`,
sessions, and agent auth survive.

## 8. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Healthcheck flapping for the first 30 s | Normal — the bot finishes wiring channels after the dashboard binds. `start_period: 20s` allows for this. |
| `claude` exits with "no credentials" | No `ANTHROPIC_API_KEY` set and no mounted `.claude/` dir. See §3. |
| Files written by the agent are owned by `1000:1000` on the host | Expected. Either run the container as your host uid (`--user $(id -u):$(id -g)`) or `chown` after. |
| Dashboard reachable from localhost only | The compose file publishes on `0.0.0.0:3939`. Behind NAT / cloud, check your security group / firewall. |

## 9. Building locally

```bash
docker build -t pikiclaw:local .
docker run --rm -it -p 3939:3939 \
  -v pikiclaw-config:/home/piki/.pikiclaw \
  -v pikiclaw-workspace:/workspace \
  -e TELEGRAM_BOT_TOKEN=... \
  -e ANTHROPIC_API_KEY=... \
  pikiclaw:local
```

The Dockerfile is multi-stage; first build is ~3–5 min, incremental builds
land in seconds thanks to BuildKit layer caching.

---

## 中文文档

Pikiclaw 官方镜像让你**不必在服务器上装 Node 或 agent CLI** 就能跑起来。
镜像内置 `claude-code`、`codex`、`gemini-cli`，并通过 3939 端口暴露 Web 控制台。

### 一键启动

```bash
docker run -d --name pikiclaw --restart unless-stopped \
  -p 3939:3939 \
  -e TELEGRAM_BOT_TOKEN=123456:replace_me \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v pikiclaw-config:/home/piki/.pikiclaw \
  -v pikiclaw-workspace:/workspace \
  ghcr.io/xiaotonng/pikiclaw:latest
```

浏览器打开 `http://<服务器IP>:3939` 完成剩余配置。

### docker compose（推荐）

仓库内自带 `docker-compose.yml` 和 `.env.example`：

```bash
cp .env.example .env   # 填入 IM token 和 agent API key
docker compose up -d
```

挂载点：

- `pikiclaw-config` → `/home/piki/.pikiclaw`：`setting.json`、会话、MCP/CLI 状态。
- `pikiclaw-workspace` → `/workspace`：agent 读写的项目目录。

### Agent 鉴权

最简单：传 API key 环境变量
（`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`）。

如果你想复用宿主机已经登录好的 OAuth：

```yaml
volumes:
  - ${HOME}/.claude:/home/piki/.claude
  - ${HOME}/.codex:/home/piki/.codex
  - ${HOME}/.gemini:/home/piki/.gemini
```

容器内默认 uid 是 1000，与宿主机 uid 不一致时请用 `--build-arg PUID=…`
重建，或对挂载目录执行 `chown`。

### 更新

```bash
docker compose pull && docker compose up -d
```

命名卷不会被清空，setting.json 与 agent 凭证都会保留。

### 反向代理

镜像里只跑 HTTP，对外暴露建议套一层 Caddy/Nginx/Traefik，
注意放行 `/ws` 的 WebSocket Upgrade。

### 反馈

镜像相关问题请在 [issue #16](https://github.com/xiaotonng/pikiclaw/issues/16)
留言，或直接新开 issue。
