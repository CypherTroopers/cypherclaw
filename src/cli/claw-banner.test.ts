// Terminal branding stays plain text on all terminal capabilities.
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import { printClawBanner } from "./claw-banner.js";

const runtimeStub = () => {
  const log = vi.fn();
  return { runtime: { log } as unknown as RuntimeEnv, log };
};

describe("printClawBanner", () => {
  it.each([
    { columns: 120, isTty: false, env: {} },
    { columns: 120, isTty: true, rich: true, env: { CI: "1" } },
    { columns: 50, isTty: true, rich: true, env: {} },
    { columns: 120, isTty: true, rich: true, env: {} },
  ])("prints the product name without logo art for %j", async (options) => {
    const { runtime, log } = runtimeStub();
    await expect(printClawBanner(runtime, options)).resolves.toBe("static");
    expect(log).toHaveBeenCalledExactlyOnceWith("CYPHERCLAW\n");
  });

  it("does not wait for startup settlement or write cursor-control sequences", async () => {
    const { runtime } = runtimeStub();
    const sleep = vi.fn(async () => {});
    const write = vi.fn();
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    await expect(
      printClawBanner(runtime, {
        columns: 120,
        isTty: true,
        rich: true,
        env: {},
        settleWhen: new Promise<void>(() => {}),
        sleep,
        write,
      }),
    ).resolves.toBe("static");
    expect(sleep).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });
});
