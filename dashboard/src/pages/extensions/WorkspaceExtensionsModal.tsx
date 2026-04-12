/**
 * Project-level extensions modal — opened from workspace sidebar.
 * Directly operates on workspace files: .mcp.json and .pikiclaw/skills/
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useStore } from '../../store';
import type {
  McpExtensionEntry,
  RecommendedMcpServer,
  SkillInfo,
  RecommendedSkillRepo,
} from '../../types';
import { Badge, Button, Dot, Modal, ModalHeader, Spinner, SectionLabel } from '../../components/ui';
import { SettingRowAction, SettingRowCard, SettingRowLead, SectionCard } from '../shared';
import { AddMcpModal, InstallSkillModal } from './ExtensionsTab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function L(locale: string, zh: string, en: string): string {
  return locale === 'zh-CN' ? zh : en;
}

function cmdSummary(config: { command?: string; args?: string[]; type?: string; url?: string }): string {
  if (config.type === 'http' && config.url) return config.url;
  const args = config.args || [];
  const cmd = config.command || '';
  if (cmd === 'npx' && args.length >= 2) return args.filter(a => a !== '-y').join(' ');
  return [cmd, ...args].join(' ');
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

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------

export function WorkspaceExtensionsModal({
  open,
  onClose,
  workdir,
}: {
  open: boolean;
  onClose: () => void;
  workdir: string;
}) {
  const locale = useStore(s => s.locale);
  const toast = useStore(s => s.toast);
  const wsName = workdir.split('/').pop() || workdir;

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

  // Filter to workspace scope only
  const wsMcp = useMemo(() => mcpExts.filter(e => e.scope === 'workspace'), [mcpExts]);
  const wsSkills = useMemo(() => skills.filter(s => s.scope === 'project'), [skills]);
  const installedMcpNames = useMemo(() => new Set(mcpExts.map(e => e.name)), [mcpExts]);

  const refreshMcp = useCallback(async () => {
    setMcpLoading(true);
    try {
      const [extRes, recRes] = await Promise.all([api.getMcpExtensions(workdir), api.getRecommendedMcp()]);
      setMcpExts(extRes.extensions || []);
      setRecommended(recRes.servers || []);
    } catch { /* ignore */ } finally {
      setMcpLoading(false);
    }
  }, [workdir]);

  const refreshSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const [skillRes, recRes] = await Promise.all([api.getExtensionSkills(workdir), api.getRecommendedSkills()]);
      setSkills(skillRes.skills || []);
      setRecommendedSkills(recRes.repos || []);
    } catch { /* ignore */ } finally {
      setSkillsLoading(false);
    }
  }, [workdir]);

  useEffect(() => {
    if (open) {
      void refreshMcp();
      void refreshSkills();
      setShowAddMcp(false);
      setShowInstallSkill(false);
    }
  }, [open, refreshMcp, refreshSkills]);

  const handleMcpToggle = useCallback(async (ext: McpExtensionEntry) => {
    try {
      await api.updateMcpExtension(ext.name, { enabled: ext.config.enabled === false }, 'workspace', workdir);
      await refreshMcp();
    } catch (e: any) {
      toast(e?.message || 'Failed', false);
    }
  }, [workdir, toast, refreshMcp]);

  const handleMcpRemove = useCallback(async (ext: McpExtensionEntry) => {
    try {
      await api.removeMcpExtension(ext.name, 'workspace', workdir);
      toast(L(locale, `${ext.name} 已移除`, `${ext.name} removed`), true);
      await refreshMcp();
    } catch (e: any) {
      toast(e?.message || 'Failed', false);
    }
  }, [workdir, locale, toast, refreshMcp]);

  const handleHealthCheck = useCallback(async (ext: McpExtensionEntry) => {
    setHealthChecking(ext.name);
    try {
      const result = await api.checkMcpHealth(ext.config);
      if (result.ok) {
        const toolCount = result.tools?.length ?? 0;
        toast(L(locale, `${ext.name} 健康 — ${toolCount} 个工具`, `${ext.name} healthy — ${toolCount} tools`), true);
      } else {
        toast(`${ext.name}: ${result.error}`, false);
      }
    } catch (e: any) {
      toast(e?.message || 'Failed', false);
    } finally {
      setHealthChecking(null);
    }
  }, [locale, toast]);

  const handleSkillRemove = useCallback(async (skill: SkillInfo) => {
    try {
      const result = await api.removeExtensionSkill(skill.name, false, workdir);
      if (result.ok) {
        toast(L(locale, `${skill.name} 已移除`, `${skill.name} removed`), true);
        await refreshSkills();
      } else {
        toast(result.error || 'Failed', false);
      }
    } catch (e: any) {
      toast(e?.message || 'Failed', false);
    }
  }, [workdir, locale, toast, refreshSkills]);

  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title={L(locale, `${wsName} — 项目扩展`, `${wsName} — Project Extensions`)}
        description={L(locale, '仅对当前工作区生效。直接操作项目目录中的配置文件。', 'Project-scoped only. Operates directly on config files in the workspace directory.')}
        onClose={onClose}
      />

      {/* ── MCP Servers ── */}
      <section className="mb-5">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SectionLabel>
              MCP Servers
              {!mcpLoading && <span className="ml-1.5 text-fg-5 font-normal lowercase tracking-normal">({wsMcp.length})</span>}
            </SectionLabel>
            <span className="rounded border border-edge bg-inset/50 px-1.5 py-0.5 font-mono text-[10px] text-fg-5">.mcp.json</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAddMcp(true)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="mr-1">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {L(locale, '添加', 'Add')}
          </Button>
        </div>

        {mcpLoading ? (
          <div className="flex items-center justify-center py-8"><Spinner /></div>
        ) : wsMcp.length === 0 ? (
          <SectionCard className="flex flex-col items-center justify-center py-6 text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-panel-alt text-fg-5"><PlugIcon /></div>
            <div className="text-[13px] text-fg-4">{L(locale, '暂无项目级 MCP 服务', 'No project-level MCP servers')}</div>
            <button className="mt-2 text-[12px] text-primary hover:text-primary/80 transition-colors" onClick={() => setShowAddMcp(true)}>
              {L(locale, '搜索并添加 →', 'Search and add →')}
            </button>
          </SectionCard>
        ) : (
          <div className="space-y-1.5">
            {wsMcp.map(ext => {
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
          <div className="flex items-center gap-2">
            <SectionLabel>
              Skills
              {!skillsLoading && <span className="ml-1.5 text-fg-5 font-normal lowercase tracking-normal">({wsSkills.length})</span>}
            </SectionLabel>
            <span className="rounded border border-edge bg-inset/50 px-1.5 py-0.5 font-mono text-[10px] text-fg-5">.pikiclaw/skills/</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowInstallSkill(true)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="mr-1">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {L(locale, '安装', 'Install')}
          </Button>
        </div>

        {skillsLoading ? (
          <div className="flex items-center justify-center py-8"><Spinner /></div>
        ) : wsSkills.length === 0 ? (
          <SectionCard className="flex flex-col items-center justify-center py-6 text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-panel-alt text-fg-5"><ZapIcon /></div>
            <div className="text-[13px] text-fg-4">{L(locale, '暂无项目级技能', 'No project-level skills')}</div>
            <button className="mt-2 text-[12px] text-primary hover:text-primary/80 transition-colors" onClick={() => setShowInstallSkill(true)}>
              {L(locale, '安装技能 →', 'Install skills →')}
            </button>
          </SectionCard>
        ) : (
          <div className="space-y-1.5">
            {wsSkills.map(skill => (
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

      {/* Shared modals — rendered inside the workspace modal, layered on top */}
      <AddMcpModal open={showAddMcp} onClose={() => setShowAddMcp(false)} locale={locale}
        recommended={recommended} installedNames={installedMcpNames} scope="workspace" workdir={workdir}
        onAdded={refreshMcp} />
      <InstallSkillModal open={showInstallSkill} onClose={() => setShowInstallSkill(false)} locale={locale}
        recommended={recommendedSkills} scope="workspace" workdir={workdir} onInstalled={refreshSkills} />
    </Modal>
  );
}
