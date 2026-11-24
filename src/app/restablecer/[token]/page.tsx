import { getReset } from "@/lib/users.ts";
import { AuthCard, LinkProblem } from "@/components/auth-card";
import { ResetForm } from "./form";

export const metadata = { title: "Restablecer contraseña", robots: { index: false }, referrer: "no-referrer" as const };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reset = getReset(token);
  return (
    <AuthCard orgName={reset.orgName} title="Nueva contraseña">
      {reset.status === "ok" ? (
        <>
          <p className="mb-5 text-[0.9375rem] text-picon-2">
            Hola, {reset.userName}. Elige una contraseña nueva para <span className="num font-semibold">{reset.email}</span>.
            Se cerrará tu sesión en todos los dispositivos.
          </p>
          <ResetForm token={token} />
        </>
      ) : (
        <LinkProblem status={reset.status} />
      )}
    </AuthCard>
  );
}
