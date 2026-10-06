import { consume } from "@lit/context";
import { state } from "lit/decorators.js";
import type { CypherRewardRegistration, CypherStatus } from "../../../../src/cypher/types.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { t } from "../../i18n/index.ts";
import { registerCypherEnglish } from "../../i18n/locales/en-cypher.ts";
import { formatUiError } from "../../lib/format-error.ts";
import { canCallGatewayMethod, isGatewayMethodAdvertised } from "../../lib/gateway-methods.ts";
import { GatewayPageController } from "../../lit/gateway-page-controller.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { PollController } from "../../lit/poll-controller.ts";
import { renderCypher, type CypherAction } from "./view.ts";

registerCypherEnglish();

class CypherPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context!: ApplicationContext;

  @state() private status: CypherStatus | null = null;
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
      this.selectedAccount = "";
      this.recipient = "";
      this.error = null;
      this.result = null;
    },
    invalidateRequests: () => this.cancelRequest(),
    ensureInitialData: () => void this.refresh(),
    onSnapshot: () => this.syncPolling(),
  });

  private allowed(method: string): boolean {
    return (
      !this.busy &&
      canCallGatewayMethod(
        this.gateway.snapshot,
        method,
        method === "cypher.status" ? "operator.read" : "operator.admin",
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
  ): Promise<void> {
    if (!this.allowed(method) || (quiet && this.pending)) {
      return;
    }
    const scope = this.gateway.capture();
    if (!scope) {
      return;
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
        method === "cypher.status" ? "operator.read" : "operator.admin",
      );
    try {
      const value = await scope.client.request<T>(method, params, {
        signal: pending.signal,
        ...(method === "cypher.stop" ? { timeoutMs: 35_000 } : {}),
      });
      if (!current()) {
        return;
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
    } catch (error) {
      if (current()) {
        this.error = formatUiError(error);
      }
    } finally {
      if (this.pending === pending) {
        this.pending = null;
        this.busy = null;
      }
    }
  }

  private refresh(quiet = false): Promise<void> {
    return this.request<CypherStatus>(
      "cypher.status",
      {},
      (status) => this.acceptStatus(status),
      false,
      quiet,
    );
  }

  private statusAction(method: string, params: Record<string, unknown> = {}): Promise<void> {
    return this.request<CypherStatus>(method, params, (status) => {
      this.acceptStatus(status);
      this.result = t("cypher.success");
    });
  }

  private action(action: CypherAction): Promise<void> | void {
    switch (action) {
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
        return this.request<{ address: string }>(
          "cypher.accounts.create",
          { password },
          (value) => {
            this.selectedAccount = value.address;
            this.reward = null;
            this.recipient = "";
            this.result = t("cypher.created", { address: value.address });
          },
          true,
        );
      }
      case "unlock": {
        const password = this.takePassword("cypher-account-password");
        const duration = Number(this.duration);
        if (!Number.isInteger(duration) || duration < 1 || duration > 86400) {
          this.error = t("cypher.durationInvalid");
          return;
        }
        return this.request<{ unlocked: boolean }>(
          "cypher.accounts.unlock",
          { address: this.selectedAccount, password, duration },
          (value) => {
            this.result = t(value.unlocked ? "cypher.unlocked" : "cypher.refused");
          },
        );
      }
      case "lock":
        return this.request<{ locked: boolean }>(
          "cypher.accounts.lock",
          { address: this.selectedAccount },
          (value) => {
            this.result = t(value.locked ? "cypher.locked" : "cypher.refused");
          },
        );
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
        return this.request<CypherRewardRegistration>(
          "cypher.reward.get",
          { signer: this.selectedAccount },
          (value) => {
            this.reward = value;
            this.recipient = value.rewardRecipient ?? "";
          },
        );
      case "reward-set": {
        const password = this.takePassword("cypher-reward-password");
        const recipient = this.recipient.trim();
        if (!/^0x[0-9a-fA-F]{40}$/u.test(recipient)) {
          this.error = t("cypher.recipientInvalid");
          return;
        }
        return this.request<CypherRewardRegistration>(
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
