import { notFound } from "next/navigation";
import { get } from "@/lib/db.ts";
import { formatDateLong, isoWeekday, weekdayName } from "@/lib/dates.ts";
import { firstName } from "@/lib/messages.ts";
import { ResponseButtons } from "./buttons";
import { accessNotesForToken, shiftStarted, type OfferResponse } from "@/lib/coverage.ts";
import { Mark } from "@/components/mark";

export const metadata = { title: "Propuesta de servicio", robots: { index: false } };

export default async function ResponsePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = get<{
    status: string; name: string; date: string; start: string; end: string; location_name: string; address: string | null;
    org_id: number; org_name: string; case_status: string; resolved_employee_id: number | null; employee_id: number;
  }>(
    `SELECT o.status, o.employee_id, o.org_id, e.name, s.date, s.start, s.end, l.name AS location_name, l.address,
            org.name AS org_name, c.status AS case_status, c.resolved_employee_id
       FROM offers o JOIN employees e ON e.id = o.employee_id AND e.org_id = o.org_id
       JOIN coverage_cases c ON c.id = o.case_id AND c.org_id = o.org_id
       JOIN shifts s ON s.id = c.shift_id AND s.org_id = o.org_id
       JOIN locations l ON l.id = s.location_id AND l.org_id = o.org_id
       JOIN organizations org ON org.id = o.org_id
      WHERE o.token = ?`,
    token,
  );
  if (!o) notFound();

  const pending = o.status === "pending" && ["open", "offering"].includes(o.case_status);
  const result: OfferResponse | null =
    o.status === "accepted" ? "accepted"
    : o.status === "declined" ? "declined"
    : !pending ? "too_late"
    : shiftStarted(o.org_id, o.date, o.start) ? "expired"
    : null;
  // Keys/alarm codes never reach the browser of someone who hasn't been confirmed on the service.
  const initial = result ? { result, accessNotes: result === "accepted" ? accessNotesForToken(token) : null } : null;

  return (
    <div className="flex min-h-dvh flex-col items-center bg-cal px-4 pt-5 pb-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Mark className="size-7" />
          <span className="cond truncate text-[0.9375rem] font-bold text-picon">{o.org_name}</span>
        </div>

        <p className="voz text-[1.25rem] text-picon-2 italic">Hola, {firstName(o.name)}:</p>
        <h1 className="cond mt-0.5 text-[2rem] leading-[1.05] font-[780] tracking-[-0.01em] text-picon">¿Puedes cubrir este servicio?</h1>

        {/* A ticket: when and where, big enough to read at arm's length. */}
        <div className="mt-5 border-2 border-picon bg-cal-claro">
          <dl>
            <div className="bg-picon px-5 py-4 text-cal-claro">
              <dt className="sr-only">Cuándo</dt>
              <dd className="num text-[2.75rem] leading-none font-bold">
                {o.start}<span className="text-cal/50">–{o.end}</span>
              </dd>
              <dd className="cond mt-2 text-base font-bold tracking-[0.06em] text-cal/80 uppercase">
                {weekdayName(isoWeekday(o.date))}, {formatDateLong(o.date)}
              </dd>
            </div>
            <div className="px-5 py-4">
              <dt className="label">Dónde</dt>
              <dd className="text-xl leading-snug font-bold text-picon">{o.location_name}</dd>
              {o.address && (
                <dd className="mt-1">
                  <a className="link inline-flex min-h-11 items-center text-base" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`} target="_blank" rel="noreferrer">
                    {o.address} · Abrir mapa
                  </a>
                </dd>
              )}
            </div>
          </dl>
          <div className="border-t-2 border-dashed border-linea-fuerte px-5 py-5">
            <ResponseButtons token={token} initial={initial} />
          </div>
        </div>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-picon-3">
          Enviado con <span className="cond font-bold text-picon-2">cauce</span>
        </p>
      </div>
    </div>
  );
}
