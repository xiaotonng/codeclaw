/**
 * tools/capture.ts — Screen capture tool.
 *
 *   take_screenshot — captures a screenshot (full screen, region, or window), cross-platform
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import type { McpToolModule, ToolResult } from './types.js';
import { toolResult, toolLog } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScreenshotRegion { x: number; y: number; width: number; height: number }

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const tools: McpToolModule['tools'] = [
  {
    name: 'take_screenshot',
    description: 'Take a screenshot and return the saved PNG path.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        display_number: {
          type: 'number',
          description: 'Optional display number.',
        },
        window_title: {
          type: 'string',
          description: 'Optional window title.',
        },
        region: {
          type: 'object',
          description: 'Optional capture region.',
          properties: {
            x: { type: 'number', description: 'Left.' },
            y: { type: 'number', description: 'Top.' },
            width: { type: 'number', description: 'Width.' },
            height: { type: 'number', description: 'Height.' },
          },
          required: ['x', 'y', 'width', 'height'],
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleTakeScreenshot(args: Record<string, unknown>): Promise<ToolResult> {
  const displayNumber = typeof args?.display_number === 'number' ? args.display_number : undefined;
  const windowTitle = typeof args?.window_title === 'string' ? args.window_title.trim() : undefined;
  const regionRaw = args?.region as Record<string, unknown> | undefined;
  let region: ScreenshotRegion | undefined;

  toolLog('take_screenshot', `display=${displayNumber ?? 'default'} window=${windowTitle || 'none'} region=${regionRaw ? 'yes' : 'none'}`);

  if (regionRaw && typeof regionRaw === 'object') {
    const x = Number(regionRaw.x);
    const y = Number(regionRaw.y);
    const w = Number(regionRaw.width);
    const h = Number(regionRaw.height);
    if ([x, y, w, h].some(v => !Number.isFinite(v) || v < 0) || w === 0 || h === 0) {
      toolLog('take_screenshot', 'ERROR invalid region params');
      return toolResult('Error: region requires finite non-negative x, y, width, height (width/height > 0)', true);
    }
    region = { x, y, width: w, height: h };
  }

  try {
    const filePath = await captureScreenshot({ displayNumber, region, windowTitle });
    const size = fs.statSync(filePath).size;
    toolLog('take_screenshot', `OK saved ${filePath} (${Math.round(size / 1024)} KB)`);
    return toolResult(`Screenshot saved: ${filePath} (${Math.round(size / 1024)} KB)`);
  } catch (e: any) {
    toolLog('take_screenshot', `ERROR ${e.message}`);
    return toolResult(`Screenshot failed: ${e.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// Shell exec helper
// ---------------------------------------------------------------------------

function execAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Window ID lookup — cross-platform
// ---------------------------------------------------------------------------

/** macOS: use JXA to find CGWindowID by title substring. */
async function findWindowIdDarwin(title: string): Promise<string> {
  const jxa = `
    ObjC.import('CoreGraphics');
    const list = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0);
    const count = ObjC.unwrap(list).length;
    const needle = ${JSON.stringify(title.toLowerCase())};
    for (let i = 0; i < count; i++) {
      const entry = ObjC.unwrap(list)[i];
      const name = ObjC.unwrap(entry.kCGWindowName || '') || '';
      const owner = ObjC.unwrap(entry.kCGWindowOwnerName || '') || '';
      if (name.toLowerCase().includes(needle) || owner.toLowerCase().includes(needle)) {
        const wid = ObjC.unwrap(entry.kCGWindowNumber);
        if (wid) { console.log(wid); $.exit(0); }
      }
    }
    console.log(''); $.exit(1);
  `.trim();
  const { stdout } = await execAsync('osascript', ['-l', 'JavaScript', '-e', jxa]);
  const wid = stdout.trim();
  if (!wid) throw new Error(`No window found matching "${title}" on macOS`);
  return wid;
}

/** Linux: use xdotool to find window ID by title substring. */
async function findWindowIdLinux(title: string): Promise<string> {
  const { stdout } = await execAsync('xdotool', ['search', '--name', title]);
  const wid = stdout.trim().split('\n')[0];
  if (!wid) throw new Error(`No window found matching "${title}" on Linux (via xdotool)`);
  return wid;
}

/** Windows: find window handle by title substring, return bounding rect. */
async function findWindowRectWindows(title: string): Promise<ScreenshotRegion> {
  const psScript = [
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices;',
    'public class Win32 {',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }',
    '}',
    '"@',
    `$procs = Get-Process | Where-Object { $_.MainWindowTitle -like '*${title.replace(/'/g, "''")}*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1`,
    'if (-not $procs) { Write-Error "No window found"; exit 1 }',
    '$rect = New-Object Win32+RECT',
    '[Win32]::GetWindowRect($procs.MainWindowHandle, [ref]$rect) | Out-Null',
    '$obj = @{ x=$rect.Left; y=$rect.Top; width=$rect.Right-$rect.Left; height=$rect.Bottom-$rect.Top }',
    '$obj | ConvertTo-Json -Compress',
  ].join('\n');
  const { stdout } = await execAsync('powershell', ['-NoProfile', '-Command', psScript]);
  const rect = JSON.parse(stdout.trim());
  if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error(`No window found matching "${title}" on Windows`);
  return rect;
}

// ---------------------------------------------------------------------------
// Screenshot capture — cross-platform
// ---------------------------------------------------------------------------

async function captureScreenshot(
  opts: { displayNumber?: number; region?: ScreenshotRegion; windowTitle?: string },
): Promise<string> {
  const { displayNumber, region, windowTitle } = opts;
  const outFile = path.join(os.tmpdir(), `pikiclaw_screenshot_${process.pid}_${Date.now()}.png`);
  const platform = process.platform;

  if (platform === 'darwin') {
    const args = ['-x'];
    if (windowTitle) {
      const wid = await findWindowIdDarwin(windowTitle);
      args.push('-l', wid);
    } else {
      if (displayNumber != null) args.push('-D', String(displayNumber));
      if (region) args.push('-R', `${region.x},${region.y},${region.width},${region.height}`);
    }
    args.push(outFile);
    await execAsync('screencapture', args);

  } else if (platform === 'win32') {
    let bounds: string;
    if (windowTitle) {
      const rect = await findWindowRectWindows(windowTitle);
      bounds = `$bounds = New-Object System.Drawing.Rectangle(${rect.x},${rect.y},${rect.width},${rect.height})`;
    } else if (region) {
      bounds = `$bounds = New-Object System.Drawing.Rectangle(${region.x},${region.y},${region.width},${region.height})`;
    } else if (displayNumber != null) {
      bounds = `$screen = [System.Windows.Forms.Screen]::AllScreens[${displayNumber}]; $bounds = $screen.Bounds`;
    } else {
      bounds = `$screen = [System.Windows.Forms.Screen]::PrimaryScreen; $bounds = $screen.Bounds`;
    }
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      bounds,
      '$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)',
      '$g.Dispose()',
      `$bmp.Save('${outFile.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$bmp.Dispose()',
    ].join('; ');
    await execAsync('powershell', ['-NoProfile', '-Command', psScript]);

  } else {
    let windowId: string | undefined;
    if (windowTitle) windowId = await findWindowIdLinux(windowTitle);
    const captured = await captureLinux(outFile, { region, windowId });
    if (!captured) throw new Error('No screenshot tool found. Install one of: maim, scrot, gnome-screenshot, or import (ImageMagick).');
  }

  if (!fs.existsSync(outFile)) throw new Error('Screenshot command succeeded but no file was produced.');
  return outFile;
}

async function captureLinux(
  tmpFile: string,
  opts: { region?: ScreenshotRegion; windowId?: string },
): Promise<boolean> {
  const { region, windowId } = opts;

  // maim — best window/region support
  try {
    const args: string[] = [];
    if (windowId) args.push('-i', windowId);
    else if (region) args.push('-g', `${region.width}x${region.height}+${region.x}+${region.y}`);
    args.push(tmpFile);
    await execAsync('maim', args);
    return true;
  } catch {}

  // scrot
  try {
    const args: string[] = [];
    if (region) args.push('-a', `${region.x},${region.y},${region.width},${region.height}`);
    args.push(tmpFile);
    await execAsync('scrot', args);
    return true;
  } catch {}

  // gnome-screenshot
  try {
    await execAsync('gnome-screenshot', ['-f', tmpFile]);
    return true;
  } catch {}

  // import (ImageMagick)
  try {
    const win = windowId || 'root';
    const geometry = region ? `${region.width}x${region.height}+${region.x}+${region.y}` : undefined;
    const args = geometry ? ['-window', win, '-crop', geometry, tmpFile] : ['-window', win, tmpFile];
    await execAsync('import', args);
    return true;
  } catch {}

  return false;
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

export const captureTools: McpToolModule = {
  tools,
  handle(name, args) {
    switch (name) {
      case 'take_screenshot': return handleTakeScreenshot(args);
      default: return toolResult(`Unknown capture tool: ${name}`, true);
    }
  },
};
