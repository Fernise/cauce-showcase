import Link from "next/link";
import { Mark } from "@/components/mark";

/** Frame for the public one-time-link pages (invitation, password reset). The link is the credential. */
export function AuthCard({ orgName, title, children }: { orgName?: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-cal px-4 pt-5 pb-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Mark className="size-7" />
          <span className="cond truncate text-[0.9375rem] font-bold text-picon">{orgName ?? "Cauce"}</span>
        </div>
        <h1 className="cond text-[1.75rem] leading-[1.05] font-[750] tracking-[-0.01em] text-picon">{title}</h1>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export function LinkProblem({ status }: { status: string }) {
  const why =
    status === "used" ? "Este enlace ya se ha usado."
    : status === "expired" ? "Este enlace ha caducado."
    : status === "revoked" ? "Este enlace se ha cancelado."
    : "Este enlace no es válido.";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.9375rem] text-picon-2">{why} Pide uno nuevo a tu administrador.</p>
      <Link href="/login" className="btn-secondary self-start">Ir a entrar</Link>
    </div>
  );
}
