import type { Agent, StreamPreviewMeta, StreamPreviewPlan } from './bot.js';
import { hasPreviewMeta, samePreviewMeta, samePreviewPlan } from './bot-streaming.js';
import { buildInitialPreviewHtml, buildStreamPreviewHtml } from './bot-telegram-render.js';

const STREAM_PREVIEW_HEARTBEAT_MS = 5_000;
const STREAM_TYPING_HEARTBEAT_MS = 4_000;
const STREAM_STALLED_NOTICE_MS = 15_000;

interface PreviewChannel {
  editMessage(chatId: number, messageId: number, text: string, opts?: { parseMode?: string }): Promise<void>;
  sendTyping(chatId: number, opts?: { messageThreadId?: number }): Promise<void>;
}

interface TelegramLivePreviewOptions {
  agent: Agent;
  chatId: number;
  placeholderMessageId: number;
  channel: PreviewChannel;
  streamEditIntervalMs: number;
  startTimeMs: number;
  canEditMessages: boolean;
  canSendTyping: boolean;
  messageThreadId?: number;
  log?: (message: string) => void;
}

export class TelegramLivePreview {
  readonly initialText: string;

  private readonly agent: Agent;
  private readonly chatId: number;
  private readonly placeholderMessageId: number;
  private readonly channel: PreviewChannel;
  private readonly streamEditIntervalMs: number;
  private readonly startTimeMs: number;
  private readonly canEditMessages: boolean;
  private readonly canSendTyping: boolean;
  private readonly messageThreadId?: number;
  private readonly log: (message: string) => void;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private editChain: Promise<void> = Promise.resolve();
  private previewVersion = 0;
  private editCount = 0;
  private lastEditAt = 0;
  private lastProgressAt: number;
  private lastPreview: string;
  private latestText = '';
  private latestThinking = '';
  private latestActivity = '';
  private latestMeta: StreamPreviewMeta | null = null;
  private latestPlan: StreamPreviewPlan | null = null;

  constructor(options: TelegramLivePreviewOptions) {
    this.agent = options.agent;
    this.chatId = options.chatId;
    this.placeholderMessageId = options.placeholderMessageId;
    this.channel = options.channel;
    this.streamEditIntervalMs = options.streamEditIntervalMs;
    this.startTimeMs = options.startTimeMs;
    this.canEditMessages = options.canEditMessages;
    this.canSendTyping = options.canSendTyping;
    this.messageThreadId = options.messageThreadId;
    this.log = options.log ?? (() => {});

    this.initialText = buildInitialPreviewHtml(this.agent);
    this.lastPreview = this.initialText;
    this.lastProgressAt = this.startTimeMs;
  }

  start() {
    this.sendTypingPulse();
    if (this.canEditMessages) {
      this.heartbeatTimer = setInterval(() => {
        const idleMs = Date.now() - this.lastProgressAt;
        const recentlyEdited = Date.now() - this.lastEditAt < STREAM_PREVIEW_HEARTBEAT_MS - 250;
        if (recentlyEdited && idleMs < STREAM_STALLED_NOTICE_MS) return;
        this.queuePreviewEdit(true);
      }, STREAM_PREVIEW_HEARTBEAT_MS);
      this.heartbeatTimer.unref?.();
    }
    if (this.canSendTyping) {
      this.typingTimer = setInterval(() => this.sendTypingPulse(), STREAM_TYPING_HEARTBEAT_MS);
      this.typingTimer.unref?.();
    }
  }

  update(
    text: string,
    thinking: string,
    activity = '',
    meta?: StreamPreviewMeta,
    plan?: StreamPreviewPlan | null,
  ) {
    const nextMeta: StreamPreviewMeta | null = hasPreviewMeta(meta) ? meta! : null;
    const nextPlan = plan?.steps?.length ? plan : null;
    const changed = text !== this.latestText
      || thinking !== this.latestThinking
      || activity !== this.latestActivity
      || !samePreviewMeta(nextMeta, this.latestMeta)
      || !samePreviewPlan(nextPlan, this.latestPlan);

    this.latestText = text;
    this.latestThinking = thinking;
    this.latestActivity = activity;
    this.latestMeta = nextMeta;
    this.latestPlan = nextPlan;

    if (changed) this.lastProgressAt = Date.now();
    if (!text.trim() && !thinking.trim() && !activity.trim() && !nextMeta && !nextPlan) return;
    this.schedulePreviewEdit();
  }

  async settle() {
    this.stopFeedback();
    await this.flushPreviewEdits();
  }

  dispose() {
    this.stopFeedback();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.previewVersion++;
  }

  getEditCount(): number {
    return this.editCount;
  }

  private stopFeedback() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
  }

  private sendTypingPulse() {
    if (!this.canSendTyping) return;
    void this.channel.sendTyping(this.chatId, { messageThreadId: this.messageThreadId }).catch(() => {});
  }

  private renderPreview(): string {
    return buildStreamPreviewHtml({
      agent: this.agent,
      elapsedMs: Date.now() - this.startTimeMs,
      bodyText: this.latestText,
      thinking: this.latestThinking,
      activity: this.latestActivity,
      meta: this.latestMeta,
      plan: this.latestPlan,
    });
  }

  private schedulePreviewEdit() {
    if (!this.canEditMessages) return;
    const wait = this.streamEditIntervalMs - (Date.now() - this.lastEditAt);
    if (wait <= 0) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.queuePreviewEdit();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.queuePreviewEdit();
    }, wait);
  }

  private queuePreviewEdit(force = false) {
    if (!this.canEditMessages) return;
    const preview = this.renderPreview();
    if (!preview) return;
    if (!force && preview === this.lastPreview) return;
    this.lastPreview = preview;
    const version = ++this.previewVersion;
    this.editCount++;
    this.lastEditAt = Date.now();
    this.editChain = this.editChain
      .catch(() => {})
      .then(async () => {
        if (version !== this.previewVersion) return;
        try {
          await this.channel.editMessage(this.chatId, this.placeholderMessageId, preview, { parseMode: 'HTML' });
        } catch (error: any) {
          this.log(`stream edit err: ${error?.message || error}`);
        }
      });
  }

  private async flushPreviewEdits() {
    if (!this.canEditMessages) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.editCount > 0 || this.latestText.trim() || this.latestThinking.trim() || this.latestActivity.trim()) {
      this.queuePreviewEdit(true);
    }
    await this.editChain.catch(() => {});
  }
}
