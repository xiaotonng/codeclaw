/**
 * NPM helper for agent package management.
 */

import type { Agent } from './index.js';

const AGENT_PACKAGES: Record<Agent, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  gemini: '@google/gemini-cli',
};

/** Known Homebrew cask tokens for agents that publish brew casks. */
const AGENT_BREW_CASKS: Partial<Record<Agent, string>> = {
  claude: 'claude-code',
  codex: 'codex',
};

const AGENT_LABELS: Record<Agent, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
};

export function getAgentPackage(agent: string): string | null {
  return AGENT_PACKAGES[agent as Agent] || null;
}

export function getAgentBrewCask(agent: string): string | null {
  return AGENT_BREW_CASKS[agent as Agent] || null;
}

export function getAgentLabel(agent: string): string {
  return AGENT_LABELS[agent as Agent] || agent;
}

export function getAgentInstallCommand(agent: string): string | null {
  const pkg = getAgentPackage(agent);
  return pkg ? `npm install -g ${pkg}` : null;
}
