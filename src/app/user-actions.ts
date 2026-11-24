"use server";

// Team management and password actions (T-012). Authorization lives in src/lib/users.ts (re-checked in the DB);
// requireUser() only identifies the caller. Errors come back as Spanish messages, never as stack traces.

import { orgTimezone } from "@/lib/queries.ts";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/auth.ts";
import { requireUser } from "@/lib/session.ts";
import { baseUrl } from "@/lib/messages.ts";
import {
  UserError, acceptInvite, changePassword, completeReset, createInvite, createResetLink, deactivateUser,
  reactivateUser, revokeToken, setRole,
} from "@/lib/users.ts";

export type TeamResult = {
  error?: string;
  ok?: string;
  /** One-time link, shown once to the admin who generated it. */
  link?: { url: string; whatsapp: string; label: string; expires: string };
} | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const raw = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const refresh = () => revalidatePath("/ajustes");

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return baseUrl(host ? `${proto}://${host}` : null);
}

async function guarded(work: () => Promise<TeamResult> | TeamResult): Promise<TeamResult> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

const whatsapp = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
const dateEs = (iso: string, tz: string) => new Date(iso).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: tz });

// ---------- Admin: team ----------

export async function inviteAction(_prev: TeamResult, fd: FormData): Promise<TeamResult> {
  const user = await requireUser();
  return guarded(async () => {
    const inv = createInvite(user, { email: str(fd, "email"), name: str(fd, "name"), role: str(fd, "role") || "coordinator" });
    const url = `${await origin()}/invitacion/${inv.token}`;
    refresh();
    return {
      ok: `Invitación creada para ${inv.email}. Cópiala ahora: no se puede volver a mostrar.`,
      link: {
        url, label: "Enlace de invitación", expires: dateEs(inv.expiresAt, orgTimezone(user.orgId)),
        whatsapp: whatsapp(`Hola, te invito a Cauce (${user.orgName}). Crea tu acceso aquí (válido 7 días): ${url}`),
      },
    };
  });
}

export async function revokeInviteAction(_prev: TeamResult, fd: FormData): Promise<TeamResult> {
  const user = await requireUser();
  return guarded(() => { revokeToken(user, Number(fd.get("id"))); refresh(); return { ok: "Invitación cancelada." }; });
}

export async function setRoleAction(_prev: TeamResult, fd: FormData): Promise<TeamResult> {
  const user = await requireUser();
  return guarded(() => { setRole(user, Number(fd.get("userId")), str(fd, "role")); refresh(); return { ok: "Rol actualizado." }; });
}

export async function deactivateAction(_prev: TeamResult, fd: FormData): Promise<TeamResult> {
  const user = await requireUser();
  return guarded(() => { deactivateUser(user, Number(fd.get("userId"))); refresh(); return { ok: "Acceso retirado." }; });
}

export async function reactivateAction(_prev: TeamResult, fd: FormData): Promise<TeamResult> {
  const user = await requireUser();
  return guarded(() => { reactivateUser(user, Number(fd.get("userId"))); refresh(); return { ok: "Acceso restaurado." }; });
}

export async function resetLinkAction(_prev: TeamResult, fd: FormData): Promise<TeamResult> {
  const user = await requireUser();
  return guarded(async () => {
    const r = createResetLink(user, Number(fd.get("userId")));
    const url = `${await origin()}/restablecer/${r.token}`;
    return {
      ok: `Enlace para ${r.userName}. Cópialo ahora: no se puede volver a mostrar.`,
      link: {
        url, label: "Enlace de restablecimiento", expires: dateEs(r.expiresAt, orgTimezone(user.orgId)),
        whatsapp: whatsapp(`Hola ${r.userName.split(" ")[0]}, aquí puedes crear una contraseña nueva para Cauce (válido 24 h): ${url}`),
      },
    };
  });
}

// ---------- Own account ----------

export async function changePasswordAction(_prev: TeamResult, fd: FormData): Promise<TeamResult> {
  const user = await requireUser();
  if (raw(fd, "next") !== raw(fd, "repeat")) return { error: "Las contraseñas nuevas no coinciden." };
  const keep = (await cookies()).get(SESSION_COOKIE)?.value;
  return guarded(async () => {
    await changePassword(user, { current: raw(fd, "current"), next: raw(fd, "next"), keepSessionToken: keep });
    return { ok: "Contraseña cambiada. Se ha cerrado la sesión en tus otros dispositivos." };
  });
}

// ---------- Public: invite and reset pages (the link is the credential) ----------

export async function acceptInviteAction(_prev: TeamResult, fd: FormData): Promise<TeamResult> {
  if (raw(fd, "password") !== raw(fd, "repeat")) return { error: "Las contraseñas no coinciden." };
  const result = await guarded(async () => {
    const done = acceptInvite(str(fd, "token"), { name: str(fd, "name"), password: raw(fd, "password") });
    (await cookies()).set(SESSION_COOKIE, done.session.token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: done.session.expires, path: "/",
    });
    return { ok: "ok" };
  });
  if (result?.error) return result;
  redirect("/");
}

export async function completeResetAction(_prev: TeamResult, fd: FormData): Promise<TeamResult> {
  if (raw(fd, "password") !== raw(fd, "repeat")) return { error: "Las contraseñas no coinciden." };
  const result = await guarded(() => { completeReset(str(fd, "token"), raw(fd, "password")); return { ok: "ok" }; });
  if (result?.error) return result;
  redirect("/login?restablecida=1");
}
