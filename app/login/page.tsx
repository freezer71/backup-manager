import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/next-session";
import { loginAction } from "./actions";
import { LoginForm } from "./LoginForm";
import { AuthShell } from "@/app/components/AuthShell";

export default async function LoginPage() {
  if ((await currentSession())?.session.totp_ok) redirect("/");
  return (
    <AuthShell title="Connexion">
      <LoginForm
        action={loginAction}
        submitLabel="Continuer"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "username" },
          { name: "password", label: "Mot de passe", type: "password", autoComplete: "current-password" },
        ]}
      />
    </AuthShell>
  );
}
