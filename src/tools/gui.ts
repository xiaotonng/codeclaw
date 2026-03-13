/**
 * tools/gui.ts — GUI interaction tools (placeholder).
 *
 * Future tools: mouse click, keyboard input, window focus/resize, etc.
 */

import type { McpToolModule } from './types.js';
import { toolResult, toolLog } from './types.js';

const tools: McpToolModule['tools'] = [];

export const guiTools: McpToolModule = {
  tools,
  handle(name) {
    toolLog(name, 'unknown GUI tool');
    return toolResult(`Unknown GUI tool: ${name}`, true);
  },
};
