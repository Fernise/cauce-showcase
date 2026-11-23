import Link from "next/link";
import { formatTimestamp } from "@/lib/dates.ts";
import { entityHref } from "@/lib/queries.ts";
import { Glyph, type GlyphKind } from "./ui";

type Item = { id: number; type: string; entity_type: string | null; entity_id: number | null; actor: string | null; summary: string; created_at: string };

// Same shape language as statuses: a gap opens (solid), someone is asked (half), it flows again (check).
const MARKS: Record<string, { glyph: GlyphKind; color: string }> = {
  "absence.created": { glyph: "hollow", color: "text-picon-3" },
  "case.opened": { glyph: "solid", color: "text-almagre" },
  "offer.sent": { glyph: "half", color: "text-azufre" },
  "offer.accepted": { glyph: "check", color: "text-mar" },
  "offer.declined": { glyph: "cross", color: "text-almagre" },
  "offer.withdrawn": { glyph: "hollow", color: "text-picon-4" },
  "case.covered": { glyph: "check", color: "text-mar" },
  "incident.created": { glyph: "bars2", color: "text-almagre" },
  "incident.resuelta": { glyph: "check", color: "text-mar" },
  "incident.note": { glyph: "hollow", color: "text-picon-4" },
};

export function ActivityList({ items, linkEntities = true }: { items: Item[]; linkEntities?: boolean }) {
  if (!items.length) return <p className="text-sm text-picon-3">Sin actividad todavía.</p>;
  return (
    <ol className="flex flex-col">
      {items.map((a) => {
        const { glyph, color } = MARKS[a.type] ?? { glyph: "hollow" as GlyphKind, color: "text-picon-4" };
        const href = linkEntities ? entityHref(a.entity_type, a.entity_id) : null;
        const body = (
          <>
            <span className="text-picon">{a.summary}</span>
            <span className="num mt-0.5 block text-[0.8125rem] text-picon-3">
              {formatTimestamp(a.created_at)}
              {a.actor ? ` · ${a.actor}` : ""}
            </span>
          </>
        );
        return (
          <li key={a.id} className="grid grid-cols-[1rem_1fr] gap-x-3 border-b border-linea-suave py-2.5 text-sm last:border-b-0">
            <span className={`flex h-5 items-center ${color}`}>
              <Glyph kind={glyph} />
            </span>
            {href ? (
              <Link href={href} className="min-w-0 hover:[&>span:first-child]:underline">{body}</Link>
            ) : (
              <div className="min-w-0">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
