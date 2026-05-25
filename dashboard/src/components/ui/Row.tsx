import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../utils';

/**
 * Row family — canonical "data list" layout primitive.
 *
 * Why this exists & shape decisions:
 *
 *   1. Cross-row column alignment was the #1 visual bug of the previous design.
 *      Per-cell stacked labels (label-on-top + value-below) gave every cell a
 *      different height, and `items-center` then placed values at different y
 *      coordinates row-by-row. The fix is a **table mental model**: every
 *      primary cell is *single-line*; secondary text falls into an optional
 *      full-width `<Row.Description>` slot that spans the whole row below the
 *      primary line. The grid has a fixed `min-height` so even a row with no
 *      description holds the column baseline.
 *
 *   2. Column labels live on `<Row.Header>` at the top of a `<RowGroup>`,
 *      NOT inside each cell. Linear's March 2026 refresh did the same — one
 *      header row, dense data rows below.
 *
 *   3. The column tracks are declared on the `<RowGroup>` (so a Header + N
 *      Rows share the same grid). When a single Row is rendered outside a
 *      group, it carries its own grid template.
 *
 * Composition:
 *   <RowGroup>
 *     <Row.Header columns={['Channel', 'Status', 'Summary', '']} />
 *     <Row>
 *       <Row.Lead icon={...} title="Telegram" subtitle="Bot token + allowlist" />
 *       <Row.Status>
 *         <StatusPill state="idle" label="未接入" />
 *       </Row.Status>
 *       <Row.Field>未配置 Bot Token</Row.Field>
 *       <Row.Action>
 *         <Button>去配置</Button>
 *       </Row.Action>
 *       <Row.Description>Telegram bot token is not configured.</Row.Description>
 *     </Row>
 *     …
 *   </RowGroup>
 */

const ROW_GRID_VAR = '--row-grid';

/**
 * Column tracks: lead | status | summary | action.
 *
 *   - Lead and status are **fixed-width** so column 3 (summary) starts at
 *     the same x coordinate across every row. Using `auto` or `fr` for
 *     these tracks lets each row measure independently (every <Row> is its
 *     own grid container), which makes the summary column visibly drift
 *     left/right row-by-row.
 *   - Summary takes the remaining space via `minmax(0,1fr)`; the `0` min
 *     lets long values truncate instead of forcing horizontal scroll.
 *   - Action is `auto` so the button hugs the right edge.
 */
const DEFAULT_GRID = '260px 120px minmax(0,1fr) auto';

/**
 * Tailwind v4 JIT scans source files for literal class names. Building the
 * grid-cols utility via template-literal interpolation (e.g.
 * `lg:grid-cols-[var(${ROW_GRID_VAR},${DEFAULT_GRID})]`) produces a runtime
 * string the scanner never sees, so the rule is silently dropped from the
 * compiled CSS and the table layout never activates. Keep this as a single
 * static literal — Tailwind converts `_` into spaces inside arbitrary values
 * so the fallback list still parses correctly.
 */
const GRID_COLS_CLASS =
  'lg:grid-cols-[var(--row-grid,260px_120px_minmax(0,1fr)_auto)]';

/* ─────────────────────────────────────────────────────────────
 * RowGroup — vertical stack of Rows sharing one bordered shell and
 * one grid template. All children render with the same column tracks
 * so the columns visually align top-to-bottom.
 * ─────────────────────────────────────────────────────────── */
export function RowGroup({
  children,
  className,
  columns,
}: {
  children: ReactNode;
  className?: string;
  /** Custom column tracks (CSS grid-template-columns value). Defaults to
   *  the canonical 4-column [lead | status | field | action] layout. */
  columns?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-[var(--edge-subtle)] bg-[var(--surface-2)]',
        '[&>*+*]:border-t [&>*+*]:border-[var(--edge-subtle)]',
        className,
      )}
      style={{ [ROW_GRID_VAR]: columns ?? DEFAULT_GRID } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Section — labelled group with optional description and right slot.
 * ─────────────────────────────────────────────────────────── */
export function Section({
  title,
  description,
  right,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {(title || right) && (
        <div className="flex items-end justify-between gap-3 px-0.5">
          <div className="min-w-0">
            {title && (
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-5">
                {title}
              </div>
            )}
            {description && (
              <div className="mt-1.5 text-[13px] leading-relaxed text-fg-4">{description}</div>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Row — single data line. Grid:
 *   lg: 4 columns, items-center, min-h-[64px]
 *   below lg: stack vertically with the same children in order.
 *
 * The breakpoint is `lg` (≥1024px) rather than `xl` because the
 * dashboard content area is capped at `max-w-[1120px]` — using `xl`
 * (≥1280px) means the table layout never activated inside the
 * dashboard's own container at common laptop viewports.
 * ─────────────────────────────────────────────────────────── */
interface RowComposition {
  Lead: typeof RowLead;
  Field: typeof RowField;
  Status: typeof RowStatus;
  Action: typeof RowAction;
  Description: typeof RowDescription;
  Header: typeof RowHeader;
}

interface RowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Inline mode = no own border / bg. Default true so most rows live inside
   *  a RowGroup; pass false to render a standalone bordered row. */
  inline?: boolean;
}

const RowImpl = forwardRef<HTMLDivElement, RowProps>(function Row(
  { children, className, inline = true, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'grid gap-x-5 gap-y-2 px-4 py-3 min-h-[64px]',
        // Inherit the column tracks from the enclosing RowGroup. Fallback
        // to the canonical 4-track grid if the row stands alone.
        GRID_COLS_CLASS,
        'lg:items-center',
        'transition-[background] duration-200 hover:bg-[var(--surface-3)]',
        inline
          ? ''
          : 'rounded-lg border border-[var(--edge-subtle)] bg-[var(--surface-2)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export const Row = RowImpl as typeof RowImpl & RowComposition;

/* ─────── Row.Header — column-label header row ─────── */
function RowHeader({
  columns,
  className,
}: {
  /** Labels in column order. Use empty string for columns without a label
   *  (e.g. the action column). Length should match RowGroup's column count. */
  columns: ReactNode[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'hidden lg:grid gap-x-5 px-4 py-2',
        GRID_COLS_CLASS,
        'lg:items-center',
        'bg-[var(--surface-1)]',
        className,
      )}
    >
      {columns.map((label, i) => (
        <div
          key={i}
          className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5"
        >
          {label}
        </div>
      ))}
    </div>
  );
}
Row.Header = RowHeader;

/* ─────── Row.Lead — identity column (icon + title + subtitle) ─────── */
function RowLead({
  icon,
  title,
  subtitle,
  badge,
  className,
  iconWrap = true,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  className?: string;
  /** false → icon renders edge-to-edge (use for brand logos). */
  iconWrap?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      {icon && (
        iconWrap ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--edge-subtle)] bg-[var(--surface-1)] text-fg-3">
            {icon}
          </div>
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center">
            {icon}
          </div>
        )
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-[13.5px] font-semibold text-fg">{title}</div>
          {badge}
        </div>
        {subtitle && (
          <div className="mt-0.5 truncate text-[12px] leading-snug text-fg-5">{subtitle}</div>
        )}
      </div>
    </div>
  );
}
Row.Lead = RowLead;

/* ─────── Row.Field — single-line value column.
 *
 * The `label` prop is preserved for backward compat with `SettingRowField`,
 * but the recommended pattern is to drop labels and rely on `<Row.Header>`
 * at the top of the group. When `label` IS passed, it renders ABOVE the
 * value (legacy two-line cell) — every row in a group must pass a label
 * (or none) to keep columns aligned.
 * ─────────────────────────────────────────────── */
function RowField({
  label,
  children,
  className,
  mono,
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5 mb-1">
          {label}
        </div>
      )}
      <div
        className={cn(
          'truncate text-[13px] text-fg-3',
          mono && 'font-mono text-[12px]',
        )}
      >
        {children}
      </div>
    </div>
  );
}
Row.Field = RowField;

/* ─────── Row.Status — slot for a StatusPill or Badge ─────── */
function RowStatus({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center', className)}>
      {children}
    </div>
  );
}
Row.Status = RowStatus;

/* ─────── Row.Action — right-aligned actions (Button, IconButton) ─────── */
function RowAction({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-2 justify-start lg:justify-end', className)}>
      {children}
    </div>
  );
}
Row.Action = RowAction;

/* ─────── Row.Description — full-width secondary line below the grid.
 *
 * Spans every column. Wraps freely. Use for status detail messages,
 * error messages, multi-line summaries — anything that would otherwise
 * inflate a cell and break column alignment.
 * ─────────────────────────────────────────── */
function RowDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'col-span-full lg:col-span-full',
        'text-[12.5px] leading-relaxed text-fg-4',
        'pl-12', // indent past the lead icon
        '-mt-1',
        className,
      )}
      style={{ gridColumn: '1 / -1' }}
    >
      {children}
    </div>
  );
}
Row.Description = RowDescription;
