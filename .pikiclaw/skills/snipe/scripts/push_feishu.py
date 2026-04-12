#!/usr/bin/env python3
"""飞书文档推送：创建飞书文档 + 发送卡片消息到群聊。

用法：
    python3 push_feishu.py --report-file /tmp/snipe_report.md
    echo "markdown" | python3 push_feishu.py --stdin

环境变量（从项目 .env 自动加载）：
    FEISHU_APP_ID      - 飞书应用 App ID
    FEISHU_APP_SECRET   - 飞书应用 App Secret
    FEISHU_CHAT_ID      - 接收消息的群聊 chat_id
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 需要 requests 库。运行: pip3 install requests", file=sys.stderr)
    sys.exit(1)

FEISHU_BASE = "https://open.feishu.cn/open-apis"

# ── .env 加载 ────────────────────────────────────

def _load_env():
    """从项目根目录的 .env 文件加载环境变量。"""
    # 向上查找 .env
    for parent in [Path(__file__).resolve().parent] + list(Path(__file__).resolve().parents):
        env_file = parent / ".env"
        if env_file.exists():
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        key, _, value = line.partition("=")
                        key = key.strip()
                        value = value.strip()
                        if key:
                            os.environ[key] = value
            break


# ── Token 缓存 ────────────────────────────────────

_token_cache = {"token": "", "expires_at": 0.0}


def _get_tenant_token(app_id: str, app_secret: str) -> str:
    """获取 tenant_access_token，缓存有效期内直接返回。"""
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"]:
        return _token_cache["token"]

    resp = requests.post(
        f"{FEISHU_BASE}/auth/v3/tenant_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"飞书 token 获取失败: {data}")

    token = data["tenant_access_token"]
    _token_cache["token"] = token
    _token_cache["expires_at"] = now + data.get("expire", 7200) - 100
    return token


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ── Markdown → 飞书 Blocks ────────────────────────

def _parse_inline(text: str) -> list:
    """解析行内格式：**bold**、[text](url)、普通文本。"""
    elements = []
    pattern = re.compile(r"\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)")
    last = 0
    for m in pattern.finditer(text):
        if m.start() > last:
            plain = text[last:m.start()]
            if plain:
                elements.append({"text_run": {"content": plain, "text_element_style": {}}})
        if m.group(1) is not None:
            elements.append(
                {"text_run": {"content": m.group(1), "text_element_style": {"bold": True}}}
            )
        else:
            elements.append(
                {
                    "text_run": {
                        "content": m.group(2),
                        "text_element_style": {"link": {"url": m.group(3)}},
                    }
                }
            )
        last = m.end()
    if last < len(text):
        tail = text[last:]
        if tail:
            elements.append({"text_run": {"content": tail, "text_element_style": {}}})
    if not elements:
        elements.append({"text_run": {"content": text, "text_element_style": {}}})
    return elements


def _make_text_block(block_type: int, key: str, elements: list) -> dict:
    return {"block_type": block_type, key: {"elements": elements}}


def md_to_feishu_blocks(md: str) -> list:
    """将 Markdown 转为飞书文档 block 列表。"""
    blocks = []
    lines = md.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # 分割线
        if re.match(r"^-{3,}\s*$", stripped):
            blocks.append({"block_type": 22, "divider": {}})
            i += 1
            continue

        # 标题
        heading_match = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading_match:
            level = len(heading_match.group(1))
            type_map = {1: (3, "heading1"), 2: (4, "heading2"), 3: (5, "heading3")}
            bt, key = type_map[level]
            elements = _parse_inline(heading_match.group(2))
            blocks.append(_make_text_block(bt, key, elements))
            i += 1
            continue

        # 引用块 (> ...)
        if stripped.startswith("> "):
            quote_text = stripped[2:]
            elements = _parse_inline(quote_text)
            # 飞书没有直接的 quote block，用 callout (block_type 19) 或普通文本加粗
            blocks.append(_make_text_block(2, "text", [
                {"text_run": {"content": "💬 " + quote_text, "text_element_style": {"italic": True}}}
            ]))
            i += 1
            continue

        # 无序列表
        bullet_match = re.match(r"^[-*]\s+(.+)$", stripped)
        if bullet_match:
            elements = _parse_inline(bullet_match.group(1))
            blocks.append(_make_text_block(12, "bullet", elements))
            i += 1
            continue

        # 有序列表
        ordered_match = re.match(r"^\d+[.)]\s+(.+)$", stripped)
        if ordered_match:
            elements = _parse_inline(ordered_match.group(1))
            blocks.append(_make_text_block(13, "ordered", elements))
            i += 1
            continue

        # 普通段落
        para_lines = [stripped]
        i += 1
        while i < len(lines):
            next_stripped = lines[i].strip()
            if not next_stripped:
                break
            if re.match(r"^(#{1,3}\s|[-*]\s|\d+[.)]\s|-{3,}|>)", next_stripped):
                break
            para_lines.append(next_stripped)
            i += 1

        full_text = "\n".join(para_lines)
        elements = _parse_inline(full_text)
        blocks.append(_make_text_block(2, "text", elements))

    return blocks


# ── 飞书 API ────────────────────────────────────

def _create_document(token: str, title: str, folder_token: str = "") -> tuple:
    """创建飞书文档，返回 (document_id, doc_url)。"""
    body = {"title": title}
    if folder_token:
        body["folder_token"] = folder_token

    resp = requests.post(
        f"{FEISHU_BASE}/docx/v1/documents",
        headers=_headers(token),
        json=body,
        timeout=15,
    )
    if not resp.ok:
        raise RuntimeError(f"创建文档失败 HTTP {resp.status_code}: {resp.text}")
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"创建文档失败: {data}")

    doc = data["data"]["document"]
    doc_id = doc["document_id"]
    doc_url = f"https://feishu.cn/docx/{doc_id}"
    return doc_id, doc_url


def _write_blocks(token: str, doc_id: str, blocks: list) -> None:
    """向文档根节点写入 block 内容，每批最多 50 个。"""
    batch_size = 50
    for start in range(0, len(blocks), batch_size):
        batch = blocks[start:start + batch_size]
        resp = requests.post(
            f"{FEISHU_BASE}/docx/v1/documents/{doc_id}/blocks/{doc_id}/children"
            f"?document_revision_id=-1",
            headers=_headers(token),
            json={"children": batch, "index": 0 if start == 0 else -1},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"写入 block 失败: {data}")


def _send_card_message(
    token: str, receive_id: str, title: str, summary: str, doc_url: str = "",
) -> None:
    """发送卡片消息。如果有 doc_url 则包含"打开文档"按钮，否则只发内容。"""
    elements = [
        {"tag": "div", "text": {"tag": "lark_md", "content": summary}},
    ]
    if doc_url:
        elements.append({"tag": "hr"})
        elements.append({
            "tag": "action",
            "actions": [
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "打开文档"},
                    "type": "primary",
                    "url": doc_url,
                }
            ],
        })
    card = {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": title},
            "template": "red",
        },
        "elements": elements,
    }
    resp = requests.post(
        f"{FEISHU_BASE}/im/v1/messages?receive_id_type=chat_id",
        headers=_headers(token),
        json={
            "receive_id": receive_id,
            "msg_type": "interactive",
            "content": json.dumps(card),
        },
        timeout=15,
    )
    data = resp.json()
    if not resp.ok or data.get("code") != 0:
        raise RuntimeError(f"发送消息失败 HTTP {resp.status_code}: {data}")


def _md_to_lark_md(report_md: str, max_len: int = 4000) -> str:
    """将 Markdown 报告转为飞书卡片支持的 lark_md 格式（精简版）。"""
    # 飞书卡片的 lark_md 支持: **bold**, [text](url), \n
    # 不支持: #标题 → 用 **加粗** 替代; > 引用 → 用普通文本; --- → 用换行
    lines = []
    for line in report_md.split("\n"):
        stripped = line.strip()
        if not stripped:
            lines.append("")
            continue
        # 标题 → 加粗
        if stripped.startswith("# "):
            lines.append(f"**{stripped[2:]}**")
        elif stripped.startswith("## "):
            lines.append(f"**{stripped[3:]}**")
        elif stripped.startswith("### "):
            lines.append(f"**{stripped[4:]}**")
        # 分割线
        elif stripped.startswith("---"):
            lines.append("─" * 20)
        # 引用 → 去掉 >
        elif stripped.startswith("> "):
            lines.append(stripped[2:])
        else:
            lines.append(stripped)

    result = "\n".join(lines)
    if len(result) > max_len:
        result = result[:max_len - 20] + "\n\n…（内容过长已截断）"
    return result


# ── 主入口 ────────────────────────────────────

def push_report(report_md: str) -> str:
    """推送 snipe 报告到飞书，返回结果信息。

    策略：先尝试创建文档 + 发通知卡片；
    如果文档创建失败（权限不足），降级为直接发送富文本卡片消息。
    """
    app_id = os.getenv("FEISHU_APP_ID", "")
    app_secret = os.getenv("FEISHU_APP_SECRET", "")
    chat_id = os.getenv("FEISHU_CHAT_ID", "")

    if not app_id or not app_secret:
        return "SKIP: 缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET"
    if not chat_id:
        return "SKIP: 缺少 FEISHU_CHAT_ID"

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    title = f"🎯 Snipe 候选（{now}）"

    try:
        token = _get_tenant_token(app_id, app_secret)

        # 尝试方案 A：创建文档 + 发通知
        doc_url = ""
        try:
            doc_id, doc_url = _create_document(token, title)
            blocks = md_to_feishu_blocks(report_md)
            if blocks:
                _write_blocks(token, doc_id, blocks)
            # 提取摘要发卡片
            summary_lines = [l.strip() for l in report_md.split("\n") if l.strip()][:5]
            summary = "\n".join(summary_lines)
            _send_card_message(token, chat_id, title, summary, doc_url)
            return f"OK: 文档已创建并推送通知 → {doc_url}"
        except Exception as doc_err:
            # 方案 A 失败，降级到方案 B
            err_str = str(doc_err)
            if "99991672" in err_str or "scope" in err_str.lower() or "permission" in err_str.lower():
                pass  # 权限不足，走降级方案
            else:
                raise  # 其他错误直接抛出

        # 方案 B：直接发送富文本卡片消息（只需 im:message:send_as_bot）
        lark_md = _md_to_lark_md(report_md)
        _send_card_message(token, chat_id, title, lark_md)
        return "OK: 已通过卡片消息推送报告（文档权限不足，降级为卡片模式）"

    except Exception as e:
        return f"ERROR: {e}"


def main():
    parser = argparse.ArgumentParser(description="推送 snipe 报告到飞书")
    parser.add_argument("--report-file", help="Markdown 报告文件路径")
    parser.add_argument("--stdin", action="store_true", help="从 stdin 读取报告")
    args = parser.parse_args()

    _load_env()

    if args.report_file:
        with open(args.report_file) as f:
            report_md = f.read()
    elif args.stdin:
        report_md = sys.stdin.read()
    else:
        parser.print_help()
        sys.exit(1)

    if not report_md.strip():
        print("ERROR: 报告内容为空", file=sys.stderr)
        sys.exit(1)

    result = push_report(report_md)
    print(result)

    if result.startswith("ERROR"):
        sys.exit(1)


if __name__ == "__main__":
    main()
