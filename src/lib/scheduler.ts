// In-process scheduler for the single-Node deployment (D-016): keeps the shift window rolling forward (T-017).
// Hourly is plenty: the window ends next Sunday, so a missed run is harmless. For multiple processes,
// disable with CAUCE_SCHEDULER=off and run `npm run shifts:roll` from cron instead.
import { rollAllOrganizations } from "./services.ts";

const HOUR = 60 * 60 * 1000;
const g = globalThis as unknown as { __cauceScheduler?: NodeJS.Timeout };

function tick(): void {
  try {
    const created = rollAllOrganizations();
    if (created > 0) console.log(`[cauce] shift window rolled: ${created} new shift(s)`);
  } catch (e) {
    console.error("[cauce] shift window roll failed", e);
  }
}

export function startScheduler(): void {
  if (process.env.CAUCE_SCHEDULER === "off" || g.__cauceScheduler) return;
  tick();
  g.__cauceScheduler = setInterval(tick, HOUR);
  g.__cauceScheduler.unref();
}
