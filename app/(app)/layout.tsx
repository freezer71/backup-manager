import { requireSession } from "@/lib/auth/next-session";
import { TopNav } from "./TopNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
