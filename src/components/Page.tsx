import type { ReactNode } from "react";

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {actions}
      </div>
      {children}
    </main>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-panel ${className}`}>
      {title ? <h2 className="border-b border-border px-4 py-2 text-sm font-semibold text-muted">{title}</h2> : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
