import type { SkillInfo } from './code-agent.js';
import type { MenuCommand } from './channel-base.js';

export const SKILL_CMD_PREFIX = 'sk_';

export interface WelcomeIntro {
  title: string;
  subtitle: string;
  version: string;
}

export function buildWelcomeIntro(version: string): WelcomeIntro {
  return {
    title: "Hi, I'm codeclaw",
    subtitle: 'Send me a message to get started.',
    version,
  };
}

export function buildSkillCommandName(skillName: string): string | null {
  const normalized = skillName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!normalized) return null;
  const cmdName = `${SKILL_CMD_PREFIX}${normalized}`;
  if (cmdName.length > 32) return null;
  return cmdName;
}

export function indexSkillsByCommand(skills: SkillInfo[]): Map<string, SkillInfo> {
  const indexed = new Map<string, SkillInfo>();
  for (const skill of skills) {
    const cmdName = buildSkillCommandName(skill.name);
    if (!cmdName || indexed.has(cmdName)) continue;
    indexed.set(cmdName, skill);
  }
  return indexed;
}

export function buildDefaultMenuCommands(agentCount: number, skills: SkillInfo[] = []): MenuCommand[] {
  const commands: MenuCommand[] = [
    { command: 'sessions', description: 'Switch sessions' },
  ];

  if (agentCount > 1) {
    commands.push({ command: 'agents', description: 'Switch agents' });
  }

  commands.push(
    { command: 'switch', description: 'Change workdir' },
    { command: 'models', description: 'Switch models' },
    { command: 'status', description: 'Show status' },
    { command: 'host', description: 'Host info' },
  );

  if (agentCount === 1) {
    commands.push({ command: 'agents', description: 'Switch agents' });
  }

  for (const [cmdName, skill] of indexSkillsByCommand(skills)) {
    const displayName = skill.label || skill.name.charAt(0).toUpperCase() + skill.name.slice(1);
    commands.push({ command: cmdName, description: `⚡ ${displayName}` });
  }

  commands.push({ command: 'restart', description: 'Restart bot' });
  return commands;
}
