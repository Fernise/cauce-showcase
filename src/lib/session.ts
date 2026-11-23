import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, userForToken, type SessionUser } from "./auth.ts";

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return userForToken(jar.get(SESSION_COOKIE)?.value);
}

/** Use in every page and server action that touches org data. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
