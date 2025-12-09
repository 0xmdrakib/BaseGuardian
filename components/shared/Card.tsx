import React, { ReactNode } from "react";

interface CardProps {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Card({ title, description, children, footer }: CardProps) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold text-neutral-50">{title}</h2>
          {description && (
            <p className="text-[11px] text-neutral-400">{description}</p>
          )}
        </div>
      </header>

      {children && (
        <div className="text-xs text-neutral-100">
          {children}
        </div>
      )}

      {footer && (
        <footer className="mt-2 border-t border-neutral-800 pt-2 text-[10px] text-neutral-500">
          {footer}
        </footer>
      )}
    </section>
  );
}
