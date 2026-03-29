import type { Agent } from './code-agent.js';
import { runtime } from './runtime.js';

export interface QueueSessionTaskRequest {
  workdir: string;
  agent: Agent;
  sessionId: string;
  prompt: string;
  attachments?: string[];
}

export function queueDashboardSessionTask(request: QueueSessionTaskRequest) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  if (!request.workdir || !request.agent || !request.sessionId || (!request.prompt && !(request.attachments || []).length)) {
    return { ok: false as const, error: 'workdir, agent, sessionId, and either prompt or attachments are required' };
  }

  return bot.submitSessionTask({
    workdir: request.workdir,
    agent: request.agent,
    sessionId: request.sessionId,
    prompt: request.prompt || 'Please inspect the attached file(s).',
    attachments: request.attachments || [],
  });
}

export function getSessionStreamState(agent: string, sessionId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: true as const, state: null };
  return { ok: true as const, state: bot.getStreamSnapshot(`${agent}:${sessionId}`) };
}

export function cancelSessionTask(taskId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = bot.cancelTask(taskId);
  return { ok: true as const, recalled: result.cancelled || result.interrupted };
}

export async function steerSessionTask(taskId: string) {
  const bot = runtime.getBotRef();
  if (!bot) return { ok: false as const, error: 'Bot is not running' };
  const result = await bot.steerTask(taskId);
  return { ok: true as const, steered: result.steered };
}
