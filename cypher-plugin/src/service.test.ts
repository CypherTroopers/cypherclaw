import { afterEach, describe, expect, it, vi } from "vitest";
import { CypherPluginService } from "./service.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Cypher plugin resource lifetime", () => {
  it("revokes service authority before joining both independent owners", async () => {
    const service = new CypherPluginService("/fixture/plugin");
    expect(() => service.current()).toThrow("unavailable");
    service.start("/fixture/state");
    const owners = service.current();
    const walletClosed = Promise.withResolvers<void>();
    const nodeClosed = Promise.withResolvers<void>();
    const wallet = vi.spyOn(owners.wallet, "close").mockReturnValue(walletClosed.promise);
    const node = vi.spyOn(owners.node, "close").mockReturnValue(nodeClosed.promise);
    let completed = false;
    const stopped = service.stop().then(() => {
      completed = true;
    });
    expect(owners.signal.aborted).toBe(true);
    expect(() => service.current()).toThrow("unavailable");
    expect(wallet).toHaveBeenCalledOnce();
    expect(node).toHaveBeenCalledOnce();
    walletClosed.resolve();
    await walletClosed.promise;
    expect(completed).toBe(false);
    nodeClosed.resolve();
    await stopped;
    service.start("/fixture/state");
    expect(service.current().signal.aborted).toBe(false);
    expect(service.current()).not.toBe(owners);
    await service.stop();
  });

  it("prevents a second owner after an unconfirmed native shutdown", async () => {
    const service = new CypherPluginService("/fixture/plugin");
    service.start("/fixture/state");
    const owners = service.current();
    vi.spyOn(owners.node, "close").mockRejectedValue(new Error("fixture native failure"));
    const wallet = vi.spyOn(owners.wallet, "close");
    await expect(service.stop()).rejects.toThrow("Check the node");
    expect(wallet).toHaveBeenCalledOnce();
    expect(() => service.start("/fixture/state")).toThrow("shutting down");
  });
});
