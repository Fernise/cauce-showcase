"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { submitSelfReport } from "@/lib/self-report.ts";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/**
 * Public: the personal link is the credential. A plain <form> posts here, so it works without JavaScript;
 * the result is shown by redirecting back to the (GET) page, which is safe to reload.
 */
export async function selfReportAction(fd: FormData): Promise<void> {
  const token = str(fd, "token");
  const res = submitSelfReport(token, { start: str(fd, "desde"), end: str(fd, "hasta"), reason: str(fd, "motivo") });
  const base = `/a/${encodeURIComponent(token)}`;
  if (!res.ok) redirect(res.error === "not_found" ? base : `${base}?error=${res.error}`);
  revalidatePath("/", "layout");
  redirect(`${base}?hecho=${res.absenceId}`);
}
