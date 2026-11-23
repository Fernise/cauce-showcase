"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" defaultValue="demo@cauce.app" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
      </div>
      {error && <p className="text-sm font-medium text-almagre" role="alert">{error}</p>}
      <button className="btn-primary mt-1" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
