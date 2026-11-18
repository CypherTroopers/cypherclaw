import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type {
  CypherNetwork,
  CypherRewardRegistration,
  CypherStatus,
  CypherTransferQuote,
  CypherTransferRecord,
  CypherWallets,
} from "../../../../src/cypher/types.ts";
import { HubTabs } from "../../components/solid/hub-tabs.tsx";
import {
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsStatus,
} from "../../components/solid/settings-ui.tsx";
import { SettingsWorkspace } from "../../components/solid/settings-workspace.tsx";
import { TabPanel } from "../../components/solid/tabs.tsx";
import { WalletGenerator } from "../../components/wallet-generator/wallet-generator.tsx";
import { registerCypherEnglish } from "../../i18n/locales/en-cypher.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../../lib/external-link.ts";
import { registerEnglishCatalog, t } from "../../lib/reactive/i18n.ts";

registerEnglishCatalog(registerCypherEnglish);

export const CYPHER_TABS = ["overview", "node", "wallets", "send", "mining", "explorer"] as const;
export type CypherTab = (typeof CYPHER_TABS)[number];

export type CypherAction =
  | "wallet-refresh"
  | "wallet-previous"
  | "wallet-next"
  | "prepare"
  | "send"
  | "cancel-quote"
  | "copy-wallet"
  | "refresh"
  | "start"
  | "stop"
  | "connect"
  | "disconnect"
  | "select"
  | "create"
  | "unlock"
  | "lock"
  | "mining-start"
  | "mining-stop"
  | "reward-get"
  | "reward-set";

export type CypherViewProps = {
  tab: CypherTab;
  wallets: CypherWallets | null;
  walletAddress: string;
  transfers: CypherTransferRecord[];
  quote: CypherTransferQuote | null;
  sendRecipient: string;
  amount: string;
  confirmed: boolean;
  explorerQuery: string;
  onTab: (tab: CypherTab) => void;
  onWallet: (value: string) => void;
  onSendRecipient: (value: string) => void;
  onAmount: (value: string) => void;
  onConfirmed: (value: boolean) => void;
  onExplorerQuery: (value: string) => void;
  status: CypherStatus | null;
  reward: CypherRewardRegistration | null;
  connected: boolean;
  available: boolean;
  canRead: boolean;
  canAdmin: boolean;
  busy: string | null;
  error: string | null;
  result: string | null;
  selectedAccount: string;
  recipient: string;
  threads: string;
  duration: string;
  allowed: (method: string) => boolean;
  onAction: (action: CypherAction) => void;
  onAccount: (value: string) => void;
  onRecipient: (value: string) => void;
  onThreads: (value: string) => void;
  onDuration: (value: string) => void;
};

const EXPLORER_BASE = "https://colossusx.make-cph-great-again.community";
const EXPLORER_GENESIS = "0x001c8239f25a697933e2a54511a576205fb21cbb80dc974adb29894dc80250ad";

function explorerMatches(network: CypherNetwork | null | undefined): boolean {
  return Boolean(
    network &&
    /^0x[0-9a-f]+$/iu.test(network.chainId) &&
    BigInt(network.chainId) === 10101919n &&
    network.genesisHash.toLowerCase() === EXPLORER_GENESIS,
  );
}

function explorerHref(query: string, network: CypherNetwork | null | undefined): string | null {
  if (!explorerMatches(network)) {
    return null;
  }
  const value = query.trim();
  if (/^0x[0-9a-f]{40}$/iu.test(value)) {
    return `${EXPLORER_BASE}/address/${value}`;
  }
  if (/^0x[0-9a-f]{64}$/iu.test(value)) {
    return `${EXPLORER_BASE}/tx/${value}`;
  }
  if (/^[0-9]{1,20}$/u.test(value)) {
    return `${EXPLORER_BASE}/block/${value}`;
  }
  return null;
}

function quantityDisplay(value: string | null | undefined): string | null | undefined {
  return value && /^0x[0-9a-f]+$/iu.test(value) ? BigInt(value).toString() : value;
}

function Notice(props: { text: string; alert?: boolean }) {
  return (
    <div class="settings-row" role={props.alert ? "alert" : "status"}>
      <span class="settings-row__desc">{props.text}</span>
    </div>
  );
}

function ActionButton(props: {
  action: CypherAction;
  label: string;
  enabled: boolean;
  onAction: (action: CypherAction) => void;
}) {
  return (
    <button
      class="btn"
      type="button"
      data-cypher-action={props.action}
      disabled={!props.enabled}
      onClick={() => props.onAction(props.action)}
    >
      {t(props.label)}
    </button>
  );
}

function ValueRow(props: { label: string; value: string | null | undefined }) {
  return (
    <SettingsRow
      title={t(props.label)}
      control={
        <span class="settings-row__value settings-row__value--mono">
          {props.value || t("cypher.unknown")}
        </span>
      }
    />
  );
}

function PasswordField(props: { id: string; label: string; disabled: boolean }) {
  return (
    <label class="field">
      <span>{t(props.label)}</span>
      <input
        id={props.id}
        class="settings-input"
        type="password"
        autocomplete="new-password"
        autocapitalize="off"
        spellcheck={false}
        disabled={props.disabled}
      />
    </label>
  );
}

function ExplorerLink(props: {
  value: string;
  label: string;
  network: CypherNetwork | null | undefined;
}) {
  return (
    <Show when={explorerHref(props.value, props.network)}>
      {(href) => (
        <a
          class="btn cypher-explorer-link"
          href={href()}
          target={EXTERNAL_LINK_TARGET}
          rel={buildExternalLinkRel()}
        >
          {t(props.label)}
        </a>
      )}
    </Show>
  );
}

function WalletSelect(props: {
  id: string;
  accounts: string[];
  walletAddress: string;
  connected: boolean;
  busy: boolean;
  onWallet: (value: string) => void;
}) {
  return (
    <label class="field">
      <span>{t("cypher.wallet")}</span>
      <select
        id={props.id}
        class="settings-select"
        value={props.walletAddress}
        disabled={!props.connected || props.busy}
        onChange={(event) => props.onWallet(event.currentTarget.value)}
      >
        <Show when={!props.walletAddress}>
          <option value="">{t("cypher.noAccounts")}</option>
        </Show>
        <Show when={props.walletAddress && !props.accounts.includes(props.walletAddress)}>
          <option value={props.walletAddress}>{props.walletAddress}</option>
        </Show>
        <For each={props.accounts}>{(address) => <option value={address}>{address}</option>}</For>
      </select>
    </label>
  );
}

function Panel(props: { tab: CypherTab; active: CypherTab; children: JSX.Element }) {
  return (
    <TabPanel
      id={`cypher-panel-${props.tab}`}
      tabId={`cypher-tab-${props.tab}`}
      className="cypher-panel"
      active={props.active === props.tab}
    >
      {props.children}
    </TabPanel>
  );
}

export function CypherView(props: CypherViewProps) {
  const status = () => props.status;
  const node = () => status()?.node;
  const accounts = () => node()?.accounts ?? [];
  const network = () => props.wallets?.network;
  const accountReady = () => Boolean(status()?.connected && props.selectedAccount);
  const walletReady = () => Boolean(status()?.connected && props.walletAddress);
  const writable = () => props.canAdmin && status()?.connected && !props.busy;
  const amountReady = () => /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u.test(props.amount.trim());
  const recipientReady = () => /^0x[0-9a-f]{40}$/iu.test(props.sendRecipient.trim());
  return (
    <>
      <SettingsPageHeader
        title={t("cypher.title")}
        subtitle={t("cypher.subtitle")}
        actions={
          <ActionButton
            action="refresh"
            label="cypher.refresh"
            enabled={props.allowed("cypher.status")}
            onAction={props.onAction}
          />
        }
      />
      <SettingsWorkspace>
        <SettingsPage>
          <div class="cypher-connection-summary" role="status">
            <SettingsStatus
              kind={status()?.connected ? "ok" : "muted"}
              label={t(status()?.connected ? "cypher.ipcConnected" : "cypher.ipcDisconnected")}
            />
            <Show when={status()?.state}>
              <SettingsStatus
                kind={status()?.state === "error" ? "danger" : "muted"}
                label={t(`cypher.states.${status()?.state ?? "stopped"}`)}
              />
            </Show>
          </div>
          <Show when={!props.connected}>
            <Notice text={t("cypher.offline")} />
          </Show>
          <Show when={props.connected && !props.available}>
            <Notice text={t("cypher.unavailable")} />
          </Show>
          <Show when={props.connected && !props.canRead}>
            <Notice text={t("cypher.readRequired")} />
          </Show>
          <Show when={props.connected && !props.canAdmin}>
            <Notice text={t("cypher.adminRequired")} />
          </Show>
          <Show when={props.busy}>
            <Notice text={t("cypher.working")} />
          </Show>
          <Show when={props.error || status()?.error}>
            <Notice text={props.error || status()?.error || ""} alert />
          </Show>
          <Show when={props.result}>
            <Notice text={props.result ?? ""} />
          </Show>
          <HubTabs
            id="cypher"
            active={props.tab}
            ariaLabel={t("cypher.tabsLabel")}
            panelId={`cypher-panel-${props.tab}`}
            tabs={CYPHER_TABS.map((value) => ({
              value,
              label: t(`cypher.tabs.${value}`),
              testId: `cypher-tab-${value}`,
            }))}
            onSelect={props.onTab}
          />
          <Panel tab="overview" active={props.tab}>
            <SettingsSection title={t("cypher.overview")} description={t("cypher.overviewHint")}>
              <ValueRow
                label="cypher.chain"
                value={quantityDisplay(network()?.chainId ?? node()?.chainId)}
              />
              <ValueRow label="cypher.block" value={quantityDisplay(node()?.blockNumber)} />
              <ValueRow label="cypher.peers" value={quantityDisplay(node()?.peerCount)} />
              <SettingsRow
                title={t("cypher.mining")}
                control={
                  <SettingsStatus
                    kind={node()?.mining ? "ok" : "muted"}
                    label={t(node()?.mining ? "cypher.miningActive" : "cypher.miningInactive")}
                  />
                }
              />
              <SettingsRow
                title={t("cypher.wallets")}
                control={
                  <button class="btn" type="button" onClick={() => props.onTab("wallets")}>
                    {t("cypher.openWallets")}
                    {props.wallets ? ` (${props.wallets.total})` : ""}
                  </button>
                }
              />
            </SettingsSection>
          </Panel>
          <Panel tab="node" active={props.tab}>
            <SettingsSection title={t("cypher.node")} description={t("cypher.nodeHint")}>
              <Show when={status() && !status()?.supported}>
                <Notice text={t("cypher.unsupported")} />
              </Show>
              <Show when={status()?.connected && !status()?.owned}>
                <Notice text={t("cypher.external")} />
              </Show>
              <SettingsRow
                title={t("cypher.state")}
                description={
                  status()
                    ? t(status()?.owned ? "cypher.owned" : "cypher.notOwned")
                    : t("cypher.noStatus")
                }
                control={
                  <>
                    <SettingsStatus
                      kind={
                        status()?.state === "error"
                          ? "danger"
                          : status()?.connected
                            ? "ok"
                            : "muted"
                      }
                      label={
                        status()
                          ? t(`cypher.states.${status()?.state ?? "stopped"}`)
                          : t("cypher.unknown")
                      }
                    />
                    <SettingsStatus
                      kind={status()?.connected ? "ok" : "muted"}
                      label={t(
                        status()?.connected ? "cypher.ipcConnected" : "cypher.ipcDisconnected",
                      )}
                    />
                  </>
                }
              />
              <SettingsRow
                title={t("cypher.node")}
                stacked
                control={
                  <div class="cypher-actions">
                    <ActionButton
                      action="start"
                      label="cypher.start"
                      enabled={
                        props.allowed("cypher.start") &&
                        status()?.supported === true &&
                        !status()?.connected &&
                        !status()?.owned &&
                        (status()?.state === "stopped" || status()?.state === "error")
                      }
                      onAction={props.onAction}
                    />
                    <ActionButton
                      action="stop"
                      label="cypher.stop"
                      enabled={
                        props.allowed("cypher.stop") &&
                        status()?.owned === true &&
                        status()?.state !== "stopping"
                      }
                      onAction={props.onAction}
                    />
                    <ActionButton
                      action="connect"
                      label="cypher.connect"
                      enabled={props.allowed("cypher.connect") && !status()?.connected}
                      onAction={props.onAction}
                    />
                    <ActionButton
                      action="disconnect"
                      label="cypher.disconnect"
                      enabled={props.allowed("cypher.disconnect") && status()?.connected === true}
                      onAction={props.onAction}
                    />
                  </div>
                }
              />
              <ValueRow
                label="cypher.platform"
                value={status() ? `${status()?.platform} / ${status()?.arch}` : null}
              />
              <ValueRow label="cypher.chain" value={quantityDisplay(node()?.chainId)} />
              <ValueRow label="cypher.block" value={quantityDisplay(node()?.blockNumber)} />
              <ValueRow label="cypher.peers" value={quantityDisplay(node()?.peerCount)} />
              <ValueRow label="cypher.hashrate" value={quantityDisplay(node()?.hashrate)} />
              <SettingsRow
                title={t("cypher.paths")}
                stacked
                control={
                  <dl class="cypher-paths">
                    <dt>{t("cypher.binary")}</dt>
                    <dd class="mono">{status()?.binaryPath ?? "—"}</dd>
                    <dt>{t("cypher.data")}</dt>
                    <dd class="mono">{status()?.dataDir ?? "—"}</dd>
                    <dt>{t("cypher.ipc")}</dt>
                    <dd class="mono">{status()?.ipcPath ?? "—"}</dd>
                  </dl>
                }
              />
            </SettingsSection>
            <details class="cypher-details">
              <summary>{t("cypher.logs")}</summary>
              <SettingsSection title={t("cypher.logs")} description={t("cypher.logsHint")}>
                <SettingsRow
                  title={t("cypher.logs")}
                  stacked
                  control={
                    <pre
                      class="code-block cypher-logs"
                      role="log"
                      aria-label={t("cypher.logs")}
                      tabindex="0"
                    >
                      {status()?.logs.length ? status()?.logs.join("\n") : t("cypher.noLogs")}
                    </pre>
                  }
                />
              </SettingsSection>
            </details>
          </Panel>
          <Panel tab="wallets" active={props.tab}>
            <SettingsSection title={t("cypher.wallets")} description={t("cypher.walletsHint")}>
              <Show when={!status()?.connected}>
                <Notice text={t("cypher.connectFirst")} />
              </Show>
              <Show when={props.wallets?.total === 0}>
                <Notice text={t("cypher.emptyWallets")} />
              </Show>
              <div class="cypher-wallet-list">
                <For each={props.wallets?.wallets ?? []}>
                  {(wallet) => (
                    <article class="cypher-wallet-row" data-cypher-wallet={wallet.address}>
                      <div class="cypher-wallet-details">
                        <span class="mono cypher-address">{wallet.address}</span>
                        <span>
                          {wallet.balance} {network()?.currency}
                        </span>
                        <SettingsStatus
                          kind={wallet.locked === false ? "ok" : "muted"}
                          label={t(
                            wallet.locked === null
                              ? "cypher.lockUnknown"
                              : wallet.locked
                                ? "cypher.walletLocked"
                                : "cypher.walletUnlocked",
                          )}
                        />
                      </div>
                      <div class="cypher-actions">
                        <button
                          class="btn"
                          type="button"
                          disabled={Boolean(props.busy)}
                          onClick={() => {
                            props.onWallet(wallet.address);
                            props.onTab("send");
                          }}
                        >
                          {t("cypher.sendFromWallet")}
                        </button>
                        <ExplorerLink
                          value={wallet.address}
                          label="cypher.viewExplorer"
                          network={network()}
                        />
                      </div>
                    </article>
                  )}
                </For>
              </div>
              <Show when={props.wallets && props.wallets.total > props.wallets.limit}>
                <SettingsRow
                  title={t("cypher.walletPage", {
                    start: String((props.wallets?.offset ?? 0) + 1),
                    end: String(
                      Math.min(
                        (props.wallets?.offset ?? 0) + (props.wallets?.limit ?? 0),
                        props.wallets?.total ?? 0,
                      ),
                    ),
                    total: String(props.wallets?.total ?? 0),
                  })}
                  control={
                    <div class="cypher-actions">
                      <ActionButton
                        action="wallet-previous"
                        label="cypher.previous"
                        enabled={!props.busy && (props.wallets?.offset ?? 0) > 0}
                        onAction={props.onAction}
                      />
                      <ActionButton
                        action="wallet-next"
                        label="cypher.next"
                        enabled={
                          !props.busy &&
                          (props.wallets?.offset ?? 0) + (props.wallets?.limit ?? 0) <
                            (props.wallets?.total ?? 0)
                        }
                        onAction={props.onAction}
                      />
                    </div>
                  }
                />
              </Show>
              <SettingsRow
                title={t("cypher.wallet")}
                stacked
                control={
                  <div class="cypher-form">
                    <WalletSelect
                      id="cypher-wallet"
                      accounts={accounts()}
                      walletAddress={props.walletAddress}
                      connected={Boolean(status()?.connected)}
                      busy={Boolean(props.busy)}
                      onWallet={props.onWallet}
                    />
                    <div class="cypher-actions">
                      <ActionButton
                        action="copy-wallet"
                        label="cypher.copyAddress"
                        enabled={walletReady()}
                        onAction={props.onAction}
                      />
                      <ActionButton
                        action="wallet-refresh"
                        label="cypher.refreshWallets"
                        enabled={props.allowed("cypher.wallets.list")}
                        onAction={props.onAction}
                      />
                    </div>
                  </div>
                }
              />
              <SettingsRow
                title={t("cypher.accountPassword")}
                description={t("cypher.passwordHint")}
                stacked
                control={
                  <div class="cypher-form cypher-form--columns">
                    <PasswordField
                      id="cypher-account-password"
                      label="cypher.accountPassword"
                      disabled={!writable()}
                    />
                    <label class="field">
                      <span>{t("cypher.unlockDuration")}</span>
                      <input
                        id="cypher-duration"
                        class="settings-input"
                        type="number"
                        min="1"
                        max="86400"
                        step="1"
                        value={props.duration}
                        disabled={!writable()}
                        onInput={(event) => props.onDuration(event.currentTarget.value)}
                      />
                    </label>
                    <div class="cypher-actions">
                      <ActionButton
                        action="create"
                        label="cypher.createAccount"
                        enabled={
                          props.allowed("cypher.accounts.create") && Boolean(status()?.connected)
                        }
                        onAction={props.onAction}
                      />
                      <ActionButton
                        action="unlock"
                        label="cypher.unlock"
                        enabled={props.allowed("cypher.accounts.unlock") && walletReady()}
                        onAction={props.onAction}
                      />
                      <ActionButton
                        action="lock"
                        label="cypher.lock"
                        enabled={props.allowed("cypher.accounts.lock") && walletReady()}
                        onAction={props.onAction}
                      />
                    </div>
                  </div>
                }
              />
            </SettingsSection>
            <details class="cypher-details">
              <summary>{t("cypher.independentGenerator")}</summary>
              <p class="settings-row__desc">{t("cypher.independentGeneratorHint")}</p>
              <WalletGenerator />
            </details>
          </Panel>
          <Panel tab="send" active={props.tab}>
            <SettingsSection title={t("cypher.send")} description={t("cypher.sendHint")}>
              <Show when={!status()?.connected}>
                <Notice text={t("cypher.connectFirst")} />
              </Show>
              <Show when={props.wallets && !props.wallets.readiness.ready}>
                <Notice
                  text={props.wallets?.readiness.reason || t("cypher.sendUnavailable")}
                  alert
                />
              </Show>
              <Show when={props.wallets && !props.wallets.finalitySupported}>
                <Notice text={t("cypher.finalityUnavailable")} />
              </Show>
              <SettingsRow
                title={t("cypher.transferDetails")}
                stacked
                control={
                  <div class="cypher-form">
                    <WalletSelect
                      id="cypher-send-wallet"
                      accounts={accounts()}
                      walletAddress={props.walletAddress}
                      connected={Boolean(status()?.connected)}
                      busy={Boolean(props.busy)}
                      onWallet={props.onWallet}
                    />
                    <label class="field">
                      <span>{t("cypher.sendRecipient")}</span>
                      <input
                        id="cypher-send-recipient"
                        class="settings-input mono"
                        type="text"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck={false}
                        placeholder="0x…"
                        value={props.sendRecipient}
                        disabled={Boolean(props.busy)}
                        onInput={(event) => props.onSendRecipient(event.currentTarget.value)}
                      />
                    </label>
                    <label class="field">
                      <span>{t("cypher.amount")}</span>
                      <input
                        id="cypher-send-amount"
                        class="settings-input"
                        type="text"
                        inputmode="decimal"
                        autocomplete="off"
                        placeholder="0.0"
                        value={props.amount}
                        disabled={Boolean(props.busy)}
                        onInput={(event) => props.onAmount(event.currentTarget.value)}
                      />
                    </label>
                    <ActionButton
                      action="prepare"
                      label="cypher.reviewTransfer"
                      enabled={
                        props.allowed("cypher.transfers.prepare") &&
                        walletReady() &&
                        props.wallets?.readiness.ready === true &&
                        recipientReady() &&
                        amountReady()
                      }
                      onAction={props.onAction}
                    />
                  </div>
                }
              />
            </SettingsSection>
            <Show when={props.quote}>
              {(quote) => (
                <SettingsSection
                  title={t("cypher.confirmTransfer")}
                  description={t("cypher.confirmHint")}
                >
                  <ValueRow label="cypher.sendFrom" value={quote().from} />
                  <ValueRow label="cypher.sendRecipient" value={quote().to} />
                  <ValueRow
                    label="cypher.amount"
                    value={`${quote().amount} ${quote().network.currency}`}
                  />
                  <ValueRow
                    label="cypher.estimatedFee"
                    value={`${quote().estimatedFee} ${quote().network.currency}`}
                  />
                  <ValueRow
                    label="cypher.total"
                    value={`${quote().total} ${quote().network.currency}`}
                  />
                  <SettingsRow
                    title={t("cypher.confirmTransfer")}
                    stacked
                    control={
                      <div class="cypher-form">
                        <label class="cypher-confirm">
                          <input
                            id="cypher-send-confirm"
                            type="checkbox"
                            checked={props.confirmed}
                            disabled={Boolean(props.busy)}
                            onChange={(event) => props.onConfirmed(event.currentTarget.checked)}
                          />
                          <span>{t("cypher.confirmCheckbox")}</span>
                        </label>
                        <PasswordField
                          id="cypher-send-password"
                          label="cypher.accountPassword"
                          disabled={!writable()}
                        />
                        <div class="cypher-actions">
                          <ActionButton
                            action="send"
                            label="cypher.sendNow"
                            enabled={
                              props.allowed("cypher.transfers.send") &&
                              props.confirmed &&
                              quote().expiresAt > Date.now()
                            }
                            onAction={props.onAction}
                          />
                          <ActionButton
                            action="cancel-quote"
                            label="cypher.editTransfer"
                            enabled={!props.busy}
                            onAction={props.onAction}
                          />
                        </div>
                      </div>
                    }
                  />
                </SettingsSection>
              )}
            </Show>
            <SettingsSection
              title={t("cypher.transferHistory")}
              description={t("cypher.historyHint")}
            >
              <Show when={props.transfers.length === 0}>
                <Notice text={t("cypher.emptyTransfers")} />
              </Show>
              <div class="cypher-transfer-list">
                <For each={props.transfers}>
                  {(transfer) => (
                    <article class="cypher-transfer" data-cypher-transfer={transfer.requestId}>
                      <div class="cypher-transfer-heading">
                        <strong>
                          {transfer.amount} {transfer.network.currency}
                        </strong>
                        <SettingsStatus
                          kind={
                            transfer.status === "complete"
                              ? "ok"
                              : transfer.status === "failed"
                                ? "danger"
                                : "muted"
                          }
                          label={t(`cypher.transferStates.${transfer.status}`)}
                        />
                      </div>
                      <dl class="cypher-paths">
                        <dt>{t("cypher.sendFrom")}</dt>
                        <dd class="mono">{transfer.from}</dd>
                        <dt>{t("cypher.sendRecipient")}</dt>
                        <dd class="mono">{transfer.to}</dd>
                        <dt>{t("cypher.txHash")}</dt>
                        <dd class="mono">{transfer.hash}</dd>
                        <Show when={transfer.actualFee}>
                          <dt>{t("cypher.actualFee")}</dt>
                          <dd>
                            {transfer.actualFee} {transfer.network.currency}
                          </dd>
                        </Show>
                        <Show when={transfer.blockNumber}>
                          <dt>{t("cypher.block")}</dt>
                          <dd>{quantityDisplay(transfer.blockNumber)}</dd>
                        </Show>
                      </dl>
                      <Show when={transfer.status === "unknown"}>
                        <Notice text={t("cypher.unknownTransfer")} />
                      </Show>
                      <Show when={transfer.finalitySupported === false}>
                        <Notice text={t("cypher.finalityUnavailable")} />
                      </Show>
                      <Show when={transfer.errorCode}>
                        <Notice
                          text={t("cypher.transferError", { code: transfer.errorCode ?? "" })}
                          alert
                        />
                      </Show>
                      <div class="cypher-actions">
                        <ExplorerLink
                          value={transfer.hash}
                          label="cypher.viewExplorer"
                          network={transfer.network}
                        />
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </SettingsSection>
          </Panel>
          <Panel tab="mining" active={props.tab}>
            <SettingsSection title={t("cypher.mining")} description={t("cypher.miningHint")}>
              <SettingsRow
                title={t("cypher.mining")}
                control={
                  <SettingsStatus
                    kind={node()?.mining ? "ok" : "muted"}
                    label={
                      node()
                        ? t(node()?.mining ? "cypher.miningActive" : "cypher.miningInactive")
                        : t("cypher.unknown")
                    }
                  />
                }
              />
              <SettingsRow
                title={t("cypher.signer")}
                stacked
                control={
                  <div class="cypher-form">
                    <label class="field">
                      <span>{t("cypher.account")}</span>
                      <select
                        id="cypher-account"
                        class="settings-select"
                        value={props.selectedAccount}
                        disabled={!node() || Boolean(props.busy) || node()?.mining === true}
                        onChange={(event) => props.onAccount(event.currentTarget.value)}
                      >
                        <Show when={!accounts().length}>
                          <option value="">{t("cypher.noAccounts")}</option>
                        </Show>
                        <For each={accounts()}>
                          {(address) => <option value={address}>{address}</option>}
                        </For>
                      </select>
                    </label>
                    <ActionButton
                      action="select"
                      label="cypher.selectAccount"
                      enabled={
                        props.allowed("cypher.accounts.select") && accountReady() && !node()?.mining
                      }
                      onAction={props.onAction}
                    />
                  </div>
                }
              />
              <SettingsRow
                title={t("cypher.threads")}
                stacked
                control={
                  <div class="cypher-form cypher-form--columns">
                    <label class="field">
                      <span>{t("cypher.threads")}</span>
                      <input
                        id="cypher-threads"
                        class="settings-input"
                        type="number"
                        min="1"
                        max="256"
                        step="1"
                        value={props.threads}
                        disabled={!writable() || node()?.mining === true}
                        onInput={(event) => props.onThreads(event.currentTarget.value)}
                      />
                    </label>
                    <PasswordField
                      id="cypher-mining-password"
                      label="cypher.miningPassword"
                      disabled={!writable()}
                    />
                    <div class="cypher-actions">
                      <ActionButton
                        action="mining-start"
                        label="cypher.startMining"
                        enabled={
                          props.allowed("cypher.mining.start") &&
                          accountReady() &&
                          node()?.mining === false
                        }
                        onAction={props.onAction}
                      />
                      <ActionButton
                        action="mining-stop"
                        label="cypher.stopMining"
                        enabled={props.allowed("cypher.mining.stop") && node()?.mining === true}
                        onAction={props.onAction}
                      />
                    </div>
                  </div>
                }
              />
            </SettingsSection>
            <SettingsSection title={t("cypher.rewards")} description={t("cypher.rewardsHint")}>
              <ValueRow label="cypher.signer" value={props.selectedAccount} />
              <Show when={props.reward?.configured}>
                <ValueRow label="cypher.registered" value={props.reward?.rewardRecipient} />
              </Show>
              <Show when={props.reward && !props.reward.configured}>
                <Notice text={t("cypher.unregistered")} />
              </Show>
              <SettingsRow
                title={t("cypher.recipient")}
                stacked
                control={
                  <div class="cypher-form cypher-form--columns">
                    <label class="field">
                      <span>{t("cypher.recipient")}</span>
                      <input
                        id="cypher-recipient"
                        class="settings-input mono"
                        type="text"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck={false}
                        placeholder="0x…"
                        value={props.recipient}
                        disabled={!writable()}
                        onInput={(event) => props.onRecipient(event.currentTarget.value)}
                      />
                    </label>
                    <PasswordField
                      id="cypher-reward-password"
                      label="cypher.rewardPassword"
                      disabled={!writable()}
                    />
                    <div class="cypher-actions">
                      <ActionButton
                        action="reward-get"
                        label="cypher.readReward"
                        enabled={props.allowed("cypher.reward.get") && accountReady()}
                        onAction={props.onAction}
                      />
                      <ActionButton
                        action="reward-set"
                        label="cypher.setReward"
                        enabled={props.allowed("cypher.reward.set") && accountReady()}
                        onAction={props.onAction}
                      />
                    </div>
                  </div>
                }
              />
            </SettingsSection>
          </Panel>
          <Panel tab="explorer" active={props.tab}>
            <SettingsSection title={t("cypher.explorer")} description={t("cypher.explorerHint")}>
              <Notice
                text={t(
                  explorerMatches(network()) ? "cypher.explorerMatched" : "cypher.explorerMismatch",
                )}
              />
              <SettingsRow
                title={t("cypher.explorerSearch")}
                stacked
                control={
                  <div class="cypher-form">
                    <label class="field">
                      <span>{t("cypher.explorerQuery")}</span>
                      <input
                        id="cypher-explorer-query"
                        class="settings-input mono"
                        type="text"
                        autocomplete="off"
                        spellcheck={false}
                        value={props.explorerQuery}
                        onInput={(event) => props.onExplorerQuery(event.currentTarget.value)}
                      />
                    </label>
                    <div class="cypher-actions">
                      <ExplorerLink
                        value={props.explorerQuery}
                        label="cypher.openExplorer"
                        network={network()}
                      />
                      <Show when={explorerMatches(network())}>
                        <a
                          class="btn cypher-explorer-link"
                          href={EXPLORER_BASE}
                          target={EXTERNAL_LINK_TARGET}
                          rel={buildExternalLinkRel()}
                        >
                          {t("cypher.explorerHome")}
                        </a>
                      </Show>
                    </div>
                    <Show
                      when={props.explorerQuery && !explorerHref(props.explorerQuery, network())}
                    >
                      <Notice text={t("cypher.explorerInvalid")} />
                    </Show>
                  </div>
                }
              />
              <Notice text={t("cypher.explorerDelay")} />
            </SettingsSection>
          </Panel>
        </SettingsPage>
      </SettingsWorkspace>
    </>
  );
}
