import { redirect } from "next/navigation";
import { getInvite } from "@/lib/users.ts";
import { currentUser } from "@/lib/session.ts";
import { AuthCard, LinkProblem } from "@/components/auth-card";
import { InviteAcceptForm } from "./form";

export const metadata = { title: "Invitación", robots: { index: false }, referrer: "no-referrer" as const };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = getInvite(token);
  if (invite.status === "ok" && (await currentUser())) redirect("/"); // already signed in: don't burn the invite by accident
  return (
    <AuthCard orgName={invite.orgName} title={invite.status === "ok" ? "Crea tu acceso" : "Invitación"}>
      {invite.status === "ok" ? (
        <>
          <p className="mb-5 text-[0.9375rem] text-picon-2">
            Te han invitado a <strong>{invite.orgName}</strong> en Cauce. Entrarás con <span className="num font-semibold">{invite.email}</span>.
          </p>
          <InviteAcceptForm token={token} nameHint={invite.nameHint ?? ""} />
        </>
      ) : (
        <LinkProblem status={invite.status} />
      )}
    </AuthCard>
  );
}
