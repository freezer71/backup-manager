export function FormError({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) return <p role="alert" className="text-[13px] text-bad">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-[13px] text-ok">{state.ok}</p>;
  return null;
}
