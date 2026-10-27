"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ReauthLink() {
  const pathname = usePathname();
  return (
    <Link href={`/confirm?next=${encodeURIComponent(pathname)}`} className="link">
      Confirmer avec un code
    </Link>
  );
}

export function FormError({ state }: { state: { error?: string; ok?: string; reauth?: boolean } }) {
  if (state.reauth) {
    return (
      <p role="alert" className="text-[13px] text-warn">
        {state.error} <ReauthLink />
      </p>
    );
  }
  if (state.error) return <p role="alert" className="text-[13px] text-bad">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-[13px] text-ok">{state.ok}</p>;
  return null;
}
