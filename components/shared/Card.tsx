import React, { ReactNode } from "react";

interface CardProps {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Card({ title, description, children, footer }: CardProps) {
  return (
    <section className="card">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold text-white/90">{title}</h2>
          {description && (
            <p className="mt-1 text-[11px] text-white/55">{description}</p>
          )}
        </div>
      </header>

      {children && (
        <div className="text-xs text-white/90">{children}</div>
      )}

      {footer && (
        <footer className="mt-3 border-t border-white/10 pt-3 text-[10px] text-white/50">
          {footer}
        </footer>
      )}
    </section>
  );
}
