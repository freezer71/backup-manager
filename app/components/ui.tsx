import Link from "next/link";

// Briques d'interface partagées (composants serveur, sans état).

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-col gap-3">
      {back && (
        <Link href={back.href} className="w-fit text-[13px] text-muted hover:text-fg">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  tone = "default",
  panel = true,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: "default" | "danger";
  panel?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      {(title || actions) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col">
            {title && <h2 className={`text-[15px] font-medium ${tone === "danger" ? "text-bad" : ""}`}>{title}</h2>}
            {description && <p className="text-[13px] text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {panel ? <div className={`panel ${tone === "danger" ? "border-bad/30" : ""} p-4`}>{children}</div> : children}
    </section>
  );
}

// Bande de chiffres clés : une seule bordure, séparateurs fins.
export function Stats({ items }: { items: Array<{ label: string; value: React.ReactNode; hint?: React.ReactNode }> }) {
  return (
    <dl className="panel grid grid-cols-2 lg:grid-cols-4">
      {items.map((it, i) => (
        <div
          key={it.label}
          className={`flex flex-col gap-1 p-4 ${i % 2 === 1 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
        >
          <dt className="text-[13px] text-muted">{it.label}</dt>
          <dd className="text-xl font-medium tracking-tight">{it.value}</dd>
          {it.hint && <dd className="text-[13px] text-muted">{it.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

export type Tone = "ok" | "run" | "warn" | "bad" | "idle";

const DOT: Record<Tone, string> = {
  ok: "bg-ok",
  run: "bg-run",
  warn: "bg-warn",
  bad: "bg-bad",
  idle: "bg-faint",
};

// État : un point de couleur et un libellé, sans fond.
export function Status({ tone, children, testId }: { tone: Tone; children: React.ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden className={`size-1.5 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-muted">{children}</div>}
    </div>
  );
}
