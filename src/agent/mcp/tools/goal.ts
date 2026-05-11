/**
 * tools/goal.ts — Persistent thread goal MCP tools.
 *
 *   goal_get    — Returns the current goal (objective, status, usage, budget).
 *   goal_update — Lets the model mark the goal complete after a completion audit.
 *                 The schema only accepts `status: "complete"`. Pause / resume /
 *                 clear / budget_limited transitions are user- or runtime-controlled
 *                 and not exposed to the model.
 *
 * Goal state lives at <sessionRoot>/goal.json; this server resolves the session
 * root from MCP_WORKSPACE_PATH (which points to <sessionRoot>/workspace).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { McpToolModule, ToolContext, ToolResult } from './types.js';
import { toolResult, toolLog } from './types.js';

// ---------------------------------------------------------------------------
// Tool definitions — descriptions match Codex's analogous `get_goal` / `update_goal`
// behaviour but use the pikiclaw tool name.
// ---------------------------------------------------------------------------

const tools: McpToolModule['tools'] = [
  {
    name: 'goal_get',
    description:
      'Get the current goal for this session, including objective, status, token and elapsed-time usage, token budget, and tokens remaining.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'goal_update',
    description: [
      'Update the existing goal.',
      'Use this tool only to mark the goal achieved.',
      'Set status to `complete` only when the objective has actually been achieved and no required work remains.',
      'Do not mark a goal complete merely because its budget is nearly exhausted or because you are stopping work.',
      'You cannot use this tool to pause, resume, or budget-limit a goal; those status changes are controlled by the user or system.',
      'When marking a budgeted goal achieved with status `complete`, report the final token usage from the tool result to the user.',
    ].join('\n'),
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['complete'],
          description:
            'Required. Set to "complete" only when the objective is achieved and no required work remains.',
        },
      },
      required: ['status'],
    },
  },
];

// ---------------------------------------------------------------------------
// Path resolution — workspace → session root → goal.json
// ---------------------------------------------------------------------------

function sessionRootFromCtx(ctx: ToolContext): string {
  const workspace = path.resolve(ctx.workspace || '');
  if (!workspace) return '';
  return path.basename(workspace) === 'workspace' ? path.dirname(workspace) : workspace;
}

function goalPathFromCtx(ctx: ToolContext): string {
  const root = sessionRootFromCtx(ctx);
  if (!root) return '';
  return path.join(root, 'goal.json');
}

// ---------------------------------------------------------------------------
// Direct filesystem state access — the MCP server runs in a child process; we
// read & write goal.json atomically here rather than RPC back to the parent.
// ---------------------------------------------------------------------------

type StoredGoal = {
  goalId: string;
  objective: string;
  status: 'active' | 'paused' | 'budget_limited' | 'complete';
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  continuationCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: number;
};

function readGoalFile(file: string): StoredGoal | null {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeGoalFile(file: string, goal: StoredGoal): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmp, JSON.stringify({ ...goal, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}

function serialize(goal: StoredGoal): Record<string, unknown> {
  return {
    goal_id: goal.goalId,
    objective: goal.objective,
    status: goal.status,
    token_budget: goal.tokenBudget,
    tokens_used: goal.tokensUsed,
    time_used_seconds: goal.timeUsedSeconds,
    remaining_tokens: goal.tokenBudget != null ? Math.max(0, goal.tokenBudget - goal.tokensUsed) : null,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleGoalGet(ctx: ToolContext): ToolResult {
  const file = goalPathFromCtx(ctx);
  toolLog('goal_get', `file=${file || '(unresolved)'}`);
  if (!file) return toolResult('Error: MCP workspace path is not configured', true);
  const goal = readGoalFile(file);
  if (!goal) return toolResult(JSON.stringify({ goal: null }, null, 2));
  return toolResult(JSON.stringify({ goal: serialize(goal) }, null, 2));
}

function handleGoalUpdate(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const status = typeof args?.status === 'string' ? args.status : '';
  toolLog('goal_update', `status=${status}`);
  if (status !== 'complete') {
    return toolResult(
      'Error: goal_update only accepts status "complete". Pause, resume, and budget-limited status changes are controlled by the user or system.',
      true,
    );
  }
  const file = goalPathFromCtx(ctx);
  if (!file) return toolResult('Error: MCP workspace path is not configured', true);
  const goal = readGoalFile(file);
  if (!goal) {
    return toolResult('Error: no goal is currently set for this session', true);
  }
  if (goal.status === 'complete') {
    return toolResult(JSON.stringify({ goal: serialize(goal), note: 'already complete' }, null, 2));
  }
  const next: StoredGoal = { ...goal, status: 'complete' };
  writeGoalFile(file, next);
  return toolResult(
    JSON.stringify(
      {
        goal: serialize(next),
        completion_budget_report:
          goal.tokenBudget != null
            ? `tokens used: ${goal.tokensUsed} of ${goal.tokenBudget}`
            : `tokens used: ${goal.tokensUsed}`,
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

export const goalTools: McpToolModule = {
  tools,
  handle(name, args, ctx) {
    switch (name) {
      case 'goal_get': return handleGoalGet(ctx);
      case 'goal_update': return handleGoalUpdate(args, ctx);
      default: return toolResult(`Unknown goal tool: ${name}`, true);
    }
  },
};
