import { Show } from "solid-js";
import type {
  WalletGeneratorResult,
  WalletGeneratorStatus,
} from "../../../../src/wallet-generator/types.ts";
import { registerWalletGeneratorEnglish } from "../../i18n/locales/en-wallet-generator.ts";
import { registerEnglishCatalog, t } from "../../lib/reactive/i18n.ts";
import { SettingsRow, SettingsSection } from "../solid/settings-ui.tsx";

registerEnglishCatalog(registerWalletGeneratorEnglish);

export type WalletGeneratorViewProps = {
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

function generatorCommand(status: WalletGeneratorStatus | null): string {
  if (!status?.binaryPath) {
    return "—";
  }
  return status.platform === "win32"
    ? `& '${status.binaryPath.replaceAll("'", "''")}'`
    : `'${status.binaryPath.replaceAll("'", "'\\''")}'`;
}

function Notice(props: { text: string; alert?: boolean }) {
  return <SettingsRow title={props.text} role={props.alert ? "alert" : "status"} />;
}

function CopyButton(props: {
  field: "address" | "privateKey";
  onCopy: (field: "address" | "privateKey") => void;
}) {
  return (
    <button
      class="btn"
      type="button"
      data-wallet-action={`copy-${props.field}`}
      onClick={() => props.onCopy(props.field)}
    >
      {t(props.field === "address" ? "walletGenerator.copyAddress" : "walletGenerator.copyKey")}
    </button>
  );
}

export function WalletGeneratorView(props: WalletGeneratorViewProps) {
  const command = () => generatorCommand(props.status);
  return (
    <SettingsSection
      title={t("walletGenerator.title")}
      description={t("walletGenerator.description")}
    >
      <Show when={!props.connected}>
        <Notice text={t("walletGenerator.offline")} />
      </Show>
      <Show when={props.connected && !props.canRead}>
        <Notice text={t("walletGenerator.readRequired")} />
      </Show>
      <Show when={props.connected && !props.canGenerate}>
        <Notice text={t("walletGenerator.adminRequired")} />
      </Show>
      <Show when={props.status && !props.status.supported}>
        <Notice text={t("walletGenerator.unsupported")} />
      </Show>
      <Show when={props.status?.supported && !props.status.available}>
        <Notice text={t("walletGenerator.unavailable")} alert />
      </Show>
      <Show when={props.error}>
        <Notice text={props.error ?? ""} alert />
      </Show>
      <SettingsRow
        title={t("walletGenerator.platform")}
        description={t("walletGenerator.executionHint")}
        control={
          <span class="settings-row__value settings-row__value--mono">
            {props.status ? `${props.status.platform} / ${props.status.arch}` : "—"}
          </span>
        }
      />
      <SettingsRow
        title={t("walletGenerator.command")}
        stacked
        control={<code class="wallet-generator-command">{command()}</code>}
      />
      <SettingsRow
        title={t("walletGenerator.generate")}
        description={props.result ? t("walletGenerator.clearBeforeGenerate") : undefined}
        control={
          <div class="wallet-generator-actions">
            <button
              class="btn"
              type="button"
              data-wallet-action="refresh"
              disabled={!props.canRead || Boolean(props.busy)}
              onClick={() => props.onRefresh()}
            >
              {t("walletGenerator.refresh")}
            </button>
            <button
              class="btn primary"
              type="button"
              data-wallet-action="generate"
              disabled={
                !props.canGenerate ||
                !props.status?.available ||
                Boolean(props.busy) ||
                Boolean(props.result)
              }
              onClick={() => props.onGenerate()}
            >
              {t(
                props.busy === "generate"
                  ? "walletGenerator.generating"
                  : "walletGenerator.generate",
              )}
            </button>
          </div>
        }
      />
      <Show when={props.busy === "status"}>
        <Notice text={t("walletGenerator.checking")} />
      </Show>
      <Show when={props.result}>
        {(result) => (
          <>
            <SettingsRow
              title={t("walletGenerator.address")}
              stacked
              control={
                <div class="wallet-generator-result">
                  <code data-wallet-value="address">{result().address}</code>
                  <div class="wallet-generator-actions">
                    <CopyButton field="address" onCopy={props.onCopy} />
                  </div>
                </div>
              }
            />
            <SettingsRow
              title={t("walletGenerator.privateKey")}
              description={t("walletGenerator.keyHint")}
              stacked
              control={
                <div class="wallet-generator-result">
                  <code
                    data-wallet-value="privateKey"
                    aria-label={
                      props.revealed
                        ? t("walletGenerator.privateKey")
                        : t("walletGenerator.keyHidden")
                    }
                  >
                    {props.revealed ? result().privateKey : "••••••••••••••••••••••••"}
                  </code>
                  <div class="wallet-generator-actions">
                    <button
                      class="btn"
                      type="button"
                      data-wallet-action="reveal"
                      aria-pressed={props.revealed ? "true" : "false"}
                      onClick={() => props.onReveal()}
                    >
                      {t(props.revealed ? "walletGenerator.hideKey" : "walletGenerator.showKey")}
                    </button>
                    <CopyButton field="privateKey" onCopy={props.onCopy} />
                    <button
                      class="btn"
                      type="button"
                      data-wallet-action="clear"
                      onClick={() => props.onClear()}
                    >
                      {t("walletGenerator.clear")}
                    </button>
                  </div>
                </div>
              }
            />
          </>
        )}
      </Show>
      <Show when={props.notice}>
        <Notice text={props.notice ?? ""} />
      </Show>
    </SettingsSection>
  );
}
