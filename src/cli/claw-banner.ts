// Terminals display the CypherClaw name without altering or recreating the logo.
import type { RuntimeEnv } from "../runtime.js";

type ClawBannerOptions = {
  columns?: number;
  isTty?: boolean;
  rich?: boolean;
  env?: NodeJS.ProcessEnv;
  settleWhen?: PromiseLike<unknown>;
  sleep?: (ms: number) => Promise<void>;
  write?: (chunk: string) => void;
};

// Existing callers keep their startup contract; this banner is always static.
export type ClawBannerResult = "static" | "completed" | "settled";

/** Print the product name as plain text without image art or cursor animation. */
export async function printClawBanner(
  runtime: RuntimeEnv,
  _options: ClawBannerOptions = {},
): Promise<ClawBannerResult> {
  runtime.log("CYPHERCLAW\n");
  return "static";
}
