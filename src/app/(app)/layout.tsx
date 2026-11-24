import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/session.ts";
import { navBadges } from "@/lib/queries.ts";
import { roleLabel } from "@/lib/users.ts";
import { logoutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <Shell userName={user.name} userRole={roleLabel(user.role)} orgName={user.orgName} badges={navBadges(user.orgId)} logoutAction={logoutAction}>
      {children}
    </Shell>
  );
}
