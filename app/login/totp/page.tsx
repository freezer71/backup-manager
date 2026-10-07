import { requirePendingSession } from "@/lib/auth/next-session";
import { totpAction } from "../actions";
import { LoginForm } from "../LoginForm";
import { AuthShell } from "@/app/components/AuthShell";

export default async function TotpPage() {
  await requirePendingSession();
  return (
    <AuthShell title="Code de vérification" subtitle="Saisissez le code affiché par votre application d'authentification.">
      <LoginForm
        action={totpAction}
        submitLabel="Se connecter"
        fields={[{ name: "code", label: "Code à 6 chiffres", type: "text", autoComplete: "one-time-code", inputMode: "numeric" }]}
      />
    </AuthShell>
  );
}
