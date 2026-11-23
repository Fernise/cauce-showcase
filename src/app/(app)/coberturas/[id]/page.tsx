import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, MessageCircle } from "lucide-react";
import { requireUser } from "@/lib/session.ts";
import { all, get } from "@/lib/db.ts";
import { getCase, rankForShift } from "@/lib/coverage.ts";
import { tradeoffSummary, WEIGHTS, type RankedCandidate } from "@/lib/ranking.ts";
import { formatDateRelative, formatTimestamp } from "@/lib/dates.ts";
import { orgToday } from "@/lib/queries.ts";
import { confirmationMessage, whatsappLink } from "@/lib/messages.ts";
import { REASON_LABELS, type ReasonCategory } from "@/lib/parse-message.ts";
import { assignAction, closeCaseAction, offerAction, respondOnBehalfAction, withdrawOfferAction } from "@/app/actions";
import { Badge, CASE_STATUS, Glyph, Initials, Meter, OFFER_STATUS, SectionHead, StatusBadge } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { ActivityList } from "@/components/activity-list";

export const metadata = { title: "Cobertura" };

type Offer = { id: number; employee_id: number; name: string; phone: string | null; token: string; message: string; score: number | null; status: string; created_at: string; responded_at: string | null };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const c = getCase(user.orgId, Number(id));
  if (!c) notFound();
  const today = orgToday(user.orgId);
  const isOpen = c.status === "open" || c.status === "offering";

  const absence = c.absence_id
    ? get<{ reason: string | null; reason_category: ReasonCategory; raw_message: string | null }>(
        "SELECT reason, reason_category, raw_message FROM absences WHERE id = ?", c.absence_id)
    : undefined;
  const offers = all<Offer>(
    `SELECT o.*, e.name, e.phone FROM offers o JOIN employees e ON e.id = o.employee_id WHERE o.org_id = ? AND o.case_id = ? ORDER BY o.created_at`,
    user.orgId, c.id,
  );
  const timeline = all<{ id: number; type: string; entity_type: string | null; entity_id: number | null; actor: string | null; summary: string; created_at: string }>(
    "SELECT * FROM activity WHERE org_id = ? AND entity_type = 'case' AND entity_id = ? ORDER BY created_at, id",
    user.orgId, c.id,
  );
  const offeredIds = new Set(offers.filter((o) => o.status !== "withdrawn").map((o) => o.employee_id));
  const ranking = isOpen ? rankForShift(user.orgId, c.shift_id, c.original_employee_id ? [c.original_employee_id] : []) : null;
  const tradeoff = ranking ? tradeoffSummary(ranking.ranked) : null;
  const resolvedPhone = c.resolved_employee_id ? get<{ phone: string | null }>("SELECT phone FROM employees WHERE id = ?", c.resolved_employee_id)?.phone ?? null : null;
  const minutesToCover = c.resolved_at ? Math.max(1, Math.round((Date.parse(c.resolved_at + "Z") - Date.parse(c.created_at + "Z")) / 60000)) : null;

  const clientId = get<{ client_id: number }>("SELECT client_id FROM locations WHERE id = ?", c.location_id)?.client_id;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link href="/coberturas" className="eyebrow -ml-1 mb-2 inline-flex min-h-8 items-center gap-1 px-1 hover:text-picon">
          <span aria-hidden>←</span> Coberturas
        </Link>
        {/* The case as a departures-board line: when · where · state. */}
        <div className="tablero grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:px-6 sm:py-5">
          <div className="num flex items-baseline gap-3 sm:block">
            <div className="text-[2rem] leading-none font-bold text-cal-claro sm:text-[2.5rem]">{c.start}<span className="text-cal/45">–{c.end}</span></div>
            <div className="cond text-sm font-bold tracking-[0.1em] text-cal/70 uppercase sm:mt-1.5">{formatDateRelative(c.date, today)}</div>
          </div>
          <div className="min-w-0 sm:border-l sm:border-cal/15 sm:pl-6">
            <h1 className="cond text-[1.625rem] leading-[1.1] font-[750] text-balance text-cal-claro sm:text-[2rem]">{c.location_name}</h1>
            <div className="mt-1 text-[0.9375rem] text-cal/75">{c.title} · {c.client_name}</div>
          </div>
          <StatusBadge map={CASE_STATUS} status={c.status} onDark className="text-base! tracking-[0.02em] sm:justify-self-end [&>svg]:size-3.5" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-10 lg:col-span-2">
          {c.status === "covered" && c.resolved_name && (
            <section className="border-l-4 border-mar bg-cal-claro px-4 py-4 sm:px-5">
              <div className="flex items-center gap-2 text-mar">
                <Glyph kind="check" className="size-4" />
                <span className="cond text-xl font-bold">Cubierto por {c.resolved_name}</span>
              </div>
              <p className="mt-1 text-sm text-picon-2">
                Planificación actualizada{minutesToCover ? <> · resuelto en <span className="num font-semibold">{minutesToCover} min</span></> : null}.
              </p>
              {(() => {
                const text = confirmationMessage({ employeeName: c.resolved_name, date: c.date, start: c.start, end: c.end, locationName: c.location_name, accessNotes: c.access_notes });
                const wa = whatsappLink(resolvedPhone, text);
                return (
                  <div className="mt-4">
                    <div className="label">Mensaje de confirmación</div>
                    <p className="voz border border-linea bg-cal px-4 py-3 whitespace-pre-line text-picon">{text}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-whatsapp"><MessageCircle className="size-4" /> WhatsApp</a>}
                      <CopyButton text={text} />
                    </div>
                  </div>
                );
              })()}
            </section>
          )}

          {offers.length > 0 && (
            <section>
              <SectionHead title="Propuestas enviadas" />
              <ul className="divide-y divide-linea-suave">
                {offers.map((o) => {
                  const wa = whatsappLink(o.phone, o.message);
                  return (
                    <li key={o.id} className="flex flex-col gap-3 py-4">
                      <div className="flex items-center gap-3">
                        <Initials name={o.name} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[0.9375rem] font-semibold">{o.name}</div>
                          <div className="num text-[0.8125rem] text-picon-3">
                            Enviada {formatTimestamp(o.created_at)}
                            {o.responded_at ? ` · respondió ${formatTimestamp(o.responded_at)}` : ""}
                          </div>
                        </div>
                        <StatusBadge map={OFFER_STATUS} status={o.status} />
                      </div>
                      {o.status === "pending" && (
                        <div className="flex flex-wrap gap-2 sm:pl-11">
                          {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-whatsapp"><MessageCircle className="size-4" /> Enviar por WhatsApp</a>}
                          <CopyButton text={o.message} label="Copiar mensaje" />
                          <a href={`/r/${o.token}`} target="_blank" rel="noreferrer" className="btn-ghost" title="Lo que verá la persona en su móvil">
                            <ExternalLink className="size-4" /> Ver enlace
                          </a>
                          <form action={respondOnBehalfAction} className="contents">
                            <input type="hidden" name="offerId" value={o.id} />
                            <SubmitButton className="btn-secondary" name="answer" value="yes">Ha aceptado</SubmitButton>
                            <SubmitButton className="btn-secondary" name="answer" value="no">No puede</SubmitButton>
                          </form>
                          <form action={withdrawOfferAction}>
                            <input type="hidden" name="offerId" value={o.id} />
                            <SubmitButton className="btn-ghost text-picon-3">Retirar</SubmitButton>
                          </form>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {ranking && (
            <section>
              <SectionHead
                title="Mejores opciones para cubrirlo"
                aside={<span className="num">{ranking.ranked.length} disponibles · {ranking.excluded.length} descartadas</span>}
              />
              {tradeoff && (
                <aside className="mt-4 border-l-[3px] border-picon py-0.5 pl-4">
                  <div className="eyebrow">A tener en cuenta</div>
                  <p className="voz mt-0.5 text-picon-2 italic">{tradeoff}</p>
                </aside>
              )}
              {ranking.ranked.length === 0 ? (
                <p className="mt-4 text-[0.9375rem] text-picon-2">
                  Nadie cumple las condiciones (disponibilidad, cualificación, horario). Revisa las descartadas o habla con el cliente.
                </p>
              ) : (
                <ol className="mt-4 flex flex-col">
                  {ranking.ranked.slice(0, 5).map((r, i) => (
                    <CandidateCard key={r.employeeId} r={r} rank={i + 1} caseId={c.id} offered={offeredIds.has(r.employeeId)} />
                  ))}
                </ol>
              )}
              {ranking.ranked.length > 5 && (
                <details className="group mt-2 border-t border-linea">
                  <summary className="flex min-h-12 cursor-pointer items-center gap-2 text-[0.9375rem] font-semibold text-picon-2 hover:text-picon">
                    <span className="num inline-block w-4 text-center group-open:hidden">+</span>
                    <span className="num hidden w-4 text-center group-open:inline-block">−</span>
                    Ver {ranking.ranked.length - 5} opciones más
                  </summary>
                  <ol className="flex flex-col">
                    {ranking.ranked.slice(5).map((r, i) => (
                      <CandidateCard key={r.employeeId} r={r} rank={i + 6} caseId={c.id} offered={offeredIds.has(r.employeeId)} />
                    ))}
                  </ol>
                </details>
              )}
              {ranking.excluded.length > 0 && (
                <details className="group border-t border-linea">
                  <summary className="flex min-h-12 cursor-pointer items-center gap-2 text-[0.9375rem] font-semibold text-picon-2 hover:text-picon">
                    <span className="num inline-block w-4 text-center group-open:hidden">+</span>
                    <span className="num hidden w-4 text-center group-open:inline-block">−</span>
                    Por qué se descartan {ranking.excluded.length} personas
                  </summary>
                  <ul className="mb-2 divide-y divide-linea-suave border-t border-linea-suave text-sm">
                    {ranking.excluded.map((e) => (
                      <li key={e.employeeId} className="grid gap-x-4 py-2 sm:grid-cols-[13rem_1fr]">
                        <span className="font-medium text-picon">{e.name}</span>
                        <span className="text-picon-3">{e.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-8">
          <section>
            <SectionHead title="Detalles" />
            <dl className="divide-y divide-linea-suave text-sm">
              <Row label="Persona ausente">{c.original_name ?? "—"}</Row>
              {absence && <Row label="Motivo">{REASON_LABELS[absence.reason_category]}{absence.reason ? ` · ${absence.reason}` : ""}</Row>}
              <Row label="Centro"><Link className="link" href={`/clientes/${clientId}`}>{c.location_name}</Link></Row>
              {c.address && <Row label="Dirección">{c.address}</Row>}
              {c.access_notes && <Row label="Acceso">{c.access_notes}</Row>}
            </dl>
            {absence?.raw_message && (
              <figure className="mt-4">
                <figcaption className="label">Mensaje original</figcaption>
                <blockquote className="voz border-l-[3px] border-linea-fuerte pl-3 text-picon-2 italic">«{absence.raw_message}»</blockquote>
              </figure>
            )}
          </section>

          {isOpen && (
            <section>
              <SectionHead title="¿No se puede cubrir?" />
              <form action={closeCaseAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="caseId" value={c.id} />
                <label htmlFor="close-note" className="sr-only">Nota</label>
                <input id="close-note" name="note" placeholder="Nota (opcional): p. ej. «cliente avisado»" className="input" />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton className="btn-secondary" name="outcome" value="cancelled">Anulado con el cliente</SubmitButton>
                  <SubmitButton className="btn-danger" name="outcome" value="unresolved">Sin cobertura</SubmitButton>
                </div>
              </form>
            </section>
          )}

          <section>
            <SectionHead title="Historial" className="mb-1" />
            <ActivityList items={timeline} linkEntities={false} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2">
      <dt className="text-picon-3">{label}</dt>
      <dd className="min-w-0 text-picon">{children}</dd>
    </div>
  );
}

const FACTOR_LABELS: Record<keyof typeof WEIGHTS, string> = {
  proximity: "Cercanía",
  hours: "Horas",
  familiarity: "Centro",
  fairness: "Reparto",
  fit: "Encaje",
};

function CandidateCard({ r, rank, caseId, offered }: { r: RankedCandidate; rank: number; caseId: number; offered: boolean }) {
  const top = rank === 1;
  return (
    <li
      className={`grid grid-cols-[2.25rem_1fr] gap-x-3 sm:grid-cols-[3rem_1fr_auto] sm:gap-x-5 ${
        top ? "mb-3 border-2 border-picon bg-cal-claro px-3 py-4 sm:px-5 sm:py-5" : "border-b border-linea px-3 py-5 sm:px-5"
      }`}
    >
      <div aria-label={`Opción ${rank}`} className={`num cond-x text-[2.5rem] leading-[0.85] font-[800] sm:text-[3.25rem] ${top ? "text-picon" : "text-picon-4"}`}>
        {rank}
      </div>

      <div className="min-w-0">
        {top && <div className="eyebrow mb-1 !text-mar">Recomendada</div>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={`/personal/${r.employeeId}`} className="text-lg leading-tight font-bold text-picon hover:underline">{r.name}</Link>
          {r.overtimeHours > 0 && <Badge tone="red">+{String(r.overtimeHours).replace(".", ",")} h extra</Badge>}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num text-[0.9375rem] font-bold">
            {r.score}<span className="font-normal text-picon-3">/100</span>
          </span>
          <Meter value={r.score} />
        </div>

        {/* The expert's notes: plain sentences, marked + / − / · in the margin. */}
        <ul className="mt-3 flex flex-col gap-1">
          {r.reasons.map((reason) => (
            <li key={reason.text} className="grid grid-cols-[1rem_1fr] gap-x-1.5">
              <span
                aria-label={reason.kind === "pro" ? "A favor" : reason.kind === "con" ? "En contra" : "Dato"}
                className={`num relative -top-[3px] text-center text-[1.0625rem] leading-[1.45] font-bold ${
                  reason.kind === "pro" ? "text-mar" : reason.kind === "con" ? "text-almagre" : "text-picon-4"
                }`}
              >
                {reason.kind === "pro" ? "+" : reason.kind === "con" ? "−" : "·"}
              </span>
              <span className="voz text-picon-2">{reason.text}</span>
            </li>
          ))}
        </ul>

        <dl className="cond mt-3 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-picon-3" title="Puntos de cada criterio sobre su peso máximo">
          {(Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => (
            <div key={k} className="flex gap-1">
              <dt>{FACTOR_LABELS[k]}</dt>
              <dd className="num font-semibold text-picon-2">{Math.round(r.factors[k] * WEIGHTS[k])}/{WEIGHTS[k]}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="col-span-2 mt-4 grid grid-cols-2 gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:mt-0 sm:flex sm:min-w-44 sm:flex-col">
        <form action={offerAction} className="contents">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="employeeId" value={r.employeeId} />
          <input type="hidden" name="score" value={r.score} />
          <SubmitButton className={offered ? "btn-secondary" : top ? "btn-primary" : "btn-secondary"} pendingText="Preparando…">
            {offered ? "Propuesta enviada" : "Proponer"}
          </SubmitButton>
        </form>
        <form action={assignAction} className="contents">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="employeeId" value={r.employeeId} />
          <SubmitButton className="btn-ghost" title="Ya lo has hablado por teléfono">
            Asignar directamente
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}
