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
  it('reuses the current CLI entrypoint when running from source', () => {
    const root = makeTmpDir('pikiclaw-mcp-bridge-');
    const cliPath = path.join(root, 'src', 'cli.ts');
    writeFile(cliPath, 'console.log("cli");\n');

    const command = resolveMcpServerCommand({
      execPath: '/usr/local/bin/node',
      execArgv: ['--loader', 'tsx', '--inspect=9229'],
      argv: ['node', cliPath],
      moduleUrl: `file://${path.join(root, 'src', 'mcp-bridge.ts')}`,
    });

    expect(command).toEqual({
      command: '/usr/local/bin/node',
      args: ['--loader', 'tsx', cliPath, '--mcp-serve'],
    });
  });

  it('falls back to the compiled session server next to the module', () => {
    const root = makeTmpDir('pikiclaw-mcp-bridge-');
    const distDir = path.join(root, 'dist');
    const serverPath = path.join(distDir, 'mcp-session-server.js');
    writeFile(serverPath, 'console.log("server");\n');

    const command = resolveMcpServerCommand({
      execPath: '/usr/local/bin/node',
      execArgv: [],
      argv: ['node', path.join(root, 'other.js')],
      moduleUrl: `file://${path.join(distDir, 'mcp-bridge.js')}`,
    });

    expect(command).toEqual({
      command: 'node',
      args: [serverPath],
    });
  });
});

describe('resolveSendFilePath', () => {
  it('prefers workspace-relative files when both roots are available', () => {
    const root = makeTmpDir('pikiclaw-send-file-');
    const workspacePath = path.join(root, 'workspace');
    const workdir = path.join(root, 'project');
    const workspaceFile = path.join(workspacePath, 'desktop-screenshot.png');
    const workdirFile = path.join(workdir, 'desktop-screenshot.png');
    writeFile(workspaceFile, 'workspace');
    writeFile(workdirFile, 'workdir');

    expect(resolveSendFilePath('desktop-screenshot.png', workspacePath, workdir)).toBe(workspaceFile);
  });

  it('falls back to workdir-relative files when workspace does not contain the path', () => {
    const root = makeTmpDir('pikiclaw-send-file-');
    const workspacePath = path.join(root, 'workspace');
    const workdir = path.join(root, 'project');
    const workdirFile = path.join(workdir, 'desktop-screenshot.png');
    fs.mkdirSync(workspacePath, { recursive: true });
    writeFile(workdirFile, 'workdir');

    expect(resolveSendFilePath('desktop-screenshot.png', workspacePath, workdir)).toBe(workdirFile);
  });
});
