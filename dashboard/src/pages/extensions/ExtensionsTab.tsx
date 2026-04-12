import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import type {
  BrowserStatusResponse,
  McpExtensionEntry,
  McpServerConfig,
  RecommendedMcpServer,
  SkillInfo,
  RecommendedSkillRepo,
  McpSearchResult,
} from '../../types';
import { cn } from '../../utils';
import { BrandIcon } from '../../components/BrandIcon';
import { Badge, Button, Card, Dot, Input, Modal, ModalHeader, Spinner, SectionLabel } from '../../components/ui';
import { SettingRowAction, SettingRowCard, SettingRowLead, SectionCard } from '../shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function L(locale: string, zh: string, en: string) {
  return locale === 'zh-CN' ? zh : en;
}

function cmdSummary(config: McpServerConfig): string {
  if (config.type === 'http' && config.url) return config.url;
  const args = config.args || [];
  const cmd = config.command || '';
  if (cmd === 'npx' && args.length >= 2) return args.filter(a => a !== '-y').join(' ');
  return [cmd, ...args].join(' ');
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const PlugIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a6 6 0 0 1-12 0V8z" />
  </svg>
);

const ZapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const SearchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// ---------------------------------------------------------------------------
// Add MCP Modal — unified search-driven flow
// ---------------------------------------------------------------------------

export function AddMcpModal({
  open,
  onClose,
  locale,
  recommended,
  installedNames,
  scope,
  workdir,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  locale: string;
  recommended: RecommendedMcpServer[];
  installedNames: Set<string>;
  scope: 'global' | 'workspace';
  workdir?: string;
  onAdded: () => void;
}) {
  const toast = useStore(s => s.toast);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [searchResults, setSearchResults] = useState<McpSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Config panel state — when a server needs env vars before install
  const [configTarget, setConfigTarget] = useState<{
    name: string;
    command: string;
    args: string;
    envSchema: Record<string, { required?: boolean; secret?: boolean; description: string }>;
  } | null>(null);
  const [configEnv, setConfigEnv] = useState<Record<string, string>>({});

  // Manual config state
  const [showManual, setShowManual] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualCommand, setManualCommand] = useState('');
  const [manualArgs, setManualArgs] = useState('');
  const [manualEnv, setManualEnv] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setQuery('');
      setSearchResults([]);
      setConfigTarget(null);
      setShowManual(false);
      setManualName('');
      setManualCommand('');
      setManualArgs('');
      setManualEnv({});
    }
  }, [open]);

  // Search registry on debounced query change
  useEffect(() => {
    if (!debouncedQuery.trim()) { setSearchResults([]); return; }
    let cancelled = false;
    setSearching(true);
    api.searchMcp(debouncedQuery.trim()).then(res => {
      if (!cancelled) setSearchResults(res.results || []);
    }).catch(() => {
      if (!cancelled) setSearchResults([]);
    }).finally(() => {
      if (!cancelled) setSearching(false);
    });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const doInstall = useCallback(async (name: string, config: McpServerConfig) => {
    setSubmitting(true);
    try {
      await api.addMcpExtension(name, config, scope, workdir);
      toast(L(locale, `${name} 已添加`, `${name} added`), true);
      onAdded();
      onClose();
    } catch (e: any) {
      toast(e?.message || 'Failed', false);
    } finally {
      setSubmitting(false);
    }
  }, [scope, workdir, locale, toast, onAdded, onClose]);

  const handleInstallRecommended = useCallback((server: RecommendedMcpServer) => {
    const envKeys = Object.keys(server.envSchema);
    if (envKeys.length > 0) {
      setConfigTarget({
        name: server.id,
        command: server.command,
        args: server.args.join(' '),
        envSchema: server.envSchema,
      });
      setConfigEnv(Object.fromEntries(envKeys.map(k => [k, ''])));
      return;
    }
    void doInstall(server.id, { command: server.command, args: server.args, enabled: true });
  }, [doInstall]);

  const handleInstallSearchResult = useCallback((result: McpSearchResult) => {
    const pkg = result.npmPackage || result.name;
    void doInstall(
      result.name.replace(/^@/, '').replace(/\//g, '-'),
      { command: 'npx', args: ['-y', pkg], enabled: true },
    );
  }, [doInstall]);

  const handleConfirmConfig = useCallback(() => {
    if (!configTarget) return;
    const envFiltered = Object.fromEntries(Object.entries(configEnv).filter(([, v]) => v.trim()));
    const args = configTarget.args.trim() ? configTarget.args.trim().split(/\s+/) : [];
    void doInstall(configTarget.name, {
      command: configTarget.command,
      args,
      env: Object.keys(envFiltered).length ? envFiltered : undefined,
      enabled: true,
    });
  }, [configTarget, configEnv, doInstall]);

  const handleManualAdd = useCallback(() => {
    if (!manualName.trim() || !manualCommand.trim()) return;
    const args = manualArgs.trim() ? manualArgs.trim().split(/\s+/) : [];
    const envFiltered = Object.fromEntries(Object.entries(manualEnv).filter(([, v]) => v.trim()));
    void doInstall(manualName.trim(), {
      command: manualCommand.trim(),
      args,
      env: Object.keys(envFiltered).length ? envFiltered : undefined,
      enabled: true,
    });
  }, [manualName, manualCommand, manualArgs, manualEnv, doInstall]);

  const isSearching = !!query.trim();
  const displayList = isSearching ? null : recommended;

  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title={L(locale, '添加 MCP 服务', 'Add MCP Server')}
        description={scope === 'global'
          ? L(locale, '添加到全局配置，对所有工作区生效。', 'Added to global config, available across all workspaces.')
          : L(locale, '添加到当前工作区 .mcp.json 文件。', 'Added to the workspace .mcp.json file.')}
        onClose={onClose}
      />

      {/* Env config panel — shown when a server needs configuration */}
      {configTarget ? (
        <div className="space-y-4 animate-in">
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-panel-alt px-3 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge bg-panel text-fg-3"><PlugIcon /></div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-fg">{configTarget.name}</div>
              <div className="mt-0.5 font-mono text-[11px] text-fg-5">{configTarget.command} {configTarget.args}</div>
            </div>
          </div>
          <div className="space-y-2">
            {Object.entries(configTarget.envSchema).map(([key, schema]) => (
              <div key={key}>
                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">
                  {key}
                  {schema.required && <span className="text-err">*</span>}
                </label>
                <Input
                  value={configEnv[key] || ''}
                  onChange={e => setConfigEnv({ ...configEnv, [key]: e.target.value })}
                  type={schema.secret ? 'password' : 'text'}
                  placeholder={schema.description}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-edge pt-3">
            <Button variant="ghost" onClick={() => setConfigTarget(null)}>{L(locale, '返回', 'Back')}</Button>
            <Button variant="primary" disabled={submitting} onClick={handleConfirmConfig}>
              {submitting ? <Spinner /> : L(locale, '安装', 'Install')}
            </Button>
          </div>
        </div>
      ) : showManual ? (
        /* Manual config form */
        <div className="space-y-3 animate-in">
          <button className="mb-1 flex items-center gap-1 text-[12px] text-fg-4 hover:text-fg-2 transition-colors" onClick={() => setShowManual(false)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            {L(locale, '返回搜索', 'Back to search')}
          </button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">{L(locale, '名称', 'Name')}</label>
              <Input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="my-server" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">{L(locale, '命令', 'Command')}</label>
              <Input value={manualCommand} onChange={e => setManualCommand(e.target.value)} placeholder="npx" className="font-mono" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">{L(locale, '参数', 'Arguments')}</label>
            <Input value={manualArgs} onChange={e => setManualArgs(e.target.value)} placeholder="-y @example/server" className="font-mono" />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">{L(locale, '环境变量', 'Env')}</span>
              <button className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors" onClick={() => setManualEnv({ ...manualEnv, NEW_KEY: '' })}>
                + {L(locale, '添加', 'Add')}
              </button>
            </div>
            {Object.entries(manualEnv).length > 0 && (
              <div className="space-y-1 rounded-md border border-edge bg-inset/50 p-2">
                {Object.entries(manualEnv).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <Input className="w-2/5 !h-7 !text-[12px] font-mono" value={key}
                      onChange={e => { const n = { ...manualEnv }; delete n[key]; n[e.target.value] = value; setManualEnv(n); }} placeholder="KEY" />
                    <Input className="flex-1 !h-7 !text-[12px] font-mono" value={value}
                      onChange={e => setManualEnv({ ...manualEnv, [key]: e.target.value })}
                      type={key.toLowerCase().includes('token') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('key') ? 'password' : 'text'} placeholder="value" />
                    <button className="shrink-0 rounded p-1 text-fg-5 transition-colors hover:bg-panel-h hover:text-err"
                      onClick={() => { const n = { ...manualEnv }; delete n[key]; setManualEnv(n); }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-edge pt-3">
            <Button variant="ghost" onClick={() => setShowManual(false)}>{L(locale, '取消', 'Cancel')}</Button>
            <Button variant="primary" disabled={!manualName.trim() || !manualCommand.trim() || submitting} onClick={handleManualAdd}>
              {submitting ? <Spinner /> : L(locale, '添加', 'Add')}
            </Button>
          </div>
        </div>
      ) : (
        /* Search + results flow */
        <div className="space-y-3">
          {/* Search input */}
          <div className="relative group">
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5/50 group-focus-within:text-fg-4 transition-colors">
              <SearchIcon />
            </div>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={L(locale, '搜索 MCP 服务...', 'Search MCP servers...')}
              className="w-full rounded-lg border border-edge bg-inset/50 py-2.5 pl-9 pr-3 text-[13px] text-fg outline-none placeholder:text-fg-5/40 focus:border-primary/30 focus:bg-inset focus:shadow-[0_0_0_3px_rgba(99,102,241,0.06)] transition-all duration-200"
              autoFocus
            />
            {searching && <div className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner className="h-3.5 w-3.5" /></div>}
          </div>

          {/* Results list */}
          <div className="max-h-[380px] overflow-y-auto space-y-1 -mx-1 px-1">
            {isSearching ? (
              searchResults.length > 0 ? (
                searchResults.map((r, i) => {
                  const id = r.name.replace(/^@/, '').replace(/\//g, '-');
                  const installed = installedNames.has(id) || installedNames.has(r.name);
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-edge/60 bg-panel-alt/40 px-3 py-2.5 transition-colors hover:border-edge hover:bg-panel-alt/70">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge bg-panel text-fg-4"><PlugIcon /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-fg">{r.name}</div>
                        {r.description && <div className="mt-0.5 text-[11px] leading-relaxed text-fg-4 line-clamp-2">{r.description}</div>}
                        {r.npmPackage && r.npmPackage !== r.name && <div className="mt-0.5 font-mono text-[10px] text-fg-5/60">{r.npmPackage}</div>}
                      </div>
                      <Button variant={installed ? 'ghost' : 'primary'} size="sm" disabled={installed || submitting}
                        onClick={() => handleInstallSearchResult(r)} className="shrink-0">
                        {installed ? L(locale, '已安装', 'Installed') : submitting ? <Spinner /> : L(locale, '安装', 'Install')}
                      </Button>
                    </div>
                  );
                })
              ) : !searching ? (
                <div className="py-8 text-center text-[13px] text-fg-5">
                  {L(locale, '未找到匹配的 MCP 服务', 'No matching MCP servers found')}
                </div>
              ) : null
            ) : (
              /* Popular / Recommended */
              displayList?.map(server => {
                const installed = installedNames.has(server.id);
                return (
                  <div key={server.id} className="flex items-center gap-3 rounded-lg border border-edge/60 bg-panel-alt/40 px-3 py-2.5 transition-colors hover:border-edge hover:bg-panel-alt/70">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge bg-panel text-fg-4"><PlugIcon /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-fg">{server.name}</div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-fg-4">
                        {locale === 'zh-CN' ? server.descriptionZh : server.description}
                      </div>
                    </div>
                    <Button variant={installed ? 'ghost' : 'primary'} size="sm" disabled={installed || submitting}
                      onClick={() => handleInstallRecommended(server)} className="shrink-0">
                      {installed ? L(locale, '已安装', 'Installed') : L(locale, '安装', 'Install')}
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          {/* Manual config link */}
          <div className="border-t border-edge pt-3 text-center">
            <button
              className="text-[12px] text-fg-4 hover:text-fg-2 transition-colors"
              onClick={() => setShowManual(true)}
            >
              {L(locale, '手动配置自定义服务 →', 'Manually configure a custom server →')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Install Skill Modal
// ---------------------------------------------------------------------------

export function InstallSkillModal({
  open,
  onClose,
  locale,
  recommended,
  scope,
  workdir,
  onInstalled,
}: {
  open: boolean;
  onClose: () => void;
  locale: string;
  recommended: RecommendedSkillRepo[];
  scope: 'global' | 'workspace';
  workdir?: string;
  onInstalled: () => void;
}) {
  const toast = useStore(s => s.toast);
  const [installSource, setInstallSource] = useState('');
  const [installSkillName, setInstallSkillName] = useState('');
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (open) { setInstallSource(''); setInstallSkillName(''); }
  }, [open]);

  const handleInstall = useCallback(async (source?: string) => {
    const src = (source || installSource).trim();
    if (!src) return;
    setInstalling(true);
    try {
      const result = await api.installSkill(src, scope === 'global', installSkillName.trim() || undefined, workdir);
      if (result.ok) {
        toast(L(locale, '技能安装成功', 'Skill installed'), true);
        onInstalled();
        onClose();
      } else {
        toast(result.error || L(locale, '安装失败', 'Installation failed'), false);
      }
    } catch (e: any) {
      toast(e?.message || 'Failed', false);
    } finally {
      setInstalling(false);
    }
  }, [installSource, installSkillName, scope, workdir, locale, toast, onInstalled, onClose]);

  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title={L(locale, '安装技能', 'Install Skill')}
        description={scope === 'global'
          ? L(locale, '使用 npx skills add 安装到 ~/.pikiclaw/skills/。', 'Uses npx skills add to install to ~/.pikiclaw/skills/.')
          : L(locale, '安装到当前工作区 .pikiclaw/skills/ 目录。', 'Installs to the workspace .pikiclaw/skills/ directory.')}
        onClose={onClose}
      />

      {recommended.length > 0 && (
        <div className="mb-4 space-y-2">
          {recommended.map(repo => (
            <div key={repo.id} className="flex items-center gap-3 rounded-lg border border-edge/60 bg-panel-alt/40 px-3 py-2.5 transition-colors hover:border-edge hover:bg-panel-alt/70">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-edge bg-panel text-fg-4"><ZapIcon /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-fg">{repo.name}</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-fg-4">{locale === 'zh-CN' ? repo.descriptionZh : repo.description}</div>
                <div className="mt-0.5 font-mono text-[10px] text-fg-5/60">{repo.source}</div>
              </div>
              <Button variant="primary" size="sm" disabled={installing} onClick={() => void handleInstall(repo.source)} className="shrink-0">
                {installing ? <Spinner /> : L(locale, '安装', 'Install')}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className={cn(recommended.length > 0 && 'border-t border-edge pt-4')}>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">{L(locale, 'GitHub 来源', 'GitHub Source')}</label>
            <Input value={installSource} onChange={e => setInstallSource(e.target.value)} placeholder="owner/repo" className="font-mono" />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">{L(locale, '指定技能（可选）', 'Specific skill (optional)')}</label>
            <Input value={installSkillName} onChange={e => setInstallSkillName(e.target.value)} placeholder={L(locale, '留空安装全部', 'Leave empty for all')} />
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="text-[11px] text-fg-5">{L(locale, '通过 npx skills add 安装', 'Installs via npx skills add')}</div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>{L(locale, '取消', 'Cancel')}</Button>
              <Button variant="primary" disabled={!installSource.trim() || installing} onClick={() => void handleInstall()}>
                {installing ? <Spinner /> : L(locale, '安装', 'Install')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function ExtensionsTab({
  onOpenBrowserSetup,
  onOpenDesktopSetup,
}: {
  onOpenBrowserSetup: () => void;
  onOpenDesktopSetup: () => void;
}) {
  const locale = useStore(s => s.locale);
  const state = useStore(s => s.state);
  const toast = useStore(s => s.toast);
  const workdir = state?.config?.workdir || '';

  // MCP state
  const [mcpExts, setMcpExts] = useState<McpExtensionEntry[]>([]);
  const [recommended, setRecommended] = useState<RecommendedMcpServer[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [healthChecking, setHealthChecking] = useState<string | null>(null);

  // Skills state
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [recommendedSkills, setRecommendedSkills] = useState<RecommendedSkillRepo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [showInstallSkill, setShowInstallSkill] = useState(false);

  // Automation state
  const [snapshot, setSnapshot] = useState<BrowserStatusResponse | null>(null);

  // Filter to global-only
  const globalMcp = useMemo(() => mcpExts.filter(e => e.scope === 'global'), [mcpExts]);
  const globalSkills = useMemo(() => skills.filter(s => s.scope === 'global'), [skills]);
  const installedMcpNames = useMemo(() => new Set(mcpExts.map(e => e.name)), [mcpExts]);

  const refreshMcp = useCallback(async () => {
    setMcpLoading(true);
    try {
      const [extRes, recRes] = await Promise.all([api.getMcpExtensions(workdir), api.getRecommendedMcp()]);
      setMcpExts(extRes.extensions || []);
      setRecommended(recRes.servers || []);
    } catch (e: any) { toast(e?.message || 'Failed', false); }
    finally { setMcpLoading(false); }
  }, [workdir, toast]);

  const refreshSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const [skillRes, recRes] = await Promise.all([api.getExtensionSkills(workdir), api.getRecommendedSkills()]);
      setSkills(skillRes.skills || []);
      setRecommendedSkills(recRes.repos || []);
    } catch (e: any) { toast(e?.message || 'Failed', false); }
    finally { setSkillsLoading(false); }
  }, [workdir, toast]);

  const refreshAutomation = useCallback(async () => {
    try { setSnapshot(await api.getBrowser()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refreshMcp(); }, [refreshMcp]);
  useEffect(() => { void refreshSkills(); }, [refreshSkills]);
  useEffect(() => { void refreshAutomation(); }, [refreshAutomation, state]);

  const handleMcpToggle = useCallback(async (ext: McpExtensionEntry) => {
    try {
      await api.updateMcpExtension(ext.name, { enabled: ext.config.enabled === false }, 'global');
      await refreshMcp();
    } catch (e: any) { toast(e?.message || 'Failed', false); }
  }, [toast, refreshMcp]);

  const handleMcpRemove = useCallback(async (ext: McpExtensionEntry) => {
    try {
      await api.removeMcpExtension(ext.name, 'global');
      toast(L(locale, `${ext.name} 已移除`, `${ext.name} removed`), true);
      await refreshMcp();
    } catch (e: any) { toast(e?.message || 'Failed', false); }
  }, [locale, toast, refreshMcp]);

  const handleHealthCheck = useCallback(async (ext: McpExtensionEntry) => {
    setHealthChecking(ext.name);
    try {
      const result = await api.checkMcpHealth(ext.config);
      if (result.ok) {
        const n = result.tools?.length ?? 0;
        const t = result.elapsedMs ? ` (${result.elapsedMs}ms)` : '';
        toast(L(locale, `${ext.name} 健康 — ${n} 工具${t}`, `${ext.name} healthy — ${n} tools${t}`), true);
      } else {
        toast(`${ext.name}: ${result.error}`, false);
      }
    } catch (e: any) { toast(e?.message || 'Failed', false); }
    finally { setHealthChecking(null); }
  }, [locale, toast]);

  const handleSkillRemove = useCallback(async (skill: SkillInfo) => {
    try {
      const result = await api.removeExtensionSkill(skill.name, true, workdir);
      if (result.ok) {
        toast(L(locale, `${skill.name} 已移除`, `${skill.name} removed`), true);
        await refreshSkills();
      } else { toast(result.error || 'Failed', false); }
    } catch (e: any) { toast(e?.message || 'Failed', false); }
  }, [workdir, locale, toast, refreshSkills]);

  // Automation badges
  const browser = snapshot?.browser;
  const desktop = snapshot?.desktop;
  const browserBadge = !browser ? { label: '...', variant: 'muted' as const }
    : !browser.enabled ? { label: L(locale, '已关闭', 'Disabled'), variant: 'muted' as const }
    : browser.running ? { label: L(locale, '运行中', 'Running'), variant: 'ok' as const }
    : browser.status === 'ready' ? { label: L(locale, '就绪', 'Ready'), variant: 'ok' as const }
    : { label: L(locale, '需配置', 'Needs setup'), variant: 'warn' as const };
  const desktopBadge = !desktop ? { label: '...', variant: 'muted' as const }
    : !desktop.installed ? { label: L(locale, '未安装', 'Not installed'), variant: 'muted' as const }
    : desktop.running ? { label: L(locale, '运行中', 'Running'), variant: 'ok' as const }
    : { label: L(locale, '已安装', 'Installed'), variant: 'accent' as const };

  return (
    <div className="animate-in space-y-6">
      <div className="text-[13px] leading-relaxed text-fg-4">
        {L(locale,
          '管理全局 MCP 服务、技能和自动化能力。项目级扩展请在工作台中对应工作区配置。',
          'Manage global MCP servers, skills, and automation. Configure project-level extensions in the Workbench.',
        )}
      </div>

      {/* ── MCP Servers ── */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <SectionLabel>
            MCP Servers
            {!mcpLoading && <span className="ml-1.5 text-fg-5 font-normal lowercase tracking-normal">({globalMcp.length})</span>}
          </SectionLabel>
          <Button variant="outline" size="sm" onClick={() => setShowAddMcp(true)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="mr-1">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {L(locale, '添加', 'Add')}
          </Button>
        </div>

        {mcpLoading ? (
          <div className="flex items-center justify-center py-10"><Spinner /></div>
        ) : globalMcp.length === 0 ? (
          <SectionCard className="flex flex-col items-center justify-center py-8 text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-panel-alt text-fg-5"><PlugIcon /></div>
            <div className="text-[13px] text-fg-4">{L(locale, '暂无全局 MCP 服务', 'No global MCP servers')}</div>
            <button className="mt-2 text-[12px] text-primary hover:text-primary/80 transition-colors" onClick={() => setShowAddMcp(true)}>
              {L(locale, '搜索并添加 →', 'Search and add →')}
            </button>
          </SectionCard>
        ) : (
          <div className="space-y-1.5">
            {globalMcp.map(ext => {
              const disabled = ext.config.enabled === false || ext.config.disabled === true;
              return (
                <SettingRowCard key={ext.name} className={disabled ? 'opacity-50' : undefined}>
                  <SettingRowLead icon={<PlugIcon />} title={ext.name}
                    subtitle={<span className="font-mono">{cmdSummary(ext.config)}</span>}
                    badge={<Dot variant={disabled ? 'idle' : 'ok'} />} />
                  <div className="min-w-0 xl:col-span-2" />
                  <SettingRowAction>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => void handleHealthCheck(ext)} disabled={healthChecking === ext.name}>
                        {healthChecking === ext.name ? <Spinner /> : L(locale, '检查', 'Check')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleMcpToggle(ext)}>
                        {disabled ? L(locale, '启用', 'Enable') : L(locale, '禁用', 'Disable')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleMcpRemove(ext)} className="hover:!text-err">
                        {L(locale, '移除', 'Remove')}
                      </Button>
                    </div>
                  </SettingRowAction>
                </SettingRowCard>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Skills ── */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <SectionLabel>
            Skills
            {!skillsLoading && <span className="ml-1.5 text-fg-5 font-normal lowercase tracking-normal">({globalSkills.length})</span>}
          </SectionLabel>
          <Button variant="outline" size="sm" onClick={() => setShowInstallSkill(true)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="mr-1">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {L(locale, '安装', 'Install')}
          </Button>
        </div>

        {skillsLoading ? (
          <div className="flex items-center justify-center py-10"><Spinner /></div>
        ) : globalSkills.length === 0 ? (
          <SectionCard className="flex flex-col items-center justify-center py-8 text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-panel-alt text-fg-5"><ZapIcon /></div>
            <div className="text-[13px] text-fg-4">{L(locale, '暂无全局技能', 'No global skills')}</div>
            <button className="mt-2 text-[12px] text-primary hover:text-primary/80 transition-colors" onClick={() => setShowInstallSkill(true)}>
              {L(locale, '安装技能 →', 'Install skills →')}
            </button>
          </SectionCard>
        ) : (
          <div className="space-y-1.5">
            {globalSkills.map(skill => (
              <SettingRowCard key={skill.name}>
                <SettingRowLead icon={<ZapIcon />} title={skill.label || skill.name}
                  subtitle={skill.description || undefined}
                  badge={skill.mcpRequires?.length ? <Badge variant="muted">MCP: {skill.mcpRequires.join(', ')}</Badge> : undefined} />
                <div className="min-w-0 xl:col-span-2" />
                <SettingRowAction>
                  <Button variant="ghost" size="sm" onClick={() => void handleSkillRemove(skill)} className="hover:!text-err">
                    {L(locale, '移除', 'Remove')}
                  </Button>
                </SettingRowAction>
              </SettingRowCard>
            ))}
          </div>
        )}
      </section>

      {/* ── Built-in Automation ── */}
      <section>
        <div className="mb-2.5"><SectionLabel>{L(locale, '内置自动化', 'Built-in Automation')}</SectionLabel></div>
        <div className="space-y-1.5">
          <SettingRowCard>
            <SettingRowLead icon={<BrandIcon brand="playwright" size={14} />}
              title={L(locale, '浏览器自动化', 'Browser Automation')}
              badge={<Badge variant={browserBadge.variant}>{browserBadge.label}</Badge>} />
            <div className="min-w-0 xl:col-span-2" />
            <SettingRowAction>
              <Button variant="outline" size="sm" onClick={onOpenBrowserSetup}>
                {browser?.enabled ? L(locale, '管理', 'Manage') : L(locale, '配置', 'Setup')}
              </Button>
            </SettingRowAction>
          </SettingRowCard>
          <SettingRowCard>
            <SettingRowLead icon={<BrandIcon brand="appium" size={14} />}
              title={L(locale, '桌面自动化', 'Desktop Automation')}
              badge={<Badge variant={desktopBadge.variant}>{desktopBadge.label}</Badge>} />
            <div className="min-w-0 xl:col-span-2" />
            <SettingRowAction>
              <Button variant="outline" size="sm" onClick={onOpenDesktopSetup}>
                {desktop?.running ? L(locale, '管理', 'Manage') : L(locale, '配置', 'Setup')}
              </Button>
            </SettingRowAction>
          </SettingRowCard>
        </div>
      </section>

      {/* Modals */}
      <AddMcpModal open={showAddMcp} onClose={() => setShowAddMcp(false)} locale={locale}
        recommended={recommended} installedNames={installedMcpNames} scope="global" onAdded={refreshMcp} />
      <InstallSkillModal open={showInstallSkill} onClose={() => setShowInstallSkill(false)} locale={locale}
        recommended={recommendedSkills} scope="global" workdir={workdir} onInstalled={refreshSkills} />
    </div>
  );
}
