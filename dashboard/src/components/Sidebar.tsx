import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { resolveAppStatusBadge } from '../app-status';
import { useStore } from '../store';
import { createT } from '../i18n';
import { getDashboardTabs } from '../tabs';
import { Button, Dot, TabsList } from './ui';
import { cn } from '../utils';

const IconSun = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const IconMoon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;

const TAB_ROUTES: Record<string, string> = {
  sessions: '/',
  im: '/im',
  agents: '/agents',
  extensions: '/extensions',
  system: '/system',
};

export type RestartPhase = null | 'confirm' | 'restarting' | 'reconnecting';

export function Sidebar({
  version,
  restartPhase,
  onRestartClick,
}: {
  version: string;
  restartPhase: RestartPhase;
  onRestartClick: () => void;
}) {
  const state = useStore(s => s.state);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const locale = useStore(s => s.locale);
  const setLocale = useStore(s => s.setLocale);
  const t = useMemo(() => createT(locale), [locale]);

  const tabs = getDashboardTabs(t);
  const appStatus = resolveAppStatusBadge(state, t);

  const busy = restartPhase === 'restarting' || restartPhase === 'reconnecting';
  const confirming = restartPhase === 'confirm';

  return (
    // Glass-chrome top bar. `--th-sidebar` is intentionally semi-transparent
    // (rgba 0.78 / 0.9) so the backdrop blur + saturate produces a visible
    // frosted effect over the page surface below.
    <header className="sticky top-0 z-40 border-b border-edge bg-[var(--th-sidebar)] backdrop-blur-[20px] [backdrop-filter:blur(20px)_saturate(1.2)]">
      <div className="mx-auto flex min-h-13 max-w-[1180px] flex-wrap items-center gap-2.5 px-4 py-2">
        {/* Logo — quieter, no gradient text, single icon tile */}
        <div className="mr-1.5 flex items-center gap-2.5 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--edge-default)] bg-[var(--surface-2)] text-fg-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M13 2L3 14h8l-1 8 11-13h-8l1-7z"/></svg>
          </div>
          <div className="leading-none">
            <div className="text-[13px] font-semibold tracking-tight text-fg">Pikiclaw</div>
          </div>
          <span className="rounded-md border border-[var(--edge-subtle)] bg-transparent px-1.5 py-0.5 text-[10px] font-mono text-fg-5">
            v{version}
          </span>
        </div>

        {/* Tab navigation — icon-only-feel: minimal height, 1px accent on active */}
        <nav className="order-3 w-full md:order-none md:w-auto">
          <TabsList className="w-full overflow-x-auto md:w-auto">
            {tabs.map(item => (
              <NavLink
                key={item.key}
                to={TAB_ROUTES[item.key]}
                end={TAB_ROUTES[item.key] === '/'}
                className={({ isActive }) => cn(
                  'relative inline-flex h-8 items-center justify-center rounded-md px-3 text-[13px] font-medium transition-colors duration-200',
                  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--brand-glow-a)]',
                  isActive
                    ? 'bg-[var(--surface-2)] text-fg'
                    : 'text-fg-4 hover:text-fg-2 hover:bg-[var(--surface-2)]',
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </TabsList>
        </nav>

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* Right-side actions */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="hidden items-center gap-1.5 rounded-full border border-[var(--edge-subtle)] bg-transparent px-2.5 py-1 text-[11px] text-fg-3 md:flex">
            <Dot tone={appStatus.dotVariant} pulse={appStatus.dotPulse} />
            <span className="font-medium">{appStatus.badgeContent}</span>
          </div>
          <Button
            variant={confirming ? 'secondary' : 'outline'}
            size="sm"
            onClick={onRestartClick}
            disabled={busy}
            title={busy ? t('modal.restarting') : confirming ? t('modal.confirmRestart') : t('sidebar.restart')}
            className={cn(
              busy ? 'pointer-events-none opacity-70' : '',
              confirming ? 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100' : '',
            )}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={busy ? 'animate-spin' : ''}
              style={busy ? { animationDuration: '1s' } : undefined}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <span className="hidden md:inline">
              {busy ? t('modal.restarting') : confirming ? t('modal.confirmRestart') : t('sidebar.restart')}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? IconSun : IconMoon}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
            className="font-mono font-semibold tracking-wider"
          >
            {locale === 'zh-CN' ? 'EN' : '\u4e2d'}
          </Button>
        </div>
      </div>
    </header>
  );
}
