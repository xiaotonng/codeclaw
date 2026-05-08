import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-control-border bg-control px-3 py-1.5 text-[13px] text-fg shadow-sm',
        'transition-[border-color,box-shadow,background] duration-200 outline-none',
        'placeholder:text-fg-5',
        'hover:border-control-border-h',
        'focus:border-control-border-h focus:bg-control-h focus:shadow-[0_0_0_4px_var(--th-glow-a)]',
        // Disabled: distinct muted look (panel-alt bg, lighter edge, dimmed
        // text) instead of a generic opacity wash. Hover/focus styles are
        // explicitly suppressed so a disabled field never appears interactive.
        'disabled:cursor-not-allowed disabled:bg-panel-alt disabled:border-edge disabled:text-fg-5',
        'disabled:shadow-none disabled:hover:border-edge disabled:placeholder:text-fg-6',
        className
      )}
      {...props}
    />
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn('mb-2 block text-sm font-medium text-fg-3', className)}>{children}</label>;
}
