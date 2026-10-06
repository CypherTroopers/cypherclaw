import type { LitElement } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CypherStatus } from "../../../../src/cypher/types.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { createApplicationGateway } from "../../test-helpers/application-context.ts";
import { createTestGatewayClient } from "../../test-helpers/gateway-client.ts";
import { gatewayHelloForMethods } from "../../test-helpers/gateway-methods.ts";
import "./cypher-page.ts";

const signer = "0x1111111111111111111111111111111111111111";
const methods = [
  "status",
  "start",
  "stop",
  "connect",
  "disconnect",
  "mining.start",
  "mining.stop",
  "accounts.create",
  "accounts.select",
  "accounts.unlock",
  "accounts.lock",
  "reward.get",
  "reward.set",
].map((method) => `cypher.${method}`);
const status: CypherStatus = {
  platform: "linux",
  arch: "x64",
  supported: true,
  rootDir: "/fixture/cypher",
  dataDir: "/fixture/data",
  binaryPath: "/fixture/cypher-linux-amd64",
  ipcPath: "/fixture/cypher.ipc",
  state: "running",
  owned: true,
  pid: 123,
  connected: true,
  logs: ["Synthetic node output"],
  error: null,
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
type TestPage = LitElement & { context: ApplicationContext };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle(page: TestPage): Promise<void> {
  await page.updateComplete;
  await Promise.resolve();
  await page.updateComplete;
}

async function mount(
  response: (method: string, params: unknown) => Promise<unknown>,
  scopes = ["operator.admin"],
) {
  const request = vi.fn(response);
  const requestOptions = new Map<string, unknown>();
  const client = createTestGatewayClient((method, params, options) => {
    requestOptions.set(method, options);
    return request(method, params);
  });
  const hello = gatewayHelloForMethods(methods, scopes);
  const source = createApplicationGateway({
    client,
    hello,
    phase: "connected",
    offlineStable: false,
    canvasPluginSurfaceUrl: null,
    assistantAgentId: null,
    sessionKey: "",
    lastError: null,
    lastErrorCode: null,
  });
  const page = document.createElement("openclaw-cypher-page") as TestPage;
  page.context = { gateway: source.gateway } as ApplicationContext;
  document.body.append(page);
  await settle(page);
  return { page, request, requestOptions, source, client, hello };
}

function button(page: TestPage, action: string): HTMLButtonElement {
  return page.querySelector<HTMLButtonElement>(`[data-cypher-action="${action}"]`)!;
}

function input(page: TestPage, id: string): HTMLInputElement {
  return page.querySelector<HTMLInputElement>(`#${id}`)!;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Cypher page", () => {
  it("keeps an owned node stoppable after a graceful-stop timeout and budgets the retry", async () => {
    const timedOut = {
      ...status,
      state: "error" as const,
      connected: false,
      node: null,
      error: "The node is still running. Retry Stop node.",
    };
    const { page, request, requestOptions } = await mount(async () => timedOut);
    expect(button(page, "start").disabled).toBe(true);
    expect(button(page, "stop").disabled).toBe(false);
    button(page, "stop").click();
    expect(request).toHaveBeenCalledWith("cypher.stop", {});
    expect(requestOptions.get("cypher.stop")).toEqual(
      expect.objectContaining({ timeoutMs: 35_000 }),
    );
    await settle(page);
  });

  it("clears all password fields before dispatch and keeps failed actions out of node logs", async () => {
    const action = deferred<unknown>();
    const { page, request } = await mount(async (method) =>
      method === "cypher.status" ? status : action.promise,
    );
    input(page, "cypher-account-password").value = "fixture-only-password";
    input(page, "cypher-mining-password").value = "another-fixture-password";
    button(page, "create").click();
    expect(request).toHaveBeenCalledWith("cypher.accounts.create", {
      password: "fixture-only-password",
    });
    expect(input(page, "cypher-account-password").value).toBe("");
    expect(input(page, "cypher-mining-password").value).toBe("");
    action.reject(new Error("Synthetic account failure"));
    await vi.waitFor(() => {
      expect(page.querySelector('[role="alert"]')?.textContent).toContain(
        "Synthetic account failure",
      );
    });
    expect(page.querySelector('[role="log"]')?.textContent).toBe("Synthetic node output");
    expect(page.textContent).not.toContain("fixture-only-password");
    expect(button(page, "create").disabled).toBe(false);
  });

  it("allows read-only users to inspect an external node without enabling mutations", async () => {
    const external = { ...status, owned: false };
    const { page, request } = await mount(async () => external, ["operator.read"]);
    expect(button(page, "refresh").disabled).toBe(false);
    expect(button(page, "reward-get").disabled).toBe(true);
    for (const action of [
      "stop",
      "create",
      "unlock",
      "lock",
      "select",
      "mining-start",
      "reward-get",
      "reward-set",
    ]) {
      expect(button(page, action).disabled).toBe(true);
      button(page, action).click();
    }
    expect(request.mock.calls.map(([method]) => method)).toEqual(["cypher.status"]);
    expect(page.textContent).toContain("Connected to an existing node");
  });

  it("ignores an old mining result after the same Gateway client reconnects", async () => {
    const action = deferred<unknown>();
    const { page, source } = await mount(async (method) =>
      method === "cypher.status" ? status : action.promise,
    );
    input(page, "cypher-mining-password").value = "fixture-only-password";
    button(page, "mining-start").click();
    source.publish({ ...source.gateway.snapshot, phase: "offline" });
    source.publish({ ...source.gateway.snapshot, phase: "connected" });
    await settle(page);
    action.resolve({ ...status, node: { ...status.node!, mining: true } });
    await settle(page);
    expect(button(page, "mining-start").disabled).toBe(false);
    expect(button(page, "mining-stop").disabled).toBe(true);
    expect(input(page, "cypher-mining-password").value).toBe("");
  });

  it("registers a distinct payout B with selected signer A and clears the signer password", async () => {
    const recipient = "0x2222222222222222222222222222222222222222";
    const { page, request } = await mount(async (method) =>
      method === "cypher.status"
        ? status
        : {
            configured: true,
            signer,
            rewardRecipient: recipient,
          },
    );
    input(page, "cypher-recipient").value = recipient;
    input(page, "cypher-recipient").dispatchEvent(new Event("input", { bubbles: true }));
    input(page, "cypher-reward-password").value = "fixture-only-password";
    button(page, "reward-set").click();
    expect(request).toHaveBeenCalledWith("cypher.reward.set", {
      signer,
      recipient,
      password: "fixture-only-password",
    });
    expect(input(page, "cypher-reward-password").value).toBe("");
    await settle(page);
    expect(page.textContent).toContain("Registered recipient B");
    expect(page.textContent).toContain(recipient);
    expect(page.textContent).toContain(signer);
  });
});
