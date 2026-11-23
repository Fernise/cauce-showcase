// Optional AI layer for message understanding. See docs/decisions.md D-003/D-004.
// Without ANTHROPIC_API_KEY (default) Cauce uses the deterministic rules parser — no cost.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parseMessageRules, type Directory, type ParsedMessage } from "./parse-message.ts";
import { isValidDate } from "./dates.ts";

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function aiModel(): string {
  return process.env.CAUCE_AI_MODEL || "claude-opus-5-5";
}

const Extraction = z.object({
  kind: z.enum(["absence", "incident", "unknown"]),
  employee_id: z.number().int().nullable(),
  employee_candidate_ids: z.array(z.number().int()),
  start_date: z.string().describe("YYYY-MM-DD"),
  end_date: z.string().describe("YYYY-MM-DD"),
  date_explicit: z.boolean(),
  reason: z.string().nullable(),
  reason_category: z.enum(["enfermedad", "familiar", "transporte", "personal", "otro"]),
  client_id: z.number().int().nullable(),
  location_id: z.number().int().nullable(),
  incident_type: z.enum(["no_realizado", "retraso", "calidad", "suministros", "cambio_servicio", "falta_personal", "otro"]).nullable(),
  severity: z.enum(["baja", "media", "alta"]),
  title: z.string().nullable(),
  warnings: z.array(z.string()),
});

const SYSTEM = `Eres el asistente de operaciones de una empresa de limpieza en Canarias.
Recibes un mensaje (normalmente de WhatsApp) reenviado por la coordinadora. Clasifícalo:
- "absence": una persona empleada avisa de que no podrá ir a trabajar.
- "incident": un cliente (o alguien) informa de un problema con un servicio.
- "unknown": ninguno de los dos.
Identifica a la persona empleada, cliente y centro SOLO con los IDs del directorio. Si un nombre
coincide con varias personas, deja employee_id en null y pon los IDs en employee_candidate_ids.
Resuelve fechas relativas ("mañana", "el jueves") respecto a la fecha de hoy. Si no hay fecha, usa hoy
y date_explicit=false. "reason" es una frase corta con el motivo tal como lo dice el mensaje.
"title" es un resumen de la incidencia en menos de 12 palabras. En "warnings" escribe, en español y
breve, cualquier dato que falte o sea contradictorio y que la coordinadora deba revisar.
No inventes datos.`;

export async function understandMessage(raw: string, dir: Directory, today: string): Promise<ParsedMessage> {
  const rules = parseMessageRules(raw, dir, today);
  if (!aiEnabled()) return rules;

  try {
    const client = new Anthropic();
    const directory = [
      "PERSONAL:", ...dir.employees.map((e) => `${e.id}: ${e.name}`),
      "CLIENTES:", ...dir.clients.map((c) => `${c.id}: ${c.name}`),
      "CENTROS:", ...dir.locations.map((l) => `${l.id}: ${l.name} (cliente ${l.clientId}, ${l.municipality ?? ""})`),
    ].join("\n");

    const response = await client.messages.parse({
      model: aiModel(),
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(Extraction) },
      system: [{ type: "text", text: SYSTEM }],
      messages: [
        {
          role: "user",
          content: `Directorio:\n${directory}\n\nHoy es ${today}.\n\nMensaje:\n"""${raw}"""`,
        },
      ],
    });

    const out = response.parsed_output;
    if (response.stop_reason === "refusal" || !out) return rules;

    const empIds = new Set(dir.employees.map((e) => e.id));
    const clientIds = new Set(dir.clients.map((c) => c.id));
    const locIds = new Set(dir.locations.map((l) => l.id));
    // Validate the pair together: if either date is invalid or reversed, fall back to the rules dates.
    const datesOk = isValidDate(out.start_date) && isValidDate(out.end_date) && out.end_date >= out.start_date;

    return {
      kind: out.kind,
      engine: "claude",
      employeeId: out.employee_id !== null && empIds.has(out.employee_id) ? out.employee_id : null,
      employeeCandidates: out.employee_candidate_ids.filter((id) => empIds.has(id)),
      startDate: datesOk ? out.start_date : rules.startDate,
      endDate: datesOk ? out.end_date : rules.endDate,
      dateExplicit: datesOk ? out.date_explicit : rules.dateExplicit,
      reason: out.reason,
      reasonCategory: out.reason_category,
      clientId: out.client_id !== null && clientIds.has(out.client_id) ? out.client_id : null,
      locationId: out.location_id !== null && locIds.has(out.location_id) ? out.location_id : null,
      incidentType: out.incident_type,
      severity: out.severity,
      title: out.title,
      warnings: out.warnings,
    };
  } catch (err) {
    // Network/auth/rate-limit errors must never block operations: fall back to rules.
    console.error("[cauce] AI extraction failed, using rules parser:", err instanceof Error ? err.message : err);
    return { ...rules, warnings: [...rules.warnings, "IA no disponible: interpretado con reglas."] };
  }
}
