import type { LitElement } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CypherStatus,
  CypherWallets,
  CypherTransferQuote,
  CypherTransferRecord,
} from "../../../../src/cypher/types.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { createApplicationGateway } from "../../test-helpers/application-context.ts";
import { createTestGatewayClient } from "../../test-helpers/gateway-client.ts";
import { gatewayHelloForMethods } from "../../test-helpers/gateway-methods.ts";
import "./cypher-page.ts";

const signer = "0x1111111111111111111111111111111111111111";
const secondWallet = "0x2222222222222222222222222222222222222222";
const methods = [
  "wallets.list",
  "transfers.prepare",
  "transfers.send",
  "transfers.list",
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
const wallets: CypherWallets = {
  network: {
    chainId: "0x" + (10101919).toString(16),
    genesisHash: "0x001c8239f25a697933e2a54511a576205fb21cbb80dc974adb29894dc80250ad",
    currency: "CLX",
    decimals: 18,
  },
  wallets: [
    { address: signer, balance: "12.5", balanceWei: "0xad78ebc5ac620000", locked: true },
    { address: secondWallet, balance: "0.000000000000000001", balanceWei: "0x1", locked: false },
  ],
  total: 2,
  offset: 0,
  limit: 25,
  readiness: { ready: true, reason: null },
  finalitySupported: true,
};
const quote: CypherTransferQuote = {
  quoteId: "cb450290-8a90-4226-b8fc-c82565159dcf",
  network: wallets.network,
  from: secondWallet,
  to: signer,
  amount: "0.000000000000000001",
  value: "0x1",
  nonce: "0x2",
  gas: "0x5208",
  gasPrice: "0x1",
  estimatedFee: "0.000000000000021",
  total: "0.000000000000021001",
  expiresAt: 4102444800000,
};
const transfer: CypherTransferRecord = {
  ...quote,
  requestId: "49b4f708-85cb-49c7-85a2-2b0d41496a8c",
  nodeKey: "fixture-node",
  hash: "0x" + "a".repeat(64),
  status: "included",
  finalitySupported: true,
  blockNumber: "0x2",
  actualFee: "0.000000000000021",
  errorCode: null,
  createdAt: 1,
  updatedAt: 2,
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
  for (let turn = 0; turn < 6; turn += 1) {
    await page.updateComplete;
    await Promise.resolve();
  }
  await page.updateComplete;
}

async function mount(
  response: (method: string, params: unknown) => Promise<unknown>,
  scopes = ["operator.admin"],
  readResponses: { wallets?: CypherWallets; transfers?: CypherTransferRecord[] } = {},
) {
  const request = vi.fn((method: string, params: unknown) => {
    if (method === "cypher.wallets.list") {
      return Promise.resolve(readResponses.wallets ?? wallets);
    }
    if (method === "cypher.transfers.list") {
      return Promise.resolve({ transfers: readResponses.transfers ?? [] });
    }
    return response(method, params);
  });
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
  document.body.append(document.createElement("openclaw-toast-host"), page);
  await settle(page);
  return { page, request, requestOptions, source, client, hello };
}

function button(page: TestPage, action: string): HTMLButtonElement {
  return page.querySelector<HTMLButtonElement>(`[data-cypher-action="${action}"]`)!;
}

function input(page: TestPage, id: string): HTMLInputElement {
  return page.querySelector<HTMLInputElement>(`#${id}`)!;
}

async function selectTab(page: TestPage, tab: string): Promise<void> {
  page
    .querySelector(`#cypher-tab-${tab}`)!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle(page);
}
function changeInput(page: TestPage, id: string, value: string): void {
  const field = input(page, id);
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
afterEach(() => {
  document.body.replaceChildren();
});

describe("Cypher page", () => {
  it("shows node quantities as exact decimal numbers while preserving wallet and transfer identifiers", async () => {
    const numericStatus: CypherStatus = {
      ...status,
      node: {
        ...status.node!,
        chainId: "0x9a249f",
        blockNumber: "0x20000000000001",
        peerCount: "0xa",
        hashrate: "0x0",
      },
    };
    const { page } = await mount(async () => numericStatus, ["operator.read"], {
      transfers: [transfer],
    });
    const displayedValue = (tab: string, title: string) => {
      const panel = page.querySelector(`#cypher-panel-${tab}`)!;
      const row = [...panel.querySelectorAll(".settings-row")].find(
        (candidate) =>
          candidate.querySelector(".settings-row__title")?.textContent?.trim() === title,
      );
      return row?.querySelector(".settings-row__value")?.textContent?.trim();
    };
    await selectTab(page, "node");
    expect(displayedValue("node", "Chain ID")).toBe("10101919");
    expect(displayedValue("node", "Block")).toBe("9007199254740993");
    expect(displayedValue("node", "Peers")).toBe("10");
    expect(displayedValue("node", "Hashrate")).toBe("0");
    await selectTab(page, "overview");
    expect(displayedValue("overview", "Chain ID")).toBe("10101919");
    expect(displayedValue("overview", "Block")).toBe("9007199254740993");
    expect(displayedValue("overview", "Peers")).toBe("10");
    await selectTab(page, "send");
    const identifiers = [...page.querySelectorAll(".cypher-transfer dd")].map((value) =>
      value.textContent?.trim(),
    );
    expect(identifiers).toContain(transfer.from);
    expect(identifiers).toContain(transfer.to);
    expect(identifiers).toContain(transfer.hash);
  });

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
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      "cypher.status",
      "cypher.wallets.list",
      "cypher.transfers.list",
    ]);
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
  it("explains each tab and keeps the independent generator mounted during navigation", async () => {
    const { page } = await mount(async () => status);
    const generator = page.querySelector("openclaw-wallet-generator");
    const instructions = {
      overview: "Check your node and network",
      node: "Start or connect to the node",
      wallets: "These wallets belong to the node",
      send: "Send funds from a wallet",
      mining: "Mining uses a separate signer",
      explorer: "Look up an address, transfer or block",
    };
    for (const [tab, instruction] of Object.entries(instructions)) {
      await selectTab(page, tab);
      const panel = page.querySelector<HTMLElement>(`#cypher-panel-${tab}`)!;
      expect(panel.hidden).toBe(false);
      expect(panel.querySelector(".settings-section__desc")?.textContent).toContain(instruction);
      expect(page.querySelector("openclaw-wallet-generator")).toBe(generator);
    }
  });

  it("uses the selected wallet for locking without changing the mining signer", async () => {
    const { page, request } = await mount(async (method) =>
      method === "cypher.accounts.lock" ? { locked: true } : status,
    );
    await selectTab(page, "wallets");
    const wallet = page.querySelector<HTMLSelectElement>("#cypher-wallet")!;
    wallet.value = secondWallet;
    wallet.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(page);
    button(page, "lock").click();
    await settle(page);
    expect(request).toHaveBeenCalledWith("cypher.accounts.lock", { address: secondWallet });
    expect(request.mock.calls.some(([method]) => method === "cypher.accounts.select")).toBe(false);
    expect(page.querySelector<HTMLSelectElement>("#cypher-account")?.value).toBe(signer);
    expect(page.textContent).toContain("0.000000000000000001");
  });

  it("requires fee review and confirmation, clears the password, and reports completion only from the tracked result", async () => {
    const send = deferred<unknown>();
    const reads: { transfers: CypherTransferRecord[] } = { transfers: [] };
    const { page, request } = await mount(
      async (method) =>
        method === "cypher.transfers.prepare"
          ? quote
          : method === "cypher.transfers.send"
            ? send.promise
            : status,
      ["operator.admin"],
      reads,
    );
    await selectTab(page, "send");
    const sender = page.querySelector<HTMLSelectElement>("#cypher-send-wallet")!;
    sender.value = secondWallet;
    sender.dispatchEvent(new Event("change", { bubbles: true }));
    changeInput(page, "cypher-send-recipient", signer);
    changeInput(page, "cypher-send-amount", "0.000000000000000001");
    await settle(page);
    button(page, "prepare").click();
    await settle(page);
    expect(request).toHaveBeenCalledWith("cypher.transfers.prepare", {
      from: secondWallet,
      to: signer,
      amount: "0.000000000000000001",
    });
    expect(page.querySelector("#cypher-panel-send")?.textContent).toContain(
      "0.000000000000021001 CLX",
    );
    expect(button(page, "send").disabled).toBe(true);
    const confirm = input(page, "cypher-send-confirm");
    confirm.checked = true;
    confirm.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(page);
    input(page, "cypher-send-password").value = "fixture-only-password";
    button(page, "send").click();
    expect(input(page, "cypher-send-password").value).toBe("");
    // A second click arrives before Lit updates the DOM; request admission must still reject it.
    button(page, "send").click();
    expect(
      request.mock.calls.filter(([method]) => method === "cypher.transfers.send"),
    ).toHaveLength(1);
    const sendParams = request.mock.calls.find(
      ([method]) => method === "cypher.transfers.send",
    )![1] as { requestId: string; quoteId: string; password: string };
    expect(sendParams).toEqual({
      requestId: expect.any(String),
      quoteId: quote.quoteId,
      password: "fixture-only-password",
    });
    await page.updateComplete;
    expect(button(page, "send").disabled).toBe(true);
    reads.transfers = [{ ...transfer, requestId: sendParams.requestId }];
    send.resolve(reads.transfers[0]);
    await settle(page);
    const row = page.querySelector(`[data-cypher-transfer="${sendParams.requestId}"]`)!;
    expect(row.textContent).toContain("Included · awaiting finality");
    expect(row.textContent).not.toContain("Complete");
    reads.transfers = [{ ...reads.transfers[0]!, status: "complete" }];
    button(page, "refresh").click();
    await settle(page);
    expect(
      page.querySelector(`[data-cypher-transfer="${sendParams.requestId}"]`)?.textContent,
    ).toContain("Complete");
    await (document.querySelector("openclaw-toast-host") as LitElement).updateComplete;
    expect(document.querySelector("openclaw-toast-host")?.textContent).toContain(
      "Transfer complete: 0.000000000000000001 CLX.",
    );
    expect(
      request.mock.calls.filter(([method]) => method === "cypher.transfers.send"),
    ).toHaveLength(1);
  });

  it.each([
    {
      outcome: "unknown" as const,
      errorCode: "CYPHER_SUBMISSION_UNKNOWN",
      message: "The node has not confirmed acceptance",
    },
    {
      outcome: "failed" as const,
      errorCode: "CYPHER_ADMISSION_REQUIRED",
      message: "Common admission is not ready",
    },
  ])(
    "reports a returned $outcome outcome without claiming acceptance or submitting again",
    async ({ outcome, errorCode, message }) => {
      const reads: { transfers: CypherTransferRecord[] } = { transfers: [] };
      const { page, request } = await mount(
        async (method, params) => {
          if (method === "cypher.transfers.prepare") {
            return quote;
          }
          if (method === "cypher.transfers.send") {
            const record = {
              ...transfer,
              requestId: (params as { requestId: string }).requestId,
              status: outcome,
              errorCode,
            };
            reads.transfers = [record];
            return record;
          }
          return status;
        },
        ["operator.admin"],
        reads,
      );
      await selectTab(page, "send");
      const sender = page.querySelector<HTMLSelectElement>("#cypher-send-wallet")!;
      sender.value = secondWallet;
      sender.dispatchEvent(new Event("change", { bubbles: true }));
      changeInput(page, "cypher-send-recipient", signer);
      changeInput(page, "cypher-send-amount", quote.amount);
      await settle(page);
      button(page, "prepare").click();
      await settle(page);
      const confirm = input(page, "cypher-send-confirm");
      confirm.checked = true;
      confirm.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(page);
      input(page, "cypher-send-password").value = "fixture-only-password";
      button(page, "send").click();
      await settle(page);
      expect(page.textContent).toContain(message);
      expect(page.textContent).not.toContain("The transfer was submitted.");
      expect(page.querySelector("[data-cypher-transfer]")?.textContent).toContain(transfer.hash);
      if (outcome === "failed") {
        expect(page.querySelector('[role="alert"]')?.textContent).toContain(
          "Common admission is not ready",
        );
      }
      expect(
        request.mock.calls.filter(([method]) => method === "cypher.transfers.send"),
      ).toHaveLength(1);
      expect(
        request.mock.calls.filter(([method]) => method === "cypher.transfers.prepare"),
      ).toHaveLength(1);
    },
  );

  it("keeps a failed receipt waiting for finality and blocks explorer links on genesis mismatch", async () => {
    const failedReceipt = { ...transfer, errorCode: "CYPHER_EXECUTION_FAILED" };
    const mismatch = {
      ...wallets,
      network: { ...wallets.network, genesisHash: "0x" + "b".repeat(64) },
    };
    const { page } = await mount(async () => status, ["operator.read"], {
      wallets: mismatch,
      transfers: [failedReceipt],
    });
    await selectTab(page, "send");
    const row = page.querySelector(`[data-cypher-transfer="${transfer.requestId}"]`)!;
    expect(row.textContent).toContain("Included · awaiting finality");
    // Historical transfers retain their own network even if the current node changed.
    expect(row.querySelector("a")?.getAttribute("href")).toBe(
      `https://colossusx.make-cph-great-again.community/tx/${transfer.hash}`,
    );
    await selectTab(page, "wallets");
    expect(page.querySelector("#cypher-panel-wallets a")).toBeNull();
    await selectTab(page, "explorer");
    changeInput(page, "cypher-explorer-query", signer);
    await settle(page);
    expect(page.querySelector("#cypher-panel-explorer a")).toBeNull();
    expect(page.querySelector("#cypher-panel-explorer")?.textContent).toContain(
      "chain ID and genesis must both match",
    );
  });
});
