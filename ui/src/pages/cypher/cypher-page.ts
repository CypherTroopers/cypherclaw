import { consume } from "@lit/context";
import { state } from "lit/decorators.js";
import type {
  CypherRewardRegistration,
  CypherStatus,
  CypherWallets,
  CypherTransferQuote,
  CypherTransferRecord,
} from "../../../../src/cypher/types.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { t } from "../../i18n/index.ts";
import { registerCypherEnglish } from "../../i18n/locales/en-cypher.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import { formatUiError } from "../../lib/format-error.ts";
import { canCallGatewayMethod, isGatewayMethodAdvertised } from "../../lib/gateway-methods.ts";
import { showToast } from "../../lib/toast.ts";
import { GatewayPageController } from "../../lit/gateway-page-controller.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { PollController } from "../../lit/poll-controller.ts";
import { renderCypher, type CypherAction, type CypherTab } from "./view.ts";

registerCypherEnglish();

class CypherPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context!: ApplicationContext;

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

  private readonly polling = new PollController(
    this,
    3000,
    () => void this.refresh(true),
    false,
    "visible",
  );

  private readonly gateway = new GatewayPageController(this, {
    getGateway: () => this.context?.gateway,
    onIdentityChange: () => {
      this.status = null;
      this.reward = null;
      this.wallets = null;
      this.transfers = [];
      this.walletAddress = "";
      this.quote = null;
      this.confirmed = false;
      this.sendRequestId = null;
      this.sendRecipient = "";
      this.amount = "";
      this.selectedAccount = "";
      this.recipient = "";
      this.error = null;
      this.result = null;
    },
    invalidateRequests: () => this.cancelRequest(),
    ensureInitialData: () => void this.refresh(),
    onSnapshot: () => {
      this.syncPolling();
      if (!this.gateway.snapshot?.hello?.auth?.scopes?.includes("operator.admin")) {
        this.clearPasswords();
        this.invalidateQuote();
      }
    },
  });

  private readMethod(method: string): boolean {
    return (
      method === "cypher.status" ||
      method === "cypher.wallets.list" ||
      method === "cypher.transfers.list"
    );
  }

  private allowed(method: string): boolean {
    return (
      !this.busy &&
      canCallGatewayMethod(
        this.gateway.snapshot,
        method,
        this.readMethod(method) ? "operator.read" : "operator.admin",
      )
    );
  }

  private syncPolling(): void {
    if (
      this.gateway.connected &&
      (this.status?.connected ||
        this.status?.state === "starting" ||
        this.status?.state === "running")
    ) {
      this.polling.start();
    } else {
      this.polling.stop();
    }
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
    this.pending = null;
    this.busy = null;
    this.clearPasswords();
  }

  override disconnectedCallback(): void {
    this.cancelRequest();
    super.disconnectedCallback();
  }

  private acceptStatus(status: CypherStatus): void {
    this.status = status;
    this.syncPolling();
    if (!status.connected) {
      this.wallets = null;
      this.quote = null;
      this.confirmed = false;
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
    const current = () =>
      this.pending === pending &&
      this.gateway.isCurrent(scope) &&
      canCallGatewayMethod(
        this.gateway.snapshot,
        method,
        this.readMethod(method) ? "operator.read" : "operator.admin",
      );
    try {
      const value = await scope.client.request<T>(method, params, {
        signal: pending.signal,
        ...(method === "cypher.stop"
          ? { timeoutMs: 35_000 }
          : method === "cypher.transfers.send"
            ? { timeoutMs: 180_000 }
            : {}),
      });
      if (!current()) {
        return undefined;
      }
      accept(value);
      if (refresh) {
        const status = await scope.client.request<CypherStatus>(
          "cypher.status",
          {},
          {
            signal: pending.signal,
          },
        );
        if (current()) {
          this.acceptStatus(status);
        }
      }
      if (current()) {
        await this.refreshDetails(scope.client, pending.signal, current, !quiet);
      }
      return current() ? value : undefined;
    } catch (error) {
      if (current()) {
        this.error = formatUiError(error);
        if (method === "cypher.transfers.send") {
          try {
            await this.refreshDetails(scope.client, pending.signal, current, true);
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
      }
    }
  }

  private async refreshDetails(
    client: NonNullable<ReturnType<GatewayPageController["capture"]>>["client"],
    signal: AbortSignal,
    current: () => boolean,
    force: boolean,
  ): Promise<void> {
    if (
      this.status?.connected &&
      (force || this.tab === "wallets" || this.tab === "send" || !this.wallets)
    ) {
      const wallets = await client.request<CypherWallets>(
        "cypher.wallets.list",
        {
          offset: this.wallets?.offset ?? 0,
          limit: 25,
        },
        { signal },
      );
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
        { signal },
      );
      if (!current()) {
        return;
      }
      for (const transfer of result.transfers) {
        const previous = this.transfers.find((item) => item.requestId === transfer.requestId);
        if (previous && previous.status !== "complete" && transfer.status === "complete") {
          showToast({
            message: t("cypher.sendComplete", { amount: transfer.amount }),
            placement: "bottom",
          });
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
      this.result = t("cypher.success");
    });
  }

  private async action(action: CypherAction): Promise<void> {
    switch (action) {
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
      case "copy-wallet":
        return copyToClipboard(this.walletAddress)
          .then((copied) => {
            this.result = copied ? t("cypher.addressCopied") : null;
            if (!copied) {
              this.error = t("cypher.copyFailed");
            }
          })
          .catch((error: unknown) => {
            this.error = formatUiError(error);
          });
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
      available: isGatewayMethodAdvertised(this.gateway.snapshot ?? {}, "cypher.status") === true,
      canRead: canCallGatewayMethod(this.gateway.snapshot, "cypher.status", "operator.read"),
      canAdmin: this.gateway.snapshot?.hello?.auth?.scopes?.includes("operator.admin") === true,
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

if (!customElements.get("openclaw-cypher-page")) {
  customElements.define("openclaw-cypher-page", CypherPage);
}
