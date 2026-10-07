"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "../login/actions";

const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/backups", label: "Backups" },
  { href: "/stats", label: "Statistiques" },
  { href: "/environments", label: "Environnements" },
  { href: "/settings", label: "Paramètres" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/projects");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 px-4 sm:flex-nowrap sm:px-6">
        <span className="order-1 shrink-0 py-3 text-[14px] font-semibold tracking-tight">Backup Manager</span>
        <nav aria-label="Navigation principale" className="order-3 -mb-px flex w-full min-w-0 gap-5 overflow-x-auto sm:order-2 sm:w-auto sm:flex-1">
          {NAV.map(({ href, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 border-b py-3 text-[14px] transition-colors ${active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <form action={logoutAction} className="order-2 ml-auto shrink-0 sm:order-3 sm:ml-0">
          <button type="submit" className="text-[13px] text-muted hover:text-fg">Déconnexion</button>
        </form>
      </div>
    </header>
  );
}
