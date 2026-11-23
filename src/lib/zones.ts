// Known municipalities / areas of Tenerife and Gran Canaria with approximate centre coordinates.
// Picking one gives an employee or a location lat/lng so proximity ranking works without geocoding (T-011).
// Coordinates are town centres rounded to ~100 m: good enough for "who is closest", not for navigation.

/** Value of the zone <select> meaning "free text, no coordinates". */
export const ZONE_OTHER = "__other";

export type Zone = { name: string; island: "Tenerife" | "Gran Canaria"; lat: number; lng: number; aliases?: string[] };

export const ZONES: Zone[] = [
  // Tenerife — municipalities
  { name: "Adeje", island: "Tenerife", lat: 28.1227, lng: -16.726 },
  { name: "Arafo", island: "Tenerife", lat: 28.3436, lng: -16.4185 },
  { name: "Arico", island: "Tenerife", lat: 28.172, lng: -16.488 },
  { name: "Arona", island: "Tenerife", lat: 28.0996, lng: -16.681 },
  { name: "Buenavista del Norte", island: "Tenerife", lat: 28.373, lng: -16.851 },
  { name: "Candelaria", island: "Tenerife", lat: 28.3547, lng: -16.3714 },
  { name: "El Rosario", island: "Tenerife", lat: 28.4373, lng: -16.3571 },
  { name: "El Sauzal", island: "Tenerife", lat: 28.473, lng: -16.426 },
  { name: "El Tanque", island: "Tenerife", lat: 28.359, lng: -16.774 },
  { name: "Fasnia", island: "Tenerife", lat: 28.23, lng: -16.44 },
  { name: "Garachico", island: "Tenerife", lat: 28.373, lng: -16.765 },
  { name: "Granadilla de Abona", island: "Tenerife", lat: 28.119, lng: -16.576 },
  { name: "Guía de Isora", island: "Tenerife", lat: 28.211, lng: -16.777 },
  { name: "Güímar", island: "Tenerife", lat: 28.3154, lng: -16.4101 },
  { name: "Icod de los Vinos", island: "Tenerife", lat: 28.366, lng: -16.721 },
  { name: "La Guancha", island: "Tenerife", lat: 28.373, lng: -16.65 },
  { name: "La Laguna", island: "Tenerife", lat: 28.4874, lng: -16.3159, aliases: ["San Cristóbal de La Laguna"] },
  { name: "La Matanza de Acentejo", island: "Tenerife", lat: 28.45, lng: -16.445 },
  { name: "La Orotava", island: "Tenerife", lat: 28.3906, lng: -16.5232 },
  { name: "La Victoria de Acentejo", island: "Tenerife", lat: 28.435, lng: -16.467 },
  { name: "Los Realejos", island: "Tenerife", lat: 28.3843, lng: -16.5826 },
  { name: "Los Silos", island: "Tenerife", lat: 28.368, lng: -16.814 },
  { name: "Puerto de la Cruz", island: "Tenerife", lat: 28.4141, lng: -16.5484 },
  { name: "San Juan de la Rambla", island: "Tenerife", lat: 28.393, lng: -16.651 },
  { name: "San Miguel de Abona", island: "Tenerife", lat: 28.1, lng: -16.613 },
  { name: "Santa Cruz", island: "Tenerife", lat: 28.4636, lng: -16.2518, aliases: ["Santa Cruz de Tenerife"] },
  { name: "Santa Úrsula", island: "Tenerife", lat: 28.425, lng: -16.49 },
  { name: "Santiago del Teide", island: "Tenerife", lat: 28.291, lng: -16.815 },
  { name: "Tacoronte", island: "Tenerife", lat: 28.4772, lng: -16.4103 },
  { name: "Tegueste", island: "Tenerife", lat: 28.516, lng: -16.338 },
  { name: "Vilaflor de Chasna", island: "Tenerife", lat: 28.159, lng: -16.636 },
  // Tenerife — common service areas inside a municipality
  { name: "Taco", island: "Tenerife", lat: 28.4445, lng: -16.3005 },
  { name: "Los Cristianos", island: "Tenerife", lat: 28.051, lng: -16.7166 },
  { name: "Playa de las Américas", island: "Tenerife", lat: 28.059, lng: -16.728 },
  { name: "San Isidro", island: "Tenerife", lat: 28.0775, lng: -16.5574 },
  { name: "Los Gigantes", island: "Tenerife", lat: 28.245, lng: -16.84 },
  // Gran Canaria — municipalities
  { name: "Agaete", island: "Gran Canaria", lat: 28.1, lng: -15.701 },
  { name: "Agüimes", island: "Gran Canaria", lat: 27.905, lng: -15.446 },
  { name: "Artenara", island: "Gran Canaria", lat: 28.02, lng: -15.65 },
  { name: "Arucas", island: "Gran Canaria", lat: 28.119, lng: -15.523 },
  { name: "Firgas", island: "Gran Canaria", lat: 28.108, lng: -15.564 },
  { name: "Gáldar", island: "Gran Canaria", lat: 28.147, lng: -15.65 },
  { name: "Ingenio", island: "Gran Canaria", lat: 27.922, lng: -15.436 },
  { name: "La Aldea de San Nicolás", island: "Gran Canaria", lat: 27.987, lng: -15.809 },
  { name: "Las Palmas de Gran Canaria", island: "Gran Canaria", lat: 28.1235, lng: -15.4363, aliases: ["Las Palmas"] },
  { name: "Mogán", island: "Gran Canaria", lat: 27.883, lng: -15.724 },
  { name: "Moya", island: "Gran Canaria", lat: 28.113, lng: -15.597 },
  { name: "San Bartolomé de Tirajana", island: "Gran Canaria", lat: 27.925, lng: -15.571 },
  { name: "Santa Brígida", island: "Gran Canaria", lat: 28.033, lng: -15.503 },
  { name: "Santa Lucía de Tirajana", island: "Gran Canaria", lat: 27.912, lng: -15.54 },
  { name: "Santa María de Guía", island: "Gran Canaria", lat: 28.138, lng: -15.629 },
  { name: "Tejeda", island: "Gran Canaria", lat: 27.995, lng: -15.617 },
  { name: "Telde", island: "Gran Canaria", lat: 27.992, lng: -15.419 },
  { name: "Teror", island: "Gran Canaria", lat: 28.058, lng: -15.548 },
  { name: "Valleseco", island: "Gran Canaria", lat: 28.048, lng: -15.565 },
  { name: "Valsequillo", island: "Gran Canaria", lat: 27.999, lng: -15.483 },
  { name: "Vega de San Mateo", island: "Gran Canaria", lat: 28.014, lng: -15.526 },
  // Gran Canaria — common service areas
  { name: "Maspalomas", island: "Gran Canaria", lat: 27.76, lng: -15.586 },
  { name: "Playa del Inglés", island: "Gran Canaria", lat: 27.756, lng: -15.573 },
  { name: "Puerto de Mogán", island: "Gran Canaria", lat: 27.816, lng: -15.764 },
];

function key(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const INDEX = new Map<string, Zone>();
for (const z of ZONES) {
  INDEX.set(key(z.name), z);
  for (const a of z.aliases ?? []) INDEX.set(key(a), z);
}

/** Case/accent-insensitive lookup by name or alias. */
export function findZone(name: string | null | undefined): Zone | null {
  return name ? INDEX.get(key(name)) ?? null : null;
}

export function zonesByIsland(): { island: Zone["island"]; zones: Zone[] }[] {
  return (["Tenerife", "Gran Canaria"] as const).map((island) => ({
    island,
    zones: ZONES.filter((z) => z.island === island).sort((a, b) => a.name.localeCompare(b.name, "es")),
  }));
}
