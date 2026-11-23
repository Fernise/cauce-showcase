"use client";

import { useActionState } from "react";
import { employeeResponseAction, type EmployeeResponseState } from "@/app/actions";
import { Glyph } from "@/components/ui";

function Outcome({ glyph, tone, title, children }: { glyph: "check" | "cross" | "hollow"; tone: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" role="status">
      <div className={`flex items-center gap-2.5 ${tone}`}>
        <Glyph kind={glyph} className="size-6" />
        <div className="cond text-[1.375rem] leading-tight font-bold text-picon">{title}</div>
      </div>
      {children}
    </div>
  );
}

export function ResponseButtons({ token, initial }: { token: string; initial: EmployeeResponseState }) {
  const [state, action, pending] = useActionState(employeeResponseAction, initial);
  const result = state?.result ?? null;
  const accessNotes = state?.accessNotes ?? null;

  if (result === "accepted") {
    return (
      <Outcome glyph="check" tone="text-mar" title="¡Gracias! Servicio confirmado.">
        <p className="text-base text-picon-2">Ya está en tu planificación.</p>
        {accessNotes && (
          <div className="mt-3 border-l-[3px] border-mar bg-mar-tinte/60 px-3 py-2.5">
            <div className="label !text-mar">Acceso</div>
            <p className="text-base text-picon">{accessNotes}</p>
          </div>
        )}
      </Outcome>
    );
  }
  if (result === "declined") {
    return (
      <Outcome glyph="cross" tone="text-picon-3" title="Entendido, gracias por responder.">
        <p className="text-base text-picon-2">Buscaremos a otra persona.</p>
      </Outcome>
    );
  }
  if (result === "already_answered") {
    return (
      <Outcome glyph="hollow" tone="text-picon-3" title="Ya habías respondido a esta propuesta.">
        <p className="text-base text-picon-2">Si quieres cambiar tu respuesta, habla con coordinación.</p>
      </Outcome>
    );
  }
  if (result === "expired") {
    return (
      <Outcome glyph="hollow" tone="text-picon-3" title="Este servicio ya ha empezado.">
        <p className="text-base text-picon-2">La propuesta ha caducado. ¡Gracias de todas formas!</p>
      </Outcome>
    );
  }
  if (result === "unavailable") {
    return (
      <Outcome glyph="cross" tone="text-almagre" title="Ahora mismo no encaja en tu planificación.">
        <p className="text-base text-picon-2">Ya no encaja con tus otros servicios u horas de esa semana. Coordinación buscará a otra persona.</p>
      </Outcome>
    );
  }
  if (result === "too_late" || result === "not_found") {
    return (
      <Outcome glyph="hollow" tone="text-picon-3" title="Este servicio ya está cubierto.">
        <p className="text-base text-picon-2">¡Gracias de todas formas!</p>
      </Outcome>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <input type="hidden" name="token" value={token} />
      <button name="answer" value="yes" disabled={pending} className="btn-primary min-h-14! text-lg!">Acepto</button>
      <button name="answer" value="no" disabled={pending} className="btn-secondary min-h-14! text-lg!">No puedo</button>
    </form>
  );
}
