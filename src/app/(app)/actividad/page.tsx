import Link from "next/link";
import { requireUser } from "@/lib/session.ts";
import { recentActivity } from "@/lib/queries.ts";
import { ActivityList } from "@/components/activity-list";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Actividad" };

const PAGE = 50;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const user = await requireUser();
  const page = Math.max(0, Number((await searchParams).p) || 0);
  const items = recentActivity(user.orgId, PAGE + 1, page * PAGE);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Actividad" subtitle="Todo lo que ha pasado en la operación, en orden." />
      <div className="card p-5">
        <ActivityList items={items.slice(0, PAGE)} />
      </div>
      <div className="mt-4 flex justify-between">
        {page > 0 ? <Link className="btn-secondary" href={`/actividad?p=${page - 1}`}>← Más recientes</Link> : <span />}
        {items.length > PAGE && <Link className="btn-secondary" href={`/actividad?p=${page + 1}`}>Anteriores →</Link>}
      </div>
    </div>
  );
}
