// Outbound communication drafts. No real sending in v1 (docs/decisions.md D-005).

import { formatDateShort } from "./dates.ts";

export function firstName(name: string): string {
  return name.split(" ")[0];
}

export function offerMessage(p: {
  employeeName: string;
  date: string;
  start: string;
  end: string;
  locationName: string;
  address: string | null;
  link: string;
  senderName: string;
}): string {
  return [
    `Hola ${firstName(p.employeeName)}, soy ${firstName(p.senderName)}.`,
    `¿Podrías cubrir un servicio el ${formatDateShort(p.date)} de ${p.start} a ${p.end} en ${p.locationName}${p.address ? ` (${p.address})` : ""}?`,
    `Responde aquí con un toque: ${p.link}`,
    `¡Gracias!`,
  ].join("\n");
}

export function confirmationMessage(p: { employeeName: string; date: string; start: string; end: string; locationName: string; accessNotes: string | null }): string {
  return [
    `¡Gracias ${firstName(p.employeeName)}! Queda confirmado: ${formatDateShort(p.date)}, ${p.start}–${p.end}, ${p.locationName}.`,
    p.accessNotes ? `Acceso: ${p.accessNotes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Spanish mobile numbers → wa.me deep link (opens WhatsApp with the text pre-filled). */
export function whatsappLink(phone: string | null, text: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 9) digits = `34${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Public origin for links sent to staff. CAUCE_BASE_URL wins; otherwise the request's own host. */
export function baseUrl(requestOrigin?: string | null): string {
  return (process.env.CAUCE_BASE_URL || requestOrigin || "http://localhost:3000").replace(/\/$/, "");
}
