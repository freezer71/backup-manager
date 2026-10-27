import { PageHeader, Section } from "@/app/components/ui";
import { LoginForm } from "@/app/login/LoginForm";
import { requireSession, safeNextPath } from "@/lib/auth/next-session";
import { REAUTH_TTL_MS } from "@/lib/auth/session";
import { confirmAction } from "./actions";

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireSession();
  const next = safeNextPath((await searchParams).next);
  return (
    <>
      <PageHeader
        title="Confirmer votre identité"
        subtitle={`Les URL de connexion, les projets, les téléchargements et le webhook demandent un code 2FA récent. Valable ${REAUTH_TTL_MS / 60_000} minutes.`}
      />
      <Section>
        <div className="max-w-sm">
          <LoginForm
            action={confirmAction.bind(null, next)}
            submitLabel="Confirmer"
            fields={[{ name: "code", label: "Code à 6 chiffres", type: "text", autoComplete: "one-time-code", inputMode: "numeric" }]}
          />
        </div>
      </Section>
    </>
  );
}
