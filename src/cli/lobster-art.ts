// Retain the existing calendar helper contract for callers that use it.
// CypherClaw renders its product name in terminals without reproducing logo art.
import { isLobsterDay } from "../shared/lobster-day.js";

/** Return a plain product name on the existing scheduled days, outside CI/tests. */
export function pickCliLobsterArt(now: Date, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CI || env.VITEST || !isLobsterDay(now)) {
    return null;
  }
  return "CypherClaw";
}
