/**
 * src/catalog — data-only manifests of everything the Extensions page offers.
 *
 * This directory is the *single* place you edit to add/remove items from the
 * Dashboard. Each file is a plain TypeScript array; no logic lives here.
 *
 *   mcp-servers.ts  — Extensions → MCP tab
 *   cli-tools.ts    — Extensions → CLI tab
 *   skill-repos.ts  — Extensions → Skills tab
 *
 * The loading / auth / install logic lives in:
 *   - src/agent/mcp/{registry,extensions,oauth}.ts   (MCP)
 *   - src/agent/cli/{registry,detector,auth}.ts      (CLI)
 *   - src/agent/{skills,skill-installer}.ts          (Skills)
 *
 * Those modules own the types and execute the runtime flows; this directory
 * exists purely so "what to show" stays editable in one spot.
 */

export { MCP_SERVERS } from './mcp-servers.js';
export { CLI_TOOLS } from './cli-tools.js';
export { SKILL_REPOS } from './skill-repos.js';
