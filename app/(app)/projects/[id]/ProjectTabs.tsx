"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Onglets d'un projet : deux vraies routes (pas de réécriture), l'onglet actif suit l'URL.
export function ProjectTabs({ projectId, runCount }: { projectId: number; runCount: number }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/projects/${projectId}`, label: "Configuration" },
    { href: `/projects/${projectId}/runs`, label: `Historique (${runCount})` },
  ];
  return (
    <nav aria-label="Sections du projet" className="-mt-4 flex gap-5 border-b border-line">
      {tabs.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b py-2 text-[14px] transition-colors ${active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
