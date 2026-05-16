import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils';

interface ModelOption {
  value: string;
  label: string;
  /** Secondary line shown beneath the label inside the menu. */
  description?: string;
  /** Right-aligned monospace tag shown next to the label. */
  meta?: string;
  /**
   * Optional bucket label. Consecutive options sharing the same group render
   * under one header row inside the menu. Use a stable string per group ("
   * Native", "My Models", etc.). Omit to render flat (current behaviour).
   */
  group?: string;
}

interface MenuStyle {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

function containsNode(container: HTMLElement | null, target: EventTarget | null): boolean {
  return !!(container && target instanceof Node && container.contains(target));
}

function matchesQuery(option: ModelOption, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${option.label} ${option.description || ''} ${option.meta || ''}`.toLowerCase();
  return tokens.every(t => haystack.includes(t));
}

/**
 * Specialised model picker: pins the currently-selected option at the top so
 * it stays visible even when scrolling through hundreds of OpenRouter models,
 * and adds a sticky search box that filters the remaining list by substring.
 *
 * Drop-in replacement for `<Select>` in the model row of AgentTab.
 */
export function ModelSelect({
  value,
  options,
  onChange,
  className,
  placeholder = '—',
  disabled = false,
  searchPlaceholder = 'Search models...',
  noMatchesText = 'No matches',
  currentLabel = 'Current',
}: {
  value: string;
  options: ModelOption[];
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  searchPlaceholder?: string;
  noMatchesText?: string;
  currentLabel?: string;
}) {
  const current = options.find(option => option.value === value);
  const isReadOnly = options.length <= 1;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<MenuStyle | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (containsNode(rootRef.current, event.target) || containsNode(menuRef.current, event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (open) {
      // Defer focus until after the portal mounts.
      const handle = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(handle);
    }
    return undefined;
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const trigger = rootRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUpward = spaceBelow < 280 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(220, Math.min(360, openUpward ? spaceAbove : spaceBelow));
      setMenuStyle({
        left: rect.left,
        top: openUpward ? Math.max(12, rect.top - maxHeight - 8) : rect.bottom + 8,
        width: rect.width,
        maxHeight,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  );

  const filteredRest = useMemo(() => {
    return options.filter(option => option.value !== value && matchesQuery(option, tokens));
  }, [options, value, tokens]);

  if (isReadOnly) {
    return (
      <div
        className={cn(
          'flex h-9 w-full items-center rounded-md border border-edge bg-panel-alt px-3 text-[13px] text-fg-5 shadow-none',
          disabled && 'cursor-not-allowed',
          className
        )}
      >
        <span className={cn('truncate', !current && 'text-fg-6')}>{current?.label || placeholder}</span>
      </div>
    );
  }

  const handleSelect = (nextValue: string) => {
    if (disabled) return;
    onChange(nextValue);
    setOpen(false);
  };

  const renderOption = (option: ModelOption, selected: boolean) => (
    <button
      key={option.value}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => handleSelect(option.value)}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-200',
        selected
          ? 'bg-panel text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
          : 'text-fg-3 hover:bg-panel-alt hover:text-fg-2'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.meta && (
            <span className="shrink-0 font-mono text-[10px] text-fg-5">{option.meta}</span>
          )}
        </div>
        {option.description && (
          <div className="mt-0.5 truncate text-[11px] leading-relaxed text-fg-5">{option.description}</div>
        )}
      </div>
      {selected && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-fg-4">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );

  /** Render filtered options with group headers between buckets. Group changes
   *  emit a sticky-style label row; no group on options falls back to flat
   *  rendering exactly as before. */
  const renderGrouped = (opts: ModelOption[]) => {
    const out: ReturnType<typeof renderOption>[] = [];
    let lastGroup: string | undefined = undefined;
    for (const option of opts) {
      if (option.group && option.group !== lastGroup) {
        out.push(
          <div
            key={`__group:${option.group}`}
            className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-fg-5"
          >
            {option.group}
          </div>
        );
        lastGroup = option.group;
      } else if (!option.group) {
        lastGroup = undefined;
      }
      out.push(renderOption(option, false));
    }
    return out;
  };

  const menu = open && menuStyle
    ? createPortal(
      <div
        ref={menuRef}
        role="listbox"
        className="fixed z-[220] flex flex-col overflow-hidden rounded-xl border border-edge-h bg-[var(--th-dropdown)] p-1.5 shadow-[0_24px_64px_rgba(2,6,23,0.22)] backdrop-blur-xl"
        style={{
          left: menuStyle.left,
          top: menuStyle.top,
          width: menuStyle.width,
          maxHeight: menuStyle.maxHeight,
        }}
      >
        <div className="relative px-1.5 pt-1 pb-2">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-fg-5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            spellCheck={false}
            autoComplete="off"
            className={cn(
              'h-8 w-full rounded-md border border-control-border bg-control pl-7 pr-2 text-[12px] text-fg shadow-sm',
              'transition-[border-color,box-shadow,background] duration-200 outline-none',
              'placeholder:text-fg-5',
              'focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]'
            )}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {current && (
            <>
              <div className="px-3 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-5">
                {currentLabel}
              </div>
              {renderOption(current, true)}
              <div className="my-1.5 border-t border-edge" />
            </>
          )}
          {filteredRest.length > 0 ? (
            renderGrouped(filteredRest)
          ) : (
            <div className="px-3 py-3 text-center text-[12px] text-fg-5">
              {noMatchesText}
            </div>
          )}
        </div>
      </div>,
      document.body
    )
    : null;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(currentOpen => !currentOpen)}
        className={cn(
          'flex h-9 w-full items-center rounded-md border border-control-border bg-control px-3 pr-8 text-left text-[13px] text-fg shadow-sm',
          'transition-[border-color,box-shadow,background] duration-200 outline-none',
          'hover:border-control-border-h hover:bg-control-h',
          'focus-visible:border-control-border-h focus-visible:shadow-[0_0_0_4px_var(--th-glow-a)]',
          'disabled:cursor-not-allowed disabled:bg-panel-alt disabled:border-edge disabled:text-fg-5',
          'disabled:shadow-none disabled:hover:border-edge disabled:hover:bg-panel-alt',
          open && 'border-control-border-h bg-control-h shadow-[0_0_0_4px_var(--th-glow-a)]'
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-fg-5')}>
          {current?.label || placeholder}
        </span>
        <span className={cn('pointer-events-none absolute inset-y-0 right-3 flex items-center text-fg-4 transition-transform duration-200', open && 'rotate-180')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {menu}
    </div>
  );
}
