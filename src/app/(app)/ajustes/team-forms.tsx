"use client";

// Interactive pieces of the Equipo / Mi cuenta sections (T-012). All server actions return a TeamResult,
// so errors ("debe quedar al menos un administrador") show next to the control instead of crashing the page.

import { useActionState, useRef } from "react";
import { MessageCircle } from "lucide-react";
import { CopyButton } from "@/components/client";
import type { TeamResult } from "@/app/user-actions";
import {
  changePasswordAction, inviteAction, resetLinkAction, revokeInviteAction, setRoleAction,
  deactivateAction, reactivateAction,
} from "@/app/user-actions";

type Action = (prev: TeamResult, fd: FormData) => Promise<TeamResult>;

function Feedback({ state }: { state: TeamResult }) {
  if (!state) return null;
  return (
    <>
      {state.error && <p className="text-sm font-medium text-almagre" role="alert">{state.error}</p>}
      {state.ok && <p className="text-sm font-medium text-mar" role="status">{state.ok}</p>}
      {state.link && (
        <div className="flex flex-col gap-2 border border-linea-fuerte bg-cal-hondo/50 p-3">
          <label className="label mb-0" htmlFor="one-time-link">{state.link.label}</label>
          <input id="one-time-link" readOnly value={state.link.url} className="input num text-xs" onFocus={(e) => e.currentTarget.select()} />
          <p className="text-xs text-picon-3">Un solo uso · caduca el {state.link.expires}</p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={state.link.url} label="Copiar enlace" />
            <a href={state.link.whatsapp} target="_blank" rel="noreferrer" className="btn-whatsapp">
              <MessageCircle className="size-4" /> Enviar por WhatsApp
            </a>
          </div>
        </div>
      )}
    </>
  );
}

/** A small form with hidden fields and a single button; shows the server's answer underneath. */
function ActionForm({
  action, fields, label, pendingLabel, className = "btn-secondary", confirmText,
}: { action: Action; fields: Record<string, string | number>; label: string; pendingLabel: string; className?: string; confirmText?: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      onSubmit={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }}
    >
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div><button className={className} disabled={pending}>{pending ? pendingLabel : label}</button></div>
      <Feedback state={state} />
    </form>
  );
}

export function ResetLinkButton({ userId, name }: { userId: number; name: string }) {
  return (
    <ActionForm
      action={resetLinkAction} fields={{ userId }} label="Enlace de contraseña" pendingLabel="Generando…"
      confirmText={`¿Generar un enlace para que ${name} cree una contraseña nueva?`}
    />
  );
}

export function DeactivateButton({ userId, name }: { userId: number; name: string }) {
  return (
    <ActionForm
      action={deactivateAction} fields={{ userId }} label="Quitar acceso" pendingLabel="Quitando…" className="btn-danger"
      confirmText={`¿Quitar el acceso a ${name}? Se cerrarán sus sesiones.`}
    />
  );
}

export function ReactivateButton({ userId }: { userId: number }) {
  return <ActionForm action={reactivateAction} fields={{ userId }} label="Restaurar acceso" pendingLabel="Restaurando…" />;
}

export function RevokeInviteButton({ id, email }: { id: number; email: string }) {
  return (
    <ActionForm
      action={revokeInviteAction} fields={{ id }} label="Cancelar" pendingLabel="Cancelando…" className="btn-ghost"
      confirmText={`¿Cancelar la invitación a ${email}?`}
    />
  );
}

export function RoleSelect({ userId, role, label }: { userId: number; role: string; label: string }) {
  const [state, formAction, pending] = useActionState(setRoleAction, null);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <label className="sr-only" htmlFor={`role-${userId}`}>Rol de {label}</label>
      <select
        id={`role-${userId}`} name="role" defaultValue={role} disabled={pending} className="input"
        onChange={() => form.current?.requestSubmit()}
      >
        <option value="coordinator">Coordinación</option>
        <option value="admin">Administración</option>
      </select>
      <Feedback state={state} />
    </form>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="inv-email">Email de la persona</label>
        <input id="inv-email" name="email" type="email" required autoComplete="off" className="input" placeholder="nombre@empresa.es" />
      </div>
      <div>
        <label className="label" htmlFor="inv-name">Nombre (opcional)</label>
        <input id="inv-name" name="name" autoComplete="off" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="inv-role">Rol</label>
        <select id="inv-role" name="role" defaultValue="coordinator" className="input">
          <option value="coordinator">Coordinación</option>
          <option value="admin">Administración</option>
        </select>
      </div>
      <div className="flex items-end sm:justify-end">
        <button className="btn-primary" disabled={pending}>{pending ? "Creando…" : "Crear enlace de invitación"}</button>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2"><Feedback state={state} /></div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <div>
        <label className="label" htmlFor="pw-current">Contraseña actual</label>
        <input id="pw-current" name="current" type="password" required autoComplete="current-password" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="pw-next">Nueva (mín. 10 caracteres)</label>
        <input id="pw-next" name="next" type="password" required minLength={10} autoComplete="new-password" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="pw-repeat">Repite la nueva</label>
        <input id="pw-repeat" name="repeat" type="password" required minLength={10} autoComplete="new-password" className="input" />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-3">
        <Feedback state={state} />
        <div className="flex justify-end"><button className="btn-primary" disabled={pending}>{pending ? "Guardando…" : "Cambiar contraseña"}</button></div>
      </div>
    </form>
  );
}
