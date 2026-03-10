import path from 'node:path';
import { listSubdirs } from './bot.js';
import { escapeHtml } from './bot-telegram-render.js';

export interface TelegramInlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

class PathRegistry {
  private pathToId = new Map<string, number>();
  private idToPath = new Map<number, string>();
  private nextId = 1;

  register(dirPath: string): number {
    let id = this.pathToId.get(dirPath);
    if (id != null) return id;
    id = this.nextId++;
    this.pathToId.set(dirPath, id);
    this.idToPath.set(id, dirPath);
    if (this.pathToId.size > 500) {
      const oldest = [...this.pathToId.entries()].slice(0, 200);
      for (const [oldPath, oldId] of oldest) {
        this.pathToId.delete(oldPath);
        this.idToPath.delete(oldId);
      }
    }
    return id;
  }

  resolve(id: number): string | undefined {
    return this.idToPath.get(id);
  }
}

const pathRegistry = new PathRegistry();
const DIR_PAGE_SIZE = 8;

function buildDirKeyboard(browsePath: string, page: number): TelegramInlineKeyboard {
  const dirs = listSubdirs(browsePath);
  const totalPages = Math.max(1, Math.ceil(dirs.length / DIR_PAGE_SIZE));
  const currentPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = dirs.slice(currentPage * DIR_PAGE_SIZE, (currentPage + 1) * DIR_PAGE_SIZE);
  const rows: TelegramInlineKeyboard['inline_keyboard'] = [];

  for (let i = 0; i < slice.length; i += 2) {
    const row: TelegramInlineKeyboard['inline_keyboard'][number] = [];
    for (let j = i; j < Math.min(i + 2, slice.length); j++) {
      const fullPath = path.join(browsePath, slice[j]);
      const id = pathRegistry.register(fullPath);
      row.push({ text: slice[j], callback_data: `sw:n:${id}:0` });
    }
    rows.push(row);
  }

  const navRow: TelegramInlineKeyboard['inline_keyboard'][number] = [];
  const parent = path.dirname(browsePath);
  if (parent !== browsePath) {
    navRow.push({ text: '⬆ ..', callback_data: `sw:n:${pathRegistry.register(parent)}:0` });
  }
  if (totalPages > 1) {
    const browseId = pathRegistry.register(browsePath);
    if (currentPage > 0) navRow.push({ text: `◀ ${currentPage}/${totalPages}`, callback_data: `sw:n:${browseId}:${currentPage - 1}` });
    if (currentPage < totalPages - 1) navRow.push({ text: `${currentPage + 2}/${totalPages} ▶`, callback_data: `sw:n:${browseId}:${currentPage + 1}` });
  }
  if (navRow.length) rows.push(navRow);

  rows.push([{ text: '✅ Select this directory', callback_data: `sw:s:${pathRegistry.register(browsePath)}` }]);
  return { inline_keyboard: rows };
}

export function buildSwitchWorkdirView(currentWorkdir: string, browsePath: string, page = 0): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  return {
    text: `<b>Switch workdir</b>\nCurrent: <code>${escapeHtml(currentWorkdir)}</code>\n\nBrowsing: <code>${escapeHtml(browsePath)}</code>`,
    keyboard: buildDirKeyboard(browsePath, page),
  };
}

export function resolveRegisteredPath(id: number): string | undefined {
  return pathRegistry.resolve(id);
}
