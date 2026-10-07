"use client";

import { useFormStatus } from "react-dom";

const VARIANTS = {
  primary: "btn btn-primary",
  danger: "btn btn-danger",
  secondary: "btn btn-secondary",
};

export function SubmitButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: keyof typeof VARIANTS }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={VARIANTS[variant]}>
      {children}
    </button>
  );
}
