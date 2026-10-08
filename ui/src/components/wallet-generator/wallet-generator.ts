import { consume } from "@lit/context";
import { state } from "lit/decorators.js";
import type {
  WalletGeneratorResult,
  WalletGeneratorStatus,
} from "../../../../src/wallet-generator/types.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { t } from "../../i18n/index.ts";
import { registerWalletGeneratorEnglish } from "../../i18n/locales/en-wallet-generator.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import { canCallGatewayMethod } from "../../lib/gateway-methods.ts";
import { GatewayPageController } from "../../lit/gateway-page-controller.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { renderWalletGenerator } from "./view.ts";

registerWalletGeneratorEnglish();

type WalletGeneratorResponses = {
  status: WalletGeneratorStatus;
  generate: WalletGeneratorResult;
};

class WalletGenerator extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context!: ApplicationContext;

  @state() private status: WalletGeneratorStatus | null = null;
  @state() private result: WalletGeneratorResult | null = null;
  @state() private busy: "status" | "generate" | null = null;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  @state() private revealed = false;
  private pending: AbortController | null = null;

  private readonly gateway = new GatewayPageController(this, {
    getGateway: () => this.context?.gateway,
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
    return canCallGatewayMethod(
      this.gateway.snapshot,
      `wallet.generator.${action}`,
      action === "status" ? "operator.read" : "operator.admin",
      { requireAdvertisement: false },
    );
  }

  private clear(): void {
    this.pending?.abort();
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
    const pending = new AbortController();
    this.pending = pending;
    this.busy = action;
    this.error = null;
    this.notice = null;
    const current = () =>
      this.pending === pending &&
      this.isConnected &&
      this.context?.gateway === this.gateway.gateway &&
      this.gateway.isCurrent(scope) &&
      this.allowed(action);
    try {
      const value = await scope.client.request<WalletGeneratorResponses[Action]>(
        `wallet.generator.${action}`,
        {},
        { signal: pending.signal, timeoutMs: 35_000 },
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
      this.context?.gateway === this.gateway.gateway &&
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

if (!customElements.get("openclaw-wallet-generator")) {
  customElements.define("openclaw-wallet-generator", WalletGenerator);
}
