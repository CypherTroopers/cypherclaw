import type { LitElement } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletGeneratorStatus } from "../../../../src/wallet-generator/types.ts";
import type { ApplicationContext } from "../../app/context.ts";
import {
  createApplicationContextProvider,
  createApplicationGateway,
} from "../../test-helpers/application-context.ts";
import { createTestGatewayClient } from "../../test-helpers/gateway-client.ts";
import { gatewayHelloForMethods } from "../../test-helpers/gateway-methods.ts";
import "../../pages/cypher/cypher-page.ts";
import "./wallet-generator.ts";

const status: WalletGeneratorStatus = {
  platform: "linux",
  arch: "x64",
  supported: true,
  available: true,
  binaryPath: "/fixture/offlinewalletgenerator/bin/linux-amd64/coldwalletgenerator",
  error: null,
  sourceCommit: "0000000000000000000000000000000000000000",
};
// Public secp256k1 scalar-one vector, never a funded or privately generated wallet.
const wallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  privateKey: `0x${"0".repeat(63)}1`,
};
const methods = ["wallet.generator.status", "wallet.generator.generate", "cypher.status"];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle(element: LitElement): Promise<void> {
  await element.updateComplete;
  await Promise.resolve();
  await element.updateComplete;
}

async function mount(
  options: {
    generate?: () => Promise<unknown>;
    status?: WalletGeneratorStatus;
    scopes?: string[];
    inCypherPage?: boolean;
  } = {},
) {
  const nodeRequest = deferred<unknown>();
  const request = vi.fn(async (method: string) => {
    if (method === "cypher.status") {
      return nodeRequest.promise;
    }
    return method === "wallet.generator.status"
      ? (options.status ?? status)
      : options.generate
        ? options.generate()
        : wallet;
  });
  const client = createTestGatewayClient(request);
  const clientRequest = vi.spyOn(client, "request");
  const source = createApplicationGateway({
    client,
    hello: gatewayHelloForMethods(methods, options.scopes ?? ["operator.admin"]),
    phase: "connected",
    offlineStable: false,
    canvasPluginSurfaceUrl: null,
    assistantAgentId: null,
    sessionKey: "",
    lastError: null,
    lastErrorCode: null,
  });
  const provider = createApplicationContextProvider({
    gateway: source.gateway,
  } as ApplicationContext);
  const host = document.createElement(
    options.inCypherPage ? "openclaw-cypher-page" : "openclaw-wallet-generator",
  ) as LitElement;
  provider.append(host);
  document.body.append(provider);
  await settle(host);
  const element = options.inCypherPage
    ? host.querySelector<LitElement>("openclaw-wallet-generator")!
    : host;
  await settle(element);
  const completeRequest = async (method = "wallet.generator.generate") => {
    const index = clientRequest.mock.calls.findLastIndex(([called]) => called === method);
    const completion = clientRequest.mock.results[index];
    if (!completion || completion.type !== "return") {
      throw new Error(`No pending ${method} request in the fixture`);
    }
    // Await the public RPC promise, including the test client's async wrapper, before rendering.
    await Promise.allSettled([completion.value]);
    await element.updateComplete;
  };
  await completeRequest("wallet.generator.status");
  return { element, host, request, source, provider, nodeRequest, completeRequest };
}

function button(element: LitElement, action: string): HTMLButtonElement {
  return element.querySelector<HTMLButtonElement>(`[data-wallet-action="${action}"]`)!;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "execCommand");
});

describe("Wallet generator", () => {
  it("generates independently while node status is pending and never overwrites an unsaved result", async () => {
    const generation = deferred<unknown>();
    const { element, host, request, completeRequest } = await mount({
      inCypherPage: true,
      generate: () => generation.promise,
    });
    expect(host.querySelector<HTMLButtonElement>('[data-cypher-action="refresh"]')!.disabled).toBe(
      true,
    );
    expect(button(element, "generate").disabled).toBe(false);
    button(element, "generate").click();
    button(element, "generate").click();
    await settle(element);
    expect(button(element, "generate").disabled).toBe(true);
    expect(
      request.mock.calls.filter(([method]) => method === "wallet.generator.generate"),
    ).toHaveLength(1);
    generation.resolve(wallet);
    await completeRequest();
    expect(element.textContent).toContain(wallet.address);
    expect(element.textContent).not.toContain(wallet.privateKey);
    expect(button(element, "generate").disabled).toBe(true);
    expect(host.querySelector('[role="log"]')?.textContent).not.toContain(wallet.address);
    button(element, "reveal").click();
    await settle(element);
    expect(element.querySelector('[data-wallet-value="privateKey"]')?.textContent).toBe(
      wallet.privateKey,
    );
    button(element, "reveal").click();
    await settle(element);
    expect(element.textContent).not.toContain(wallet.privateKey);
    button(element, "clear").click();
    await settle(element);
    expect(element.querySelector("[data-wallet-value]")).toBeNull();
    expect(button(element, "generate").disabled).toBe(false);
    button(element, "generate").click();
    await completeRequest();
    button(element, "reveal").click();
    await settle(element);
    expect(element.querySelector('[data-wallet-value="privateKey"]')?.textContent).toBe(
      wallet.privateKey,
    );
  });

  it("copies only the selected value after an explicit click and reports the outcome", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { element, completeRequest } = await mount();
    button(element, "generate").click();
    await completeRequest();
    expect(writeText).not.toHaveBeenCalled();
    button(element, "copy-address").click();
    await settle(element);
    expect(writeText).toHaveBeenLastCalledWith(wallet.address);
    expect(element.textContent).toContain("Wallet address copied.");
    button(element, "copy-privateKey").click();
    await settle(element);
    expect(writeText).toHaveBeenLastCalledWith(wallet.privateKey);
    expect(element.textContent).toContain("Private key copied.");
    expect(element.textContent).not.toContain(wallet.privateKey);
  });

  it.each([
    { label: "read-only access", scopes: ["operator.read"], status },
    {
      label: "unsupported platform",
      status: { ...status, supported: false, available: false, binaryPath: null },
    },
    { label: "unavailable binary", status: { ...status, available: false } },
  ])("disables generation for $label", async (options) => {
    const { element, request } = await mount(options);
    expect(button(element, "generate").disabled).toBe(true);
    button(element, "generate").click();
    expect(
      request.mock.calls.filter(([method]) => method === "wallet.generator.generate"),
    ).toHaveLength(0);
  });

  it("does not copy through the fallback after the displayed wallet is cleared", async () => {
    const copying = deferred<void>();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    vi.stubGlobal("navigator", { clipboard: { writeText: () => copying.promise } });
    const { element, completeRequest } = await mount();
    button(element, "generate").click();
    await completeRequest();
    button(element, "copy-privateKey").click();
    button(element, "clear").click();
    copying.reject(new Error("Clipboard denied"));
    await settle(element);
    expect(element.querySelector("[data-wallet-value]")).toBeNull();
    expect(element.textContent).not.toContain("Private key copied.");
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("discards a delayed result across a same-client disconnect and reconnect", async () => {
    const generation = deferred<unknown>();
    const { element, source, completeRequest } = await mount({
      generate: () => generation.promise,
    });
    button(element, "generate").click();
    source.publish({ ...source.gateway.snapshot, phase: "offline" });
    source.publish({ ...source.gateway.snapshot, phase: "connected" });
    await completeRequest("wallet.generator.status");
    generation.resolve(wallet);
    await completeRequest();
    expect(element.querySelector("[data-wallet-value]")).toBeNull();
    expect(button(element, "generate").disabled).toBe(false);
  });

  it.each(["disconnect", "pagehide", "navigation", "context", "scope"] as const)(
    "clears a revealed key on %s",
    async (reason) => {
      const { element, source, provider, completeRequest } = await mount();
      button(element, "generate").click();
      await completeRequest();
      button(element, "reveal").click();
      await settle(element);
      expect(element.textContent).toContain(wallet.privateKey);
      switch (reason) {
        case "disconnect":
          source.publish({ ...source.gateway.snapshot, phase: "offline" });
          break;
        case "pagehide":
          globalThis.dispatchEvent(new Event("pagehide"));
          break;
        case "navigation":
          element.remove();
          break;
        case "context":
          provider.setContext({
            gateway: createApplicationGateway(source.gateway.snapshot).gateway,
          } as ApplicationContext);
          break;
        case "scope":
          source.publish({
            ...source.gateway.snapshot,
            hello: gatewayHelloForMethods(methods, ["operator.read"]),
          });
          break;
      }
      await settle(element);
      expect(element.textContent).not.toContain(wallet.privateKey);
      expect(element.textContent).not.toContain(wallet.address);
    },
  );

  it("shows a safe failure without displaying raw output or automatically retrying", async () => {
    const generation = deferred<unknown>();
    const { element, request, completeRequest } = await mount({
      generate: () => generation.promise,
    });
    button(element, "generate").click();
    generation.reject(new Error(`Private Key: ${wallet.privateKey}`));
    await completeRequest();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      "Wallet generation did not complete.",
    );
    expect(element.textContent).not.toContain(wallet.privateKey);
    expect(
      request.mock.calls.filter(([method]) => method === "wallet.generator.generate"),
    ).toHaveLength(1);
    expect(button(element, "generate").disabled).toBe(false);
  });
});
