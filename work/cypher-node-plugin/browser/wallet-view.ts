import { html, nothing } from "lit";
import type {
  WalletGeneratorResult,
  WalletGeneratorStatus,
} from "../src/wallet-generator/types.ts";
import { t } from "./i18n.ts";
import { renderSettingsRow, renderSettingsSection } from "./settings.ts";
import "./style.css";

type WalletGeneratorProps = {
  status: WalletGeneratorStatus | null;
  result: WalletGeneratorResult | null;
  connected: boolean;
  canRead: boolean;
  canGenerate: boolean;
  busy: "status" | "generate" | null;
  error: string | null;
  notice: string | null;
  revealed: boolean;
  onRefresh: () => void;
  onGenerate: () => void;
  onReveal: () => void;
  onCopy: (field: "address" | "privateKey") => void;
  onClear: () => void;
};

export function renderWalletGenerator(props: WalletGeneratorProps) {
  const status = props.status;
  const command = status?.binaryPath
    ? status.platform === "win32"
      ? `& '${status.binaryPath.replaceAll("'", "''")}'`
      : `'${status.binaryPath.replaceAll("'", "'\\''")}'`
    : "—";
  const notice = (text: string, alert = false) =>
    renderSettingsRow({ title: text, role: alert ? "alert" : "status" });
  const copyButton = (field: "address" | "privateKey") => html`
    <button
      class="btn"
      type="button"
      data-wallet-action=${`copy-${field}`}
      @click=${() => props.onCopy(field)}
    >
      ${t(field === "address" ? "walletGenerator.copyAddress" : "walletGenerator.copyKey")}
    </button>
  `;
  return renderSettingsSection(
    { title: t("walletGenerator.title"), description: t("walletGenerator.description") },
    html`
      ${!props.connected ? notice(t("walletGenerator.offline")) : nothing}
      ${props.connected && !props.canRead ? notice(t("walletGenerator.readRequired")) : nothing}
      ${props.connected && !props.canGenerate ? notice(t("walletGenerator.adminRequired")) : nothing}
      ${status && !status.supported ? notice(t("walletGenerator.unsupported")) : nothing}
      ${status?.supported && !status.available ? notice(t("walletGenerator.unavailable"), true) : nothing}
      ${props.error ? notice(props.error, true) : nothing}
      ${renderSettingsRow({
        title: t("walletGenerator.platform"),
        description: t("walletGenerator.executionHint"),
        control: html`<span class="settings-row__value settings-row__value--mono">
          ${status ? `${status.platform} / ${status.arch}` : "—"}
        </span>`,
      })}
      ${renderSettingsRow({
        title: t("walletGenerator.command"),
        stacked: true,
        control: html`<code class="wallet-generator-command">${command}</code>`,
      })}
      ${renderSettingsRow({
        title: t("walletGenerator.generate"),
        description: props.result ? t("walletGenerator.clearBeforeGenerate") : undefined,
        control: html`<div class="wallet-generator-actions">
          <button
            class="btn"
            type="button"
            data-wallet-action="refresh"
            ?disabled=${!props.canRead || Boolean(props.busy)}
            @click=${props.onRefresh}
          >
            ${t("walletGenerator.refresh")}
          </button>
          <button
            class="btn primary"
            type="button"
            data-wallet-action="generate"
            ?disabled=${!props.canGenerate || !status?.available || Boolean(props.busy) || Boolean(props.result)}
            @click=${props.onGenerate}
          >
            ${t(props.busy === "generate" ? "walletGenerator.generating" : "walletGenerator.generate")}
          </button>
        </div>`,
      })}
      ${props.busy === "status" ? notice(t("walletGenerator.checking")) : nothing}
      ${
        props.result
          ? html`
              ${renderSettingsRow({
                title: t("walletGenerator.address"),
                stacked: true,
                control: html`<div class="wallet-generator-result">
                  <code data-wallet-value="address" .textContent=${props.result.address}></code>
                  <div class="wallet-generator-actions">${copyButton("address")}</div>
                </div>`,
              })}
              ${renderSettingsRow({
                title: t("walletGenerator.privateKey"),
                description: t("walletGenerator.keyHint"),
                stacked: true,
                control: html`<div class="wallet-generator-result">
                  <code
                    data-wallet-value="privateKey"
                    aria-label=${props.revealed ? t("walletGenerator.privateKey") : t("walletGenerator.keyHidden")}
                    .textContent=${props.revealed ? props.result.privateKey : "••••••••••••••••••••••••"}
                  ></code>
                  <div class="wallet-generator-actions">
                    <button
                      class="btn"
                      type="button"
                      data-wallet-action="reveal"
                      aria-pressed=${props.revealed}
                      @click=${props.onReveal}
                    >
                      ${t(props.revealed ? "walletGenerator.hideKey" : "walletGenerator.showKey")}
                    </button>
                    ${copyButton("privateKey")}
                    <button
                      class="btn"
                      type="button"
                      data-wallet-action="clear"
                      @click=${props.onClear}
                    >
                      ${t("walletGenerator.clear")}
                    </button>
                  </div>
                </div>`,
              })}
            `
          : nothing
      }
      ${props.notice ? notice(props.notice) : nothing}
    `,
  );
}
