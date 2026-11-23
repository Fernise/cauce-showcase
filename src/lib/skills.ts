export const SKILLS: Record<string, string> = {
  cristales: "Cristales",
  industrial: "Limpieza industrial",
  sanitario: "Centros sanitarios",
  altura: "Trabajo en altura",
  maquinaria: "Maquinaria (fregadora/rotativa)",
  cocina: "Cocinas",
  llaves: "Llaves / alarma",
};

export function parseSkills(csv: string | null | undefined): string[] {
  return (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function skillLabel(key: string): string {
  return SKILLS[key] ?? key;
}
