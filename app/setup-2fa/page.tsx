import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { requirePendingSession } from "@/lib/auth/next-session";
import { newTotpSecret, totpUri } from "@/lib/auth/totp";
import { getDb } from "@/lib/db";
import { getUser, setTotpPending } from "@/lib/repo/user";
import { confirmTotpSetupAction } from "../login/actions";
import { LoginForm } from "../login/LoginForm";
import { AuthShell } from "@/app/components/AuthShell";

export default async function SetupTotpPage() {
  await requirePendingSession();
  const db = getDb();
  const user = getUser(db);
  if (!user) redirect("/login");
  if (user.totp_secret) redirect("/login/totp");

  let secret = user.totp_pending_secret;
  if (!secret) {
    secret = newTotpSecret();
    setTotpPending(db, secret);
  }
  const qr = await QRCode.toDataURL(totpUri(user.email, secret));

  return (
    <AuthShell
      title="Activer la double authentification"
      subtitle="Scannez ce QR code avec votre application d'authentification, puis saisissez le code affiché."
    >
      <div className="mb-8 flex flex-col gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code TOTP" className="rounded-md bg-white p-2" width={176} height={176} />
        <p className="text-[13px] break-all text-muted">
          Clé manuelle : <span data-testid="totp-secret" className="font-mono text-fg">{secret}</span>
        </p>
      </div>
      <LoginForm
        action={confirmTotpSetupAction}
        submitLabel="Activer"
        fields={[{ name: "code", label: "Code à 6 chiffres", type: "text", autoComplete: "one-time-code", inputMode: "numeric" }]}
      />
    </AuthShell>
  );
}
