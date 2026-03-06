/**
 * Telegram channel — all Telegram Bot API interaction for codeclaw.
 *
 * Handles: messaging, formatting, inline keyboards, pagination,
 * callback queries, photo/document handling, streaming display,
 * interactive prompt detection, and the polling loop.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { VERSION, VALID_ENGINES, normalizeSessionName, normalizeEngine } from './codeclaw.js';

// ---------------------------------------------------------------------------
// Telegram formatting helpers
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToTgHtml(text) {
  const result = [];
  const lines = text.split('\n');
  let i = 0;
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines = [];

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();

    if (stripped.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        const remainder = stripped.slice(3).trim();
        codeLang = remainder ? remainder.split(/\s/)[0] : '';
        codeLines = [];
      } else {
        inCodeBlock = false;
        const codeContent = escapeHtml(codeLines.join('\n'));
        if (codeLang) {
          result.push(`<pre><code class="language-${escapeHtml(codeLang)}">${codeContent}</code></pre>`);
        } else {
          result.push(`<pre>${codeContent}</pre>`);
        }
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      result.push(`<b>${mdInlineToHtml(headingMatch[2])}</b>`);
      i++;
      continue;
    }

    result.push(mdInlineToHtml(line));
    i++;
  }

  if (inCodeBlock && codeLines.length) {
    const codeContent = escapeHtml(codeLines.join('\n'));
    result.push(`<pre>${codeContent}</pre>`);
  }

  return result.join('\n');
}

function mdInlineToHtml(line) {
  const parts = [];
  let remaining = line;
  while (remaining.includes('`')) {
    const idx = remaining.indexOf('`');
    const end = remaining.indexOf('`', idx + 1);
    if (end === -1) break;
    parts.push(formatTextSegment(remaining.slice(0, idx)));
    parts.push(`<code>${escapeHtml(remaining.slice(idx + 1, end))}</code>`);
    remaining = remaining.slice(end + 1);
  }
  parts.push(formatTextSegment(remaining));
  return parts.join('');
}

function formatTextSegment(text) {
  text = escapeHtml(text);
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');
  text = text.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
  text = text.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return text;
}

function trimText(text, limit = 3900) {
  text = text.trim();
  if (!text) return ['(empty response)'];
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < 0) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function detectQuickReplies(text) {
  const lines = text.trim().split('\n');
  const lastLines = lines.slice(-15).join('\n');

  if (/\?\s*$/.test(lastLines)) {
    if (/(?:should I|do you want|shall I|would you like|proceed|continue\?)/i.test(lastLines)) {
      return ['Yes', 'No'];
    }
  }

  const numbered = [...lastLines.matchAll(/^\s*(\d+)[.)]\s+(.{3,60})$/gm)];
  if (numbered.length >= 2 && numbered.length <= 6) {
    return numbered.map(m => `${m[1]}. ${m[2].trim().slice(0, 30)}`);
  }

  const lettered = [...lastLines.matchAll(/^\s*([A-F])[.)]\s+(.{3,60})$/gm)];
  if (lettered.length >= 2 && lettered.length <= 6) {
    return lettered.map(m => `${m[1]}) ${m[2].trim().slice(0, 30)}`);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Telegram Channel
// ---------------------------------------------------------------------------

export class TelegramChannel {
  static EDIT_INTERVAL = 1.5;

  constructor(core) {
    this.core = core;
    this.token = core.token;
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
    this._pageCache = new Map();
  }

  // -------------------------------------------------------------------
  // Telegram Bot API
  // -------------------------------------------------------------------

  async _apiCall(method, payload) {
    const url = `${this.apiBase}/${method}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(Math.max(30, this.core.pollTimeout + 10) * 1000),
    });
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(`Telegram API error (${method}): ${JSON.stringify(data)}`);
    }
    return data;
  }

  async _sendMessage(chatId, text, { replyTo, parseMode, replyMarkup } = {}) {
    let msgId = null;
    for (const chunk of trimText(text)) {
      const payload = {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      };
      if (parseMode) payload.parse_mode = parseMode;
      if (replyTo != null) payload.reply_to_message_id = replyTo;
      if (replyMarkup != null) payload.reply_markup = replyMarkup;
      let result;
      try {
        result = await this._apiCall('sendMessage', payload);
      } catch {
        if (parseMode) {
          delete payload.parse_mode;
          result = await this._apiCall('sendMessage', payload);
        } else {
          throw new Error('sendMessage failed');
        }
      }
      if (msgId === null) {
        msgId = result?.result?.message_id ?? null;
      }
    }
    return msgId;
  }

  async _deleteMessage(chatId, messageId) {
    try {
      await this._apiCall('deleteMessage', { chat_id: chatId, message_id: messageId });
      return true;
    } catch {
      return false;
    }
  }

  async _editMessage(chatId, messageId, text, { parseMode, replyMarkup } = {}) {
    text = text.trim();
    if (!text) return;
    if (text.length > 4000) text = text.slice(0, 4000) + '\n...';
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
    };
    if (parseMode) payload.parse_mode = parseMode;
    if (replyMarkup != null) payload.reply_markup = replyMarkup;
    try {
      await this._apiCall('editMessageText', payload);
    } catch (exc) {
      const errStr = String(exc).toLowerCase();
      if (errStr.includes('message is not modified')) return;
      if (parseMode && (errStr.includes("can't parse") || errStr.includes('bad request'))) {
        delete payload.parse_mode;
        try { await this._apiCall('editMessageText', payload); return; } catch { /* ignore */ }
      }
      this.core._log(`edit error: ${exc}`, { err: true });
    }
  }

  async _answerCallbackQuery(callbackQueryId, text = '') {
    const payload = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;
    try { await this._apiCall('answerCallbackQuery', payload); } catch { /* ignore */ }
  }

  async _sendDocument(chatId, content, filename, { caption, replyTo } = {}) {
    const url = `${this.apiBase}/sendDocument`;
    const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 16);
    const boundary = `----codeclaw${hash}`;
    const parts = [];

    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}`);
    if (replyTo) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="reply_to_message_id"\r\n\r\n${replyTo}`);
    }
    if (caption) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.slice(0, 1024)}`);
    }

    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const bodyParts = parts.map(p => Buffer.from(p, 'utf-8'));
    bodyParts.push(Buffer.concat([Buffer.from(fileHeader, 'utf-8'), Buffer.from(content, 'utf-8')]));
    bodyParts.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));

    const body = Buffer.concat(bodyParts.map((p, i) =>
      i < bodyParts.length - 1 ? Buffer.concat([p, Buffer.from('\r\n')]) : p
    ));

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
      const data = await resp.json();
      return data?.result?.message_id ?? null;
    } catch (exc) {
      this.core._log(`sendDocument error: ${exc}`, { err: true });
      return null;
    }
  }

  async _getFileUrl(fileId) {
    try {
      const data = await this._apiCall('getFile', { file_id: fileId });
      const filePath = data?.result?.file_path || '';
      if (filePath) return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    } catch (exc) {
      this.core._log(`getFile error: ${exc}`, { err: true });
    }
    return null;
  }

  async _downloadFile(fileUrl) {
    try {
      const resp = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
      return Buffer.from(await resp.arrayBuffer());
    } catch (exc) {
      this.core._log(`download error: ${exc}`, { err: true });
      return null;
    }
  }

  // -------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------

  _fmtTokens(n) {
    if (n == null) return '-';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  _sessionSummaryHtml(chatId) {
    const cs = this.core._ensureChatState(chatId);
    const active = cs.active;
    const engine = cs.engine || this.core.defaultEngine;
    const lines = [
      `<b>Engine:</b> ${escapeHtml(engine)}`,
      `<b>Active:</b> ${escapeHtml(active)}`,
      '',
    ];
    for (const name of Object.keys(cs.threads).sort()) {
      const tid = (cs.threads[name] || '').trim();
      const marker = name === active ? ' (active)' : '';
      const tidDisplay = tid ? `<code>${escapeHtml(tid.slice(0, 12))}</code>` : '-';
      lines.push(`  ${escapeHtml(name)}${marker} ${tidDisplay}`);
    }
    return lines.join('\n');
  }

  _formatMetaHtml(sessionName, threadId, engine, result) {
    const parts = [engine];
    if (result) {
      parts.push(`${result.elapsedS.toFixed(1)}s`);
      const { inputTokens: inT, cachedInputTokens: caT, outputTokens: ouT } = result;
      if (inT != null || ouT != null) {
        const tokenParts = [];
        if (inT != null) tokenParts.push(`in:${this._fmtTokens(inT)}`);
        if (caT) tokenParts.push(`cached:${this._fmtTokens(caT)}`);
        if (ouT != null) tokenParts.push(`out:${this._fmtTokens(ouT)}`);
        parts.push(tokenParts.join(' '));
      }
    }
    const tid = threadId || (result ? result.threadId : null);
    if (tid) parts.push(tid.slice(0, 12));
    return '<code>' + parts.join(' | ') + '</code>';
  }

  // -------------------------------------------------------------------
  // Pagination & keyboards
  // -------------------------------------------------------------------

  _paginateText(text, limit = 3800) {
    if (text.length <= limit) return [text];
    const pages = [];
    let remaining = text;
    while (remaining.length > limit) {
      let cut = remaining.lastIndexOf('\n', limit);
      if (cut < 0) cut = limit;
      pages.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining.trim()) pages.push(remaining.trim());
    return pages;
  }

  _buildPageKeyboard(msgId, page, total, quickReplies) {
    const navRow = [];
    if (page > 0) navRow.push({ text: '< Prev', callback_data: `page:${msgId}:${page - 1}` });
    navRow.push({ text: `${page + 1}/${total}`, callback_data: 'noop' });
    if (page < total - 1) navRow.push({ text: 'Next >', callback_data: `page:${msgId}:${page + 1}` });
    const rows = [navRow];
    const actionRow = [];
    if (total > 1) actionRow.push({ text: 'Full text', callback_data: `full:${msgId}` });
    actionRow.push({ text: 'New session', callback_data: `newsess:${msgId}` });
    rows.push(actionRow);
    if (quickReplies?.length) rows.push(...this._buildQuickReplyRows(msgId, quickReplies));
    return { inline_keyboard: rows };
  }

  _buildActionKeyboard(msgId, quickReplies) {
    const row = [{ text: 'New session', callback_data: `newsess:${msgId}` }];
    const rows = [row];
    if (quickReplies?.length) rows.push(...this._buildQuickReplyRows(msgId, quickReplies));
    return { inline_keyboard: rows };
  }

  _buildQuickReplyRows(msgId, replies) {
    const rows = [];
    let row = [];
    for (let i = 0; i < replies.length; i++) {
      const label = replies[i].slice(0, 32);
      let cbData = `qr:${msgId}:${i}`;
      if (cbData.length > 64) cbData = cbData.slice(0, 64);
      row.push({ text: label, callback_data: cbData });
      if (row.length >= 3) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    return rows;
  }

  _cachePages(msgId, chatId, pages, meta, sessionName, engine, rawMessage = '', quickReplies) {
    this._pageCache.set(msgId, {
      pages, meta, chatId, sessionName, engine,
      fullText: pages.join('\n'),
      rawMessage,
      quickReplies: quickReplies || [],
    });
    if (this._pageCache.size > 50) {
      const keys = [...this._pageCache.keys()].slice(0, this._pageCache.size - 50);
      for (const k of keys) this._pageCache.delete(k);
    }
  }

  // -------------------------------------------------------------------
  // Final reply
  // -------------------------------------------------------------------

  async _sendFinalReply(chatId, placeholderMsgId, sessionName, engine, result) {
    const meta = this._formatMetaHtml(sessionName, result.threadId, engine, result);
    const body = mdToTgHtml(result.message);
    const pages = this._paginateText(body, 3800);
    const total = pages.length;
    const quickReplies = detectQuickReplies(result.message);

    if (total === 1) {
      const htmlText = `${pages[0]}\n\n${meta}`;
      const keyboard = this._buildActionKeyboard(placeholderMsgId, quickReplies);
      await this._editMessage(chatId, placeholderMsgId, htmlText, { parseMode: 'HTML', replyMarkup: keyboard });
    } else {
      const pageHeader = `<i>Page 1/${total}</i>`;
      const htmlText = `${pages[0]}\n\n${pageHeader}\n${meta}`;
      const keyboard = this._buildPageKeyboard(placeholderMsgId, 0, total, quickReplies);
      await this._editMessage(chatId, placeholderMsgId, htmlText, { parseMode: 'HTML', replyMarkup: keyboard });
      this._cachePages(placeholderMsgId, chatId, pages, meta, sessionName, engine, result.message, quickReplies);
      await this._sendDocument(
        chatId, result.message,
        `response_${placeholderMsgId}.md`,
        { caption: `Full response (${result.message.length} chars)`, replyTo: placeholderMsgId },
      );
    }
  }

  // -------------------------------------------------------------------
  // Help
  // -------------------------------------------------------------------

  _helpHtml() {
    return (
      `<b>codeclaw</b> v${VERSION}\n` +
      '\n' +
      '<b>Commands</b>\n' +
      '/ask &lt;prompt&gt; \u2014 Ask the AI agent\n' +
      '/engine [codex|claude] \u2014 Show or switch engine\n' +
      '/battle &lt;prompt&gt; \u2014 Run both engines, compare\n' +
      '/new [prompt] \u2014 Reset session\n' +
      '/stop \u2014 Clear session thread\n' +
      '/status \u2014 Session / engine / thread info\n' +
      '/session list|use|new|del \u2014 Multi-session\n' +
      '/clear [N] \u2014 Delete bot\'s recent messages (default 50)\n' +
      '\n' +
      '<i>DM: send text directly. Group: @mention or reply.\n' +
      'Send photos with a caption to analyze images.</i>'
    );
  }

  // -------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------

  async _streamRun(chatId, placeholderMsgId, prompt, threadId, engine) {
    const proc = this.core.spawnEngine(prompt, engine, threadId);
    const start = Date.now();
    let lastEdit = 0;
    let editCount = 0;
    const editInterval = TelegramChannel.EDIT_INTERVAL * 1000;

    const onText = (text) => {
      const now = Date.now();
      if ((now - lastEdit) < editInterval) return;
      const display = text.trim();
      if (!display) return;
      const elapsed = (now - start) / 1000;
      const maxBody = 3600;
      let bodyHtml;
      if (display.length > maxBody) {
        const truncated = display.slice(-maxBody);
        bodyHtml = '<i>(...truncated)</i>\n' + mdToTgHtml(truncated);
      } else {
        bodyHtml = mdToTgHtml(display);
      }
      const dots = '\u00b7'.repeat((editCount % 3) + 1);
      const header = `<code>${escapeHtml(engine)} | ${elapsed.toFixed(0)}s ${dots}</code>`;
      const htmlText = `${bodyHtml}\n\n${header}`;
      this._editMessage(chatId, placeholderMsgId, htmlText, { parseMode: 'HTML' })
        .catch(exc => this.core._log(`stream edit failed: ${exc}`, { err: true }));
      lastEdit = now;
      editCount++;
    };

    const result = await this.core.parseEvents(proc, engine, threadId, onText);
    this.core._log(
      `done engine=${engine} ok=${result.ok} ` +
      `elapsed=${result.elapsedS.toFixed(1)}s edits=${editCount} ` +
      `tokens=in:${this._fmtTokens(result.inputTokens)}` +
      `/cached:${this._fmtTokens(result.cachedInputTokens)}` +
      `/out:${this._fmtTokens(result.outputTokens)}`
    );
    return result;
  }

  async _runBlocking(prompt, engine) {
    const proc = this.core.spawnEngine(prompt, engine, null);
    return this.core.parseEvents(proc, engine, null, () => {});
  }

  // -------------------------------------------------------------------
  // Battle mode
  // -------------------------------------------------------------------

  async _handleBattle(chatId, messageId, prompt) {
    const engines = [...VALID_ENGINES].sort();
    this.core._log(`battle started: ${engines[0]} vs ${engines[1]}`);
    const placeholderId = await this._sendMessage(
      chatId,
      `<b>BATTLE</b>  ${escapeHtml(engines[0])} vs ${escapeHtml(engines[1])}\n\n<i>Running both engines...</i>`,
      { replyTo: messageId, parseMode: 'HTML' },
    );

    const results = {};
    const errors = {};

    await Promise.all(engines.map(async (eng) => {
      try {
        results[eng] = await this._runBlocking(prompt, eng);
      } catch (exc) {
        errors[eng] = String(exc);
      }
    }));

    const parts = [`<b>BATTLE</b>  ${escapeHtml(prompt.slice(0, 80))}\n`];
    for (const eng of engines) {
      const r = results[eng];
      const err = errors[eng];
      parts.push(`<b>\u258e${escapeHtml(eng.toUpperCase())}</b>`);
      if (err) {
        parts.push(`Error: ${escapeHtml(err)}`);
      } else if (r) {
        let stats = `${r.elapsedS.toFixed(1)}s`;
        if (r.inputTokens != null && r.outputTokens != null) {
          stats += ` | ${this._fmtTokens(r.inputTokens + r.outputTokens)} tokens`;
        }
        parts.push(`${mdToTgHtml(r.message)}\n<code>${stats}</code>`);
      } else {
        parts.push('(no result)');
      }
      parts.push('');
    }

    for (const eng of engines) {
      const r = results[eng];
      if (r) this.core._log(`battle ${eng}: ${r.elapsedS.toFixed(1)}s ok=${r.ok} tokens=out:${this._fmtTokens(r.outputTokens)}`);
    }

    const fullText = parts.join('\n').trim();
    const chunks = trimText(fullText, 3800);
    await this._editMessage(chatId, placeholderId, chunks[0], { parseMode: 'HTML' });
    for (const chunk of chunks.slice(1)) {
      await this._sendMessage(chatId, chunk, { parseMode: 'HTML' });
    }
  }

  // -------------------------------------------------------------------
  // Message routing
  // -------------------------------------------------------------------

  _shouldHandle(msg) {
    const chat = msg.chat || {};
    const chatId = chat.id;
    if (chatId == null) return false;
    if (this.core.allowedChatIds.size && !this.core.allowedChatIds.has(Number(chatId))) return false;
    const chatType = chat.type || '';
    const text = (msg.text || msg.caption || '').trim();
    const hasPhoto = !!msg.photo;
    const hasDocument = !!msg.document;
    if (chatType === 'private') return !!(text || hasPhoto || hasDocument);
    if (text.startsWith('/')) return true;
    if (!this.core.requireMention) return !!(text || hasPhoto || hasDocument);
    const mention = this.core.botUsername ? `@${this.core.botUsername.toLowerCase()}` : '';
    if (mention && text.toLowerCase().includes(mention)) return true;
    const replyTo = msg.reply_to_message || {};
    if (replyTo.from?.id === this.core.botId) return true;
    return false;
  }

  _cleanPrompt(text) {
    if (this.core.botUsername) {
      text = text.replace(new RegExp(`@${this.core.botUsername}`, 'gi'), '');
    }
    return text.trim();
  }

  // -------------------------------------------------------------------
  // Callback query handler
  // -------------------------------------------------------------------

  async _handleCallbackQuery(cq) {
    const cqId = cq.id || '';
    const data = cq.data || '';
    const msg = cq.message || {};
    const chatId = msg.chat?.id;
    const messageId = msg.message_id;
    if (!chatId || !messageId) { await this._answerCallbackQuery(cqId); return; }

    if (data === 'noop') { await this._answerCallbackQuery(cqId); return; }

    // Pagination
    if (data.startsWith('page:')) {
      const p = data.split(':');
      if (p.length === 3) {
        const cacheId = parseInt(p[1], 10);
        let pageNum = parseInt(p[2], 10);
        if (Number.isNaN(cacheId) || Number.isNaN(pageNum)) {
          await this._answerCallbackQuery(cqId, 'Invalid page'); return;
        }
        const entry = this._pageCache.get(cacheId);
        if (!entry) { await this._answerCallbackQuery(cqId, 'Page expired, send message again'); return; }
        const { pages, meta } = entry;
        const total = pages.length;
        pageNum = Math.max(0, Math.min(pageNum, total - 1));
        const pageHeader = `<i>Page ${pageNum + 1}/${total}</i>`;
        const htmlText = `${pages[pageNum]}\n\n${pageHeader}\n${meta}`;
        const keyboard = this._buildPageKeyboard(cacheId, pageNum, total, entry.quickReplies);
        await this._editMessage(chatId, messageId, htmlText, { parseMode: 'HTML', replyMarkup: keyboard });
        await this._answerCallbackQuery(cqId, `Page ${pageNum + 1}/${total}`);
      }
      return;
    }

    // Full text as document
    if (data.startsWith('full:')) {
      const cacheId = parseInt(data.split(':')[1], 10);
      if (Number.isNaN(cacheId)) { await this._answerCallbackQuery(cqId); return; }
      const entry = this._pageCache.get(cacheId);
      if (!entry) { await this._answerCallbackQuery(cqId, 'Cache expired'); return; }
      await this._sendDocument(
        chatId, entry.rawMessage || entry.fullText,
        `response_${cacheId}.md`,
        { caption: 'Full response' },
      );
      await this._answerCallbackQuery(cqId, 'Sent as document');
      return;
    }

    // Quick reply
    if (data.startsWith('qr:')) {
      const p = data.split(':');
      if (p.length === 3) {
        const cacheId = parseInt(p[1], 10);
        const idx = parseInt(p[2], 10);
        if (Number.isNaN(cacheId) || Number.isNaN(idx)) { await this._answerCallbackQuery(cqId); return; }
        const entry = this._pageCache.get(cacheId);
        const replies = entry?.quickReplies || [];
        const replyText = idx < replies.length ? replies[idx] : `Option ${idx + 1}`;
        await this._answerCallbackQuery(cqId, `Sending: ${replyText.slice(0, 40)}`);
        await this._runPrompt(chatId, replyText, messageId);
      }
      return;
    }

    // New session
    if (data.startsWith('newsess:')) {
      const [sessionName] = this.core._sessionForChat(chatId);
      this.core._setSessionThread(chatId, sessionName, null);
      const engine = this.core._engineForChat(chatId);
      const meta = this._formatMetaHtml(sessionName, null, engine);
      await this._answerCallbackQuery(cqId, 'Session reset');
      await this._sendMessage(
        chatId,
        `Session reset: <b>${escapeHtml(sessionName)}</b>\n\n${meta}`,
        { parseMode: 'HTML' },
      );
      return;
    }

    await this._answerCallbackQuery(cqId);
  }

  // -------------------------------------------------------------------
  // Photo handler
  // -------------------------------------------------------------------

  async _handlePhotoMessage(msg) {
    const chatId = Number(msg.chat.id);
    const messageId = msg.message_id;
    const caption = this._cleanPrompt((msg.caption || '').trim());

    const photos = msg.photo || [];
    if (!photos.length) return;
    const bestPhoto = photos.reduce((a, b) => (b.file_size || 0) > (a.file_size || 0) ? b : a);
    const fileId = bestPhoto.file_id;
    if (!fileId) return;

    const engine = this.core._engineForChat(chatId);
    const ph = await this._sendMessage(
      chatId,
      `<code>${escapeHtml(engine)} | downloading image ...</code>`,
      { replyTo: messageId, parseMode: 'HTML' },
    );

    const fileUrl = await this._getFileUrl(fileId);
    if (!fileUrl) { await this._editMessage(chatId, ph, 'Failed to download image.'); return; }

    const fileData = await this._downloadFile(fileUrl);
    if (!fileData) { await this._editMessage(chatId, ph, 'Failed to download image.'); return; }

    const ext = fileUrl.endsWith('.png') ? '.png' : '.jpg';
    const tmpPath = path.join(this.core.workdir, `_tg_photo_${messageId}${ext}`);
    try {
      fs.writeFileSync(tmpPath, fileData);
      let prompt = caption || 'Please analyze this image.';
      prompt = `${prompt}\n\n[Image saved to: ${path.basename(tmpPath)}]`;

      await this._editMessage(
        chatId, ph,
        `<code>${escapeHtml(engine)} | thinking ...</code>`,
        { parseMode: 'HTML' },
      );

      const [sessionName, currentThread] = this.core._sessionForChat(chatId);
      const result = await this._streamRun(chatId, ph, prompt, currentThread, engine);
      if (result.threadId) this.core._setSessionThread(chatId, sessionName, result.threadId);
      await this._sendFinalReply(chatId, ph, sessionName, engine, result);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  // -------------------------------------------------------------------
  // Prompt runner
  // -------------------------------------------------------------------

  async _runPrompt(chatId, prompt, replyTo) {
    const engine = this.core._engineForChat(chatId);
    const [sessionName, currentThread] = this.core._sessionForChat(chatId);
    const ph = await this._sendMessage(
      chatId,
      `<code>${escapeHtml(engine)} | thinking ...</code>`,
      { replyTo, parseMode: 'HTML' },
    );
    const result = await this._streamRun(chatId, ph, prompt, currentThread, engine);
    if (result.threadId) this.core._setSessionThread(chatId, sessionName, result.threadId);
    await this._sendFinalReply(chatId, ph, sessionName, engine, result);
  }

  // -------------------------------------------------------------------
  // Command handlers
  // -------------------------------------------------------------------

  _handleSessionCommand(chatId, arg, engine) {
    const [active, tid] = this.core._sessionForChat(chatId);
    const defaultMeta = this._formatMetaHtml(active, tid, engine);
    const parts = arg.split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return `Usage: /session list | use &lt;name&gt; | new &lt;name&gt; | del &lt;name&gt;\n\n${defaultMeta}`;
    }

    const action = parts[0].toLowerCase();
    if (action === 'list') return `${this._sessionSummaryHtml(chatId)}\n\n${defaultMeta}`;

    if (action === 'use') {
      if (parts.length < 2) return `Usage: /session use &lt;name&gt;\n\n${defaultMeta}`;
      const name = normalizeSessionName(parts[1]);
      this.core._setActiveSession(chatId, name);
      const [, newTid] = this.core._sessionForChat(chatId);
      const meta = this._formatMetaHtml(name, newTid, engine);
      return `Switched to session: <b>${escapeHtml(name)}</b>\n\n${meta}`;
    }

    if (action === 'new') {
      if (parts.length < 2) return `Usage: /session new &lt;name&gt; [prompt]\n\n${defaultMeta}`;
      const name = normalizeSessionName(parts[1]);
      this.core._setActiveSession(chatId, name);
      this.core._setSessionThread(chatId, name, null);
      if (!parts.slice(2).join(' ').trim()) {
        const meta = this._formatMetaHtml(name, null, engine);
        return `Created session: <b>${escapeHtml(name)}</b>\n\n${meta}`;
      }
      return null;
    }

    if (['del', 'delete', 'rm'].includes(action)) {
      if (parts.length < 2) return `Usage: /session del &lt;name&gt;\n\n${defaultMeta}`;
      this.core._deleteSession(chatId, normalizeSessionName(parts[1]));
      const [newActive, newTid] = this.core._sessionForChat(chatId);
      const meta = this._formatMetaHtml(newActive, newTid, engine);
      return `Deleted session: <b>${escapeHtml(parts[1])}</b>\n\n${meta}`;
    }

    return `Unknown subcommand.\n\n${defaultMeta}`;
  }

  async _handleTextMessage(msg) {
    const chatId = Number(msg.chat.id);
    const messageId = msg.message_id;
    let text = this._cleanPrompt((msg.text || msg.caption || '').trim());
    if (!text) return;
    const engine = this.core._engineForChat(chatId);

    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const head = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
      const arg = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();
      let cmd = head.slice(1);
      if (cmd.includes('@')) cmd = cmd.split('@')[0];

      if (cmd === 'start' || cmd === 'help') {
        const [sessionName, tid] = this.core._sessionForChat(chatId);
        const meta = this._formatMetaHtml(sessionName, tid, engine);
        await this._sendMessage(chatId, `${this._helpHtml()}\n\n${meta}`, { replyTo: messageId, parseMode: 'HTML' });
        return;
      }

      if (cmd === 'engine') {
        if (!arg) {
          const avail = [...VALID_ENGINES].sort().join(', ');
          await this._sendMessage(
            chatId,
            `<b>Engine:</b> ${escapeHtml(engine)}\n<b>Available:</b> ${escapeHtml(avail)}\n\n/engine codex  or  /engine claude`,
            { replyTo: messageId, parseMode: 'HTML' },
          );
          return;
        }
        try {
          const newEngine = normalizeEngine(arg);
          this.core._setEngineForChat(chatId, newEngine);
          this.core._log(`engine switched to ${newEngine} chat=${chatId}`);
          const [sessionName, tid] = this.core._sessionForChat(chatId);
          const meta = this._formatMetaHtml(sessionName, tid, newEngine);
          await this._sendMessage(
            chatId,
            `Engine switched to <b>${escapeHtml(newEngine)}</b>\n\n${meta}`,
            { replyTo: messageId, parseMode: 'HTML' },
          );
        } catch (exc) {
          await this._sendMessage(chatId, String(exc), { replyTo: messageId });
        }
        return;
      }

      if (cmd === 'battle') {
        if (!arg) {
          await this._sendMessage(chatId, 'Usage: /battle &lt;prompt&gt;', { replyTo: messageId, parseMode: 'HTML' });
          return;
        }
        await this._handleBattle(chatId, messageId, arg);
        return;
      }

      if (cmd === 'session' || cmd === 'sessions') {
        const reply = this._handleSessionCommand(chatId, arg, engine);
        if (reply !== null) {
          await this._sendMessage(chatId, reply, { replyTo: messageId, parseMode: 'HTML' });
          return;
        }
        const cmdParts = arg.split(/\s+/).filter(Boolean);
        const sessionName = normalizeSessionName(cmdParts[1]);
        const prompt = cmdParts.slice(2).join(' ').trim();
        const ph = await this._sendMessage(
          chatId,
          `<code>${escapeHtml(engine)} | thinking ...</code>`,
          { replyTo: messageId, parseMode: 'HTML' },
        );
        const result = await this._streamRun(chatId, ph, prompt, null, engine);
        this.core._setSessionThread(chatId, sessionName, result.threadId);
        await this._sendFinalReply(chatId, ph, sessionName, engine, result);
        return;
      }

      if (cmd === 'new' || cmd === 'reset') {
        const [sessionName] = this.core._sessionForChat(chatId);
        this.core._setSessionThread(chatId, sessionName, null);
        if (!arg) {
          const meta = this._formatMetaHtml(sessionName, null, engine);
          await this._sendMessage(
            chatId,
            `Session reset: <b>${escapeHtml(sessionName)}</b>\n\n${meta}`,
            { replyTo: messageId, parseMode: 'HTML' },
          );
          return;
        }
        const ph = await this._sendMessage(
          chatId,
          `<code>${escapeHtml(engine)} | thinking ...</code>`,
          { replyTo: messageId, parseMode: 'HTML' },
        );
        const result = await this._streamRun(chatId, ph, arg, null, engine);
        this.core._setSessionThread(chatId, sessionName, result.threadId);
        await this._sendFinalReply(chatId, ph, sessionName, engine, result);
        return;
      }

      if (cmd === 'stop') {
        const [sessionName] = this.core._sessionForChat(chatId);
        this.core._setSessionThread(chatId, sessionName, null);
        const meta = this._formatMetaHtml(sessionName, null, engine);
        await this._sendMessage(
          chatId,
          `Session cleared: <b>${escapeHtml(sessionName)}</b>\n\n${meta}`,
          { replyTo: messageId, parseMode: 'HTML' },
        );
        return;
      }

      if (cmd === 'status') {
        const [sessionName, tid] = this.core._sessionForChat(chatId);
        const summary = this._sessionSummaryHtml(chatId);
        const meta = this._formatMetaHtml(sessionName, tid, engine);
        await this._sendMessage(chatId, `${summary}\n\n${meta}`, { replyTo: messageId, parseMode: 'HTML' });
        return;
      }

      if (cmd === 'clear') {
        let count = 50;
        if (arg) { const n = parseInt(arg, 10); if (!Number.isNaN(n)) count = Math.min(n, 200); }
        this.core._log(`clear: deleting up to ${count} bot messages in chat=${chatId}`);
        let deleted = 0;
        if (messageId) await this._deleteMessage(chatId, messageId);
        if (messageId) {
          for (let offset = 1; offset <= count; offset++) {
            const mid = messageId - offset;
            if (mid <= 0) break;
            if (await this._deleteMessage(chatId, mid)) deleted++;
          }
        }
        this.core._log(`clear: deleted ${deleted} messages in chat=${chatId}`);
        await this._sendMessage(chatId, `<i>Cleared ${deleted} messages.</i>`, { parseMode: 'HTML' });
        return;
      }

      if (cmd === 'ask' || cmd === 'a') {
        if (!arg) {
          await this._sendMessage(chatId, 'Usage: /ask &lt;question&gt;', { replyTo: messageId, parseMode: 'HTML' });
          return;
        }
        text = arg;
      } else {
        // Pass through unrecognized commands to the engine (e.g. /commit, /simplify, /compact)
        text = `/${cmd}` + (arg ? ` ${arg}` : '');
      }
    }

    // Normal message
    await this._runPrompt(chatId, text, messageId);
  }

  // -------------------------------------------------------------------
  // Startup notice
  // -------------------------------------------------------------------

  async _registerBotCommands() {
    const commands = [
      // codeclaw native commands
      { command: 'ask', description: 'Ask the AI agent' },
      { command: 'engine', description: 'Show or switch engine (codex/claude)' },
      { command: 'battle', description: 'Run both engines and compare' },
      { command: 'new', description: 'Reset session (optionally with prompt)' },
      { command: 'stop', description: 'Clear session thread' },
      { command: 'status', description: 'Session / engine / thread info' },
      { command: 'session', description: 'Multi-session: list|use|new|del' },
      { command: 'clear', description: 'Delete bot messages (default 50)' },
      { command: 'help', description: 'Show help' },
      // Engine passthrough commands (claude / codex)
      { command: 'compact', description: '[engine] Compact conversation context' },
      { command: 'commit', description: '[engine] Generate a git commit' },
      { command: 'simplify', description: '[engine] Review and simplify changed code' },
      { command: 'pr_comments', description: '[engine] Address PR review comments' },
    ];
    try {
      await this._apiCall('setMyCommands', { commands });
      this.core._log(`registered ${commands.length} bot commands`);
    } catch (exc) {
      this.core._log(`setMyCommands failed: ${exc}`, { err: true });
    }
  }

  async _sendStartupNotice() {
    const { execSync } = await import('node:child_process');
    const targets = new Set(this.core.allowedChatIds);
    for (const key of Object.keys(this.core.state.chats || {})) {
      const n = parseInt(key, 10);
      if (!Number.isNaN(n)) targets.add(n);
    }
    if (!targets.size) {
      this.core._log('startup notice: no known chats yet \u2014 send any message to the bot first, or set --allowed-ids');
      return;
    }

    let whichCmd;
    try { whichCmd = (cmd) => execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8' }).trim(); }
    catch { whichCmd = () => null; }

    const engines = [...VALID_ENGINES].sort().filter(eng => { try { return !!whichCmd(eng); } catch { return false; } });
    const engineList = engines.length ? engines.join(', ') : 'none found';
    const statusLine = this.core._replacedOldProcess ? 'restarted (replaced previous instance)' : 'online';
    const text = (
      `<b>codeclaw</b> v${VERSION} ${escapeHtml(statusLine)}\n` +
      '\n' +
      `<b>Engine:</b> ${escapeHtml(this.core.defaultEngine)}\n` +
      `<b>Available:</b> ${escapeHtml(engineList)}\n` +
      `<b>Workdir:</b> <code>${escapeHtml(this.core.workdir)}</code>\n` +
      '\n' +
      '<i>/help for commands</i>'
    );
    for (const cid of [...targets].sort((a, b) => a - b)) {
      try {
        await this._sendMessage(cid, text, { parseMode: 'HTML' });
        this.core._log(`startup notice sent to chat=${cid}`);
      } catch (exc) {
        this.core._log(`startup notice failed for chat=${cid}: ${exc}`, { err: true });
      }
    }
  }

  // -------------------------------------------------------------------
  // Polling loop
  // -------------------------------------------------------------------

  async run() {
    await this._registerBotCommands();
    await this._sendStartupNotice();
    this.core._log(`polling started (mention_required=${this.core.requireMention})`);

    while (this.core.running) {
      const offset = (parseInt(this.core.state.last_update_id, 10) || 0) + 1;
      let updates;
      try {
        const data = await this._apiCall('getUpdates', {
          timeout: this.core.pollTimeout,
          offset,
          allowed_updates: ['message', 'callback_query'],
        });
        updates = data.result || [];
      } catch (exc) {
        const isNetwork = String(exc).toLowerCase().includes('fetch') || String(exc).toLowerCase().includes('network');
        this.core._log(`${isNetwork ? 'network' : 'poll'} error: ${exc}`, { err: true });
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      for (const update of updates) {
        const uid = parseInt(update.update_id, 10) || 0;
        this.core.state.last_update_id = Math.max(
          parseInt(this.core.state.last_update_id, 10) || 0, uid
        );
        this.core._saveState();

        // Callback queries
        const cq = update.callback_query;
        if (cq && typeof cq === 'object') {
          try { await this._handleCallbackQuery(cq); } catch (exc) {
            this.core._log(`callback_query error: ${exc}`, { err: true });
          }
          continue;
        }

        const msg = update.message;
        if (!msg || typeof msg !== 'object' || !this._shouldHandle(msg)) continue;

        const chatId = msg.chat.id;
        const user = msg.from || {};
        const username = user.username || user.first_name || '';
        const preview = (msg.text || msg.caption || '').trim().replace(/\n/g, ' ').slice(0, 100);
        this.core._log(`msg chat=${chatId} user=${username} ${JSON.stringify(preview)}`);

        try {
          if (msg.photo && !(msg.text || '').startsWith('/')) {
            await this._handlePhotoMessage(msg);
          } else {
            await this._handleTextMessage(msg);
          }
        } catch (exc) {
          this.core._log(`error chat=${chatId}: ${exc}`, { err: true });
          const eng = this.core._engineForChat(Number(chatId));
          const [sn, tid] = this.core._sessionForChat(Number(chatId));
          const meta = this._formatMetaHtml(sn, tid, eng);
          const isTimeout = String(exc).includes('timeout') || String(exc).includes('Timeout');
          const errMsg = isTimeout
            ? `Timeout (&gt;${this.core.runTimeout}s)\n\n${meta}`
            : `Error: ${escapeHtml(String(exc))}\n\n${meta}`;
          await this._sendMessage(Number(chatId), errMsg, { replyTo: msg.message_id, parseMode: 'HTML' })
            .catch(() => {});
        }
      }
    }
  }
}
