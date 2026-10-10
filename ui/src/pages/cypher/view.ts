import { html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import type {
  CypherRewardRegistration,
  CypherStatus,
  CypherNetwork,
  CypherWallets,
  CypherTransferQuote,
  CypherTransferRecord,
} from "../../../../src/cypher/types.ts";
import { renderHubTabs } from "../../components/hub-tabs.ts";
import {
  renderSettingsPage,
  renderSettingsPageHeader,
  renderSettingsRow,
  renderSettingsSection,
  renderSettingsStatus,
} from "../../components/settings-ui.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import { t } from "../../i18n/index.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../../lib/external-link.ts";
import "../../components/wallet-generator/wallet-generator.ts";
import "./style.css";

export type CypherTab = "overview" | "node" | "wallets" | "send" | "mining" | "explorer";

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

type CypherProps = {
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

export function renderCypher(props: CypherProps): TemplateResult {
  const status = props.status;
  const node = status?.node;
  const accountReady = Boolean(status?.connected && props.selectedAccount);
  const writable = props.canAdmin && status?.connected && !props.busy;
  const button = (action: CypherAction, label: string, enabled: boolean) => html`
    <button
      class="btn"
      type="button"
      data-cypher-action=${action}
      ?disabled=${!enabled}
      @click=${() => props.onAction(action)}
    >
      ${t(label)}
    </button>
  `;
  const valueRow = (label: string, value: string | null | undefined) =>
    renderSettingsRow({
      title: t(label),
      control: html`<span class="settings-row__value settings-row__value--mono"
        >${value || t("cypher.unknown")}</span
      >`,
    });
  const password = (id: string, label: string) => html`
    <label class="field">
      <span>${t(label)}</span>
      <input
        id=${id}
        class="settings-input"
        type="password"
        autocomplete="new-password"
        autocapitalize="off"
        spellcheck="false"
        ?disabled=${!writable}
      />
    </label>
  `;
  const notice = (text: string, alert = false) => html`
    <div class="settings-row" role=${alert ? "alert" : "status"}>
      <span class="settings-row__desc">${text}</span>
    </div>
  `;
  const nodeActions = html`<div class="cypher-actions">
    ${button(
      "start",
      "cypher.start",
      props.allowed("cypher.start") &&
        status?.supported === true &&
        !status.connected &&
        !status.owned &&
        (status.state === "stopped" || status.state === "error"),
    )}
    ${button(
      "stop",
      "cypher.stop",
      props.allowed("cypher.stop") && status?.owned === true && status.state !== "stopping",
    )}
    ${button("connect", "cypher.connect", props.allowed("cypher.connect") && !status?.connected)}
    ${button("disconnect", "cypher.disconnect", props.allowed("cypher.disconnect") && status?.connected === true)}
  </div>`;
  const nodeSection = renderSettingsSection(
    { title: t("cypher.node"), description: t("cypher.nodeHint") },
    html`
      ${status && !status.supported ? notice(t("cypher.unsupported")) : nothing}
      ${status?.connected && !status.owned ? notice(t("cypher.external")) : nothing}
      ${renderSettingsRow({
        title: t("cypher.state"),
        description: status
          ? t(status.owned ? "cypher.owned" : "cypher.notOwned")
          : t("cypher.noStatus"),
        control: html`
          ${renderSettingsStatus({
            kind: status?.state === "error" ? "danger" : status?.connected ? "ok" : "muted",
            label: status ? t(`cypher.states.${status.state}`) : t("cypher.unknown"),
          })}
          ${renderSettingsStatus({
            kind: status?.connected ? "ok" : "muted",
            label: t(status?.connected ? "cypher.ipcConnected" : "cypher.ipcDisconnected"),
          })}
        `,
      })}
      ${renderSettingsRow({ title: t("cypher.node"), stacked: true, control: nodeActions })}
      ${valueRow("cypher.platform", status ? `${status.platform} / ${status.arch}` : null)}
      ${valueRow("cypher.chain", quantityDisplay(node?.chainId))}
      ${valueRow("cypher.block", quantityDisplay(node?.blockNumber))}
      ${valueRow("cypher.peers", quantityDisplay(node?.peerCount))}
      ${valueRow("cypher.hashrate", quantityDisplay(node?.hashrate))}
      ${renderSettingsRow({
        title: t("cypher.paths"),
        stacked: true,
        control: html`
          <dl class="cypher-paths">
            <dt>${t("cypher.binary")}</dt>
            <dd class="mono">${status?.binaryPath ?? "—"}</dd>
            <dt>${t("cypher.data")}</dt>
            <dd class="mono">${status?.dataDir ?? "—"}</dd>
            <dt>${t("cypher.ipc")}</dt>
            <dd class="mono">${status?.ipcPath ?? "—"}</dd>
          </dl>
        `,
      })}
    `,
  );
  const network = props.wallets?.network;
  const walletReady = Boolean(status?.connected && props.walletAddress);
  const link = (value: string, label: string, targetNetwork = network) => {
    const href = explorerHref(value, targetNetwork);
    return href
      ? html`<a
          class="btn cypher-explorer-link"
          href=${href}
          target=${EXTERNAL_LINK_TARGET}
          rel=${buildExternalLinkRel()}
          >${t(label)}</a
        >`
      : nothing;
  };
  const walletSelect = (id: string) => html`<label class="field"
    ><span>${t("cypher.wallet")}</span>
    <select
      id=${id}
      class="settings-select"
      .value=${live(props.walletAddress)}
      ?disabled=${!status?.connected || Boolean(props.busy)}
      @change=${(event: Event) => props.onWallet((event.target as HTMLSelectElement).value)}
    >
      ${!props.walletAddress ? html`<option value="">${t("cypher.noAccounts")}</option>` : nothing}
      ${props.walletAddress && !props.wallets?.wallets.some((wallet) => wallet.address === props.walletAddress) ? html`<option value=${props.walletAddress}>${props.walletAddress}</option>` : nothing}
      ${(props.wallets?.wallets ?? []).map((wallet) => html`<option value=${wallet.address}>${wallet.address}</option>`)}
    </select></label
  >`;
  const accounts = renderSettingsSection(
    { title: t("cypher.wallets"), description: t("cypher.walletsHint") },
    html`
      ${!status?.connected ? notice(t("cypher.connectFirst")) : nothing}
      ${props.wallets?.total === 0 ? notice(t("cypher.emptyWallets")) : nothing}
      <div class="cypher-wallet-list">
        ${(props.wallets?.wallets ?? []).map(
          (wallet) => html`<article class="cypher-wallet-row" data-cypher-wallet=${wallet.address}>
            <div class="cypher-wallet-details">
              <span class="mono cypher-address">${wallet.address}</span
              ><span>${wallet.balance} ${network?.currency}</span>
              ${renderSettingsStatus({ kind: wallet.locked === false ? "ok" : "muted", label: t(wallet.locked === null ? "cypher.lockUnknown" : wallet.locked ? "cypher.walletLocked" : "cypher.walletUnlocked") })}
            </div>
            <div class="cypher-actions">
              <button
                class="btn"
                type="button"
                ?disabled=${Boolean(props.busy)}
                @click=${() => {
                  props.onWallet(wallet.address);
                  props.onTab("send");
                }}
              >
                ${t("cypher.sendFromWallet")}</button
              >${link(wallet.address, "cypher.viewExplorer")}
            </div>
          </article>`,
        )}
      </div>
      ${props.wallets && props.wallets.total > props.wallets.limit ? renderSettingsRow({ title: t("cypher.walletPage", { start: String(props.wallets.offset + 1), end: String(Math.min(props.wallets.offset + props.wallets.limit, props.wallets.total)), total: String(props.wallets.total) }), control: html`<div class="cypher-actions">${button("wallet-previous", "cypher.previous", !props.busy && props.wallets.offset > 0)}${button("wallet-next", "cypher.next", !props.busy && props.wallets.offset + props.wallets.limit < props.wallets.total)}</div>` }) : nothing}
      ${renderSettingsRow({
        title: t("cypher.wallet"),
        stacked: true,
        control: html`<div class="cypher-form">
          ${walletSelect("cypher-wallet")}
          <div class="cypher-actions">
            ${button("copy-wallet", "cypher.copyAddress", walletReady)}${button("wallet-refresh", "cypher.refreshWallets", props.allowed("cypher.wallets.list"))}
          </div>
        </div>`,
      })}
      ${renderSettingsRow({
        title: t("cypher.accountPassword"),
        description: t("cypher.passwordHint"),
        stacked: true,
        control: html`<div class="cypher-form cypher-form--columns">
          ${password("cypher-account-password", "cypher.accountPassword")}
          <label class="field"
            ><span>${t("cypher.unlockDuration")}</span
            ><input
              id="cypher-duration"
              class="settings-input"
              type="number"
              min="1"
              max="86400"
              step="1"
              .value=${live(props.duration)}
              ?disabled=${!writable}
              @input=${(event: Event) => props.onDuration((event.target as HTMLInputElement).value)}
          /></label>
          <div class="cypher-actions">
            ${button("create", "cypher.createAccount", props.allowed("cypher.accounts.create") && Boolean(status?.connected))}${button("unlock", "cypher.unlock", props.allowed("cypher.accounts.unlock") && walletReady)}${button("lock", "cypher.lock", props.allowed("cypher.accounts.lock") && walletReady)}
          </div>
        </div>`,
      })}
    `,
  );
  const mining = renderSettingsSection(
    { title: t("cypher.mining"), description: t("cypher.miningHint") },
    html`
      ${renderSettingsRow({
        title: t("cypher.mining"),
        control: renderSettingsStatus({
          kind: node?.mining ? "ok" : "muted",
          label: node
            ? t(node.mining ? "cypher.miningActive" : "cypher.miningInactive")
            : t("cypher.unknown"),
        }),
      })}
      ${renderSettingsRow({
        title: t("cypher.signer"),
        stacked: true,
        control: html`<div class="cypher-form">
          <label class="field"
            ><span>${t("cypher.account")}</span
            ><select
              id="cypher-account"
              class="settings-select"
              .value=${live(props.selectedAccount)}
              ?disabled=${!node || Boolean(props.busy) || node.mining}
              @change=${(event: Event) => props.onAccount((event.target as HTMLSelectElement).value)}
            >
              ${!node?.accounts.length ? html`<option value="">${t("cypher.noAccounts")}</option>` : nothing}
              ${(node?.accounts ?? []).map((address) => html`<option value=${address}>${address}</option>`)}
            </select></label
          >${button("select", "cypher.selectAccount", props.allowed("cypher.accounts.select") && accountReady && !node?.mining)}
        </div>`,
      })}
      ${renderSettingsRow({
        title: t("cypher.threads"),
        stacked: true,
        control: html`<div class="cypher-form cypher-form--columns">
          <label class="field"
            ><span>${t("cypher.threads")}</span>
            <input
              id="cypher-threads"
              class="settings-input"
              type="number"
              min="1"
              max="256"
              step="1"
              .value=${live(props.threads)}
              ?disabled=${!writable || node?.mining === true}
              @input=${(event: Event) => props.onThreads((event.target as HTMLInputElement).value)}
            />
          </label>
          ${password("cypher-mining-password", "cypher.miningPassword")}
          <div class="cypher-actions">
            ${button("mining-start", "cypher.startMining", props.allowed("cypher.mining.start") && accountReady && node?.mining === false)}
            ${button("mining-stop", "cypher.stopMining", props.allowed("cypher.mining.stop") && node?.mining === true)}
          </div>
        </div>`,
      })}
    `,
  );
  const reward = renderSettingsSection(
    { title: t("cypher.rewards"), description: t("cypher.rewardsHint") },
    html`
      ${valueRow("cypher.signer", props.selectedAccount)}
      ${
        props.reward
          ? props.reward.configured
            ? valueRow("cypher.registered", props.reward.rewardRecipient)
            : notice(t("cypher.unregistered"))
          : nothing
      }
      ${renderSettingsRow({
        title: t("cypher.recipient"),
        stacked: true,
        control: html`<div class="cypher-form cypher-form--columns">
          <label class="field"
            ><span>${t("cypher.recipient")}</span>
            <input
              id="cypher-recipient"
              class="settings-input mono"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="0x…"
              .value=${live(props.recipient)}
              ?disabled=${!writable}
              @input=${(event: Event) => props.onRecipient((event.target as HTMLInputElement).value)}
            />
          </label>
          ${password("cypher-reward-password", "cypher.rewardPassword")}
          <div class="cypher-actions">
            ${button("reward-get", "cypher.readReward", props.allowed("cypher.reward.get") && accountReady)}
            ${button("reward-set", "cypher.setReward", props.allowed("cypher.reward.set") && accountReady)}
          </div>
        </div>`,
      })}
    `,
  );
  const logs = renderSettingsSection(
    { title: t("cypher.logs"), description: t("cypher.logsHint") },
    html`
      ${renderSettingsRow({
        title: t("cypher.logs"),
        stacked: true,
        control: html`
          <pre
            class="code-block cypher-logs"
            role="log"
            aria-label=${t("cypher.logs")}
            tabindex="0"
          >
${status?.logs.length ? status.logs.join("\n") : t("cypher.noLogs")}</pre>
        `,
      })}
    `,
  );
  const overview = renderSettingsSection(
    { title: t("cypher.overview"), description: t("cypher.overviewHint") },
    html`
      ${valueRow("cypher.chain", quantityDisplay(network?.chainId ?? node?.chainId))}
      ${valueRow("cypher.block", quantityDisplay(node?.blockNumber))}
      ${valueRow("cypher.peers", quantityDisplay(node?.peerCount))}
      ${renderSettingsRow({ title: t("cypher.mining"), control: renderSettingsStatus({ kind: node?.mining ? "ok" : "muted", label: t(node?.mining ? "cypher.miningActive" : "cypher.miningInactive") }) })}
      ${renderSettingsRow({ title: t("cypher.wallets"), control: html`<button class="btn" @click=${() => props.onTab("wallets")}>${t("cypher.openWallets")}${props.wallets ? ` (${props.wallets.total})` : ""}</button>` })}
    `,
  );
  const quote = props.quote;
  const send = html`${renderSettingsSection(
    { title: t("cypher.send"), description: t("cypher.sendHint") },
    html`
      ${!status?.connected ? notice(t("cypher.connectFirst")) : nothing}
      ${props.wallets && !props.wallets.readiness.ready ? notice(props.wallets.readiness.reason || t("cypher.sendUnavailable"), true) : nothing}
      ${props.wallets && !props.wallets.finalitySupported ? notice(t("cypher.finalityUnavailable")) : nothing}
      ${renderSettingsRow({
        title: t("cypher.transferDetails"),
        stacked: true,
        control: html`<div class="cypher-form">
          ${walletSelect("cypher-send-wallet")}
          <label class="field"
            ><span>${t("cypher.sendRecipient")}</span
            ><input
              id="cypher-send-recipient"
              class="settings-input mono"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="0x…"
              .value=${live(props.sendRecipient)}
              ?disabled=${Boolean(props.busy)}
              @input=${(event: Event) => props.onSendRecipient((event.target as HTMLInputElement).value)}
          /></label>
          <label class="field"
            ><span>${t("cypher.amount")}</span
            ><input
              id="cypher-send-amount"
              class="settings-input"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.0"
              .value=${live(props.amount)}
              ?disabled=${Boolean(props.busy)}
              @input=${(event: Event) => props.onAmount((event.target as HTMLInputElement).value)}
          /></label>
          ${button("prepare", "cypher.reviewTransfer", props.allowed("cypher.transfers.prepare") && walletReady && props.wallets?.readiness.ready === true && /^0x[0-9a-f]{40}$/iu.test(props.sendRecipient.trim()) && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u.test(props.amount.trim()))}
        </div>`,
      })}
    `,
  )}
  ${
    quote
      ? renderSettingsSection(
          { title: t("cypher.confirmTransfer"), description: t("cypher.confirmHint") },
          html`
            ${valueRow("cypher.sendFrom", quote.from)}${valueRow("cypher.sendRecipient", quote.to)}${valueRow("cypher.amount", `${quote.amount} ${quote.network.currency}`)}${valueRow("cypher.estimatedFee", `${quote.estimatedFee} ${quote.network.currency}`)}${valueRow("cypher.total", `${quote.total} ${quote.network.currency}`)}
            ${renderSettingsRow({
              title: t("cypher.confirmTransfer"),
              stacked: true,
              control: html`<div class="cypher-form">
                <label class="cypher-confirm"
                  ><input
                    id="cypher-send-confirm"
                    type="checkbox"
                    .checked=${props.confirmed}
                    ?disabled=${Boolean(props.busy)}
                    @change=${(event: Event) => props.onConfirmed((event.target as HTMLInputElement).checked)}
                  /><span>${t("cypher.confirmCheckbox")}</span></label
                >
                ${password("cypher-send-password", "cypher.accountPassword")}
                <div class="cypher-actions">
                  ${button("send", "cypher.sendNow", props.allowed("cypher.transfers.send") && props.confirmed && quote.expiresAt > Date.now())}${button("cancel-quote", "cypher.editTransfer", !props.busy)}
                </div>
              </div>`,
            })}
          `,
        )
      : nothing
  }
  ${renderSettingsSection(
    { title: t("cypher.transferHistory"), description: t("cypher.historyHint") },
    html`
      ${props.transfers.length === 0 ? notice(t("cypher.emptyTransfers")) : nothing}
      <div class="cypher-transfer-list">
        ${props.transfers.map(
          (transfer) => html`<article
            class="cypher-transfer"
            data-cypher-transfer=${transfer.requestId}
          >
            <div class="cypher-transfer-heading">
              <strong>${transfer.amount} ${transfer.network.currency}</strong
              >${renderSettingsStatus({ kind: transfer.status === "complete" ? "ok" : transfer.status === "failed" ? "danger" : "muted", label: t(`cypher.transferStates.${transfer.status}`) })}
            </div>
            <dl class="cypher-paths">
              <dt>${t("cypher.sendFrom")}</dt>
              <dd class="mono">${transfer.from}</dd>
              <dt>${t("cypher.sendRecipient")}</dt>
              <dd class="mono">${transfer.to}</dd>
              <dt>${t("cypher.txHash")}</dt>
              <dd class="mono">${transfer.hash}</dd>
              ${
                transfer.actualFee
                  ? html`<dt>${t("cypher.actualFee")}</dt>
                      <dd>${transfer.actualFee} ${transfer.network.currency}</dd>`
                  : nothing
              }${
                transfer.blockNumber
                  ? html`<dt>${t("cypher.block")}</dt>
                      <dd>${quantityDisplay(transfer.blockNumber)}</dd>`
                  : nothing
              }
            </dl>
            ${transfer.status === "unknown" ? notice(t("cypher.unknownTransfer")) : nothing}
            ${transfer.finalitySupported === false ? notice(t("cypher.finalityUnavailable")) : nothing}
            ${transfer.errorCode ? notice(t("cypher.transferError", { code: transfer.errorCode }), true) : nothing}
            <div class="cypher-actions">
              ${link(transfer.hash, "cypher.viewExplorer", transfer.network)}
            </div>
          </article>`,
        )}
      </div>
    `,
  )} `;
  const explorer = renderSettingsSection(
    { title: t("cypher.explorer"), description: t("cypher.explorerHint") },
    html`
      ${notice(t(explorerMatches(network) ? "cypher.explorerMatched" : "cypher.explorerMismatch"))}
      ${renderSettingsRow({
        title: t("cypher.explorerSearch"),
        stacked: true,
        control: html`<div class="cypher-form">
          <label class="field"
            ><span>${t("cypher.explorerQuery")}</span
            ><input
              id="cypher-explorer-query"
              class="settings-input mono"
              type="text"
              autocomplete="off"
              spellcheck="false"
              .value=${live(props.explorerQuery)}
              @input=${(event: Event) => props.onExplorerQuery((event.target as HTMLInputElement).value)}
          /></label>
          <div class="cypher-actions">
            ${link(props.explorerQuery, "cypher.openExplorer")}${explorerMatches(network) ? html`<a class="btn cypher-explorer-link" href=${EXPLORER_BASE} target=${EXTERNAL_LINK_TARGET} rel=${buildExternalLinkRel()}>${t("cypher.explorerHome")}</a>` : nothing}
          </div>
          ${props.explorerQuery && !explorerHref(props.explorerQuery, network) ? notice(t("cypher.explorerInvalid")) : nothing}
        </div>`,
      })}
      ${notice(t("cypher.explorerDelay"))}
    `,
  );
  const tabs: CypherTab[] = ["overview", "node", "wallets", "send", "mining", "explorer"];
  const panel = (tab: CypherTab, content: TemplateResult) =>
    html`<div
      id=${`cypher-panel-${tab}`}
      class="cypher-panel"
      role="tabpanel"
      aria-labelledby=${`cypher-tab-${tab}`}
      ?hidden=${props.tab !== tab}
    >
      ${content}
    </div>`;
  return html`
    ${renderSettingsPageHeader({ title: t("cypher.title"), subtitle: t("cypher.subtitle"), actions: html`${button("refresh", "cypher.refresh", props.allowed("cypher.status"))}` })}
    ${renderSettingsWorkspace(
      renderSettingsPage(html`
        <div class="cypher-connection-summary" role="status">
          ${renderSettingsStatus({ kind: status?.connected ? "ok" : "muted", label: t(status?.connected ? "cypher.ipcConnected" : "cypher.ipcDisconnected") })}${status?.state ? renderSettingsStatus({ kind: status.state === "error" ? "danger" : "muted", label: t(`cypher.states.${status.state}`) }) : nothing}
        </div>
        ${!props.connected ? notice(t("cypher.offline")) : nothing}
        ${props.connected && !props.available ? notice(t("cypher.unavailable")) : nothing}
        ${props.connected && !props.canRead ? notice(t("cypher.readRequired")) : nothing}
        ${props.connected && !props.canAdmin ? notice(t("cypher.adminRequired")) : nothing}
        ${props.busy ? notice(t("cypher.working")) : nothing}
        ${props.error || status?.error ? notice(props.error || status?.error || "", true) : nothing}${props.result ? notice(props.result) : nothing}
        ${renderHubTabs({ id: "cypher", active: props.tab, tabs: tabs.map((value) => ({ value, label: t(`cypher.tabs.${value}`), testId: `cypher-tab-${value}` })), ariaLabel: t("cypher.tabsLabel"), panelId: `cypher-panel-${props.tab}`, onSelect: props.onTab })}
        ${panel("overview", overview)}
        ${panel(
          "node",
          html`${nodeSection}
            <details class="cypher-details">
              <summary>${t("cypher.logs")}</summary>
              ${logs}
            </details>`,
        )}
        ${panel(
          "wallets",
          html`${accounts}
            <details class="cypher-details">
              <summary>${t("cypher.independentGenerator")}</summary>
              <p class="settings-row__desc">${t("cypher.independentGeneratorHint")}</p>
              <openclaw-wallet-generator></openclaw-wallet-generator>
            </details>`,
        )}
        ${panel("send", send)} ${panel("mining", html`${mining}${reward}`)}
        ${panel("explorer", explorer)}
      `),
    )}
  `;
}
