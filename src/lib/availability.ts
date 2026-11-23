// Weekly availability helpers shared by the server (parsing) and the client (presets in the form). Pure.

export type AvailabilityWindow = { weekday: number; start: string; end: string };

export const AVAILABILITY_PRESETS: { key: string; label: string; days: number[]; start: string; end: string }[] = [
  { key: "manana", label: "L-V mañana 06:00-15:00", days: [1, 2, 3, 4, 5], start: "06:00", end: "15:00" },
  { key: "tarde", label: "L-V tarde 13:00-22:00", days: [1, 2, 3, 4, 5], start: "13:00", end: "22:00" },
  { key: "completo", label: "L-D completo 06:00-22:00", days: [1, 2, 3, 4, 5, 6, 7], start: "06:00", end: "22:00" },
];

export function presetWindows(key: string): AvailabilityWindow[] {
  const p = AVAILABILITY_PRESETS.find((x) => x.key === key)!;
  return p.days.map((weekday) => ({ weekday, start: p.start, end: p.end }));
}
