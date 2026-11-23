import { requireUser } from "@/lib/session.ts";
import { directory, orgToday } from "@/lib/queries.ts";
import { aiEnabled } from "@/lib/ai.ts";
import { AvisoComposer } from "@/components/aviso-composer";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Registrar aviso" };

export default async function NewNoticePage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const user = await requireUser();
  const { tipo } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Registrar aviso"
        subtitle={
          <>
            Pega el WhatsApp o email tal cual: Cauce identifica a la persona, el cliente, las fechas y los servicios afectados.
            {!aiEnabled() && " (Modo sin IA: interpretación por reglas, sin coste.)"}
          </>
        }
      />
      <AvisoComposer
        dir={directory(user.orgId)}
        today={orgToday(user.orgId)}
        defaultKind={tipo === "incidencia" ? "incident" : tipo === "ausencia" ? "absence" : undefined}
      />
    </div>
  );
}
