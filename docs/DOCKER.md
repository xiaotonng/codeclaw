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

> ⚠️ **Codex SQLite corruption risk.** The Codex CLI keeps its state in a
> SQLite database under `~/.codex/`. SQLite does **not** tolerate concurrent
> writers from different processes when the file lives on a docker bind mount,
> nor does it tolerate two binaries of different versions opening the same db.
> If you mount `~/.codex` into the container, you **must** treat it as a
> single-writer file:
>
> - Do not run the host's Codex desktop app while the docker container is
>   also running with codex active. Stop one before using the other.
> - When you `docker pull` a newer pikiclaw image, the codex CLI baked into
>   the image (see §5) may be newer than the host's. Either pin the
>   `CODEX_VERSION` build-arg to match the host, or upgrade the host's codex
>   at the same time.
> - If you only need OAuth credentials (and don't need to share session
>   history), mount **just** the auth file read-only — this avoids the db
>   entirely:
>
>   ```yaml
>   volumes:
>     - ${HOME}/.codex/auth.json:/home/piki/.codex/auth.json:ro
>   ```
>
> Symptoms of a corrupted db: when launching Codex desktop you see
> `database disk image is malformed` / `error returned from database: (code: 11)`.
> Recovery: stop both the container and Codex desktop, back up `~/.codex/`,
> remove the corrupted `*.db` and `*.db-*` files, then relaunch — Codex will
> rebuild a clean database (session history will be lost; the backup is your
> only chance to recover it manually).

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
| `PIKICLAW_BROWSER_CDP_URL` | —      | Attach to an external Chrome DevTools Protocol endpoint (e.g. `http://chromium:9223`) instead of launching local Chrome. Also turns browser tooling on. See §6. |
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

## 6. Browser automation (remote Chrome via CDP)

The base image **does not bundle Chrome** — a headless Chromium + Xvfb + fonts
would push the image past 1 GB and the browser still wouldn't be useful for
sites that require an interactive sign-in. Instead, pikiclaw attaches to *any*
external Chrome DevTools Protocol endpoint via `PIKICLAW_BROWSER_CDP_URL`.
Setting that variable alone turns on browser tooling — you do **not** also need
`PIKICLAW_BROWSER_ENABLED`.

The recommended pattern is a Chromium sidecar (real browser + web-VNC for
signing in) plus a tiny **socat CDP bridge**:

```yaml
services:
  pikiclaw:
    image: ghcr.io/xiaotonng/pikiclaw:latest
    environment:
      PIKICLAW_BROWSER_CDP_URL: http://chromium:9223
    depends_on: [chromium]
    # …rest of the pikiclaw service as before

  chromium:
    image: lscr.io/linuxserver/chromium:latest
    container_name: pikiclaw-chromium
    environment:
      PUID: 1000
      PGID: 1000
      TZ: Etc/UTC
      # --remote-allow-origins=* is REQUIRED (see below).
      CHROME_CLI: "--remote-debugging-port=9222 --remote-allow-origins=*"
    ports:
      - "3000:3000"   # web UI (KasmVNC) — open this in your browser to sign in
      - "3001:3001"   # https variant of the web UI
    volumes:
      - chromium-config:/config
    shm_size: 1gb
    restart: unless-stopped

  # Exposes Chrome's localhost-only CDP to pikiclaw. See "Why the bridge?" below.
  chromium-cdp-bridge:
    image: alpine/socat:latest
    container_name: pikiclaw-chromium-cdp-bridge
    network_mode: "service:chromium"
    depends_on: [chromium]
    command: TCP-LISTEN:9223,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9222
    restart: unless-stopped

volumes:
  chromium-config:
```

How to use it:

1. `docker compose up -d`
2. Open `http://<host>:3000` in your browser — that's the Chromium running
   inside the sidecar. Sign in to whichever sites the agent needs
   (Google / GitHub / your internal SSO). The profile is persisted in the
   `chromium-config` named volume, so logins survive restarts.
3. That's it — `PIKICLAW_BROWSER_CDP_URL` already enabled the tool. (You can
   still toggle it from Extensions → Browser in the dashboard; it will show
   "Remote CDP" and the endpoint instead of a local profile.)

Pikiclaw will now drive the *same* Chromium session — every `browser_*` MCP
tool call attaches to the running Chromium over CDP, so the agent inherits
your logged-in state.

### Why the bridge?

`lscr.io/linuxserver/chromium` (and most desktop Chromium builds) launch Chrome
with its debug port bound to `127.0.0.1` and **ignore
`--remote-debugging-address=0.0.0.0`**, so another container cannot reach
`chromium:9222` directly. The `socat` sidecar runs inside the Chromium
container's network namespace (`network_mode: "service:chromium"`) and forwards
`0.0.0.0:9223 → 127.0.0.1:9222`. Because socat connects to Chrome from
`127.0.0.1`, it also satisfies Chrome's host-header check — so pikiclaw points
at the bridge port (`http://chromium:9223`).

`--remote-allow-origins=*` is **required**: since Chrome 111, the CDP WebSocket
handshake is rejected with `403 Forbidden` unless the requesting origin is
allowlisted. Without it the bridge connects but every `browser_*` call fails.

Alternative endpoints that need **no** bridge (they already bind `0.0.0.0` and
allow remote origins):

- **`browserless/chrome`** — purpose-built CDP service, no VNC layer
  (set `PIKICLAW_BROWSER_CDP_URL=http://browserless:3000`, drop both the
  `chromium` and `chromium-cdp-bridge` services).
- **An existing Chrome on the host** started with
  `--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --remote-allow-origins=*` —
  `PIKICLAW_BROWSER_CDP_URL=http://host.docker.internal:9222`
  (Linux: add `extra_hosts: ["host.docker.internal:host-gateway"]`).

When `PIKICLAW_BROWSER_CDP_URL` is set, pikiclaw never tries to launch or
SIGKILL a local Chrome — the sidecar is treated as a managed external service.
If the endpoint is momentarily unreachable, the `browser_*` call surfaces a
connection error instead of silently falling back to a (non-existent) local
Chrome.

## 7. Reverse proxy / TLS

The dashboard speaks plain HTTP. For internet-facing deployments put a TLS
terminator in front (Caddy, Nginx, Traefik). Example Caddy snippet:

```caddyfile
pikiclaw.example.com {
  reverse_proxy localhost:3939
}
```

The dashboard speaks WebSocket on `/ws`; most reverse proxies upgrade it
transparently, but verify your proxy isn't stripping `Upgrade` headers.

## 8. Updating

```bash
docker compose pull && docker compose up -d
```

The named volumes are preserved across pulls, so your `setting.json`,
sessions, and agent auth survive.

## 9. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Healthcheck flapping for the first 30 s | Normal — the bot finishes wiring channels after the dashboard binds. `start_period: 20s` allows for this. |
| `claude` exits with "no credentials" | No `ANTHROPIC_API_KEY` set and no mounted `.claude/` dir. See §3. |
| Files written by the agent are owned by `1000:1000` on the host | Expected. Either run the container as your host uid (`--user $(id -u):$(id -g)`) or `chown` after. |
| Dashboard reachable from localhost only | The compose file publishes on `0.0.0.0:3939`. Behind NAT / cloud, check your security group / firewall. |

## 10. Building locally

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

> ⚠️ **Codex SQLite 损坏风险。** Codex CLI 把状态写在 `~/.codex/` 下的
> SQLite 数据库里。SQLite 不支持跨 docker bind mount 的并发写入，也不
> 支持两个不同版本的 codex 同时打开同一个 db。如果你挂载了 `~/.codex`：
>
> - 不要在容器跑着的时候同时打开宿主机的 Codex desktop。要用哪个，
>   先把另一个关掉。
> - `docker pull` 拉到新版镜像后，镜像里 baked 的 codex CLI 版本
>   （见 §5）可能跟宿主版本不一致。请用 `--build-arg CODEX_VERSION=`
>   把版本钉死，或者同步升级宿主机的 codex。
> - 如果你只是需要复用 OAuth 凭证、不需要共享会话历史，可以**只**
>   挂载凭证文件，以只读方式挂载，这样可以完全绕开 db：
>
>   ```yaml
>   volumes:
>     - ${HOME}/.codex/auth.json:/home/piki/.codex/auth.json:ro
>   ```
>
> db 损坏的典型表现：宿主机打开 Codex desktop 时弹出
> `database disk image is malformed` / `error returned from database: (code: 11)`。
> 恢复方法：先把容器和 Codex desktop 都停掉，备份 `~/.codex/`，删掉损坏的
> `*.db` 和 `*.db-*` 文件，再启动 codex，它会重建一个干净的数据库
> （会话历史会丢失，备份是你手动恢复历史的唯一机会）。

容器内默认 uid 是 1000，与宿主机 uid 不一致时请用 `--build-arg PUID=…`
重建，或对挂载目录执行 `chown`。

### 浏览器自动化（外接 Chrome）

镜像本身不打包 Chrome（避免镜像膨胀到 1GB+，且容器里没显示器也用不起来）。
推荐做法是起一个 Chromium 边车容器（带网页 VNC 给你登录用），再加一个 socat
**CDP 桥接**，pikiclaw 通过桥接端口接进去。只要设置了
`PIKICLAW_BROWSER_CDP_URL`，浏览器工具就会自动打开，**无需**再设
`PIKICLAW_BROWSER_ENABLED`：

```yaml
services:
  pikiclaw:
    environment:
      PIKICLAW_BROWSER_CDP_URL: http://chromium:9223
    depends_on: [chromium]

  chromium:
    image: lscr.io/linuxserver/chromium:latest
    environment:
      # --remote-allow-origins=* 必须加，否则 Chrome 111+ 会用 403 拒绝跨主机握手。
      CHROME_CLI: "--remote-debugging-port=9222 --remote-allow-origins=*"
    ports:
      - "3000:3000"   # 网页 VNC，给你自己登录用
    volumes:
      - chromium-config:/config
    shm_size: 1gb

  # 把 Chrome 只绑在 127.0.0.1 的调试端口转发成 0.0.0.0:9223，让 pikiclaw 能连上。
  chromium-cdp-bridge:
    image: alpine/socat:latest
    network_mode: "service:chromium"
    depends_on: [chromium]
    command: TCP-LISTEN:9223,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9222
```

部署后用浏览器打开 `http://<服务器IP>:3000`，在容器里那个 Chromium 上登录
Google / GitHub / 公司 SSO 等。登录态会持久化到 `chromium-config` 卷里。
pikiclaw 通过桥接的 9223 端口 attach 同一份 Chromium，agent 自动继承你的登录态。

**为什么要桥接？** `lscr.io/linuxserver/chromium`（以及大多数桌面版 Chromium）
会忽略 `--remote-debugging-address=0.0.0.0`，调试端口只绑在 `127.0.0.1`，别的
容器直接连 `chromium:9222` 连不上。socat 边车跑在 chromium 的网络命名空间里
（`network_mode: "service:chromium"`），把 `0.0.0.0:9223` 转发到
`127.0.0.1:9222`；因为 socat 是从 `127.0.0.1` 发起连接，顺带绕过了 Chrome 的
host 头校验。

不需要桥接的替代方案（它们本身就绑 `0.0.0.0` 且放开了 origin）：
- **`browserless/chrome`**：专门的 CDP 服务，无 VNC，直接
  `PIKICLAW_BROWSER_CDP_URL=http://browserless:3000`，省掉上面两个服务。
- **宿主机已有的 Chrome**（启动参数带
  `--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --remote-allow-origins=*`）：
  `PIKICLAW_BROWSER_CDP_URL=http://host.docker.internal:9222`
  （Linux 宿主需要在 compose 里加 `extra_hosts: ["host.docker.internal:host-gateway"]`）。

设置了 `PIKICLAW_BROWSER_CDP_URL` 之后，pikiclaw 不再尝试启动或杀掉本地 Chrome —
sidecar 完全由你管；端点临时连不上时，`browser_*` 调用会直接报连接错误，而不会
偷偷回退去拉本地 Chrome。

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
