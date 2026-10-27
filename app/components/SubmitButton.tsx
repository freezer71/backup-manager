"use client";

import { useFormStatus } from "react-dom";

const VARIANTS = {
  primary: "btn btn-primary",
  danger: "btn btn-danger",
  secondary: "btn btn-secondary",
};

// name/value : distinguer deux boutons d'un même formulaire (ex. Enregistrer / Supprimer).
export function SubmitButton({
  children,
  variant = "primary",
  name,
  value,
  formNoValidate,
}: {
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
  name?: string;
  value?: string;
  formNoValidate?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} formNoValidate={formNoValidate} disabled={pending} aria-busy={pending} className={VARIANTS[variant]}>
      {children}
    </button>
  );
}
