import { LitElement } from "lit";
import type { ControlUiViewContext } from "openclaw/plugin-sdk/control-ui";
import type { CypherRewardRegistration, CypherStatus } from "../src/cypher/types.ts";
import { PluginHostController } from "./host-controller.ts";
import { t } from "./i18n.ts";
import { renderCypher, type CypherAction } from "./node-view.ts";
import type { WalletGenerator } from "./wallet.ts";

type StatusMethod =
  | "cypher.status"
  | "cypher.start"
  | "cypher.stop"
  | "cypher.connect"
  | "cypher.disconnect"
  | "cypher.accounts.select"
  | "cypher.mining.start"
  | "cypher.mining.stop";
type NodeResponses = { [Method in StatusMethod]: CypherStatus } & {
  "cypher.accounts.create": { address: string };
  "cypher.accounts.unlock": { unlocked: boolean };
  "cypher.accounts.lock": { locked: boolean };
  "cypher.reward.get": CypherRewardRegistration;
  "cypher.reward.set": CypherRewardRegistration;
};

export class CypherPage extends LitElement {
  static override properties = {
    context: { attribute: false },
    status: { state: true },
    reward: { state: true },
    selectedAccount: { state: true },
    recipient: { state: true },
    threads: { state: true },
    duration: { state: true },
    busy: { state: true },
    error: { state: true },
    result: { state: true },
  };

  constructor() {
    super();
    this.status = null;
    this.reward = null;
    this.selectedAccount = "";
    this.recipient = "";
    this.threads = "1";
    this.duration = "300";
    this.busy = null;
    this.error = null;
    this.result = null;
  }

  override createRenderRoot() {
    return this;
  }
  declare context: ControlUiViewContext;

  declare private status: CypherStatus | null;
  declare private reward: CypherRewardRegistration | null;
  declare private selectedAccount: string;
  declare private recipient: string;
  declare private threads: string;
  declare private duration: string;
  declare private busy: string | null;
  declare private error: string | null;
  declare private result: string | null;
  private pending: symbol | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisibility = () => {
    this.syncPolling();
    if (this.timer !== null) {
      void this.refresh(true);
    }
  };

  private readonly gateway = new PluginHostController(this, {
    getContext: () => this.context,
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

  updateContext(context: ControlUiViewContext): void {
    this.context = context;
    // View transitions must invalidate secrets even when Lit batches hide/show into one render.
    this.querySelector<WalletGenerator>(".cypher-plugin-wallet")?.updateContext(context);
    this.gateway.synchronize();
  }

  private permitted(method: string): boolean {
    return method === "cypher.status" ? this.gateway.canRead : this.gateway.canAdmin;
  }

  private allowed(method: string): boolean {
    return !this.busy && this.permitted(method);
  }

  private syncPolling(): void {
    const active =
      this.gateway.connected &&
      document.visibilityState !== "hidden" &&
      (this.status?.connected ||
        this.status?.state === "starting" ||
        this.status?.state === "running" ||
        this.status?.state === "stopping");
    if (active && this.timer === null) {
      this.timer = setInterval(() => void this.refresh(true), 3000);
    } else if (!active && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibility);
    globalThis.addEventListener("pagehide", this.onPageHide);
  }

  private readonly onPageHide = () => this.cancelRequest();

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
      this.result = status.state === "stopped" ? t("cypher.stopComplete") : null;
    }
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

  private async request<Method extends keyof NodeResponses>(
    method: Method,
    params: Record<string, unknown>,
    accept: (value: NodeResponses[Method]) => void,
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
    const pending = Symbol(method);
    this.pending = pending;
    if (!quiet) {
      this.busy = method;
      this.error = null;
      this.result = null;
    }
    const current = () =>
      this.pending === pending && this.gateway.isCurrent(scope) && this.permitted(method);
    try {
      const value = await scope.client.request<NodeResponses[Method]>(method, params);
      if (!current()) {
        return;
      }
      accept(value);
      if (refresh) {
        const status = await scope.client.request<CypherStatus>("cypher.status", {});
        if (current()) {
          this.acceptStatus(status);
        }
      }
    } catch (error) {
      if (current()) {
        this.error = this.context.host.redact(
          error instanceof Error ? error.message : t("cypher.requestFailed"),
        );
      }
    } finally {
      if (this.pending === pending) {
        this.pending = null;
        this.busy = null;
      }
    }
  }

  private refresh(quiet = false): Promise<void> {
    return this.request("cypher.status", {}, (status) => this.acceptStatus(status), false, quiet);
  }

  private statusAction(method: StatusMethod, params: Record<string, unknown> = {}): Promise<void> {
    return this.request(method, params, (status) => {
      this.acceptStatus(status);
      this.result = t(status.state === "stopping" ? "cypher.stopRequested" : "cypher.success");
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
        return this.request(
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
        return this.request(
          "cypher.accounts.unlock",
          { address: this.selectedAccount, password, duration },
          (value) => {
            this.result = t(value.unlocked ? "cypher.unlocked" : "cypher.refused");
          },
        );
      }
      case "lock":
        return this.request("cypher.accounts.lock", { address: this.selectedAccount }, (value) => {
          this.result = t(value.locked ? "cypher.locked" : "cypher.refused");
        });
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
        return this.request("cypher.reward.get", { signer: this.selectedAccount }, (value) => {
          this.reward = value;
          this.recipient = value.rewardRecipient ?? "";
        });
      case "reward-set": {
        const password = this.takePassword("cypher-reward-password");
        const recipient = this.recipient.trim();
        if (!/^0x[0-9a-fA-F]{40}$/u.test(recipient)) {
          this.error = t("cypher.recipientInvalid");
          return;
        }
        return this.request(
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

// A reloaded plugin module must not reuse a previous version's global element constructor.
customElements.define(
  `cypher-plugin-page-${crypto.getRandomValues(new Uint32Array(2)).join("-")}`,
  CypherPage,
);
