/**
 * tools/types.ts — Shared types for MCP session tools.
 */

/** MCP tool result content item. */
export type ToolContent = { type: 'text'; text: string };

/** Standard MCP tool result. */
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/** MCP tool definition (matches MCP protocol tools/list schema). */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** A tool module exports definitions + a handler. */
export interface McpToolModule {
  tools: McpToolDef[];
  handle(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}

/** Context passed to tool handlers by the MCP server. */
export interface ToolContext {
  workspace: string;
  stagedFiles: string[];
  callbackUrl: string;
}

/** Helper to build a text tool result. */
export function toolResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/** Shared logger for tool modules — writes to stderr to avoid interfering with stdio MCP transport. */
export function toolLog(tool: string, msg: string) {
  const ts = new Date().toTimeString().slice(0, 8);
  process.stderr.write(`[tool:${tool} ${ts}] ${msg}\n`);
}
