"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/app/user-actions";

export function InviteAcceptForm({ token, nameHint }: { token: string; nameHint: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="name">Tu nombre</label>
        <input id="name" name="name" required autoComplete="name" defaultValue={nameHint} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña (mín. 10 caracteres)</label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="repeat">Repite la contraseña</label>
        <input id="repeat" name="repeat" type="password" required minLength={10} autoComplete="new-password" className="input" />
      </div>
      {state?.error && <p className="text-sm font-medium text-almagre" role="alert">{state.error}</p>}
      <button className="btn-primary mt-1" disabled={pending}>{pending ? "Creando…" : "Crear acceso y entrar"}</button>
    </form>
  );
}
