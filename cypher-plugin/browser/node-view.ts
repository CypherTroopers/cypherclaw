import { html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { html as staticHtml, unsafeStatic } from "lit/static-html.js";
import type { ControlUiViewContext } from "openclaw/plugin-sdk/control-ui";
import type { CypherRewardRegistration, CypherStatus } from "../src/cypher/types.ts";
import { t } from "./i18n.ts";
import {
  renderSettingsPage,
  renderSettingsPageHeader,
  renderSettingsRow,
  renderSettingsSection,
  renderSettingsStatus,
} from "./settings.ts";
import { renderSettingsWorkspace } from "./settings.ts";
import { walletElementName } from "./wallet.ts";
import "./style.css";

const walletTag = unsafeStatic(walletElementName);

export type CypherAction =
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
  context: ControlUiViewContext;
  status: CypherStatus | null;
  reward: CypherRewardRegistration | null;
  connected: boolean;
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
      ${!props.connected ? notice(t("cypher.offline")) : nothing}
      ${props.connected && !props.canRead ? notice(t("cypher.readRequired")) : nothing}
      ${props.connected && !props.canAdmin ? notice(t("cypher.adminRequired")) : nothing}
      ${props.busy ? notice(t("cypher.working")) : nothing}
      ${status && !status.supported ? notice(t("cypher.unsupported")) : nothing}
      ${status?.connected && !status.owned ? notice(t("cypher.external")) : nothing}
      ${props.error || status?.error ? notice(props.error || status?.error || "", true) : nothing}
      ${props.result ? notice(props.result) : nothing}
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
      ${valueRow("cypher.chain", node?.chainId)} ${valueRow("cypher.block", node?.blockNumber)}
      ${valueRow("cypher.peers", node?.peerCount)} ${valueRow("cypher.hashrate", node?.hashrate)}
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
  const accounts = renderSettingsSection(
    { title: t("cypher.accounts"), description: t("cypher.accountsHint") },
    html`
      ${valueRow("cypher.signer", node?.signer)}
      ${renderSettingsRow({
        title: t("cypher.account"),
        stacked: true,
        control: html`<div class="cypher-form">
          <label class="field">
            <span>${t("cypher.account")}</span>
            <select
              id="cypher-account"
              class="settings-select"
              .value=${live(props.selectedAccount)}
              ?disabled=${!node || Boolean(props.busy)}
              @change=${(event: Event) => props.onAccount((event.target as HTMLSelectElement).value)}
            >
              ${(node?.accounts.length ?? 0) === 0 ? html`<option value="">${t("cypher.noAccounts")}</option>` : nothing}
              ${(node?.accounts ?? []).map((address) => html`<option value=${address}>${address}</option>`)}
            </select>
          </label>
          ${button("select", "cypher.selectAccount", props.allowed("cypher.accounts.select") && accountReady && !node?.mining)}
        </div>`,
      })}
      ${renderSettingsRow({
        title: t("cypher.accountPassword"),
        description: t("cypher.passwordHint"),
        stacked: true,
        control: html`<div class="cypher-form cypher-form--columns">
          ${password("cypher-account-password", "cypher.accountPassword")}
          <label class="field"
            ><span>${t("cypher.unlockDuration")}</span>
            <input
              id="cypher-duration"
              class="settings-input"
              type="number"
              min="1"
              max="86400"
              step="1"
              .value=${live(props.duration)}
              ?disabled=${!writable}
              @input=${(event: Event) => props.onDuration((event.target as HTMLInputElement).value)}
            />
          </label>
          <div class="cypher-actions">
            ${button("create", "cypher.createAccount", props.allowed("cypher.accounts.create") && Boolean(status?.connected))}
            ${button("unlock", "cypher.unlock", props.allowed("cypher.accounts.unlock") && accountReady)}
            ${button("lock", "cypher.lock", props.allowed("cypher.accounts.lock") && accountReady)}
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
  return html`
    ${renderSettingsPageHeader({
      title: t("cypher.title"),
      subtitle: t("cypher.subtitle"),
      actions: html` ${button("refresh", "cypher.refresh", props.allowed("cypher.status"))} `,
    })}
    ${renderSettingsWorkspace(renderSettingsPage(html`${nodeSection}${accounts}${mining}${reward}${logs}${staticHtml`<${walletTag} class="cypher-plugin-wallet" .context=${props.context}></${walletTag}>`}`))}
  `;
}
