import type { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CypherStatus } from "../src/cypher/types.ts";
import type { NativeSetupStatus } from "../src/native/types.ts";
import type { WalletGeneratorStatus } from "../src/wallet-generator/types.ts";
import { createTestHost } from "./host.test-support.ts";
import plugin from "./index.ts";

const signer = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const node: CypherStatus = {
  platform: "linux",
  arch: "x64",
  supported: true,
  rootDir: "/fixture/node",
  dataDir: "/fixture/data",
  binaryPath: "/fixture/node/cypher",
  ipcPath: "/fixture/data/cypher.ipc",
  state: "stopped",
  owned: false,
  pid: null,
  connected: false,
  node: null,
  logs: [],
  error: null,
};
const ready: NativeSetupStatus = {
  state: "ready",
  target: "linux-amd64",
  node: {
    supported: true,
    ready: true,
    pin: {
      repository: "fixture/node",
      distributionCommit: "0".repeat(40),
      sourceCommit: "1".repeat(40),
    },
  },
  wallet: {
    supported: true,
    ready: true,
    pin: {
      repository: "fixture/wallet",
      distributionCommit: "2".repeat(40),
      sourceCommit: "3".repeat(40),
    },
  },
  progress: null,
  error: null,
};
const network = {
  chainId: "0x9a249f",
  genesisHash: "0x001c8239f25a697933e2a54511a576205fb21cbb80dc974adb29894dc80250ad",
  currency: "CLX",
  decimals: 18,
};
const wallets = {
  network,
  wallets: [
    { address: signer, balance: "1", balanceWei: "0xde0b6b3a7640000", locked: true },
    { address: recipient, balance: "0", balanceWei: "0x0", locked: false },
  ],
  total: 2,
  offset: 0,
  limit: 25,
  readiness: { ready: true, reason: null },
  finalitySupported: true,
};
const connected: CypherStatus = {
  ...node,
  owned: true,
  connected: true,
  state: "running",
  pid: 10,
  node: {
    clientVersion: "fixture",
    chainId: "0x1",
    blockNumber: "0x2",
    peerCount: "0x0",
    mining: false,
    hashrate: "0x0",
    accounts: [signer],
    signer,
  },
};
const available: WalletGeneratorStatus = {
  platform: "linux",
  arch: "x64",
  supported: true,
  available: true,
  binaryPath: "/fixture/wallet-generator",
  error: null,
  sourceCommit: "0".repeat(40),
};
// Public scalar-one test vector; never use this wallet for funds.
const wallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  privateKey: `0x${"0".repeat(63)}1`,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function mount(
  options: {
    node?: CypherStatus;
    setup?: NativeSetupStatus;
    locale?: string;
    admin?: boolean;
    generate?: () => Promise<unknown>;
    respond?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  } = {},
) {
  const fixture = createTestHost(async (method, params) => {
    if (method === "cypher.setup.status") {
      return options.setup ?? ready;
    }
    if (method === "cypher.wallets.list") {
      return wallets;
    }
    if (method === "cypher.transfers.list") {
      return { transfers: [] };
    }
    if (method === "cypher.wallet.generator.status") {
      return available;
    }
    if (method === "cypher.wallet.generator.generate") {
      return options.generate ? options.generate() : wallet;
    }
    if (method === "cypher.status") {
      return options.node ?? node;
    }
    if (options.respond) {
      return options.respond(method, params);
    }
    throw new Error(`Unexpected request ${method}`);
  });
  fixture.connection.canAdmin = options.admin ?? true;
  Object.defineProperty(fixture.host, "locale", { value: options.locale ?? "en" });
  const deactivate = await plugin.activate(fixture.host);
  const registration = fixture.pages.get("cypher");
  if (!registration) {
    throw new Error("Cypher did not register its public page");
  }
  const container = document.createElement("div");
  document.body.append(container);
  const view = registration.mount(container, fixture.context);
  const element = container.querySelector<LitElement>(".cypher-plugin")!;
  await element.updateComplete;
  const generator = element.querySelector<LitElement>(".cypher-plugin-wallet")!;
  await generator.updateComplete;
  const render = async () => {
    await element.updateComplete;
    await generator.updateComplete;
    await element.updateComplete;
  };
  const complete = async (method: string) => {
    const index = fixture.request.mock.calls.findLastIndex(([called]) => called === method);
    const result = fixture.request.mock.results[index];
    if (!result || result.type !== "return") {
      throw new Error(`No ${method} request`);
    }
    await Promise.allSettled([result.value]);
    await render();
  };
  await complete("cypher.setup.status");
  await complete("cypher.status");
  await complete("cypher.wallet.generator.status");
  return { ...fixture, element, generator, container, view, render, complete, deactivate };
}

function button(
  element: HTMLElement,
  kind: "cypher" | "wallet",
  action: string,
): HTMLButtonElement {
  return element.querySelector<HTMLButtonElement>(`[data-${kind}-action="${action}"]`)!;
}

function fill(element: HTMLElement, id: string, value: string): void {
  const input = element.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("standalone Cypher page through the public Control UI host", () => {
  it("registers all node sections and generates an independent masked wallet with node IPC stopped", async () => {
    const fixture = await mount();
    const { element, generator, request, complete, render } = fixture;
    expect(fixture.navigation.has("cypher")).toBe(true);
    expect(
      [...element.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
    ).toEqual(["Overview", "Node", "Wallets", "Send", "Mining", "Explorer"]);
    expect(element.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    expect(fixture.request.mock.calls.some(([method]) => method === "cypher.setup.prepare")).toBe(
      false,
    );
    expect(button(generator, "wallet", "generate").disabled).toBe(false);
    button(generator, "wallet", "generate").click();
    button(generator, "wallet", "generate").click();
    await complete("cypher.wallet.generator.generate");
    expect(generator.textContent).toContain(wallet.address);
    expect(generator.textContent).not.toContain(wallet.privateKey);
    expect(button(generator, "wallet", "generate").disabled).toBe(true);
    expect(
      request.mock.calls.filter(([method]) => method === "cypher.wallet.generator.generate"),
    ).toHaveLength(1);
    button(generator, "wallet", "reveal").click();
    await render();
    expect(generator.textContent).toContain(wallet.privateKey);
    button(generator, "wallet", "clear").click();
    await render();
    expect(generator.querySelector("[data-wallet-value]")).toBeNull();
    button(generator, "wallet", "generate").click();
    await complete("cypher.wallet.generator.generate");
    button(generator, "wallet", "reveal").click();
    await render();
    expect(generator.textContent).toContain(wallet.privateKey);
    expect(
      request.mock.calls.every(
        ([method]) =>
          ["cypher.status", "cypher.setup.status"].includes(method) ||
          method.startsWith("cypher.wallet.generator."),
      ),
    ).toBe(true);
    fixture.view?.dispose?.();
    if (typeof fixture.deactivate === "function") {
      fixture.deactivate();
    }
    expect(fixture.pages.size).toBe(0);
    expect(fixture.navigation.size).toBe(0);
    expect(element.textContent).not.toContain(wallet.privateKey);
  });

  it.each(["mining-start", "reward-set"] as const)(
    "keeps signer A separate from recipient B and clears passwords before %s",
    async (action) => {
      const operation = deferred<unknown>();
      const { element, request, complete } = await mount({
        node: connected,
        respond: () => operation.promise,
      });
      element.querySelector<HTMLButtonElement>("#cypher-tab-mining")!.click();
      fill(element, "cypher-recipient", recipient);
      for (const id of [
        "cypher-account-password",
        "cypher-mining-password",
        "cypher-reward-password",
      ]) {
        fill(element, id, "fixture-password");
      }
      button(element, "cypher", action).click();
      const method = action === "mining-start" ? "cypher.mining.start" : "cypher.reward.set";
      const params = request.mock.calls.find(([called]) => called === method)?.[1];
      expect(params).toEqual(
        action === "mining-start"
          ? { threads: 1, signer, password: "fixture-password" }
          : { signer, recipient, password: "fixture-password" },
      );
      expect(
        [...element.querySelectorAll<HTMLInputElement>('input[type="password"]')].every(
          (input) => input.value === "",
        ),
      ).toBe(true);
      operation.resolve(
        action === "mining-start"
          ? connected
          : { configured: true, signer, rewardRecipient: recipient },
      );
      await complete(method);
      expect(element.textContent).not.toContain("fixture-password");
    },
  );

  it.each(["disconnect", "hide", "pagehide", "scope", "abort"] as const)(
    "clears a revealed wallet on public lifecycle change: %s",
    async (reason) => {
      const fixture = await mount();
      button(fixture.generator, "wallet", "generate").click();
      await fixture.complete("cypher.wallet.generator.generate");
      button(fixture.generator, "wallet", "reveal").click();
      await fixture.render();
      expect(fixture.generator.textContent).toContain(wallet.privateKey);
      if (reason === "disconnect") {
        fixture.connection.connected = false;
        fixture.notify();
      }
      if (reason === "hide") {
        fixture.view?.update?.({ ...fixture.context, presented: false });
      }
      if (reason === "pagehide") {
        globalThis.dispatchEvent(new Event("pagehide"));
      }
      if (reason === "scope") {
        fixture.connection.canAdmin = false;
        fixture.notify();
      }
      if (reason === "abort") {
        fixture.lifetime.abort();
      }
      expect(fixture.generator.textContent).not.toContain(wallet.privateKey);
      await fixture.render();
      expect(fixture.generator.textContent).not.toContain(wallet.privateKey);
      expect(fixture.generator.textContent).not.toContain(wallet.address);
    },
  );

  it("drops delayed generation when a retained page is hidden and shown before another render", async () => {
    const generation = deferred<unknown>();
    const fixture = await mount({ generate: () => generation.promise });
    button(fixture.generator, "wallet", "generate").click();
    fixture.view?.update?.({ ...fixture.context, presented: false });
    fixture.view?.update?.(fixture.context);
    await fixture.render();
    await fixture.complete("cypher.wallet.generator.status");
    generation.resolve(wallet);
    await fixture.complete("cypher.wallet.generator.generate");
    expect(fixture.generator.querySelector("[data-wallet-value]")).toBeNull();
  });

  it.each([
    { locale: "en", waiting: "Waiting for the node to exit", stopped: "The node has stopped." },
    { locale: "ja", waiting: "ノードの終了を待っています", stopped: "ノードを停止しました。" },
  ])("reports stopping until process exit in $locale", async ({ locale, waiting, stopped }) => {
    const status = { ...connected };
    const fixture = await mount({
      locale,
      node: status,
      respond: async (method) => {
        if (method !== "cypher.stop") {
          throw new Error(`Unexpected request ${method}`);
        }
        return { ...connected, state: "stopping", connected: false, node: null };
      },
    });
    button(fixture.element, "cypher", "stop").click();
    await fixture.complete("cypher.stop");
    expect(fixture.element.textContent).toContain(waiting);
    Object.assign(status, node);
    vi.advanceTimersByTime(3000);
    await fixture.complete("cypher.status");
    expect(fixture.element.textContent).toContain(stopped);
    expect(fixture.element.textContent).not.toContain(waiting);
  });

  it("allows status viewing while keeping node and wallet mutations disabled for read-only operators", async () => {
    const fixture = await mount({ admin: false, node: connected });
    expect(button(fixture.generator, "wallet", "generate").disabled).toBe(true);
    for (const action of ["stop", "create", "unlock", "mining-start", "reward-set"]) {
      expect(button(fixture.element, "cypher", action).disabled).toBe(true);
    }
    expect(button(fixture.element, "cypher", "refresh").disabled).toBe(false);
    expect(button(fixture.element, "cypher", "setup-prepare").disabled).toBe(true);
  });

  it("never shows raw key-bearing failures or retries generation automatically", async () => {
    const generation = deferred<unknown>();
    const fixture = await mount({ generate: () => generation.promise });
    button(fixture.generator, "wallet", "generate").click();
    generation.reject(new Error(`Private key: ${wallet.privateKey}`));
    await fixture.complete("cypher.wallet.generator.generate");
    expect(fixture.generator.querySelector('[role="alert"]')?.textContent).toContain(
      "Wallet generation did not complete",
    );
    expect(fixture.generator.textContent).not.toContain(wallet.privateKey);
    expect(
      fixture.request.mock.calls.filter(
        ([method]) => method === "cypher.wallet.generator.generate",
      ),
    ).toHaveLength(1);
  });

  it("requires an administrator's explicit preparation click, then reloads the installed node and generator", async () => {
    const setup: NativeSetupStatus = {
      ...ready,
      state: "missing",
      node: { ...ready.node, ready: false },
      wallet: { ...ready.wallet, ready: false },
    };
    const preparation = deferred<unknown>();
    const fixture = await mount({
      setup,
      locale: "ja",
      respond: async (method) => {
        if (method === "cypher.setup.prepare") {
          return preparation.promise;
        }
        throw new Error(`Unexpected request ${method}`);
      },
    });
    const prepare = button(fixture.element, "cypher", "setup-prepare");
    expect(prepare.textContent).toContain("ノードを準備");
    expect(prepare.disabled).toBe(false);
    expect(button(fixture.element, "cypher", "start").disabled).toBe(true);
    expect(fixture.request.mock.calls.some(([method]) => method === "cypher.setup.prepare")).toBe(
      false,
    );
    prepare.click();
    prepare.click();
    await fixture.render();
    expect(prepare.disabled).toBe(true);
    expect(
      fixture.request.mock.calls.filter(([method]) => method === "cypher.setup.prepare"),
    ).toHaveLength(1);
    Object.assign(setup, ready);
    preparation.resolve(ready);
    await fixture.complete("cypher.setup.prepare");
    await fixture.complete("cypher.status");
    expect(button(fixture.element, "cypher", "start").disabled).toBe(false);
    expect(
      fixture.request.mock.calls.filter(([method]) => method === "cypher.wallet.generator.status")
        .length,
    ).toBeGreaterThan(1);
  });

  it("invalidates fee confirmation and removes its password when the sending wallet changes", async () => {
    const quote = {
      quoteId: "cb450290-8a90-4226-b8fc-c82565159dcf",
      network,
      from: signer,
      to: recipient,
      amount: "1",
      value: "0xde0b6b3a7640000",
      nonce: "0x1",
      gas: "0x5208",
      gasPrice: "0x1",
      estimatedFee: "0.000000000000021",
      total: "1.000000000000021",
      expiresAt: Date.now() + 60000,
    };
    const fixture = await mount({
      node: connected,
      respond: async (method) => {
        if (method === "cypher.transfers.prepare") {
          return quote;
        }
        throw new Error(`Unexpected request ${method}`);
      },
    });
    fixture.element.querySelector<HTMLButtonElement>("#cypher-tab-send")!.click();
    fill(fixture.element, "cypher-send-recipient", recipient);
    fill(fixture.element, "cypher-send-amount", "1");
    await fixture.render();
    button(fixture.element, "cypher", "prepare").click();
    await fixture.complete("cypher.transfers.prepare");
    expect(button(fixture.element, "cypher", "send").disabled).toBe(true);
    const confirm = fixture.element.querySelector<HTMLInputElement>("#cypher-send-confirm")!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event("change", { bubbles: true }));
    fill(fixture.element, "cypher-send-password", "fixture-password");
    await fixture.render();
    expect(button(fixture.element, "cypher", "send").disabled).toBe(false);
    const select = fixture.element.querySelector<HTMLSelectElement>("#cypher-send-wallet")!;
    select.value = recipient;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(fixture.element.querySelector<HTMLInputElement>("#cypher-send-password")!.value).toBe(
      "",
    );
    await fixture.render();
    expect(fixture.element.querySelector("#cypher-send-confirm")).toBeNull();
    expect(fixture.request.mock.calls.some(([method]) => method === "cypher.transfers.send")).toBe(
      false,
    );
  });
});
