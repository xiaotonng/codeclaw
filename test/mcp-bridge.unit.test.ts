import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveMcpServerCommand, resolveSendFilePath } from '../src/mcp-bridge.ts';
import { makeTmpDir } from './support/env.ts';

function writeFile(filePath: string, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('resolveMcpServerCommand', () => {
  it('reuses the current CLI entrypoint from source and falls back to the compiled session server', () => {
    // --- Source entrypoint scenario ---
    const root1 = makeTmpDir('pikiclaw-mcp-bridge-');
    const cliPath = path.join(root1, 'src', 'cli.ts');
    writeFile(cliPath, 'console.log("cli");\n');

    const command1 = resolveMcpServerCommand({
      execPath: '/usr/local/bin/node',
      execArgv: ['--loader', 'tsx', '--inspect=9229'],
      argv: ['node', cliPath],
      moduleUrl: `file://${path.join(root1, 'src', 'mcp-bridge.ts')}`,
    });

    expect(command1).toEqual({
      command: '/usr/local/bin/node',
      args: ['--loader', 'tsx', cliPath, '--mcp-serve'],
    });

    // --- Compiled session server fallback scenario ---
    const root2 = makeTmpDir('pikiclaw-mcp-bridge-');
    const distDir = path.join(root2, 'dist');
    const serverPath = path.join(distDir, 'mcp-session-server.js');
    writeFile(serverPath, 'console.log("server");\n');

    const command2 = resolveMcpServerCommand({
      execPath: '/usr/local/bin/node',
      execArgv: [],
      argv: ['node', path.join(root2, 'other.js')],
      moduleUrl: `file://${path.join(distDir, 'mcp-bridge.js')}`,
    });

    expect(command2).toEqual({
      command: 'node',
      args: [serverPath],
    });
  });
});

describe('resolveSendFilePath', () => {
  it('prefers workspace-relative files and falls back to workdir-relative files', () => {
    // --- Workspace-relative scenario ---
    const root1 = makeTmpDir('pikiclaw-send-file-');
    const workspacePath1 = path.join(root1, 'workspace');
    const workdir1 = path.join(root1, 'project');
    const workspaceFile = path.join(workspacePath1, 'desktop-screenshot.png');
    const workdirFile1 = path.join(workdir1, 'desktop-screenshot.png');
    writeFile(workspaceFile, 'workspace');
    writeFile(workdirFile1, 'workdir');

    expect(resolveSendFilePath('desktop-screenshot.png', workspacePath1, [], workdir1).path).toBe(workspaceFile);

    // --- Workdir fallback scenario ---
    const root2 = makeTmpDir('pikiclaw-send-file-');
    const workspacePath2 = path.join(root2, 'workspace');
    const workdir2 = path.join(root2, 'project');
    const workdirFile2 = path.join(workdir2, 'desktop-screenshot.png');
    fs.mkdirSync(workspacePath2, { recursive: true });
    writeFile(workdirFile2, 'workdir');

    expect(resolveSendFilePath('desktop-screenshot.png', workspacePath2, [], workdir2).path).toBe(workdirFile2);
  });
});
