import { headers } from "next/headers";
import { baseUrl } from "./messages.ts";

/** Public origin of the current request (CAUCE_BASE_URL wins). For server components building absolute links. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return baseUrl(host ? `${proto}://${host}` : null);
}
