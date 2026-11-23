import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/session.ts";
import { all } from "@/lib/db.ts";
import { orgToday } from "@/lib/queries.ts";
import { addDays, dateRange, formatDateRelative, formatDateShort, isoWeekday, startOfWeek, weekdayShort } from "@/lib/dates.ts";
import { Glyph, PageHeader, Tabs } from "@/components/ui";

export const metadata = { title: "Planificación" };

type Shift = {
  id: number; date: string; start: string; end: string; title: string; status: string; employee_id: number | null; employee_name: string | null;
  location_id: number; location_name: string; client_name: string; case_id: number | null; case_status: string | null; replaced: string | null;
};

const validDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

export default async function PlanningPage({ searchParams }: { searchParams: Promise<{ fecha?: string; vista?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = orgToday(user.orgId);
  const date = validDate(sp.fecha) ?? today;
  const view = sp.vista === "semana" ? "semana" : "dia";
  const from = view === "semana" ? startOfWeek(date) : date;
  const to = view === "semana" ? addDays(from, 6) : date;

  const shifts = all<Shift>(
    `SELECT s.id, s.date, s.start, s.end, s.title, s.status, s.employee_id, e.name AS employee_name, s.location_id, l.name AS location_name,
            cl.name AS client_name,
            (SELECT c.id FROM coverage_cases c WHERE c.shift_id = s.id ORDER BY c.id DESC LIMIT 1) AS case_id,
            (SELECT c.status FROM coverage_cases c WHERE c.shift_id = s.id ORDER BY c.id DESC LIMIT 1) AS case_status,
            (SELECT oe.name FROM coverage_cases c JOIN employees oe ON oe.id = c.original_employee_id WHERE c.shift_id = s.id AND c.status = 'covered' ORDER BY c.id DESC LIMIT 1) AS replaced
       FROM shifts s JOIN locations l ON l.id = s.location_id JOIN clients cl ON cl.id = l.client_id LEFT JOIN employees e ON e.id = s.employee_id
      WHERE s.org_id = ? AND s.date BETWEEN ? AND ? ORDER BY cl.name, l.name, s.start`,
    user.orgId, from, to,
  );

  const step = view === "semana" ? 7 : 1;
  const nav = (d: string) => `/planificacion?fecha=${d}${view === "semana" ? "&vista=semana" : ""}`;
  const locations = [...new Map(shifts.map((s) => [s.location_id, { id: s.location_id, name: s.location_name, client: s.client_name }])).values()];
  const uncovered = shifts.filter((s) => s.status === "uncovered").length;

  return (
    <div>
      <PageHeader
        title="Planificación"
        subtitle={`${shifts.filter((s) => s.status !== "cancelled").length} servicios · ${uncovered ? `${uncovered} sin cubrir` : "todo cubierto"}`}
        actions={
          <div className="flex items-center gap-1">
            <Link href={nav(addDays(date, -step))} className="btn-secondary w-11 px-0 sm:w-10" aria-label="Anterior"><ChevronLeft className="size-4" /></Link>
            <Link href={nav(today)} className="btn-secondary">Hoy</Link>
            <Link href={nav(addDays(date, step))} className="btn-secondary w-11 px-0 sm:w-10" aria-label="Siguiente"><ChevronRight className="size-4" /></Link>
            <span className="num ml-2 text-[0.9375rem] font-semibold text-picon first-letter:uppercase">
              {view === "semana" ? `${formatDateShort(from)} – ${formatDateShort(to)}` : formatDateRelative(date, today) === formatDateShort(date) ? formatDateShort(date) : `${formatDateRelative(date, today)} · ${formatDateShort(date)}`}
            </span>
          </div>
        }
      />
      <Tabs active={view} items={[
        { key: "dia", label: "Día", href: `/planificacion?fecha=${date}` },
        { key: "semana", label: "Semana", href: `/planificacion?fecha=${date}&vista=semana` },
      ]} />

      {view === "dia" ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          {locations.length === 0 && <p className="text-sm text-picon-3">No hay servicios este día.</p>}
          {locations.map((l) => (
            <section key={l.id}>
              <div className="flex items-baseline justify-between gap-3 border-b-2 border-picon pb-1">
                <h2 className="truncate text-[0.9375rem] font-bold">{l.name}</h2>
                <span className="shrink-0 truncate text-xs text-picon-3">{l.client}</span>
              </div>
              <ul className="divide-y divide-linea-suave">
                {shifts.filter((s) => s.location_id === l.id).map((s) => <ShiftRow key={s.id} s={s} />)}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border border-linea bg-cal-claro">
            <table className="w-full min-w-[680px] table-fixed border-collapse text-sm">
              <colgroup><col className="w-44 sm:w-64" /></colgroup>
              <thead>
                <tr className="border-b-2 border-picon">
                  <th className="eyebrow sticky left-0 z-10 border-r border-linea-suave bg-cal-claro px-3 py-2 text-left">Centro</th>
                  {dateRange(from, to).map((d) => (
                    <th key={d} className={`px-1 py-1.5 text-center font-normal ${d === today ? "bg-picon text-cal-claro" : ""}`}>
                      <Link href={`/planificacion?fecha=${d}`} className="flex flex-col items-center leading-tight hover:underline">
                        <span className={`cond text-[0.6875rem] font-bold tracking-[0.08em] uppercase ${d === today ? "text-cal/75" : "text-picon-3"}`}>
                          {d === today ? "Hoy" : weekdayShort(isoWeekday(d))}
                        </span>
                        <span className="num text-base font-bold">{Number(d.slice(8))}</span>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-linea-suave">
                {locations.map((l) => (
                  <tr key={l.id}>
                    <td className="sticky left-0 z-10 truncate border-r border-linea-suave bg-cal-claro px-3 py-2 font-medium text-picon">{l.name}</td>
                    {dateRange(from, to).map((d) => {
                      const day = shifts.filter((s) => s.location_id === l.id && s.date === d && s.status !== "cancelled");
                      const open = day.filter((s) => s.status === "uncovered");
                      const waiting = open.length > 0 && open.every((s) => s.case_status === "offering");
                      const col = d === today ? "bg-cal-hondo/70" : "";
                      if (!day.length) return <td key={d} className={`px-1 py-1.5 ${col}`} aria-label="Sin servicios" />;
                      return (
                        <td key={d} className={`px-1 py-1.5 text-center ${col}`}>
                          {/* One pip per service: ink = covered, almagre = gap, azufre = waiting for an answer. */}
                          <Link
                            href={open[0]?.case_id ? `/coberturas/${open[0].case_id}` : `/planificacion?fecha=${d}`}
                            aria-label={`${day.length - open.length} de ${day.length} cubiertos`}
                            className={`inline-flex min-h-8 items-center justify-center gap-1.5 px-1.5 hover:bg-cal-hondo ${open.length ? "ring-1 ring-current ring-inset" : ""} ${
                              open.length ? (waiting ? "text-azufre-texto" : "text-almagre") : ""
                            }`}
                            title={day.map((s) => `${s.start} ${s.title}: ${s.employee_name ?? "SIN CUBRIR"}`).join("\n")}
                          >
                            <span className="flex gap-[2px]">
                              {day.map((s) => (
                                <span
                                  key={s.id}
                                  className={`h-3.5 w-1.5 ${s.status !== "uncovered" ? "bg-picon-3" : s.case_status === "offering" ? "bg-azufre" : "bg-almagre"}`}
                                />
                              ))}
                            </span>
                            {open.length > 0 && <span className="num text-[0.8125rem] font-bold">{day.length - open.length}/{day.length}</span>}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-picon-3">
            <span className="eyebrow">Cada marca, un servicio</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-1.5 bg-picon-3" /> cubierto</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-1.5 bg-almagre" /> sin cubrir</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-1.5 bg-azufre" /> esperando respuesta</span>
          </p>
        </>
      )}
    </div>
  );
}

function ShiftRow({ s }: { s: Shift }) {
  const gap = s.status === "uncovered";
  const body = (
    <>
      <span className="num w-[5.5rem] shrink-0 text-[0.8125rem] font-semibold text-picon-2">{s.start}–{s.end}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] text-picon-3">{s.title}</span>
        <span className="block truncate">
          {s.status === "cancelled" ? (
            <span className="text-picon-4 line-through">Anulado</span>
          ) : s.employee_name ? (
            <span className="font-semibold text-picon">{s.employee_name}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-bold text-almagre">
              <Glyph kind={s.case_status === "offering" ? "half" : "solid"} /> Sin cubrir
            </span>
          )}
          {s.replaced && <span className="text-[0.8125rem] text-mar"> · sustituye a {s.replaced.split(" ")[0]}</span>}
          {s.case_status === "offering" && <span className="text-[0.8125rem] font-medium text-azufre-texto"> · esperando respuesta</span>}
        </span>
      </span>
    </>
  );
  const cls = `-mx-2 flex min-h-12 items-center gap-3 px-2 py-2 text-sm ${gap ? "bg-almagre-tinte hover:bg-red-200/60" : "hover:bg-cal-hondo/60"}`;
  return (
    <li>
      {s.case_id && gap ? (
        <Link href={`/coberturas/${s.case_id}`} className={cls}>{body}</Link>
      ) : s.employee_id ? (
        <Link href={`/personal/${s.employee_id}`} className={cls}>{body}</Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
