/**
 * Runtime session status helpers for dashboard polling.
 */

import { isRunningSessionStale } from '../agent/index.js';
import type { Bot, ChatState, SessionInfo, SessionRuntime } from './bot.js';

type SessionLookupBot = Pick<Bot, 'sessionStates'>;
type SessionLookupChat = Pick<ChatState, 'agent' | 'sessionId' | 'activeSessionKey'>;
type SessionLookupRuntimeBot = Pick<Bot, 'sessionStates' | 'chats'>;
type SessionLookupInfo = Pick<SessionInfo, 'agent' | 'sessionId' | 'running' | 'runState' | 'runUpdatedAt' | 'runPid'>;

/** Age threshold used when the owning PID is unknown or unverifiable. */
const STALE_RUNNING_AGE_MS = 30 * 60_000; // 30 minutes

export interface SessionStatusResult {
  runtime: SessionRuntime | null;
  isCurrent: boolean;
  isRunning: boolean;
  /** True when the persisted record claims 'running' but is actually orphaned (no live process, no runtime). */
  isStale: boolean;
}

function getSessionRuntime(bot: SessionLookupBot, session: SessionLookupInfo): SessionRuntime | null {
  const sessionId = session.sessionId || null;
  if (!sessionId) return null;
  return bot.sessionStates.get(`${session.agent}:${sessionId}`) || null;
}

function resolveIsRunning(session: SessionLookupInfo, runtime: SessionRuntime | null): { isRunning: boolean; isStale: boolean } {
  if (runtime?.runningTaskIds.size) return { isRunning: true, isStale: false };
  if (!session.running) return { isRunning: false, isStale: false };
  const stale = isRunningSessionStale(
    {
      runState: session.runState ?? 'running',
      runPid: session.runPid ?? null,
      runUpdatedAt: session.runUpdatedAt ?? null,
    },
    STALE_RUNNING_AGE_MS,
  );
  return stale ? { isRunning: false, isStale: true } : { isRunning: true, isStale: false };
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
  const { isRunning, isStale } = resolveIsRunning(session, runtime);
  return { runtime, isCurrent, isRunning, isStale };
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

  const { isRunning, isStale } = resolveIsRunning(session, runtime);
  return { runtime, isCurrent, isRunning, isStale };
}
