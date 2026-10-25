// Emblème : trois sauvegardes empilées, la plus récente en vert, les plus anciennes s'estompent.
// Les icônes de l'onglet et de l'écran d'accueil (app/icon.png, apple-icon.png) portent la médaille de Mnémosyne de l'identité Kouma Home.
export function LogoMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="6 5.5 20 20.5" className={className} aria-hidden="true">
      <path d="M7.5 20.5 16 25l8.5-4.5" fill="none" stroke="var(--color-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 16 16 20.5l8.5-4.5" fill="none" stroke="var(--color-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 6.5 24.5 11 16 15.5 7.5 11Z" fill="var(--color-ok)" stroke="var(--color-ok)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <LogoMark />
      Backup Manager
    </span>
  );
}
