import { LitElement } from "lit";
import { state } from "lit/decorators.js";
import type { ControlUiHost, ControlUiViewContext } from "openclaw/plugin-sdk/control-ui";
import type {
  CypherRewardRegistration,
  CypherStatus,
  CypherWallets,
  CypherTransferQuote,
  CypherTransferRecord,
} from "../src/cypher/types.ts";
import type { NativeSetupStatus } from "../src/native/types.ts";
import { copyToClipboard } from "./clipboard.ts";
import { PluginHostController } from "./host-controller.ts";
import { t } from "./i18n.ts";
import { renderCypher, type CypherAction, type CypherTab } from "./node-view.ts";
import type { WalletGenerator } from "./wallet.ts";

export class CypherPage extends LitElement {
  static override properties = { context: { attribute: false } };
  declare context: ControlUiViewContext;
  override createRenderRoot() {
    return this;
  }
  @state() private setup: NativeSetupStatus | null = null;
  @state() private setupError: string | null = null;
  private setupPending: symbol | null = null;

  @state() private status: CypherStatus | null = null;
  @state() private tab: CypherTab = "overview";
  @state() private wallets: CypherWallets | null = null;
  @state() private walletAddress = "";
  @state() private transfers: CypherTransferRecord[] = [];
  @state() private quote: CypherTransferQuote | null = null;
  @state() private sendRecipient = "";
  @state() private amount = "";
  @state() private confirmed = false;
  @state() private explorerQuery = "";
  private sendRequestId: string | null = null;
  @state() private reward: CypherRewardRegistration | null = null;
  @state() private selectedAccount = "";
  @state() private recipient = "";
  @state() private threads = "1";
  @state() private duration = "300";
  @state() private busy: string | null = null;
  @state() private error: string | null = null;
  @state() private result: string | null = null;
  private pending: AbortController | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisibility = () => {
    this.syncPolling();
    if (this.timer !== null) {
      void this.refresh(true);
    }
  };
  private readonly onPageHide = () => {
    this.cancelRequest();
    this.invalidateQuote();
  };

  private readonly gateway = new PluginHostController(this, {
    getContext: () => this.context,
    onIdentityChange: () => {
      this.status = null;
      this.setup = null;
      this.setupError = null;
      this.reward = null;
      this.wallets = null;
      this.transfers = [];
      this.walletAddress = "";
      this.sendRecipient = "";
      this.amount = "";
      this.selectedAccount = "";
      this.recipient = "";
      this.error = null;
      this.result = null;
    },
    invalidateRequests: () => {
      this.cancelRequest();
      this.invalidateQuote();
    },
    ensureInitialData: () => void this.refresh(),
    onSnapshot: () => {
      this.syncPolling();
    },
  });

  updateContext(context: ControlUiViewContext): void {
    this.context = context;
    this.querySelector<WalletGenerator>(".cypher-plugin-wallet")?.updateContext(context);
    this.gateway.synchronize();
    this.requestUpdate();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibility);
    globalThis.addEventListener("pagehide", this.onPageHide);
  }

  private readMethod(method: string): boolean {
    return (
      method === "cypher.setup.status" ||
      method === "cypher.status" ||
      method === "cypher.wallets.list" ||
      method === "cypher.transfers.list"
    );
  }

  private permitted(method: string): boolean {
    return this.readMethod(method) ? this.gateway.canRead : this.gateway.canAdmin;
  }

  private allowed(method: string): boolean {
    return !this.busy && this.permitted(method);
  }

  private syncPolling(): void {
    const active =
      this.gateway.canRead &&
      document.visibilityState !== "hidden" &&
      (this.status?.connected ||
        ["starting", "running", "stopping"].includes(this.status?.state ?? "") ||
        this.setup?.state === "preparing" ||
        this.busy === "cypher.setup.prepare");
    if (active && this.timer === null) {
      this.timer = setInterval(() => {
        void this.readSetup();
        void this.refreshNode(true);
      }, 3000);
    } else if (!active && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private acceptSetup(setup: NativeSetupStatus): void {
    const becameReady =
      this.setup !== null && this.setup.state !== "ready" && setup.state === "ready";
    this.setup = setup;
    this.setupError = null;
    this.syncPolling();
    if (becameReady) {
      void this.querySelector<WalletGenerator>(".cypher-plugin-wallet")?.refreshAvailability();
      void this.refreshNode(true);
    }
  }

  private async readSetup(): Promise<void> {
    const scope = this.gateway.capture();
    if (!scope || !this.gateway.canRead || this.setupPending) {
      return;
    }
    const pending = Symbol("setup");
    this.setupPending = pending;
    const current = () =>
      this.setupPending === pending && this.gateway.isCurrent(scope) && this.gateway.canRead;
    try {
      const value = await scope.client.request<NativeSetupStatus>("cypher.setup.status", {});
      if (current()) {
        this.acceptSetup(value);
      }
    } catch (error) {
      if (current()) {
        this.setupError = this.errorText(error);
      }
    } finally {
      if (this.setupPending === pending) {
        this.setupPending = null;
      }
    }
  }

  private errorText(error: unknown): string {
    return this.context.host.redact(
      error instanceof Error ? error.message : t("cypher.requestFailed"),
    );
  }

  private clearPasswords(): void {
    for (const input of this.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
      input.value = "";
    }
  }

  private takePassword(id: string): string {
    const input = this.querySelector<HTMLInputElement>(`#${id}`);
    const password = input?.value ?? "";
    this.clearPasswords();
    return password;
  }

  private cancelRequest(): void {
    this.pending?.abort();
    this.setupPending = null;
    this.pending = null;
    this.busy = null;
    this.clearPasswords();
  }

  override disconnectedCallback(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    globalThis.removeEventListener("pagehide", this.onPageHide);
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.cancelRequest();
    super.disconnectedCallback();
  }

  private acceptStatus(status: CypherStatus): void {
    if (this.status?.state === "stopping" && status.state !== "stopping") {
      this.result =
        status.state === "stopped" ? t("cypher.stopComplete", {}, this.context.host.locale) : null;
    }
    this.status = status;
    this.syncPolling();
    if (!status.connected) {
      this.wallets = null;
      this.invalidateQuote();
    }
    const accounts = status.node?.accounts ?? [];
    if (!accounts.includes(this.selectedAccount)) {
      this.selectedAccount =
        status.node?.signer && accounts.includes(status.node.signer)
          ? status.node.signer
          : (accounts[0] ?? "");
      this.reward = null;
      this.recipient = "";
    }
  }

  private async request<T>(
    method: string,
    params: Record<string, unknown>,
    accept: (value: T) => void,
    refresh = false,
    quiet = false,
  ): Promise<T | undefined> {
    if (!this.allowed(method) || (quiet && this.pending)) {
      return undefined;
    }
    const scope = this.gateway.capture();
    if (!scope) {
      return undefined;
    }
    this.pending?.abort();
    const pending = new AbortController();
    this.pending = pending;
    if (!quiet) {
      this.busy = method;
      this.error = null;
      this.result = null;
    }
    this.syncPolling();
    const current = () =>
      this.pending === pending && this.gateway.isCurrent(scope) && this.permitted(method);
    try {
      const value = await scope.client.request<T>(method, params);
      if (!current()) {
        return undefined;
      }
      accept(value);
      if (refresh) {
        const status = await scope.client.request<CypherStatus>("cypher.status", {});
        if (current()) {
          this.acceptStatus(status);
        }
      }
      if (current()) {
        await this.refreshDetails(scope.client, current, !quiet);
      }
      return current() ? value : undefined;
    } catch (error) {
      if (current()) {
        this.error = this.errorText(error);
        if (method === "cypher.transfers.send") {
          try {
            await this.refreshDetails(scope.client, current, true);
          } catch {
            // The original error remains visible; the next refresh reconciles the durable transfer.
          }
        }
      }
      return undefined;
    } finally {
      if (this.pending === pending) {
        this.pending = null;
        this.busy = null;
        this.syncPolling();
      }
    }
  }

  private async refreshDetails(
    client: ControlUiHost,
    current: () => boolean,
    force: boolean,
  ): Promise<void> {
    if (
      this.status?.connected &&
      (force || this.tab === "wallets" || this.tab === "send" || !this.wallets)
    ) {
      const wallets = await client.request<CypherWallets>("cypher.wallets.list", {
        offset: this.wallets?.offset ?? 0,
        limit: 25,
      });
      if (!current()) {
        return;
      }
      this.wallets = wallets;
      if (!this.walletAddress) {
        this.walletAddress = wallets.wallets[0]?.address ?? "";
      }
    }
    if (
      this.status?.connected &&
      (force ||
        this.tab === "send" ||
        this.transfers.some((transfer) => !["complete", "failed"].includes(transfer.status)))
    ) {
      const result = await client.request<{ transfers: CypherTransferRecord[] }>(
        "cypher.transfers.list",
        { limit: 50 },
      );
      if (!current()) {
        return;
      }
      for (const transfer of result.transfers) {
        const previous = this.transfers.find((item) => item.requestId === transfer.requestId);
        if (previous && previous.status !== "complete" && transfer.status === "complete") {
          this.result = t("cypher.sendComplete", { amount: transfer.amount });
        }
      }
      this.transfers = result.transfers;
    }
  }

  private invalidateQuote(): void {
    this.quote = null;
    this.confirmed = false;
    this.sendRequestId = null;
    this.clearPasswords();
  }

  private async refresh(quiet = false): Promise<void> {
    await this.readSetup();
    await this.refreshNode(quiet);
  }

  private async refreshNode(quiet = false): Promise<void> {
    await this.request<CypherStatus>(
      "cypher.status",
      {},
      (status) => this.acceptStatus(status),
      false,
      quiet,
    );
  }

  private async statusAction(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.request<CypherStatus>(method, params, (status) => {
      this.acceptStatus(status);
      this.result = t(
        status.state === "stopping" ? "cypher.stopRequested" : "cypher.success",
        {},
        this.context.host.locale,
      );
    });
  }

  private async action(action: CypherAction): Promise<void> {
    switch (action) {
      case "setup-refresh":
        return this.readSetup();
      case "setup-prepare":
        if (!this.setup || this.setup.state === "preparing") {
          return;
        }
        await this.request<NativeSetupStatus>(
          "cypher.setup.prepare",
          {},
          (setup) => this.acceptSetup(setup),
          true,
        );
        await this.readSetup();
        return;
      case "wallet-refresh":
        return this.refresh();
      case "wallet-previous":
      case "wallet-next":
        if (this.wallets) {
          this.wallets = {
            ...this.wallets,
            offset: Math.max(
              0,
              this.wallets.offset +
                (action === "wallet-next" ? this.wallets.limit : -this.wallets.limit),
            ),
          };
        }
        return this.refresh();
      case "prepare":
        this.invalidateQuote();
        await this.request<CypherTransferQuote>(
          "cypher.transfers.prepare",
          {
            from: this.walletAddress,
            to: this.sendRecipient.trim(),
            amount: this.amount.trim(),
          },
          (quote) => {
            this.quote = quote;
            this.sendRequestId = crypto.randomUUID();
          },
        );
        return;
      case "send": {
        const password = this.takePassword("cypher-send-password");
        if (!this.quote || !this.confirmed || !this.sendRequestId) {
          return;
        }
        if (this.quote.expiresAt <= Date.now()) {
          this.invalidateQuote();
          this.error = t("cypher.quoteExpired");
          return;
        }
        await this.request<CypherTransferRecord>(
          "cypher.transfers.send",
          {
            requestId: this.sendRequestId,
            quoteId: this.quote.quoteId,
            password,
          },
          (transfer) => {
            this.transfers = [
              transfer,
              ...this.transfers.filter((item) => item.requestId !== transfer.requestId),
            ];
            this.quote = null;
            this.confirmed = false;
            this.sendRequestId = null;
            if (transfer.status === "failed") {
              const reason = t(
                transfer.errorCode === "CYPHER_ADMISSION_REQUIRED"
                  ? "cypher.sendAdmissionRejected"
                  : transfer.errorCode === "CYPHER_EXECUTION_FAILED"
                    ? "cypher.sendExecutionFailed"
                    : "cypher.sendFailedHint",
              );
              this.error = t("cypher.sendFailed", { reason });
            } else {
              this.result =
                transfer.status === "unknown"
                  ? t("cypher.sendUnknown")
                  : transfer.status === "complete"
                    ? t("cypher.sendComplete", { amount: transfer.amount })
                    : t("cypher.sendAccepted");
            }
          },
        );
        return;
      }
      case "cancel-quote":
        this.invalidateQuote();
        return;
      case "copy-wallet": {
        const address = this.walletAddress;
        const scope = this.gateway.capture();
        if (!scope) {
          return;
        }
        const current = () => this.gateway.isCurrent(scope) && this.walletAddress === address;
        const copied = await copyToClipboard(address, current);
        if (current()) {
          this.result = copied ? t("cypher.addressCopied") : null;
          this.error = copied ? null : t("cypher.copyFailed");
        }
        return;
      }
      case "refresh":
        return this.refresh();
      case "start":
      case "stop":
      case "connect":
      case "disconnect":
        return this.statusAction(`cypher.${action}`);
      case "select":
        return this.statusAction("cypher.accounts.select", { address: this.selectedAccount });
      case "create": {
        const password = this.takePassword("cypher-account-password");
        await this.request<{ address: string }>(
          "cypher.accounts.create",
          { password },
          (value) => {
            this.walletAddress = value.address;
            this.invalidateQuote();
            this.result = t("cypher.created", { address: value.address });
          },
          true,
        );
        return;
      }
      case "unlock": {
        const password = this.takePassword("cypher-account-password");
        const duration = Number(this.duration);
        if (!Number.isInteger(duration) || duration < 1 || duration > 86400) {
          this.error = t("cypher.durationInvalid");
          return;
        }
        await this.request<{ unlocked: boolean }>(
          "cypher.accounts.unlock",
          { address: this.walletAddress, password, duration },
          (value) => {
            this.result = t(value.unlocked ? "cypher.unlocked" : "cypher.refused");
          },
        );
        return;
      }
      case "lock":
        await this.request<{ locked: boolean }>(
          "cypher.accounts.lock",
          { address: this.walletAddress },
          (value) => {
            this.result = t(value.locked ? "cypher.locked" : "cypher.refused");
          },
        );
        return;
      case "mining-start": {
        const password = this.takePassword("cypher-mining-password");
        const threads = Number(this.threads);
        if (!Number.isInteger(threads) || threads < 1 || threads > 256) {
          this.error = t("cypher.threadsInvalid");
          return;
        }
        return this.statusAction("cypher.mining.start", {
          threads,
          signer: this.selectedAccount,
          password,
        });
      }
      case "mining-stop":
        return this.statusAction("cypher.mining.stop");
      case "reward-get":
        await this.request<CypherRewardRegistration>(
          "cypher.reward.get",
          { signer: this.selectedAccount },
          (value) => {
            this.reward = value;
            this.recipient = value.rewardRecipient ?? "";
          },
        );
        return;
      case "reward-set": {
        const password = this.takePassword("cypher-reward-password");
        const recipient = this.recipient.trim();
        if (!/^0x[0-9a-fA-F]{40}$/u.test(recipient)) {
          this.error = t("cypher.recipientInvalid");
          return;
        }
        await this.request<CypherRewardRegistration>(
          "cypher.reward.set",
          { signer: this.selectedAccount, recipient, password },
          (value) => {
            this.reward = value;
            this.result = t("cypher.rewardUpdated");
          },
        );
      }
    }
  }

  override render() {
    return renderCypher({
      context: this.context,
      setup: this.setup,
      setupError: this.setupError,
      tab: this.tab,
      wallets: this.wallets,
      walletAddress: this.walletAddress,
      transfers: this.transfers,
      quote: this.quote,
      sendRecipient: this.sendRecipient,
      amount: this.amount,
      confirmed: this.confirmed,
      explorerQuery: this.explorerQuery,
      onTab: (tab) => {
        this.clearPasswords();
        this.tab = tab;
        if (!this.busy) {
          void this.refresh(true);
        }
      },
      onWallet: (address) => {
        this.walletAddress = address;
        this.invalidateQuote();
      },
      onSendRecipient: (value) => {
        this.sendRecipient = value;
        this.invalidateQuote();
      },
      onAmount: (value) => {
        this.amount = value;
        this.invalidateQuote();
      },
      onConfirmed: (value) => {
        this.confirmed = value;
      },
      onExplorerQuery: (value) => {
        this.explorerQuery = value;
      },
      status: this.status,
      reward: this.reward,
      connected: this.gateway.connected,
      canRead: this.gateway.canRead,
      canAdmin: this.gateway.canAdmin,
      busy: this.busy,
      error: this.error,
      result: this.result,
      selectedAccount: this.selectedAccount,
      recipient: this.recipient,
      threads: this.threads,
      duration: this.duration,
      allowed: (method) => this.allowed(method),
      onAction: (action) => void this.action(action),
      onAccount: (address) => {
        this.selectedAccount = address;
        this.reward = null;
        this.recipient = "";
        this.clearPasswords();
      },
      onRecipient: (value) => {
        this.recipient = value;
      },
      onThreads: (value) => {
        this.threads = value;
      },
      onDuration: (value) => {
        this.duration = value;
      },
    });
  }
}

// Every browser asset revision owns its constructor, including explicit UI reloads.
customElements.define(
  `cypher-plugin-page-${crypto.getRandomValues(new Uint32Array(2)).join("-")}`,
  CypherPage,
);
