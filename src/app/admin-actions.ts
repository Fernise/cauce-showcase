"use server";

// Create/edit actions for employees, clients, locations and recurring services (T-013).
// Every action: requireUser → org-scoped checks in src/lib → activity event → revalidate → redirect.

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session.ts";
import type { SessionUser } from "@/lib/auth.ts";
import { orgSettings } from "@/lib/coverage.ts";
import { nowTimeIn, todayIn } from "@/lib/dates.ts";
import { SKILLS } from "@/lib/skills.ts";
import {
  createClient, createEmployee, createLocation, parseClientForm, parseEmployeeForm, parseLocationForm, setEmployeeActive,
  updateClient, updateEmployee, updateLocation,
} from "@/lib/admin.ts";
import {
  createTemplate, parseTemplateForm, parseWeekdays, removeTemplate, templateFit, updateTemplate, type Clock,
} from "@/lib/services.ts";
import { idField, NotFoundError, rawValues, text, ValidationError, type FormState } from "@/lib/validation.ts";

const refresh = () => revalidatePath("/", "layout");

function clockFor(orgId: number): Clock {
  const tz = orgSettings(orgId).timezone;
  return { today: todayIn(tz), time: nowTimeIn(tz) };
}

/** Empty field = create (null); a present but malformed id is treated as not found. */
function optionalId(fd: FormData, key: string): number | null {
  if (!text(fd, key)) return null;
  const id = idField(fd, key);
  if (!id) throw new NotFoundError();
  return id;
}

function requiredId(fd: FormData, key: string): number {
  const id = optionalId(fd, key);
  if (!id) throw new NotFoundError();
  return id;
}

/** Runs the mutation; validation / not-found errors come back as form state, anything else propagates. */
async function submit(fd: FormData, work: (user: SessionUser) => string): Promise<FormState> {
  const user = await requireUser();
  let target: string;
  try {
    target = work(user);
  } catch (e) {
    if (e instanceof ValidationError) return { errors: e.errors, values: rawValues(fd) };
    if (e instanceof NotFoundError) return { errors: [e.message], values: rawValues(fd) };
    throw e;
  }
  refresh();
  redirect(target);
}

// ---------- Employees ----------

export async function saveEmployeeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return submit(fd, (user) => {
    const id = optionalId(fd, "id");
    const input = parseEmployeeForm(fd);
    if (id) {
      updateEmployee(user.orgId, id, input, user.name);
      return `/personal/${id}`;
    }
    return `/personal/${createEmployee(user.orgId, input, user.name)}`;
  });
}

export async function setEmployeeActiveAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  try {
    setEmployeeActive(user.orgId, requiredId(fd, "id"), text(fd, "active") === "1", user.name);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  refresh();
}

// ---------- Clients & locations ----------

export async function saveClientAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return submit(fd, (user) => {
    const id = optionalId(fd, "id");
    const input = parseClientForm(fd);
    if (id) {
      updateClient(user.orgId, id, input, user.name);
      return `/clientes/${id}`;
    }
    return `/clientes/${createClient(user.orgId, input, user.name)}`;
  });
}

export async function saveLocationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return submit(fd, (user) => {
    const id = optionalId(fd, "id");
    const input = parseLocationForm(fd);
    if (id) return `/clientes/${updateLocation(user.orgId, id, input, user.name)}`;
    const clientId = requiredId(fd, "clientId");
    createLocation(user.orgId, clientId, input, user.name);
    return `/clientes/${clientId}`;
  });
}

// ---------- Recurring services ----------

export async function saveTemplateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return submit(fd, (user) => {
    const id = optionalId(fd, "id");
    const input = parseTemplateForm(fd);
    const clock = clockFor(user.orgId);
    const edit = (clientId: number, locationId: number, templateId: number, g: { created: number; updated: number; cancelled: number }) =>
      `/clientes/${clientId}/centros/${locationId}/servicios/${templateId}/editar?ok=${g.created}.${g.updated}.${g.cancelled}`;
    if (id) {
      const r = updateTemplate(user.orgId, id, input, user.name, clock);
      return edit(r.clientId, r.locationId, id, r.generation);
    }
    const locationId = requiredId(fd, "locationId");
    const r = createTemplate(user.orgId, locationId, input, user.name, clock);
    return edit(r.clientId, locationId, r.id, r.generation);
  });
}

export async function deleteTemplateAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  let clientId: number;
  try {
    clientId = removeTemplate(user.orgId, requiredId(fd, "id"), user.name, clockFor(user.orgId)).clientId;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  refresh();
  redirect(`/clientes/${clientId}`);
}

/** Live (non-blocking) warnings shown under the "titular" select while editing a service. */
export async function checkTemplateFitAction(fd: FormData): Promise<string[]> {
  const user = await requireUser();
  const employeeId = idField(fd, "defaultEmployeeId");
  const locationId = idField(fd, "locationId");
  if (!employeeId || !locationId) return [];
  return templateFit(user.orgId, {
    employeeId, locationId, weekdays: parseWeekdays(fd), start: text(fd, "start"), end: text(fd, "end"),
    skills: fd.getAll("skills").map(String).filter((s) => s in SKILLS), excludeTemplateId: idField(fd, "id"),
  });
}
