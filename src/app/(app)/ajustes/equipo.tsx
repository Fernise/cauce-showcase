import { listPendingInvites, listTeam, roleLabel } from "@/lib/users.ts";
import { formatDateShort, todayIn } from "@/lib/dates.ts";
import { orgTimezone } from "@/lib/queries.ts";
import { StatusBadge, type CASE_STATUS } from "@/components/ui";
import {
  DeactivateButton, InviteForm, ReactivateButton, ResetLinkButton, RevokeInviteButton, RoleSelect,
} from "./team-forms";

const USER_STATUS: typeof CASE_STATUS = {
  active: { label: "Con acceso", tone: "green", glyph: "check" },
  inactive: { label: "Sin acceso", tone: "slate", glyph: "hollow" },
};

const lastLogin = (iso: string | null, tz: string) => (iso ? formatDateShort(todayIn(tz, new Date(iso))) : "Aún no ha entrado");

/** Admin-only section; the page renders it only for admins and listTeam() re-checks in the DB. */
export function Equipo({ user }: { user: { id: number; orgId: number } }) {
  const tz = orgTimezone(user.orgId);
  const team = listTeam(user);
  const invites = listPendingInvites(user);
  const activeAdmins = team.filter((m) => m.active && m.role === "admin").length;
  return (
    <section id="equipo" className="card p-5">
      <h2 className="h-section mb-1">Equipo</h2>
      <p className="mb-4 text-sm text-picon-3">
        Administración gestiona accesos; coordinación hace todo lo operativo. Sin correo: tú generas el enlace y lo envías por WhatsApp.
      </p>

      <ul className="-mx-5 divide-y divide-linea border-y border-linea">
        {team.map((m) => (
          <li key={m.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-picon">{m.name}{m.id === user.id ? " (tú)" : ""}</span>
                <StatusBadge map={USER_STATUS} status={m.active ? "active" : "inactive"} />
              </div>
              <div className="truncate text-sm text-picon-3">{m.email}</div>
              <div className="text-xs text-picon-3">{roleLabel(m.role)} · Último acceso: {lastLogin(m.lastLoginAt, tz)}</div>
            </div>
            <div className="flex flex-col gap-2 sm:w-64 sm:shrink-0">
              {m.active ? (
                <>
                  <RoleSelect userId={m.id} role={m.role} label={m.name} />
                  <ResetLinkButton userId={m.id} name={m.name} />
                  {!(m.role === "admin" && activeAdmins <= 1) && <DeactivateButton userId={m.id} name={m.name} />}
                </>
              ) : (
                <ReactivateButton userId={m.id} />
              )}
            </div>
          </li>
        ))}
      </ul>

      {invites.length > 0 && (
        <div className="mt-5">
          <h3 className="eyebrow mb-2">Invitaciones pendientes</h3>
          <ul className="divide-y divide-linea border-y border-linea">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 text-sm">
                  <div className="truncate font-medium text-picon">{i.email}</div>
                  <div className="text-xs text-picon-3">{roleLabel(i.role)} · caduca el {formatDateShort(i.expiresAt.slice(0, 10))}</div>
                </div>
                <RevokeInviteButton id={i.id} email={i.email} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 border-t border-linea pt-5">
        <h3 className="eyebrow mb-3">Invitar coordinador/a</h3>
        <InviteForm />
      </div>
    </section>
  );
}
