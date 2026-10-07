// Cadre des pages de connexion : formulaire centré, sans carte ni effet.
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-[22rem]">
        <p className="mb-10 text-[13px] font-medium text-muted">Backup Manager</p>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
