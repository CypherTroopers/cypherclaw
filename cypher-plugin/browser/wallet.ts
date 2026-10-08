import { LitElement } from "lit";
import type { ControlUiViewContext } from "openclaw/plugin-sdk/control-ui";
import type {
  WalletGeneratorResult,
  WalletGeneratorStatus,
} from "../src/wallet-generator/types.ts";
import { copyToClipboard } from "./clipboard.ts";
import { PluginHostController } from "./host-controller.ts";
import { t } from "./i18n.ts";
import { renderWalletGenerator } from "./wallet-view.ts";

type WalletGeneratorResponses = {
  status: WalletGeneratorStatus;
  generate: WalletGeneratorResult;
};

export class WalletGenerator extends LitElement {
  static override properties = {
    context: { attribute: false },
    status: { state: true },
    result: { state: true },
    busy: { state: true },
    error: { state: true },
    notice: { state: true },
    revealed: { state: true },
  };

  constructor() {
    super();
    this.status = null;
    this.result = null;
    this.busy = null;
    this.error = null;
    this.notice = null;
    this.revealed = false;
  }

  override createRenderRoot() {
    return this;
  }
  declare context: ControlUiViewContext;

  declare private status: WalletGeneratorStatus | null;
  declare private result: WalletGeneratorResult | null;
  declare private busy: "status" | "generate" | null;
  declare private error: string | null;
  declare private notice: string | null;
  declare private revealed: boolean;
  private pending: symbol | null = null;

  private readonly gateway = new PluginHostController(this, {
    getContext: () => this.context,
    invalidateRequests: () => {
      this.clear();
      this.status = null;
    },
    ensureInitialData: () => void this.refresh(),
    onSnapshot: () => {
      if (this.result && !this.allowed("generate")) {
        this.clear();
      }
    },
  });

  updateContext(context: ControlUiViewContext): void {
    this.context = context;
    this.gateway.synchronize();
  }

  private readonly onPageHide = () => this.clear();

  override connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener("pagehide", this.onPageHide);
  }

  override disconnectedCallback(): void {
    globalThis.removeEventListener("pagehide", this.onPageHide);
    this.clear();
    super.disconnectedCallback();
  }

  private allowed(action: "status" | "generate"): boolean {
    return action === "status" ? this.gateway.canRead : this.gateway.canAdmin;
  }

  private clear(): void {
    this.pending = null;
    this.busy = null;
    this.result = null;
    this.revealed = false;
    this.error = null;
    this.notice = null;
    // Remove revealed values synchronously, before a pagehide can preserve the document.
    for (const output of this.querySelectorAll("[data-wallet-value]")) {
      output.textContent = "";
    }
  }

  private async request<Action extends keyof WalletGeneratorResponses>(
    action: Action,
    accept: (value: WalletGeneratorResponses[Action]) => void,
  ): Promise<void> {
    if (this.pending || !this.allowed(action)) {
      return;
    }
    const scope = this.gateway.capture();
    if (!scope) {
      return;
    }
    const pending = Symbol(action);
    this.pending = pending;
    this.busy = action;
    this.error = null;
    this.notice = null;
    const current = () =>
      this.pending === pending &&
      this.isConnected &&
      this.gateway.isCurrent(scope) &&
      this.allowed(action);
    try {
      const value = await scope.client.request<WalletGeneratorResponses[Action]>(
        `cypher.wallet.generator.${action}`,
        {},
      );
      if (current()) {
        accept(value);
      }
    } catch {
      if (current()) {
        // Process and transport failures may contain raw output; never render their messages.
        this.error = t(
          action === "status" ? "walletGenerator.statusFailed" : "walletGenerator.generateFailed",
        );
      }
    } finally {
      if (this.pending === pending) {
        this.pending = null;
        this.busy = null;
      }
    }
  }

  private refresh(): Promise<void> {
    return this.request("status", (status) => {
      this.status = status;
    });
  }

  private generate(): Promise<void> | void {
    if (this.result || !this.status?.available) {
      return;
    }
    return this.request("generate", (result) => {
      this.result = result;
      this.revealed = false;
    });
  }

  private async copy(field: "address" | "privateKey"): Promise<void> {
    const result = this.result;
    const scope = this.gateway.capture();
    if (!result || !scope || !this.allowed("generate")) {
      return;
    }
    const current = () =>
      this.isConnected &&
      this.result === result &&
      this.gateway.isCurrent(scope) &&
      this.allowed("generate");
    const copied = await copyToClipboard(result[field], current);
    if (current()) {
      this.notice = copied
        ? t(field === "address" ? "walletGenerator.addressCopied" : "walletGenerator.keyCopied")
        : t("walletGenerator.copyFailed");
    }
  }

  override render() {
    return renderWalletGenerator({
      status: this.status,
      result: this.result,
      connected: this.gateway.connected,
      canRead: this.allowed("status"),
      canGenerate: this.allowed("generate"),
      busy: this.busy,
      error: this.error,
      notice: this.notice,
      revealed: this.revealed,
      onRefresh: () => void this.refresh(),
      onGenerate: () => void this.generate(),
      onReveal: () => {
        this.revealed = !this.revealed;
      },
      onCopy: (field) => void this.copy(field),
      onClear: () => this.clear(),
    });
  }
}

export const walletElementName = `cypher-plugin-wallet-${crypto.getRandomValues(new Uint32Array(2)).join("-")}`;
customElements.define(walletElementName, WalletGenerator);
