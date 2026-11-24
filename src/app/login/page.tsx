import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session.ts";
import { Mark, Wordmark } from "@/components/mark";
import { LoginForm } from "./form";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ restablecida?: string }> }) {
  const { restablecida } = await searchParams;
  if (await currentUser()) redirect("/");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="flex flex-col justify-between gap-10 bg-picon px-6 py-8 text-cal sm:px-10 lg:px-14 lg:py-12">
        <div className="flex items-center gap-3">
          <Mark className="size-10" />
          <Wordmark className="text-[1.75rem] text-cal-claro" />
        </div>
        <div className="max-w-md">
          <p className="cond text-[2rem] leading-[1.05] font-[750] tracking-[-0.01em] text-cal-claro sm:text-[2.75rem]">
            De la ausencia a la cobertura confirmada.
          </p>
          <p className="mt-3 text-[0.9375rem] text-cal/70">
            Coordinación de operaciones para empresas de limpieza.
          </p>
        </div>
        <div className="hidden lg:block">
          <div className="flex gap-[3px]" aria-hidden>
            {Array.from({ length: 34 }, (_, i) => (
              <span key={i} className={`h-3 w-[5px] ${i === 33 ? "bg-almagre-claro" : "bg-cal/60"}`} />
            ))}
          </div>
        </div>
      </section>

      <section className="flex items-start justify-center px-6 py-10 sm:px-10 lg:items-center">
        <div className="w-full max-w-sm">
          <h1 className="cond text-[1.75rem] font-[750] text-picon">Entrar</h1>
          <p className="mt-1 mb-6 text-sm text-picon-3">
            Demo: <span className="num font-semibold text-picon-2">demo@cauce.app</span> / <span className="num font-semibold text-picon-2">demo1234</span>
          </p>
          {restablecida && (
            <p className="mb-4 text-sm font-medium text-mar" role="status">Contraseña actualizada. Ya puedes entrar.</p>
          )}
          <LoginForm />
          <p className="mt-6 text-sm text-picon-3">
            ¿Has olvidado la contraseña? Pide a tu administrador un enlace para restablecerla.
          </p>
        </div>
      </section>
    </div>
  );
}
