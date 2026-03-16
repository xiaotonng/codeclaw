import type { Agent } from './code-agent.js';

const AGENT_PACKAGES: Record<Agent, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  gemini: '@google/gemini-cli',
};

const AGENT_LABELS: Record<Agent, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
};

export function getAgentPackage(agent: string): string | null {
  return AGENT_PACKAGES[agent as Agent] || null;
}

export function getAgentLabel(agent: string): string {
  return AGENT_LABELS[agent as Agent] || agent;
}

export function getAgentInstallCommand(agent: string): string | null {
  const pkg = getAgentPackage(agent);
  return pkg ? `npm install -g ${pkg}` : null;
}
