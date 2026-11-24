// Generate missing shifts up to the end of next week for every organisation (T-017). Idempotent.
// The app server already does this hourly; this script is for cron or manual runs.
import { rollAllOrganizations } from "../src/lib/services.ts";

console.log(`New shifts: ${rollAllOrganizations()}`);
