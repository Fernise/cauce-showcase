import { run } from "./db.ts";

export type EntityType = "absence" | "case" | "offer" | "shift" | "incident" | "employee" | "client" | "org" | "user";

export function logActivity(
  orgId: number,
  type: string,
  summary: string,
  entity?: { type: EntityType; id: number },
  actor?: string,
): void {
  run(
    "INSERT INTO activity (org_id, type, entity_type, entity_id, actor, summary) VALUES (?, ?, ?, ?, ?, ?)",
    orgId,
    type,
    entity?.type ?? null,
    entity?.id ?? null,
    actor ?? null,
    summary,
  );
}
