import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/session.ts";
import { all, get } from "@/lib/db.ts";
import { CASE_SELECT, type CaseRow } from "@/lib/coverage.ts";
import { orgToday, orgTimezone } from "@/lib/queries.ts";
import { formatDateRelative, formatRange, formatTimestamp } from "@/lib/dates.ts";
import { REASON_LABELS, type ReasonCategory } from "@/lib/parse-message.ts";
import { sourceLabel } from "@/lib/self-report.ts";
import { cancelAbsenceAction } from "@/app/actions";
import { Badge, CASE_STATUS, Glyph, PageHeader, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/client";

export const metadata = { title: "Ausencia" };

export default async function AbsencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ solapada?: string }> }) {
  const user = await requireUser();
  const tz = orgTimezone(user.orgId);
  const { id } = await params;
  const a = get<{ id: number; employee_id: number; name: string; start_date: string; end_date: string; reason: string | null; reason_category: ReasonCategory; raw_message: string | null; status: string; source: string; created_at: string }>(
    "SELECT a.*, e.name FROM absences a JOIN employees e ON e.id = a.employee_id WHERE a.org_id = ? AND a.id = ?",
    user.orgId, Number(id),
  );
  if (!a) notFound();
  const today = orgToday(user.orgId);
  const cases = all<CaseRow>(`${CASE_SELECT} WHERE c.org_id = ? AND c.absence_id = ? ORDER BY s.date, s.start`, user.orgId, a.id);
  const open = cases.filter((c) => c.status === "open" || c.status === "offering");
  const overlapped = (await searchParams).solapada === "1";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: "/ausencias", label: "Ausencias" }}
        title={a.name}
        subtitle={<span className="first-letter:uppercase">{formatRange(a.start_date, a.end_date, today)} · {REASON_LABELS[a.reason_category]}{a.reason ? ` · ${a.reason}` : ""}</span>}
        actions={a.status === "cancelled" ? <Badge>Anulada</Badge> : undefined}
      />

      {overlapped && (
        <div className="mb-4 border-l-4 border-azufre bg-cal-claro px-4 py-3 text-[0.9375rem] text-picon" role="status">
          Esta ausencia ya estaba registrada para esas fechas, así que no se ha creado otra. Si son días nuevos, regístralos aparte.
        </div>
      )}

      {open.length > 0 ? (
        <div className="mb-6 border-l-4 border-almagre bg-almagre-tinte px-4 py-3 text-[0.9375rem] text-picon">
          <b>{open.length} servicio{open.length > 1 ? "s" : ""} por cubrir.</b> Abre cada uno para ver las mejores opciones de sustitución.
        </div>
      ) : cases.length > 0 && a.status !== "cancelled" ? (
        <div className="mb-6 flex items-center gap-2 border-l-4 border-mar bg-mar-tinte/60 px-4 py-3 text-[0.9375rem] text-picon">
          <Glyph kind="check" className="text-mar" /> Todos los servicios afectados están resueltos.
        </div>
      ) : null}

      <section className="mb-6">
        <h2 className="h-section mb-2">Servicios afectados</h2>
        {cases.length === 0 ? (
          <div className="card p-4 text-sm text-slate-600">No tenía servicios planificados en esas fechas.</div>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {cases.map((c) => (
              <li key={c.id}>
                <Link href={`/coberturas/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.location_name}</div>
                    <div className="truncate text-xs text-slate-500">
                      <span className="first-letter:uppercase">{formatDateRelative(c.date, today)}</span> · {c.start}–{c.end} · {c.title}
                      {c.resolved_name ? ` · cubre ${c.resolved_name}` : ""}
                    </div>
                  </div>
                  <StatusBadge map={CASE_STATUS} status={c.status} />
                  {(c.status === "open" || c.status === "offering") && <span className="hidden sm:block"><span className="btn-primary">Buscar sustituta/o <ArrowRight className="size-4" /></span></span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4 text-sm">
        <div className="text-slate-500">
          Registrada {formatTimestamp(a.created_at, tz)}
          {sourceLabel(a.source) && <> · <b className="font-semibold text-picon">{sourceLabel(a.source)}</b> (desde su enlace personal)</>}
        </div>
        {a.raw_message && <p className="mt-2 rounded-lg bg-slate-50 p-2.5 text-slate-700 italic">«{a.raw_message}»</p>}
        {a.status === "active" && (
          <form action={cancelAbsenceAction} className="mt-3">
            <input type="hidden" name="absenceId" value={a.id} />
            <SubmitButton className="btn-danger">Anular ausencia (finalmente sí trabaja)</SubmitButton>
          </form>
        )}
      </section>
    </div>
  );
}
