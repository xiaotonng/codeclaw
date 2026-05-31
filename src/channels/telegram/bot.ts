/**
 * Telegram bot orchestration: commands, callbacks, streaming lifecycle.
 *
 * Rendering, workdir browsing, and live preview state live in dedicated helper modules.
 * New IM integrations should stay parallel to this file and compose shared runtime helpers
 * instead of growing a single multi-platform bot entrypoint.
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  Bot, type Agent, type SessionRuntime, type StreamResult,
  type ImTaskPresenter, type ImTaskPresenterOpts,
  fmtTokens, fmtUptime, fmtBytes, buildPrompt,
  parseAllowedChatIds,
} from '../../bot/bot.js';
import {
  BOT_SHUTDOWN_FORCE_EXIT_MS,
  SessionMessageRegistry,
  buildBotMenuState,
  buildKnownChatEnv,
  buildSessionTaskId,
} from '../../bot/orchestration.js';
import {
  stageSessionFiles,
} from '../../agent/index.js';
import type { McpSendFileCallback } from '../../agent/mcp/bridge.js';
import { shutdownAllDrivers } from '../../agent/driver.js';
import {
  SKILL_CMD_PREFIX,
} from '../../bot/menu.js';
import {
  getStartData,
  type StartData,
  getStatusDataAsync,
  getHostDataSync,
  getSessionTurnPreviewData,
  getWorkspacesData,
  resolveSkillPrompt,
  summarizePromptForStatus,
  handleGoalCommand,
} from '../../bot/commands.js';
import {
  buildAgentsCommandView,
  buildModelsCommandView,
  buildModeCommandView,
  buildSessionsCommandView,
  buildSkillsCommandView,
  decodeCommandAction,
  executeCommandAction,
  type CommandActionResult,
  type CommandSelectionView,
} from '../../bot/command-ui.js';
import { buildSwitchWorkdirView, buildWorkspacesView, resolveRegisteredPath } from './directory.js';
import { LivePreview, type LivePreviewRenderer } from './live-preview.js';
import {
  registerProcessRuntime,
  buildRestartCommand,
  requestProcessRestart,
} from '../../core/process-control.js';
import {
  buildInitialPreviewHtml,
  buildHumanLoopPromptHtml,
  buildAnsweredHumanLoopPromptHtml,
  buildStreamPreviewHtml,
  buildFinalReplyRender,
  dispatchImageBlocks,
  escapeHtml,
  formatMenuLines,
  formatProviderUsageLines,
  renderCommandNoticeHtml,
  renderCommandSelectionHtml,
  renderCommandSelectionKeyboard,
  renderSessionTurnHtml,
  truncateMiddle,
} from './render.js';
import { currentHumanLoopQuestion, humanLoopOptionSelected, type HumanLoopPromptState, type ResolvedHumanLoopAnswers } from '../../bot/human-loop.js';
import { TelegramChannel, type TgContext, type TgCallbackContext, type TgMessage } from './channel.js';
import { splitText, supportsChannelCapability } from '../base.js';
import { getActiveUserConfig, loadKnownChatIds } from '../../core/config/user-config.js';
import { VERSION } from '../../core/version.js';


/** Telegram HTML renderer for LivePreview. */
const telegramPreviewRenderer: LivePreviewRenderer = {
  renderInitial: buildInitialPreviewHtml,
  renderStream: buildStreamPreviewHtml,
};

/**
 * Echo message rendered after a human-loop prompt resolves — a small chat
 * message that records the decision in the conversation history (independent
 * of the now-closed card above). Returns null when there's nothing useful to
 * say (e.g. an empty cancellation).
 */
function buildInteractionEchoHtml(summary: ResolvedHumanLoopAnswers): string | null {
  if (summary.status === 'cancelled') {
    return `<i>⊘ Prompt cancelled.</i>`;
  }
  if (!summary.rows.length) return null;
  if (summary.rows.length === 1) {
    return `<b>✓ Answered</b> · ${escapeHtml(summary.rows[0].display)}`;
  }
  const lines = ['<b>✓ Answered</b>'];
  for (const row of summary.rows) {
    lines.push(`• ${escapeHtml(row.label)}: ${escapeHtml(row.display)}`);
  }
  return lines.join('\n');
}

type ShutdownSignal = 'SIGINT' | 'SIGTERM';
type ProcessSignal = ShutdownSignal | 'SIGUSR2';

const SHUTDOWN_EXIT_CODE: Record<ShutdownSignal, number> = {
  SIGINT: 130,
  SIGTERM: 143,
};

// ---------------------------------------------------------------------------
// TelegramBot
// ---------------------------------------------------------------------------

export class TelegramBot extends Bot {
  private token: string;
  private channel!: TelegramChannel;
  private sessionMessages = new SessionMessageRegistry<number, number>();
  private nextTaskId = 1;
  private shutdownInFlight = false;
  private shutdownExitCode: number | null = null;
  private shutdownForceExitTimer: ReturnType<typeof setTimeout> | null = null;
  private signalHandlers: Partial<Record<ProcessSignal, () => void>> = {};
  private processRuntimeCleanup: (() => void) | null = null;

  constructor() {
    super();
    const config = getActiveUserConfig();
    // merge Telegram-specific allowed IDs into base
    if (config.telegramAllowedChatIds) {
      for (const id of parseAllowedChatIds(config.telegramAllowedChatIds)) this.allowedChatIds.add(id);
    }
    // Restore chats persisted across restarts so sendStartupNotice can greet
    // them even when the env-based hand-off was lost (crash-style respawn).
    for (const id of loadKnownChatIds('telegram')) {
      // Do NOT add to allowedChatIds
    }
    this.token = String(config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!this.token) throw new Error('Missing Telegram token. Configure via dashboard or set TELEGRAM_BOT_TOKEN');
  }

  public override requestStop(): void {
    super.requestStop();
    try { this.channel?.disconnect(); } catch {}
  }

  protected override onManagedConfigChange(config: Record<string, any>, opts: { initial?: boolean } = {}) {
    const nextToken = String(config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (nextToken && nextToken !== this.token) {
      this.token = nextToken;
      if (!opts.initial) this.log('telegram token reloaded from setting.json');
    }

    const mergedAllowed = parseAllowedChatIds(process.env.PIKICLAW_ALLOWED_IDS || '');
    for (const id of parseAllowedChatIds(String(config.telegramAllowedChatIds || ''))) mergedAllowed.add(id);
    for (const id of loadKnownChatIds('telegram')) {
      for (const parsed of parseAllowedChatIds(id)) mergedAllowed.add(parsed);
    }
    this.allowedChatIds = mergedAllowed;
  }

  /** Skill command prefix used in Telegram bot commands. */
  private static readonly SKILL_CMD_PREFIX = SKILL_CMD_PREFIX;

  /** Register bot menu commands. Called automatically after connect. */
  async setupMenu() {
    if (!supportsChannelCapability((this as any).channel, 'commandMenu')) return;
    const { commands, skillCount } = buildBotMenuState(this);
    await this.channel.setMenu(commands);
    this.log(`menu: ${commands.length} commands (${skillCount} skills)`);
  }

  protected override afterSwitchWorkdir(_oldPath: string, _newPath: string) {
    if (!(this as any).channel) return;
    void this.setupMenu().catch(err => this.log(`menu refresh failed after workdir switch: ${err}`));
  }

  private clearShutdownForceExitTimer() {
    if (!this.shutdownForceExitTimer) return;
    clearTimeout(this.shutdownForceExitTimer);
    this.shutdownForceExitTimer = null;
  }

  private removeSignalHandlers() {
    for (const sig of Object.keys(this.signalHandlers) as ProcessSignal[]) {
      const handler = this.signalHandlers[sig];
      if (handler) process.off(sig, handler);
    }
    this.signalHandlers = {};
  }

  private installSignalHandlers() {
    this.removeSignalHandlers();

    const onSigint = () => this.beginShutdown('SIGINT');
    const onSigterm = () => this.beginShutdown('SIGTERM');
    const onSigusr2 = () => this.performRestart();

    this.signalHandlers = {
      SIGINT: onSigint,
      SIGTERM: onSigterm,
      SIGUSR2: onSigusr2,
    };

    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    process.on('SIGUSR2', onSigusr2);
  }

  private cleanupRuntimeForExit() {
    try { this.channel.disconnect(); } catch {}
    this.stopKeepAlive();
    shutdownAllDrivers();
  }

  private buildRestartEnv(): Record<string, string> {
    const knownChats = this.channel.knownChats instanceof Set ? this.channel.knownChats : new Set<number>();
    return buildKnownChatEnv(this.allowedChatIds, knownChats, 'TELEGRAM_ALLOWED_CHAT_IDS');
  }

  private beginShutdown(sig: ShutdownSignal) {
    if (this.shutdownInFlight) return;

    this.shutdownInFlight = true;
    this.shutdownExitCode = SHUTDOWN_EXIT_CODE[sig];
    this.log(`${sig}, shutting down...`);

    this.cleanupRuntimeForExit();

    this.clearShutdownForceExitTimer();
    this.shutdownForceExitTimer = setTimeout(() => {
      this.log(`shutdown still pending after ${Math.floor(BOT_SHUTDOWN_FORCE_EXIT_MS / 1000)}s, forcing exit`);
      process.exit(this.shutdownExitCode ?? 1);
    }, BOT_SHUTDOWN_FORCE_EXIT_MS);
    this.shutdownForceExitTimer.unref?.();
  }

  private performRestart() {
    this.cleanupRuntimeForExit();
    const { bin, args } = buildRestartCommand(process.argv.slice(2));
    const child = spawn(bin, args, {
      stdio: 'inherit',
      detached: true,
      env: {
        ...process.env,
        npm_config_yes: process.env.npm_config_yes || 'true',
      },
    });
    child.unref();
    process.exit(0);
  }

  private createTaskId(session: SessionRuntime): string {
    return buildSessionTaskId(session, this.nextTaskId++);
  }

  private registerSessionMessage(chatId: number, messageId: number | null | undefined, session: SessionRuntime) {
    this.sessionMessages.register(chatId, messageId, session, session.workdir);
  }

  private registerSessionMessages(chatId: number, messageIds: Array<number | null | undefined>, session: SessionRuntime) {
    this.sessionMessages.registerMany(chatId, messageIds, session, session.workdir);
  }

  private sessionFromMessage(chatId: number, messageId: number | null | undefined): SessionRuntime | null {
    const sessionRef = this.sessionMessages.resolve(chatId, messageId);
    if (!sessionRef) return null;
    return this.getSessionRuntimeByKey(sessionRef.key, { allowAnyWorkdir: true })
      || this.hydrateSessionRuntime(sessionRef);
  }

  private ensureSession(chatId: number, title: string, files: string[]): SessionRuntime {
    return this.ensureSessionForChat(chatId, title, files);
  }

  private resolveIncomingSession(ctx: TgContext, text: string, files: string[]): SessionRuntime {
    const cs = this.chat(ctx.chatId);
    const replyMessageId = typeof ctx.raw?.reply_to_message?.message_id === 'number'
      ? ctx.raw.reply_to_message.message_id
      : null;
    const repliedSession = this.sessionFromMessage(ctx.chatId, replyMessageId);
    if (repliedSession) {
      this.log(`[resolveSession] reply matched session=${repliedSession.sessionId} chat=${ctx.chatId}`);
      this.applySessionSelection(cs, repliedSession);
      return repliedSession;
    }

    const selected = this.getSelectedSession(cs);
    if (selected) return selected;
    return this.ensureSession(ctx.chatId, text, files);
  }

  // ---- commands -------------------------------------------------------------

  private async cmdStart(ctx: TgContext) {
    const d = getStartData(this, ctx.chatId);
    await ctx.reply(this.renderStartHtml(d), { parseMode: 'HTML' });
  }

  private renderStartHtml(d: StartData): string {
    const lines = [
      `<b>${escapeHtml(d.title)}</b> v${escapeHtml(d.version)}`,
      escapeHtml(d.subtitle),
      '',
      `<b>Agent:</b> ${escapeHtml(d.agent)}`,
      `<b>Workdir:</b> <code>${escapeHtml(d.workdir)}</code>`,
      '',
      '<b>Agents</b>',
      ...d.agentDetails.map(a => {
        const parts = [`  <b>${escapeHtml(a.agent)}</b>: ${escapeHtml(a.model)}`];
        if (a.effort) parts[0] += ` (effort: ${escapeHtml(a.effort)})`;
        return parts[0];
      }),
      '',
      '<b>Commands</b>',
      ...formatMenuLines(d.commands),
    ];
    return lines.join('\n');
  }

  private async cmdSkills(ctx: TgContext) {
    await this.sendCommandView(ctx, buildSkillsCommandView(this, ctx.chatId));
  }

  private async cmdExt(ctx: TgContext) {
    const { getExtensionSummaryData } = await import('../../bot/commands.js');
    const data = getExtensionSummaryData(this, ctx.chatId);
    const lines: string[] = ['<b>Extensions</b>', ''];

    // MCP servers
    lines.push(`<b>MCP Servers</b> (${data.mcpCount})`);
    if (data.mcpExtensions.length === 0) {
      lines.push('  <i>No MCP extensions configured</i>');
    } else {
      for (const ext of data.mcpExtensions) {
        const icon = ext.enabled ? '●' : '○';
        const scope = ext.scope === 'global' ? '[G]' : ext.scope === 'workspace' ? '[W]' : '[B]';
        lines.push(`  ${icon} ${scope} <b>${escapeHtml(ext.name)}</b>`);
        if (ext.command) lines.push(`    <code>${escapeHtml(ext.command.slice(0, 80))}</code>`);
      }
    }

    lines.push('');

    // Skills
    lines.push(`<b>Skills</b> (${data.skillCount})`);
    if (data.skills.length === 0) {
      lines.push('  <i>No skills installed</i>');
    } else {
      for (const skill of data.skills) {
        const scope = skill.scope === 'global' ? '[G]' : '[P]';
        lines.push(`  ${scope} <b>${escapeHtml(skill.label)}</b> <i>(${escapeHtml(skill.name)})</i>`);
      }
    }

    lines.push('', '<i>Manage extensions in the Dashboard → Extensions tab.</i>');

    await ctx.reply(lines.join('\n'), { parseMode: 'HTML' });
  }

  private async sendCommandView(ctx: TgContext, view: CommandSelectionView) {
    await ctx.reply(
      renderCommandSelectionHtml(view),
      { parseMode: 'HTML', keyboard: renderCommandSelectionKeyboard(view) },
    );
  }

  private async replyCommandResult(ctx: TgContext, result: CommandActionResult) {
    if (result.kind === 'view') {
      await this.sendCommandView(ctx, result.view);
      return;
    }
    if (result.kind === 'skill') {
      await this.handleMessage({ text: result.prompt, files: [] }, ctx);
      return;
    }
    if (result.kind === 'notice') {
      const sent = await ctx.reply(renderCommandNoticeHtml(result.notice), { parseMode: 'HTML' });
      if (result.session && typeof sent === 'number') this.registerSessionMessage(ctx.chatId, sent, result.session);
      if (result.previewSession) {
        await this.previewCurrentSessionTurn(ctx.chatId, result.previewSession.agent, result.previewSession.sessionId);
      }
      return;
    }
    await ctx.reply(escapeHtml(result.message), { parseMode: 'HTML' });
  }

  private async applyCommandCallbackResult(ctx: TgCallbackContext, result: CommandActionResult) {
    if (result.kind === 'noop') {
      await ctx.answerCallback(result.message);
      return;
    }
    if (result.kind === 'view') {
      await ctx.editReply(
        ctx.messageId,
        renderCommandSelectionHtml(result.view),
        { parseMode: 'HTML', keyboard: renderCommandSelectionKeyboard(result.view) },
      );
      await ctx.answerCallback(result.callbackText ?? undefined);
      return;
    }
    if (result.kind === 'skill') {
      await ctx.answerCallback(result.callbackText ?? undefined);
      await this.handleMessage({ text: result.prompt, files: [] }, ctx);
      return;
    }
    await ctx.answerCallback(result.callbackText ?? undefined);
    await ctx.editReply(ctx.messageId, renderCommandNoticeHtml(result.notice), { parseMode: 'HTML' });
    if (result.session) this.registerSessionMessage(ctx.chatId, ctx.messageId, result.session);
    if (result.previewSession) {
      await this.previewCurrentSessionTurn(ctx.chatId, result.previewSession.agent, result.previewSession.sessionId);
    }
  }

  private sessionsPageSize = 5;

  private buildStopKeyboard(actionId: string | null, opts?: { queued?: boolean }) {
    if (!actionId) return undefined;
    if (opts?.queued) {
      return {
        inline_keyboard: [[
          { text: 'Recall', callback_data: `tsk:stop:${actionId}` },
          { text: 'Steer', callback_data: `tsk:steer:${actionId}` },
        ]],
      };
    }
    return {
      inline_keyboard: [[
        { text: 'Stop', callback_data: `tsk:stop:${actionId}` },
      ]],
    };
  }

  private async cmdSessions(ctx: TgContext) {
    await this.sendCommandView(ctx, await buildSessionsCommandView(this, ctx.chatId, 0, this.sessionsPageSize));
  }

  private async cmdStatus(ctx: TgContext) {
    const d = await getStatusDataAsync(this, ctx.chatId);
    const lines = [
      `<b>pikiclaw</b> v${d.version}\n`,
      `<b>Uptime:</b> ${fmtUptime(d.uptime)}`,
      `<b>Memory:</b> ${(d.memRss / 1024 / 1024).toFixed(0)}MB RSS / ${(d.memHeap / 1024 / 1024).toFixed(0)}MB heap`,
      `<b>PID:</b> ${d.pid}`,
      `<b>Workdir:</b> <code>${escapeHtml(d.workdir)}</code>`,
      '',
      `<b>Agent:</b> ${escapeHtml(d.agent)}`,
      `<b>Model:</b> ${escapeHtml(d.model)}`,
      `<b>Session:</b> ${d.sessionId ? `<code>${escapeHtml(d.sessionId.slice(0, 16))}</code>` : '(new)'}`,
      `<b>Active Tasks:</b> ${d.activeTasksCount}`,
    ];
    if (d.running) {
      lines.push(`<b>Running:</b> ${fmtUptime(Date.now() - d.running.startedAt)} - ${escapeHtml(summarizePromptForStatus(d.running.prompt))}`);
    }
    lines.push(...formatProviderUsageLines(d.usage), '', '<b>Bot Usage</b>', `  Turns: ${d.stats.totalTurns}`);
    if (d.stats.totalInputTokens || d.stats.totalOutputTokens) {
      lines.push(`  In: ${fmtTokens(d.stats.totalInputTokens)}  Out: ${fmtTokens(d.stats.totalOutputTokens)}`);
      if (d.stats.totalCachedTokens) lines.push(`  Cached: ${fmtTokens(d.stats.totalCachedTokens)}`);
    }
    await ctx.reply(lines.join('\n'), { parseMode: 'HTML' });
  }

  private async cmdSwitch(ctx: TgContext) {
    const wd = this.chatWorkdir(ctx.chatId);
    const browsePath = path.dirname(wd);
    const savedCount = getWorkspacesData(this, ctx.chatId).workspaces.length;
    const view = buildSwitchWorkdirView(wd, browsePath, 0, { savedWorkspaceCount: savedCount });
    await ctx.reply(
      view.text,
      { parseMode: 'HTML', keyboard: view.keyboard },
    );
  }

  private async cmdWorkspaces(ctx: TgContext) {
    const data = getWorkspacesData(this, ctx.chatId);
    const view = buildWorkspacesView(data);
    await ctx.reply(view.text, { parseMode: 'HTML', keyboard: view.keyboard });
  }

  private async cmdHost(ctx: TgContext) {
    const d = getHostDataSync(this);
    const lines = [
      `<b>Host</b>\n`,
      `<b>Name:</b> ${escapeHtml(d.hostName)}`,
      `<b>CPU:</b> ${escapeHtml(d.cpuModel)} x${d.cpuCount}`,
      d.cpuUsage
        ? `<b>CPU Usage:</b> ${d.cpuUsage.usedPercent.toFixed(1)}% (${d.cpuUsage.userPercent.toFixed(1)}% user, ${d.cpuUsage.sysPercent.toFixed(1)}% sys, ${d.cpuUsage.idlePercent.toFixed(1)}% idle)`
        : '<b>CPU Usage:</b> unavailable',
      `<b>Memory:</b> ${fmtBytes(d.memoryUsed)} / ${fmtBytes(d.totalMem)} (${d.memoryPercent.toFixed(0)}%)`,
      `<b>Available:</b> ${fmtBytes(d.memoryAvailable)}`,
      `<b>Battery:</b> ${d.battery ? `${escapeHtml(d.battery.percent)} (${escapeHtml(d.battery.state)})` : 'unavailable'}`,
    ];
    if (d.disk) lines.push(`<b>Disk:</b> ${escapeHtml(d.disk.used)} used / ${escapeHtml(d.disk.total)} total (${escapeHtml(d.disk.percent)})`);
    lines.push(`\n<b>Process:</b> PID ${d.selfPid} | RSS ${fmtBytes(d.selfRss)} | Heap ${fmtBytes(d.selfHeap)}`);
    if (d.topProcs.length > 1) {
      lines.push(`\n<b>Top Processes:</b>`);
      lines.push(`<pre>${d.topProcs.map(l => escapeHtml(l)).join('\n')}</pre>`);
    }
    await ctx.reply(lines.join('\n'), { parseMode: 'HTML' });
  }

  private async cmdAgents(ctx: TgContext) {
    await this.sendCommandView(ctx, buildAgentsCommandView(this, ctx.chatId));
  }

  private async cmdModels(ctx: TgContext) {
    await this.sendCommandView(ctx, await buildModelsCommandView(this, ctx.chatId));
  }

  private async cmdMode(ctx: TgContext) {
    await this.sendCommandView(ctx, buildModeCommandView(this, ctx.chatId));
  }

  private async cmdRestart(ctx: TgContext) {
    await ctx.reply(
      `<b>Restarting pikiclaw...</b>\n\n` +
      `The bot will be back shortly.`,
      { parseMode: 'HTML' },
    );
    void requestProcessRestart({ log: msg => this.log(msg) });
  }

  private async cmdGoal(ctx: TgContext, args: string) {
    const reply = await handleGoalCommand(this, ctx.chatId, args);
    if (reply == null) {
      await ctx.reply('No session selected. Use /sessions to pick one first.');
      return;
    }
    await ctx.reply(reply);
  }

  private async cmdStop(ctx: TgContext) {
    const session = this.selectedSession(ctx.chatId);
    if (!session) {
      await ctx.reply('No active session to stop.');
      return;
    }
    const { interrupted, cancelledQueued } = this.stopTasksForSession(session.key);
    if (!interrupted && cancelledQueued === 0) {
      await ctx.reply('No running or queued work for the current session.');
      return;
    }
    const parts: string[] = [];
    if (interrupted) parts.push('interrupted the current run');
    if (cancelledQueued > 0) parts.push(`cancelled ${cancelledQueued} queued ${cancelledQueued === 1 ? 'task' : 'tasks'}`);
    await ctx.reply(`Stopped current session: ${parts.join(', ')}.`);
  }

  private buildHumanLoopKeyboard(promptId: string): { inline_keyboard: { text: string; callback_data: string }[][] } {
    const prompt = this.humanLoopPrompt(promptId);
    const question = prompt ? currentHumanLoopQuestion(prompt) : null;
    const inline_keyboard: { text: string; callback_data: string }[][] = [];
    const optionRows = (question?.options || []).map((option, index) => ([{
      text: `${humanLoopOptionSelected(prompt!, option.value) ? '●' : '○'} ${truncateMiddle(option.label, 28)}`,
      callback_data: `hl:o:${promptId}:${index}`,
    }]));
    inline_keyboard.push(...optionRows);
    if (question?.options?.length && question.allowFreeform) {
      inline_keyboard.push([{ text: 'Other...', callback_data: `hl:other:${promptId}` }]);
    }
    if (question?.allowEmpty) {
      inline_keyboard.push([{ text: 'Skip', callback_data: `hl:skip:${promptId}` }]);
    }
    inline_keyboard.push([{ text: 'Cancel', callback_data: `hl:cancel:${promptId}` }]);
    return { inline_keyboard };
  }

  private async refreshHumanLoopPrompt(chatId: number, promptId: string) {
    const prompt = this.humanLoopPrompt(promptId);
    if (!prompt) return;
    const messageId = prompt.messageIds[0];
    if (typeof messageId !== 'number') return;
    await this.channel.editMessage(chatId, messageId, buildHumanLoopPromptHtml(prompt), {
      parseMode: 'HTML',
      keyboard: this.buildHumanLoopKeyboard(promptId),
    }).catch(() => {});
  }

  protected override async onInteractionAnswered(
    prompt: HumanLoopPromptState<number>,
    summary: ResolvedHumanLoopAnswers,
  ): Promise<void> {
    const messageId = prompt.messageIds[0];
    const chatId = prompt.chatId;
    const closedHtml = buildAnsweredHumanLoopPromptHtml(prompt, summary);
    if (typeof messageId === 'number') {
      try {
        await this.channel.editMessage(chatId, messageId, closedHtml, {
          parseMode: 'HTML',
          keyboard: { inline_keyboard: [] },
        });
      } catch (err: any) {
        this.debug(`[human-loop] close-card edit failed chat=${chatId} prompt=${prompt.promptId}: ${err?.message || err}`);
      }
    }
    const echoLines = buildInteractionEchoHtml(summary);
    if (!echoLines) return;
    try {
      await this.channel.send(chatId, echoLines, { parseMode: 'HTML' });
    } catch (err: any) {
      this.debug(`[human-loop] echo send failed chat=${chatId} prompt=${prompt.promptId}: ${err?.message || err}`);
    }
  }

  /**
   * IM presenter for programmatic submissions (e.g. /goal-driven turns) so
   * they stream to Telegram the same way a typed message does — placeholder
   * card, LivePreview edits, sendFinalReply at the end. Without this, /goal
   * just emits a confirmation reply and the rest of the turn is invisible.
   */
  protected override async createImTaskPresenter(opts: ImTaskPresenterOpts): Promise<ImTaskPresenter | null> {
    if (typeof opts.chatId !== 'number') return null;
    const chatId = opts.chatId;
    const startTimeMs = Date.now();
    const startConfig = this.resolveSessionStreamConfig(opts.session);
    const canEditMessages = supportsChannelCapability((this as any).channel, 'editMessages');
    const canSendTyping = supportsChannelCapability((this as any).channel, 'typingIndicators');
    let phId: number | null = null;
    if (canEditMessages) {
      try {
        const sent = await this.channel.send(
          chatId,
          buildInitialPreviewHtml(opts.agent, startConfig.model, startConfig.effort, false),
          { parseMode: 'HTML' },
        );
        phId = typeof sent === 'number' ? sent : null;
        if (phId != null) this.registerSessionMessage(chatId, phId, opts.session);
      } catch (e: any) {
        this.debug(`[im-presenter telegram] placeholder send failed chat=${chatId}: ${e?.message || e}`);
      }
    }
    this.registerTaskPlaceholders(opts.taskId, [phId]);

    let livePreview: LivePreview | null = null;
    if (phId != null || canSendTyping) {
      livePreview = new LivePreview({
        agent: opts.agent,
        chatId,
        placeholderMessageId: phId,
        channel: this.channel,
        renderer: telegramPreviewRenderer,
        streamEditIntervalMs: opts.agent === 'codex' ? 400 : 800,
        startTimeMs,
        canEditMessages,
        canSendTyping,
        model: startConfig.model,
        effort: startConfig.effort,
        log: (msg) => this.debug(msg),
      });
      livePreview.start();
    }

    const session = opts.session;
    return {
      onText: (text, thinking, activity, meta, plan) => {
        livePreview?.update(text, thinking, activity, meta, plan);
      },
      onSuccess: async (result) => {
        try { await livePreview?.settle(); } catch {}
        const finalReply = await this.sendFinalReply({ chatId }, phId, opts.agent, result);
        this.registerSessionMessages(chatId, finalReply.messageIds, session);
      },
      onFailure: async (error) => {
        try { await livePreview?.settle(); } catch {}
        const errorHtml = `<b>Error</b>\n\n<code>${escapeHtml(error.slice(0, 500))}</code>`;
        if (phId != null) {
          try {
            await this.channel.editMessage(chatId, phId, errorHtml, { parseMode: 'HTML', keyboard: { inline_keyboard: [] } });
            this.registerSessionMessage(chatId, phId, session);
            return;
          } catch {}
        }
        try {
          const sent = await this.channel.send(chatId, errorHtml, { parseMode: 'HTML' });
          this.registerSessionMessage(chatId, typeof sent === 'number' ? sent : null, session);
        } catch (e: any) {
          this.debug(`[im-presenter telegram] error send failed chat=${chatId}: ${e?.message || e}`);
        }
      },
      dispose: () => {
        livePreview?.dispose();
      },
    };
  }

  protected override async renderInteractionPrompt(prompt: HumanLoopPromptState<number>, chatId: number): Promise<void> {
    const messageThreadId = this.interactionThreadIds.get(prompt.taskId);
    const sent = await this.channel.send(chatId, buildHumanLoopPromptHtml(prompt), {
      parseMode: 'HTML',
      messageThreadId,
      keyboard: this.buildHumanLoopKeyboard(prompt.promptId),
    });
    if (typeof sent === 'number') this.registerHumanLoopMessage(prompt.promptId, sent);
  }

  /** Cache the messageThreadId per task so renderInteractionPrompt can use it. */
  private interactionThreadIds = new Map<string, number | undefined>();

  // ---- streaming bridge -----------------------------------------------------

  private async handleMessage(msg: TgMessage, ctx: TgContext) {
    const text = msg.text.trim();
    if (!text && !msg.files.length) return;
    const pendingPrompt = this.pendingHumanLoopPrompt(ctx.chatId);
    if (pendingPrompt && text && !msg.files.length && !text.startsWith('/')) {
      const result = this.humanLoopSubmitText(ctx.chatId, text);
      if (!result) {
        await ctx.reply('Please answer the active prompt using the buttons above.');
        return;
      }
      // Completed prompts close themselves via onInteractionAnswered.
      if (!result.completed) await this.refreshHumanLoopPrompt(ctx.chatId, result.prompt.promptId);
      return;
    }

    const session = this.resolveIncomingSession(ctx, text, msg.files);
    const cs = this.chat(ctx.chatId);
    this.applySessionSelection(cs, session);
    const messageThreadId = typeof ctx.raw?.message_thread_id === 'number' ? ctx.raw.message_thread_id : undefined;

    if (!text && msg.files.length) {
      const hadPendingWork = this.sessionHasPendingWork(session);
      const stageTask = this.queueSessionTask(session, async () => {
        try {
          if (this.isSourceMessageWithdrawn(ctx.chatId, ctx.messageId)) {
            this.debug(`[handleMessage] skipped withdrawn file stage chat=${ctx.chatId} msg=${ctx.messageId}`);
            return;
          }
          const staged = stageSessionFiles({
            agent: session.agent,
            workdir: session.workdir,
            files: msg.files,
            sessionId: session.sessionId,
            title: undefined,
            threadId: session.threadId,
          });
          session.workspacePath = staged.workspacePath;
          session.threadId = staged.threadId;
          this.syncSelectedChats(session);
          if (!staged.importedFiles.length) throw new Error('no files persisted');
          this.debug(`[handleMessage] staged workspace files chat=${ctx.chatId} session=${staged.sessionId} files=${staged.importedFiles.length}`);
          this.registerSessionMessage(ctx.chatId, ctx.messageId, session);
          await this.safeSetMessageReaction(ctx.chatId, ctx.messageId, ['👌']);
        } catch (e: any) {
          this.warn(`[handleMessage] stage files failed: ${e?.message || e}`);
          await this.safeSetMessageReaction(ctx.chatId, ctx.messageId, ['⚠️']);
        }
      });
      if (hadPendingWork) {
        void stageTask.catch(e => this.warn(`[handleMessage] stage queue failed: ${e}`));
      } else {
        await stageTask.catch(e => this.warn(`[handleMessage] stage queue failed: ${e}`));
      }
      return;
    }

    const files = msg.files;
    const prompt = buildPrompt(text, files);
    const start = Date.now();
    const canEditMessages = supportsChannelCapability((this as any).channel, 'editMessages');
    const canSendTyping = supportsChannelCapability((this as any).channel, 'typingIndicators');
    this.debug(`[handleMessage] queued chat=${ctx.chatId} agent=${session.agent} session=${session.sessionId || '(new)'} prompt="${prompt.slice(0, 100)}" files=${files.length}`);
    const taskId = this.createTaskId(session);
    this.beginTask({
      taskId,
      chatId: ctx.chatId,
      agent: session.agent,
      sessionKey: session.key,
      prompt,
      attachments: files,
      startedAt: start,
      sourceMessageId: ctx.messageId,
    });
    this.emitStreamQueued(session.key, taskId);
    const waiting = this.sessionHasPendingWork(session);
    const queuePosition = waiting ? this.getQueuePosition(session.key, taskId) : 0;
    const placeholderKeyboard = this.buildStopKeyboard(this.actionIdForTask(taskId), { queued: waiting });
    const startConfig = this.resolveSessionStreamConfig(session);
    let phId: number | null = null;
    if (canEditMessages) {
      const placeholderId = await ctx.reply(buildInitialPreviewHtml(session.agent, startConfig.model, startConfig.effort, waiting, queuePosition), { parseMode: 'HTML', messageThreadId, keyboard: placeholderKeyboard });
      phId = typeof placeholderId === 'number' ? placeholderId : null;
      if (phId != null) {
        this.registerSessionMessage(ctx.chatId, phId, session);
        this.debug(`[handleMessage] placeholder sent msg_id=${phId}, task queued`);
      } else {
        this.debug(`[handleMessage] placeholder unavailable for chat=${ctx.chatId}; continuing without live preview`);
      }
    } else {
      this.debug(`[handleMessage] skipping placeholder for chat=${ctx.chatId}; channel does not support message edits`);
    }
    this.registerTaskPlaceholders(taskId, [phId]);

    void this.queueSessionTask(session, async () => {
      let livePreview: LivePreview | null = null;
      let task: ReturnType<TelegramBot['markTaskRunning']> = null;
      const abortController = new AbortController();
      try {
        task = this.markTaskRunning(taskId, () => abortController.abort());
        if (!task || task.cancelled) {
          this.emitStreamCancelled(taskId, session.key);
          if (phId != null) {
            try { await this.channel.deleteMessage(ctx.chatId, phId); } catch {}
          }
          this.debug(`[handleMessage] skipped cancelled queued task chat=${ctx.chatId} msg=${ctx.messageId}`);
          return;
        }
        this.emitStreamStart(taskId, session);
        // Task is now running — update keyboard from Recall/Steer to Stop
        const runningKeyboard = this.buildStopKeyboard(this.actionIdForTask(taskId));
        if (phId != null && waiting) {
          try { await this.channel.editMessage(ctx.chatId, phId, buildInitialPreviewHtml(session.agent, startConfig.model, startConfig.effort, false), { parseMode: 'HTML', keyboard: runningKeyboard }); } catch {}
        }
        if (phId != null || canSendTyping) {
          livePreview = new LivePreview({
            agent: session.agent,
            chatId: ctx.chatId,
            placeholderMessageId: phId,
            channel: this.channel,
            renderer: telegramPreviewRenderer,
            streamEditIntervalMs: session.agent === 'codex' ? 400 : 800,
            startTimeMs: start,
            canEditMessages,
            canSendTyping,
            messageThreadId,
            keyboard: runningKeyboard,
            model: startConfig.model,
            effort: startConfig.effort,
            log: (message: string) => this.debug(message),
          });
          livePreview.start();
        }

        // MCP sendFile callback: sends files to IM in real-time during the stream
        const mcpSendFile = this.createMcpSendFileCallback(ctx, messageThreadId);

        this.interactionThreadIds.set(taskId, messageThreadId);
        const result = await this.runStream(prompt, session, files, (nextText, nextThinking, nextActivity = '', meta, plan) => {
          livePreview?.update(nextText, nextThinking, nextActivity, meta, plan);
          this.emitStreamText(taskId, session.key, nextText, nextThinking, nextActivity, meta, plan);
        }, undefined, mcpSendFile, abortController.signal, this.createInteractionHandler(ctx.chatId, taskId), (steer) => {
          const currentTask = this.activeTasks.get(taskId);
          if (!currentTask || currentTask.cancelled || currentTask.status !== 'running') return;
          currentTask.steer = steer;
        });
        await livePreview?.settle();

        if (task?.freezePreviewOnAbort && result.stopReason === 'interrupted') {
          this.emitStreamDone(taskId, session.key, {
            sessionId: result.sessionId || session.sessionId,
            incomplete: true,
          });
          const frozenMessageIds = await this.freezeSteerHandoffPreview(ctx, phId, livePreview);
          this.registerSessionMessages(ctx.chatId, frozenMessageIds, session);
          this.debug(`[handleMessage] steer handoff preserved previous preview chat=${ctx.chatId} task=${taskId}`);
          return;
        }

        this.emitStreamDone(taskId, session.key, {
          sessionId: result.sessionId || session.sessionId,
          incomplete: !!result.incomplete,
          ...(result.ok ? {} : { error: result.error || result.message }),
        });
        this.debug(
          `[handleMessage] done agent=${session.agent} ok=${result.ok} session=${result.sessionId || '?'} elapsed=${result.elapsedS.toFixed(1)}s edits=${livePreview?.getEditCount() || 0} ` +
          `tokens=in:${fmtTokens(result.inputTokens)}/cached:${fmtTokens(result.cachedInputTokens)}/out:${fmtTokens(result.outputTokens)}`
        );
        this.debug(`[handleMessage] response preview: "${result.message.slice(0, 150)}"`);

        const finalReply = await this.sendFinalReply(
          { chatId: ctx.chatId, replyTo: ctx.messageId, messageThreadId },
          phId, session.agent, result,
        );
        this.registerSessionMessages(ctx.chatId, finalReply.messageIds, session);
        this.debug(`[handleMessage] final reply sent to chat=${ctx.chatId}`);
      } catch (e: any) {
        if (task?.freezePreviewOnAbort && abortController.signal.aborted) {
          this.emitStreamDone(taskId, session.key, {
            sessionId: session.sessionId,
            incomplete: true,
          });
          const frozenMessageIds = await this.freezeSteerHandoffPreview(ctx, phId, livePreview);
          this.registerSessionMessages(ctx.chatId, frozenMessageIds, session);
          this.debug(`[handleMessage] steer handoff preserved preview after abort chat=${ctx.chatId} task=${taskId}`);
          return;
        }
        const msgText = String(e?.message || e || 'Unknown error');
        this.emitStreamDone(taskId, session.key, {
          sessionId: session.sessionId,
          incomplete: true,
          error: msgText,
        });
        this.warn(`[handleMessage] task failed chat=${ctx.chatId} session=${session.sessionId} error=${msgText}`);
        const errorHtml = `<b>Error</b>\n\n<code>${escapeHtml(msgText.slice(0, 500))}</code>`;
        if (phId != null) {
          try {
            await this.channel.editMessage(ctx.chatId, phId, errorHtml, { parseMode: 'HTML', keyboard: { inline_keyboard: [] } });
            this.registerSessionMessage(ctx.chatId, phId, session);
          } catch {
            const sent = await this.channel.send(ctx.chatId, errorHtml, { parseMode: 'HTML', replyTo: ctx.messageId, messageThreadId }).catch(() => null);
            this.registerSessionMessage(ctx.chatId, typeof sent === 'number' ? sent : null, session);
          }
        } else {
          const sent = await this.channel.send(ctx.chatId, errorHtml, { parseMode: 'HTML', replyTo: ctx.messageId, messageThreadId }).catch(() => null);
          this.registerSessionMessage(ctx.chatId, typeof sent === 'number' ? sent : null, session);
        }
        await this.safeSetMessageReaction(ctx.chatId, ctx.messageId, ['⚠️']);
      } finally {
        livePreview?.dispose();
        this.interactionThreadIds.delete(taskId);
        this.finishTask(taskId);
        this.syncSelectedChats(session);
      }
    }, taskId).catch(e => {
      this.warn(`[handleMessage] queue execution failed: ${e}`);
      this.finishTask(taskId);
    });
  }

  private async freezeSteerHandoffPreview(
    ctx: TgContext,
    phId: number | null,
    livePreview: LivePreview | null,
  ): Promise<number[]> {
    if (phId == null) return [];
    const previewHtml = livePreview?.getRenderedPreview()?.trim() || '';
    if (!previewHtml) return [phId];
    try {
      await this.channel.editMessage(ctx.chatId, phId, previewHtml, {
        parseMode: 'HTML',
        keyboard: { inline_keyboard: [] },
      });
      return [phId];
    } catch {
      return [];
    }
  }

  /** Create an MCP sendFile callback bound to a Telegram chat context. */
  private createMcpSendFileCallback(ctx: TgContext, messageThreadId?: number): McpSendFileCallback {
    return async (filePath, opts) => {
      try {
        await this.channel.sendFile(ctx.chatId, filePath, {
          caption: opts?.caption,
          replyTo: ctx.messageId,
          messageThreadId,
          asPhoto: opts?.kind === 'photo',
        });
        return { ok: true };
      } catch (e: any) {
        this.log(`[mcp] sendFile failed: ${filePath} error=${e?.message || e}`);
        return { ok: false, error: e?.message || 'send failed' };
      }
    };
  }

  private async safeSetMessageReaction(chatId: number, messageId: number, reactions: string[]) {
    if (!supportsChannelCapability((this as any).channel, 'messageReactions')) return;
    const setReaction = (this.channel as any)?.setMessageReaction;
    if (typeof setReaction !== 'function') return;
    try {
      await setReaction.call(this.channel, chatId, messageId, reactions);
    } catch {}
  }

  private async sendFinalReply(
    anchor: { chatId: number; replyTo?: number; messageThreadId?: number },
    phId: number | null,
    agent: Agent,
    result: StreamResult,
  ): Promise<{ primaryMessageId: number | null; messageIds: number[] }> {
    const rendered = buildFinalReplyRender(agent, result);
    const messageIds: number[] = [];
    const remember = (messageId: number | null) => {
      if (typeof messageId === 'number' && !messageIds.includes(messageId)) messageIds.push(messageId);
      return messageId;
    };
    const sendFinalText = (text: string, replyTo?: number | null) => this.channel.send(anchor.chatId, text, {
      parseMode: 'HTML',
      replyTo: replyTo ?? anchor.replyTo,
      messageThreadId: anchor.messageThreadId,
    });
    const replacePreview = async (text: string) => {
      if (phId != null) {
        try {
          await this.channel.editMessage(anchor.chatId, phId, text, { parseMode: 'HTML', keyboard: { inline_keyboard: [] } });
          return remember(phId);
        } catch {}
      }
      return remember(await sendFinalText(text));
    };
    let finalMsgId: number | null = phId;

    if (rendered.fullHtml.length <= 3900) {
      finalMsgId = await replacePreview(rendered.fullHtml);
    } else {
      // Split: header on first message, footer on last message
      const maxFirst = 3900 - rendered.headerHtml.length;
      let firstBody: string;
      let remaining: string;
      if (maxFirst > 200) {
        let cut = rendered.bodyHtml.lastIndexOf('\n', maxFirst);
        if (cut < maxFirst * 0.3) cut = maxFirst;
        firstBody = rendered.bodyHtml.slice(0, cut);
        remaining = rendered.bodyHtml.slice(cut);
      } else {
        firstBody = '';
        remaining = rendered.bodyHtml;
      }

      if (remaining.trim()) {
        // Multi-message: header on first, footer on last
        const firstHtml = `${rendered.headerHtml}${firstBody}`;
        finalMsgId = await replacePreview(firstHtml);
        const chunks = splitText(remaining, 3800);
        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          const chunkText = isLast ? `${chunks[i]}${rendered.footerHtml}` : chunks[i];
          remember(await sendFinalText(chunkText, finalMsgId ?? phId ?? anchor.replyTo));
        }
        // Safety: re-clear the Stop keyboard on the placeholder in case the first edit silently failed
        if (phId != null) {
          try { await this.channel.editMessage(anchor.chatId, phId, firstHtml || '(done)', { parseMode: 'HTML', keyboard: { inline_keyboard: [] } }); } catch {}
        }
      } else {
        // Body fits on first message; only footer pushes it over — keep together
        const firstHtml = `${rendered.headerHtml}${firstBody}${rendered.footerHtml}`;
        finalMsgId = await replacePreview(firstHtml);
      }
    }

    // Dispatch any image MessageBlocks the agent produced this turn (Codex
    // built-in `image_gen`, MCP / Skill tool_result images, …). Each goes out
    // as a separate Telegram photo with the optional caption attached.
    const dispatched = await dispatchImageBlocks(this.channel, result.assistantBlocks, {
      chatId: anchor.chatId,
      replyTo: finalMsgId ?? phId ?? anchor.replyTo,
      messageThreadId: anchor.messageThreadId,
      log: (message) => this.debug(message),
    });
    for (const entry of dispatched) {
      if (typeof entry.messageId === 'number') remember(entry.messageId);
    }

    return { primaryMessageId: finalMsgId, messageIds };
  }

  // ---- callbacks ------------------------------------------------------------

  private async handleSwitchNavigateCallback(data: string, ctx: TgCallbackContext): Promise<boolean> {
    if (!data.startsWith('sw:n:')) return false;
    const [pathId, pageRaw] = data.slice(5).split(':');
    const browsePath = resolveRegisteredPath(parseInt(pathId, 10));
    if (!browsePath) {
      await ctx.answerCallback('Expired, use /switch again');
      return true;
    }
    const wd = this.chatWorkdir(ctx.chatId);
    const view = buildSwitchWorkdirView(wd, browsePath, parseInt(pageRaw, 10) || 0);
    await ctx.editReply(ctx.messageId, view.text, { parseMode: 'HTML', keyboard: view.keyboard });
    await ctx.answerCallback();
    return true;
  }

  private async handleSwitchSelectCallback(data: string, ctx: TgCallbackContext): Promise<boolean> {
    if (!data.startsWith('sw:s:')) return false;
    const dirPath = resolveRegisteredPath(parseInt(data.slice(5), 10));
    if (!dirPath) {
      await ctx.answerCallback('Expired, use /switch again');
      return true;
    }
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      await ctx.answerCallback('Not a valid directory');
      return true;
    }

    const oldPath = this.switchWorkdir(dirPath);
    await ctx.answerCallback('Switched!');
    await ctx.editReply(
      ctx.messageId,
      `<b>Workdir</b>\n● <code>${escapeHtml(truncateMiddle(oldPath, 42))}</code>\n→ <code>${escapeHtml(truncateMiddle(dirPath, 42))}</code>`,
      { parseMode: 'HTML' },
    );
    return true;
  }

  private async handleWorkspacesCallback(data: string, ctx: TgCallbackContext): Promise<boolean> {
    if (data.startsWith('wsp:p:')) {
      const page = parseInt(data.slice('wsp:p:'.length), 10) || 0;
      const view = buildWorkspacesView(getWorkspacesData(this, ctx.chatId), page);
      await ctx.editReply(ctx.messageId, view.text, { parseMode: 'HTML', keyboard: view.keyboard });
      await ctx.answerCallback();
      return true;
    }
    if (data.startsWith('wsp:s:')) {
      const dirPath = resolveRegisteredPath(parseInt(data.slice('wsp:s:'.length), 10));
      if (!dirPath) {
        await ctx.answerCallback('Expired, use /workspaces again');
        return true;
      }
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        await ctx.answerCallback('Workspace path is missing on disk');
        return true;
      }
      const oldPath = this.switchWorkdir(dirPath);
      await ctx.answerCallback('Switched!');
      await ctx.editReply(
        ctx.messageId,
        `<b>Workdir</b>\n● <code>${escapeHtml(truncateMiddle(oldPath, 42))}</code>\n→ <code>${escapeHtml(truncateMiddle(dirPath, 42))}</code>`,
        { parseMode: 'HTML' },
      );
      return true;
    }
    return false;
  }

  private async handleSessionsPageCallback(data: string, ctx: TgCallbackContext): Promise<boolean> {
    const action = decodeCommandAction(data);
    if (!action) return false;
    const result = await executeCommandAction(this, ctx.chatId, action, {
      sessionsPageSize: this.sessionsPageSize,
    });
    await this.applyCommandCallbackResult(ctx, result);
    return true;
  }

  private async handleTaskStopCallback(data: string, ctx: TgCallbackContext): Promise<boolean> {
    if (!data.startsWith('tsk:stop:')) return false;
    const actionId = data.slice('tsk:stop:'.length).trim();
    const result = this.stopTaskByActionId(actionId);
    if (!result.task) {
      await ctx.answerCallback('This task already finished.');
      return true;
    }
    if (result.cancelled) {
      try { await this.channel.deleteMessage(ctx.chatId, ctx.messageId); } catch {}
      await ctx.answerCallback('Queued task cancelled.');
      return true;
    }
    if (result.interrupted) {
      await ctx.answerCallback('Stopping...');
      return true;
    }
    await ctx.answerCallback('Nothing to stop.');
    return true;
  }

  private async handleTaskSteerCallback(data: string, ctx: TgCallbackContext): Promise<boolean> {
    if (!data.startsWith('tsk:steer:')) return false;
    const actionId = data.slice('tsk:steer:'.length).trim();
    const result = await this.steerTaskByActionId(actionId);
    if (!result.task) {
      await ctx.answerCallback('This task already finished.');
      return true;
    }
    if (result.task.status !== 'queued') {
      await ctx.answerCallback('Task is already running.');
      return true;
    }
    await ctx.answerCallback(result.interrupted ? 'Steering — switching to the queued reply...' : 'No running task to interrupt.');
    return true;
  }

  private async handleHumanLoopCallback(data: string, ctx: TgCallbackContext): Promise<boolean> {
    if (!data.startsWith('hl:')) return false;
    const [, action, promptId, rawIndex] = data.split(':');
    const prompt = this.humanLoopPrompt(promptId);
    if (!prompt) {
      await ctx.answerCallback('This prompt is no longer active.');
      return true;
    }
    if (action === 'cancel') {
      this.humanLoopCancel(promptId, 'Prompt cancelled from Telegram.');
      await ctx.answerCallback('Cancelled.');
      return true;
    }
    if (action === 'skip') {
      const result = this.humanLoopSkip(promptId);
      if (!result) {
        await ctx.answerCallback('This prompt is no longer active.');
        return true;
      }
      if (!result.completed) await this.refreshHumanLoopPrompt(ctx.chatId, promptId);
      await ctx.answerCallback(result.completed ? 'Submitted.' : 'Skipped.');
      return true;
    }
    if (action === 'other') {
      const result = this.humanLoopSelectOption(promptId, '__other__', { requestFreeform: true });
      if (!result) {
        await ctx.answerCallback('This prompt is no longer active.');
        return true;
      }
      await this.refreshHumanLoopPrompt(ctx.chatId, promptId);
      await ctx.answerCallback('Reply with text to continue.');
      return true;
    }
    if (action === 'o') {
      const index = Number.parseInt(rawIndex || '', 10);
      const question = this.humanLoopCurrentQuestion(promptId);
      const option = Number.isFinite(index) ? question?.options?.[index] : null;
      if (!option) {
        await ctx.answerCallback('Option expired.');
        return true;
      }
      const result = this.humanLoopSelectOption(promptId, option.value);
      if (!result) {
        await ctx.answerCallback('This prompt is no longer active.');
        return true;
      }
      if (!result.completed) await this.refreshHumanLoopPrompt(ctx.chatId, promptId);
      await ctx.answerCallback(result.completed ? 'Submitted.' : 'Recorded.');
      return true;
    }
    await ctx.answerCallback();
    return true;
  }

  async handleCallback(data: string, ctx: TgCallbackContext) {
    if (await this.handleHumanLoopCallback(data, ctx)) return;
    if (await this.handleTaskStopCallback(data, ctx)) return;
    if (await this.handleTaskSteerCallback(data, ctx)) return;
    if (await this.handleSwitchNavigateCallback(data, ctx)) return;
    if (await this.handleSwitchSelectCallback(data, ctx)) return;
    if (await this.handleWorkspacesCallback(data, ctx)) return;
    if (await this.handleSessionsPageCallback(data, ctx)) return;
    await ctx.answerCallback();
  }

  private async previewCurrentSessionTurn(chatId: number, agent: Agent, sessionId: string | null) {
    try {
      const preview = await getSessionTurnPreviewData(this, agent, sessionId, 50, this.chatWorkdir(chatId));
      if (!preview) return;
      const previewHtml = renderSessionTurnHtml(preview.userText, preview.assistantText);
      if (!previewHtml) return;
      const sent = await this.channel.send(chatId, previewHtml, { parseMode: 'HTML' });
      if (sessionId) {
        const runtime = this.getSessionRuntimeByKey(this.sessionKey(agent, sessionId));
        if (runtime && typeof sent === 'number') this.registerSessionMessage(chatId, sent, runtime);
      }
    } catch {
      // non-critical
    }
  }

  // ---- command router -------------------------------------------------------

  async handleCommand(cmd: string, args: string, ctx: TgContext) {
    try {
      switch (cmd) {
        case 'start':    await this.cmdStart(ctx); return;
        case 'sessions': await this.cmdSessions(ctx); return;
        case 'agents':   await this.cmdAgents(ctx); return;
        case 'models':   await this.cmdModels(ctx); return;
        case 'mode':     await this.cmdMode(ctx); return;
        case 'skills':   await this.cmdSkills(ctx); return;
        case 'ext':      await this.cmdExt(ctx); return;
        case 'goal':     await this.cmdGoal(ctx, args); return;
        case 'stop':     await this.cmdStop(ctx); return;
        case 'status':   await this.cmdStatus(ctx); return;
        case 'host':     await this.cmdHost(ctx); return;
        case 'switch':   await this.cmdSwitch(ctx); return;
        case 'workspaces': await this.cmdWorkspaces(ctx); return;
        case 'restart':  await this.cmdRestart(ctx); return;
        default:
          // Intercept skill commands (sk_<name>) and route to agent
          if (cmd.startsWith(TelegramBot.SKILL_CMD_PREFIX)) {
            await this.cmdSkill(cmd, args, ctx);
            return;
          }
          await this.handleMessage({ text: `/${cmd}${args ? ' ' + args : ''}`, files: [] }, ctx);
      }
    } catch (e: any) {
      this.log(`cmd error: ${e}`);
      await ctx.reply(`Error: ${String(e).slice(0, 200)}`);
    }
  }

  /** Execute a project-defined skill by routing it to the current agent. */
  private async cmdSkill(cmd: string, args: string, ctx: TgContext) {
    const resolved = resolveSkillPrompt(this, ctx.chatId, cmd, args);
    if (!resolved) {
      await ctx.reply(`Skill not found for command /${cmd} in:\n<code>${escapeHtml(this.chatWorkdir(ctx.chatId))}</code>`, { parseMode: 'HTML' });
      return;
    }
    this.log(`skill: ${resolved.skillName} agent=${this.chat(ctx.chatId).agent}${args.trim() ? ` args="${args.trim()}"` : ''}`);
    await this.handleMessage({ text: resolved.prompt, files: [] }, ctx);
  }

  // ---- lifecycle ------------------------------------------------------------

  async run() {
    const tmpDir = path.join(os.tmpdir(), 'pikiclaw');
    fs.mkdirSync(tmpDir, { recursive: true });

    this.channel = new TelegramChannel({
      token: this.token,
      workdir: tmpDir,
      allowedChatIds: this.allowedChatIds.size ? this.allowedChatIds as Set<number> : undefined,
    });
    this.processRuntimeCleanup?.();
    this.processRuntimeCleanup = registerProcessRuntime({
      label: 'telegram',
      getActiveTaskCount: () => this.activeTasks.size,
      prepareForRestart: () => this.cleanupRuntimeForExit(),
      buildRestartEnv: () => this.buildRestartEnv(),
    });
    this.installSignalHandlers();

    try {
      const bot = await this.channel.connect();
      this.connected = true;
      this.log(`bot: @${bot.username} (id=${bot.id})`);

      this.channel.skipPendingUpdatesOnNextListen();

      // Seed knownChats so setupMenu applies per-chat commands
      for (const cid of this.allowedChatIds) if (typeof cid === 'number') this.channel.knownChats.add(cid);

      for (const ag of this.fetchAgents().agents) {
        this.log(`agent ${ag.agent}: ${ag.path || 'NOT FOUND'}`);
      }
      this.log(`config: agent=${this.defaultAgent} workdir=${this.workdir} timeout=${this.runTimeout}s`);

      this.channel.onCommand((cmd, args, ctx) => this.handleCommand(cmd, args, ctx));
      this.channel.onMessage((msg, ctx) => this.handleMessage(msg, ctx));
      this.channel.onCallback((data, ctx) => this.handleCallback(data, ctx));
      this.channel.onError(err => this.log(`error: ${err}`));

      this.startKeepAlive();
      void this.setupMenu().catch(err => this.log(`menu setup failed: ${err}`));
      void this.sendStartupNotice().catch(err => this.log(`startup notice failed: ${err}`));
      this.log('✓ Telegram connected, polling started — ready to receive messages');
      await this.channel.listen();
      this.stopKeepAlive();
      this.log('stopped');
    } finally {
      this.stopKeepAlive();
      this.clearShutdownForceExitTimer();
      this.removeSignalHandlers();
      this.processRuntimeCleanup?.();
      this.processRuntimeCleanup = null;
      if (this.shutdownInFlight) process.exit(this.shutdownExitCode ?? 1);
    }
  }

  private async sendStartupNotice() {
    const targets = new Set(this.allowedChatIds);
    for (const cid of this.channel.knownChats) targets.add(cid);
    if (!targets.size) {
      this.log('no known chats for startup notice');
      return;
    }

    for (const cid of targets) {
      try {
        const d = getStartData(this, cid);
        const text = this.renderStartHtml(d);
        await this.channel.send(cid, text, { parseMode: 'HTML' });
        this.log(`startup notice sent to chat=${cid}`);
      } catch (e) {
        this.log(`startup notice failed for chat=${cid}: ${e}`);
      }
    }
  }
}
