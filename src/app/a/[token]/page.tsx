import { notFound } from "next/navigation";
import { formatDateLong, isoWeekday, todayIn, weekdayName, formatDateShort, addDays } from "@/lib/dates.ts";
import { firstName } from "@/lib/messages.ts";
import { REASON_LABELS } from "@/lib/parse-message.ts";
import {
  ERROR_MESSAGES, findReporter, isReasonCategory, previewSelfReport, REASON_CATEGORIES, resolveWhen, selfReportOutcome,
  type AffectedService, type SelfReportError,
} from "@/lib/self-report.ts";
import { Glyph } from "@/components/ui";
import { Mark } from "@/components/mark";
import { selfReportAction } from "./actions";

// The token is a credential: never indexed, never leaked through the Referer header.
export const metadata = { title: "Avisar de una ausencia", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

type Search = { cuando?: string; desde?: string; hasta?: string; motivo?: string; error?: string; hecho?: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Services({ services, empty }: { services: AffectedService[]; empty: string }) {
  if (!services.length) return <p className="text-base text-picon-2">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-linea-suave border-y border-linea">
      {services.map((s, i) => (
        <li key={i} className="flex items-start gap-3 py-2.5">
          <Glyph kind="solid" className="mt-1.5 text-almagre" />
          <div className="min-w-0">
            <div className="num text-base font-bold text-picon">
              {s.start}–{s.end} <span className="cond font-semibold text-picon-2">· {formatDateShort(s.date)}</span>
            </div>
            <div className="text-base text-picon-2">{s.locationName}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Notice({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  return (
    <div role="status" className={`mb-5 border-l-4 px-3 py-2.5 text-base text-picon ${tone === "error" ? "border-almagre bg-almagre-tinte" : "border-mar bg-mar-tinte/60"}`}>
      {children}
    </div>
  );
}

const rangeLabel = (start: string, end: string) =>
  start === end
    ? `${weekdayName(isoWeekday(start))} ${formatDateLong(start)}`
    : `del ${formatDateLong(start)} al ${formatDateLong(end)}`;

export default async function SelfReportPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const reporter = findReporter(token);
  if (!reporter) notFound();
  const q = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, one(v)])) as Search;
  const today = todayIn(reporter.timezone);
  const tomorrow = addDays(today, 1);

  // Step 3 — done.
  const doneId = Number(q.hecho);
  const outcome = Number.isInteger(doneId) && doneId > 0 ? selfReportOutcome(token, doneId) : undefined;

  // Step 2 — review what will be sent.
  let review: ReturnType<typeof previewSelfReport> | null = null;
  const dates = !outcome && q.cuando && isReasonCategory(q.motivo) ? resolveWhen(q.cuando, today, q.desde, q.hasta) : null;
  if (dates && isReasonCategory(q.motivo)) review = previewSelfReport(token, { ...dates, reason: q.motivo });
  if (!outcome && q.cuando && !dates) review = { ok: false, error: q.cuando === "otras" ? "invalid_dates" : "invalid_reason", message: ERROR_MESSAGES[q.cuando === "otras" ? "invalid_dates" : "invalid_reason"] };

  // Why we are (back) on the first step: a failed review, or a refused submit redirected here with ?error=.
  const urlError = q.error && q.error in ERROR_MESSAGES ? (q.error as SelfReportError) : null;
  const notice: { error: SelfReportError; message: string } | null =
    review && !review.ok ? review : urlError ? { error: urlError, message: ERROR_MESSAGES[urlError] } : null;

  return (
    <div className="flex min-h-dvh flex-col items-center bg-cal px-4 pt-5 pb-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Mark className="size-7" />
          <span className="cond truncate text-[0.9375rem] font-bold text-picon">{reporter.orgName}</span>
        </div>

        <p className="voz text-[1.25rem] text-picon-2 italic">Hola, {firstName(reporter.name)}:</p>

        {outcome ? (
          <div role="status">
            <h1 className="cond mt-0.5 flex items-start gap-2.5 text-[2rem] leading-[1.05] font-[780] tracking-[-0.01em] text-picon">
              <Glyph kind="check" className="mt-2 size-6 text-mar" />Coordinación ya lo sabe.
            </h1>
            <p className="mt-2 text-lg text-picon-2">No tienes que hacer nada más.</p>
            <div className="mt-5 border-2 border-picon bg-cal-claro px-5 py-4">
              <div className="label">Tu aviso</div>
              <p className="text-lg font-bold text-picon first-letter:uppercase">{rangeLabel(outcome.start, outcome.end)}</p>
              <p className="text-base text-picon-2">{REASON_LABELS[outcome.reason]}</p>
              <div className="label mt-4">Servicios afectados</div>
              <Services services={outcome.services} empty="No tenías servicios planificados esos días." />
              {outcome.services.length > 0 && <p className="mt-3 text-sm text-picon-3">Coordinación buscará quien los cubra y te avisará si hace falta algo.</p>}
            </div>
            <p className="mt-4 text-center text-sm text-picon-3">Guarda este enlace: sirve siempre que necesites avisar.</p>
          </div>
        ) : review?.ok ? (
          <>
            <h1 className="cond mt-0.5 text-[2rem] leading-[1.05] font-[780] tracking-[-0.01em] text-picon">¿Avisamos a coordinación?</h1>
            <div className="mt-5 border-2 border-picon bg-cal-claro">
              <div className="bg-picon px-5 py-4 text-cal-claro">
                <div className="cond text-base font-bold tracking-[0.06em] text-cal/80 uppercase">No puedes trabajar</div>
                <div className="mt-1 text-xl leading-snug font-bold first-letter:uppercase">{rangeLabel(review.start, review.end)}</div>
                <div className="mt-1 text-base text-cal/80">{REASON_LABELS[review.reason]}</div>
              </div>
              <div className="px-5 py-4">
                <div className="label">Servicios afectados</div>
                <Services services={review.services} empty="No tienes servicios planificados esos días. Avisamos igualmente." />
              </div>
              <form action={selfReportAction} className="flex flex-col gap-2.5 border-t-2 border-dashed border-linea-fuerte px-5 py-5">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="desde" value={review.start} />
                <input type="hidden" name="hasta" value={review.end} />
                <input type="hidden" name="motivo" value={review.reason} />
                <button type="submit" className="btn-primary min-h-14! text-lg!">Avisar a coordinación</button>
                <a href={`/a/${encodeURIComponent(token)}`} className="btn-secondary min-h-14! text-lg!">Cambiar</a>
              </form>
            </div>
          </>
        ) : (
          <>
            <h1 className="cond mt-0.5 text-[2rem] leading-[1.05] font-[780] tracking-[-0.01em] text-picon">¿No puedes ir a trabajar?</h1>
            <p className="mt-2 text-base text-picon-2">Avisa aquí y coordinación buscará quien te sustituya.</p>
            <div className="mt-5">
              {notice && <Notice tone={notice.error === "duplicate" || notice.error === "rate_limited" ? "info" : "error"}>{notice.message}</Notice>}
            </div>
            <form method="get" className="group border-2 border-picon bg-cal-claro">
              <fieldset className="px-5 pt-4 pb-3">
                <legend className="label">¿Cuándo?</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[["hoy", "Hoy", formatDateShort(today)], ["manana", "Mañana", formatDateShort(tomorrow)]].map(([v, t, sub]) => (
                    <label key={v} className="relative block">
                      <input type="radio" name="cuando" value={v} required defaultChecked={q.cuando === v} className="peer sr-only" />
                      <span className="flex min-h-16 cursor-pointer flex-col justify-center border border-linea-fuerte bg-cal-claro px-3 peer-checked:border-picon peer-checked:bg-picon peer-checked:text-cal-claro peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-mar">
                        <span className="cond text-xl font-bold">{t}</span>
                        <span className="num text-sm opacity-70">{sub}</span>
                      </span>
                    </label>
                  ))}
                  <label className="relative col-span-2 block">
                    <input id="cuando-otras" type="radio" name="cuando" value="otras" required defaultChecked={q.cuando === "otras"} className="peer sr-only" />
                    <span className="flex min-h-12 cursor-pointer items-center border border-linea-fuerte bg-cal-claro px-3 peer-checked:border-picon peer-checked:bg-picon peer-checked:text-cal-claro peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-mar">
                      <span className="cond text-xl font-bold">Otras fechas</span>
                    </span>
                  </label>
                </div>
                <div className="mt-3 hidden grid-cols-2 gap-2 group-has-[#cuando-otras:checked]:grid">
                  <div>
                    <label htmlFor="desde" className="label">Desde</label>
                    <input id="desde" type="date" name="desde" min={today} defaultValue={q.desde || tomorrow} className="input" />
                  </div>
                  <div>
                    <label htmlFor="hasta" className="label">Hasta (incluido)</label>
                    <input id="hasta" type="date" name="hasta" min={today} defaultValue={q.hasta || ""} className="input" />
                  </div>
                </div>
              </fieldset>
              <fieldset className="border-t-2 border-dashed border-linea-fuerte px-5 pt-4 pb-3">
                <legend className="label">Motivo</legend>
                <div className="flex flex-wrap gap-2">
                  {REASON_CATEGORIES.map((c) => (
                    <label key={c} className="relative block">
                      <input type="radio" name="motivo" value={c} required defaultChecked={q.motivo === c} className="peer sr-only" />
                      <span className="flex min-h-11 cursor-pointer items-center border border-linea-fuerte bg-cal-claro px-3.5 text-base font-semibold peer-checked:border-picon peer-checked:bg-picon peer-checked:text-cal-claro peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-mar">
                        {REASON_LABELS[c]}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-sm text-picon-3">Solo hace falta el motivo general. No escribas detalles de salud.</p>
              </fieldset>
              <div className="border-t-2 border-dashed border-linea-fuerte px-5 py-5">
                <button type="submit" className="btn-primary w-full min-h-14! text-lg!">Continuar</button>
              </div>
            </form>
          </>
        )}
        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-picon-3">
          Enviado con <span className="cond font-bold text-picon-2">cauce</span>
        </p>
      </div>
    </div>
  );
}
