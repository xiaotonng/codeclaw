import { describe, expect, it } from 'vitest';
import { buildDefaultMenuCommands, buildSkillCommandName, buildWelcomeIntro, indexSkillsByCommand } from '../src/bot-menu.ts';

describe('bot-menu', () => {
  it('builds stable skill command names and preserves the original skill metadata', () => {
    expect(buildSkillCommandName('My-Skill')).toBe('sk_my_skill');
    expect(buildSkillCommandName('already_clean')).toBe('sk_already_clean');

    const skills = [
      { name: 'My-Skill', label: 'My Skill', description: null, source: 'skills' as const },
      { name: 'Another Skill', label: null, description: null, source: 'commands' as const },
    ];
    const index = indexSkillsByCommand(skills);

    expect([...index.keys()]).toEqual(['sk_my_skill', 'sk_another_skill']);
    expect(index.get('sk_my_skill')?.name).toBe('My-Skill');
    expect(index.get('sk_another_skill')?.source).toBe('commands');
  });

  it('builds the default command menu with skills and restart at the end', () => {
    const commands = buildDefaultMenuCommands(2, [
      { name: 'My-Skill', label: 'Ship It', description: null, source: 'skills' as const },
    ]);

    expect(commands.map(cmd => cmd.command)).toEqual([
      'sessions',
      'agents',
      'switch',
      'models',
      'status',
      'host',
      'sk_my_skill',
      'restart',
    ]);
    expect(commands[6]).toEqual({ command: 'sk_my_skill', description: '⚡ Ship It' });
    expect(commands[7]).toEqual({ command: 'restart', description: 'Restart bot' });
  });

  it('builds a reusable welcome intro payload', () => {
    expect(buildWelcomeIntro('0.2.24')).toEqual({
      title: "Hi, I'm codeclaw",
      subtitle: 'Send me a message to get started.',
      version: '0.2.24',
    });
  });
});
