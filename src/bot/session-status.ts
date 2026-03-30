/**
 * Runtime session status helpers for dashboard polling.
 */

import type { Bot, ChatState, SessionInfo, SessionRuntime } from './bot.js';

type SessionLookupBot = Pick<Bot, 'sessionStates'>;
type SessionLookupChat = Pick<ChatState, 'agent' | 'sessionId' | 'activeSessionKey'>;
type SessionLookupRuntimeBot = Pick<Bot, 'sessionStates' | 'chats'>;
type SessionLookupInfo = Pick<SessionInfo, 'agent' | 'sessionId' | 'running'>;

export interface SessionStatusResult {
  runtime: SessionRuntime | null;
  isCurrent: boolean;
  isRunning: boolean;
}

function getSessionRuntime(bot: SessionLookupBot, session: SessionLookupInfo): SessionRuntime | null {
  const sessionId = session.sessionId || null;
  if (!sessionId) return null;
  return bot.sessionStates.get(`${session.agent}:${sessionId}`) || null;
}

export function getSessionStatusForChat(
  bot: SessionLookupBot,
  chat: SessionLookupChat,
  session: SessionLookupInfo,
): SessionStatusResult {
  const runtime = getSessionRuntime(bot, session);
  const sessionId = session.sessionId || null;
  const isCurrent = !!sessionId && (
    runtime
      ? chat.activeSessionKey === runtime.key
      : chat.agent === session.agent && chat.sessionId === sessionId
  );
  return {
    runtime,
    isCurrent,
    isRunning: !!runtime?.runningTaskIds.size || !!session.running,
  };
}

export function getSessionStatusForBot(
  bot: SessionLookupRuntimeBot,
  session: SessionLookupInfo,
): SessionStatusResult {
  const runtime = getSessionRuntime(bot, session);
  const sessionId = session.sessionId || null;
  let isCurrent = false;

  if (sessionId) {
    for (const [, chat] of bot.chats) {
      if (runtime) {
        if (chat.activeSessionKey === runtime.key) {
          isCurrent = true;
          break;
        }
        continue;
      }
      if (chat.agent === session.agent && chat.sessionId === sessionId) {
        isCurrent = true;
        break;
      }
    }
  }

  return {
    runtime,
    isCurrent,
    isRunning: !!runtime?.runningTaskIds.size || !!session.running,
  };
}
