import { createSignal, onCleanup, untrack } from "solid-js";
import type {
  CypherRewardRegistration,
  CypherStatus,
  CypherTransferQuote,
  CypherTransferRecord,
  CypherWallets,
} from "../../../../src/cypher/types.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import { formatUiError } from "../../lib/format-error.ts";
import { canCallGatewayMethod, isGatewayMethodAdvertised } from "../../lib/gateway-methods.ts";
import { useApplication } from "../../lib/reactive/context.ts";
import { useGatewayPage } from "../../lib/reactive/gateway-page.ts";
import { t } from "../../lib/reactive/i18n.ts";
import { useVisiblePoll } from "../../lib/reactive/visible-poll.ts";
import { showToast } from "../../lib/toast.ts";
import { CypherView, type CypherAction, type CypherTab } from "./view.tsx";
import "./style.css";

declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "openclaw-cypher-page": HTMLAttributes<HTMLElement>;
    }
  }
}

type GatewayClient = NonNullable<
  ReturnType<ReturnType<typeof useGatewayPage>["capture"]>
>["client"];

export function CypherPage() {
  const context = useApplication();
  const [status, setStatusSignal] = createSignal<CypherStatus | null>(null);
  const [tab, setTabSignal] = createSignal<CypherTab>("overview");
  const [wallets, setWalletsSignal] = createSignal<CypherWallets | null>(null);
  const [walletAddress, setWalletAddressSignal] = createSignal("");
  const [transfers, setTransfersSignal] = createSignal<CypherTransferRecord[]>([]);
  const [quote, setQuoteSignal] = createSignal<CypherTransferQuote | null>(null);
  const [sendRecipient, setSendRecipientSignal] = createSignal("");
  const [amount, setAmountSignal] = createSignal("");
  const [confirmed, setConfirmedSignal] = createSignal(false);
  const [explorerQuery, setExplorerQuery] = createSignal("");
  const [reward, setReward] = createSignal<CypherRewardRegistration | null>(null);
  const [selectedAccount, setSelectedAccountSignal] = createSignal("");
  const [recipient, setRecipientSignal] = createSignal("");
  const [threads, setThreadsSignal] = createSignal("1");
  const [duration, setDurationSignal] = createSignal("300");
  const [busy, setBusySignal] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<string | null>(null);
  // Signal writes from an in-flight request stay hidden until the next await.
  // Admission and follow-up reads use these values immediately.
  let statusValue: CypherStatus | null = null;
  let tabValue: CypherTab = "overview";
  let walletsValue: CypherWallets | null = null;
  let walletAddressValue = "";
  let transfersValue: CypherTransferRecord[] = [];
  let quoteValue: CypherTransferQuote | null = null;
  let sendRecipientValue = "";
  let amountValue = "";
  let confirmedValue = false;
  let selectedAccountValue = "";
  let recipientValue = "";
  let threadsValue = "1";
  let durationValue = "300";
  let busyValue: string | null = null;
  const setStatus = (next: CypherStatus | null) => {
    statusValue = next;
    setStatusSignal(next);
  };
  const setTab = (next: CypherTab) => {
    tabValue = next;
    setTabSignal(next);
  };
  const setWallets = (next: CypherWallets | null) => {
    walletsValue = next;
    setWalletsSignal(next);
  };
  const setWalletAddress = (next: string) => {
    walletAddressValue = next;
    setWalletAddressSignal(next);
  };
  const setTransfers = (
    next: CypherTransferRecord[] | ((items: CypherTransferRecord[]) => CypherTransferRecord[]),
  ) => {
    transfersValue = typeof next === "function" ? next(transfersValue) : next;
    setTransfersSignal(transfersValue);
  };
  const setQuote = (next: CypherTransferQuote | null) => {
    quoteValue = next;
    setQuoteSignal(next);
  };
  const setSendRecipient = (next: string) => {
    sendRecipientValue = next;
    setSendRecipientSignal(next);
  };
  const setAmount = (next: string) => {
    amountValue = next;
    setAmountSignal(next);
  };
  const setConfirmed = (next: boolean) => {
    confirmedValue = next;
    setConfirmedSignal(next);
  };
  const setSelectedAccount = (next: string) => {
    selectedAccountValue = next;
    setSelectedAccountSignal(next);
  };
  const setRecipient = (next: string) => {
    recipientValue = next;
    setRecipientSignal(next);
  };
  const setThreads = (next: string) => {
    threadsValue = next;
    setThreadsSignal(next);
  };
  const setDuration = (next: string) => {
    durationValue = next;
    setDurationSignal(next);
  };
  const setBusy = (next: string | null) => {
    busyValue = next;
    setBusySignal(next);
  };
  let host: HTMLElement | undefined;
  let pending: AbortController | null = null;
  let sendRequestId: string | null = null;
  let disposed = false;

  const clearPasswords = () => {
    for (const input of host?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []) {
      input.value = "";
    }
  };
  const takePassword = (id: string) => {
    const password = host?.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "";
    clearPasswords();
    return password;
  };
  const cancelRequest = () => {
    pending?.abort();
    pending = null;
    if (!disposed) {
      setBusy(null);
    }
    clearPasswords();
  };
  const invalidateQuote = () => {
    setQuote(null);
    setConfirmed(false);
    sendRequestId = null;
    clearPasswords();
  };
  const readMethod = (method: string) =>
    method === "cypher.status" ||
    method === "cypher.wallets.list" ||
    method === "cypher.transfers.list";
  const gatewayRef: { current?: ReturnType<typeof useGatewayPage> } = {};
  const gateway = () => {
    const current = gatewayRef.current;
    if (!current) {
      throw new Error("ColossusX gateway binding is unavailable");
    }
    return current;
  };
  const allowed = (method: string) => {
    // Subscribe render computations; admission uses the value written before the signal commits.
    busy();
    return (
      !busyValue &&
      canCallGatewayMethod(
        gateway().snapshot,
        method,
        readMethod(method) ? "operator.read" : "operator.admin",
      )
    );
  };
  const pollingRef: { current?: ReturnType<typeof useVisiblePoll> } = {};
  const syncPolling = () => {
    const polling = pollingRef.current;
    const current = statusValue;
    if (!polling) {
      return;
    }
    if (
      gateway().connected &&
      (current?.connected || current?.state === "starting" || current?.state === "running")
    ) {
      polling.start();
    } else {
      polling.stop();
    }
  };
  const acceptStatus = (next: CypherStatus) => {
    setStatus(next);
    syncPolling();
    if (!next.connected) {
      setWallets(null);
      setQuote(null);
      setConfirmed(false);
    }
    const accounts = next.node?.accounts ?? [];
    if (!walletAddressValue) {
      setWalletAddress(accounts[0] ?? "");
    }
    if (!accounts.includes(selectedAccountValue)) {
      setSelectedAccount(
        next.node?.signer && accounts.includes(next.node.signer)
          ? next.node.signer
          : (accounts[0] ?? ""),
      );
      setReward(null);
      setRecipient("");
    }
  };
  pollingRef.current = useVisiblePoll(3000, () => void refresh(true));
  gatewayRef.current = useGatewayPage({
    getGateway: () => context.gateway,
    onIdentityChange: () => {
      setStatus(null);
      setReward(null);
      setWallets(null);
      setTransfers([]);
      setWalletAddress("");
      setQuote(null);
      setConfirmed(false);
      sendRequestId = null;
      setSendRecipient("");
      setAmount("");
      setSelectedAccount("");
      setRecipient("");
      setError(null);
      setResult(null);
    },
    invalidateRequests: () => cancelRequest(),
    ensureInitialData: () => void refresh(),
    onSnapshot: () => {
      untrack(() => {
        syncPolling();
        if (!gateway().snapshot?.hello?.auth?.scopes?.includes("operator.admin")) {
          clearPasswords();
          invalidateQuote();
        }
      });
    },
  });

  onCleanup(() => {
    disposed = true;
    pending?.abort();
    pending = null;
    clearPasswords();
  });

  async function refreshDetails(
    client: GatewayClient,
    signal: AbortSignal,
    current: () => boolean,
    force: boolean,
  ): Promise<void> {
    const activeTab = tabValue;
    if (
      statusValue?.connected &&
      (force || activeTab === "wallets" || activeTab === "send" || !walletsValue)
    ) {
      const listed = await client.request<CypherWallets>(
        "cypher.wallets.list",
        { offset: walletsValue?.offset ?? 0, limit: 25 },
        { signal },
      );
      if (!current()) {
        return;
      }
      setWallets(listed);
    }
    if (
      statusValue?.connected &&
      (force ||
        tabValue === "send" ||
        transfersValue.some((transfer) => !["complete", "failed"].includes(transfer.status)))
    ) {
      const listed = await client.request<{ transfers: CypherTransferRecord[] }>(
        "cypher.transfers.list",
        { limit: 50 },
        { signal },
      );
      if (!current()) {
        return;
      }
      for (const transfer of listed.transfers) {
        const previous = transfersValue.find((item) => item.requestId === transfer.requestId);
        if (previous && previous.status !== "complete" && transfer.status === "complete") {
          showToast({
            message: t("cypher.sendComplete", { amount: transfer.amount }),
            placement: "bottom",
          });
        }
      }
      setTransfers(listed.transfers);
    }
  }

  async function request<T>(
    method: string,
    params: Record<string, unknown>,
    accept: (value: T) => void,
    refreshAfter = false,
    quiet = false,
  ): Promise<T | undefined> {
    if (!allowed(method) || (quiet && pending)) {
      return undefined;
    }
    const scope = gateway().capture();
    if (!scope) {
      return undefined;
    }
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    if (!quiet) {
      setBusy(method);
      setError(null);
      setResult(null);
    }
    const current = () =>
      !disposed &&
      pending === controller &&
      gateway().isCurrent(scope) &&
      canCallGatewayMethod(
        gateway().snapshot,
        method,
        readMethod(method) ? "operator.read" : "operator.admin",
      );
    try {
      const value = await scope.client.request<T>(method, params, {
        signal: controller.signal,
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
      if (refreshAfter) {
        const next = await scope.client.request<CypherStatus>(
          "cypher.status",
          {},
          { signal: controller.signal },
        );
        if (current()) {
          acceptStatus(next);
        }
      }
      if (current()) {
        await refreshDetails(scope.client, controller.signal, current, !quiet);
      }
      return current() ? value : undefined;
    } catch (caught) {
      if (current()) {
        setError(formatUiError(caught));
        if (method === "cypher.transfers.send") {
          try {
            await refreshDetails(scope.client, controller.signal, current, true);
          } catch {
            // The original error remains visible; the next refresh reconciles the durable transfer.
          }
        }
      }
      return undefined;
    } finally {
      if (pending === controller) {
        pending = null;
        if (!disposed) {
          setBusy(null);
        }
      }
    }
  }

  function refresh(quiet = false): Promise<CypherStatus | undefined> {
    return request<CypherStatus>("cypher.status", {}, (next) => acceptStatus(next), false, quiet);
  }

  async function statusAction(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await request<CypherStatus>(method, params, (next) => {
      acceptStatus(next);
      setResult(t("cypher.success"));
    });
  }

  async function runAction(action: CypherAction): Promise<void> {
    switch (action) {
      case "wallet-refresh":
        await refresh();
        return;
      case "wallet-previous":
      case "wallet-next": {
        const current = walletsValue;
        if (current) {
          setWallets({
            ...current,
            offset: Math.max(
              0,
              current.offset + (action === "wallet-next" ? current.limit : -current.limit),
            ),
          });
        }
        await refresh();
        return;
      }
      case "prepare":
        invalidateQuote();
        await request<CypherTransferQuote>(
          "cypher.transfers.prepare",
          { from: walletAddressValue, to: sendRecipientValue.trim(), amount: amountValue.trim() },
          (prepared) => {
            setQuote(prepared);
            sendRequestId = crypto.randomUUID();
          },
        );
        return;
      case "send": {
        const password = takePassword("cypher-send-password");
        const prepared = quoteValue;
        const requestId = sendRequestId;
        if (!prepared || !confirmedValue || !requestId) {
          return;
        }
        if (prepared.expiresAt <= Date.now()) {
          invalidateQuote();
          setError(t("cypher.quoteExpired"));
          return;
        }
        await request<CypherTransferRecord>(
          "cypher.transfers.send",
          { requestId, quoteId: prepared.quoteId, password },
          (transfer) => {
            setTransfers((items) => [
              transfer,
              ...items.filter((item) => item.requestId !== transfer.requestId),
            ]);
            setQuote(null);
            setConfirmed(false);
            sendRequestId = null;
            if (transfer.status === "failed") {
              const reason = t(
                transfer.errorCode === "CYPHER_ADMISSION_REQUIRED"
                  ? "cypher.sendAdmissionRejected"
                  : transfer.errorCode === "CYPHER_EXECUTION_FAILED"
                    ? "cypher.sendExecutionFailed"
                    : "cypher.sendFailedHint",
              );
              setError(t("cypher.sendFailed", { reason }));
            } else {
              setResult(
                transfer.status === "unknown"
                  ? t("cypher.sendUnknown")
                  : transfer.status === "complete"
                    ? t("cypher.sendComplete", { amount: transfer.amount })
                    : t("cypher.sendAccepted"),
              );
            }
          },
        );
        return;
      }
      case "cancel-quote":
        invalidateQuote();
        return;
      case "copy-wallet":
        await copyToClipboard(walletAddressValue)
          .then((copied) => {
            if (disposed) {
              return;
            }
            setResult(copied ? t("cypher.addressCopied") : null);
            if (!copied) {
              setError(t("cypher.copyFailed"));
            }
          })
          .catch((caught: unknown) => {
            if (!disposed) {
              setError(formatUiError(caught));
            }
          });
        return;
      case "refresh":
        await refresh();
        return;
      case "start":
      case "stop":
      case "connect":
      case "disconnect":
        await statusAction(`cypher.${action}`);
        return;
      case "select":
        await statusAction("cypher.accounts.select", { address: selectedAccountValue });
        return;
      case "create": {
        const password = takePassword("cypher-account-password");
        await request<{ address: string }>(
          "cypher.accounts.create",
          { password },
          (value) => {
            setWalletAddress(value.address);
            invalidateQuote();
            setResult(t("cypher.created", { address: value.address }));
          },
          true,
        );
        return;
      }
      case "unlock": {
        const password = takePassword("cypher-account-password");
        const seconds = Number(durationValue);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) {
          setError(t("cypher.durationInvalid"));
          return;
        }
        await request<{ unlocked: boolean }>(
          "cypher.accounts.unlock",
          { address: walletAddressValue, password, duration: seconds },
          (value) => setResult(t(value.unlocked ? "cypher.unlocked" : "cypher.refused")),
        );
        return;
      }
      case "lock":
        await request<{ locked: boolean }>(
          "cypher.accounts.lock",
          { address: walletAddressValue },
          (value) => setResult(t(value.locked ? "cypher.locked" : "cypher.refused")),
        );
        return;
      case "mining-start": {
        const password = takePassword("cypher-mining-password");
        const count = Number(threadsValue);
        if (!Number.isInteger(count) || count < 1 || count > 256) {
          setError(t("cypher.threadsInvalid"));
          return;
        }
        await statusAction("cypher.mining.start", {
          threads: count,
          signer: selectedAccountValue,
          password,
        });
        return;
      }
      case "mining-stop":
        await statusAction("cypher.mining.stop");
        return;
      case "reward-get":
        await request<CypherRewardRegistration>(
          "cypher.reward.get",
          { signer: selectedAccountValue },
          (value) => {
            setReward(value);
            setRecipient(value.rewardRecipient ?? "");
          },
        );
        return;
      case "reward-set": {
        const password = takePassword("cypher-reward-password");
        const nextRecipient = recipientValue.trim();
        if (!/^0x[0-9a-fA-F]{40}$/u.test(nextRecipient)) {
          setError(t("cypher.recipientInvalid"));
          return;
        }
        await request<CypherRewardRegistration>(
          "cypher.reward.set",
          { signer: selectedAccountValue, recipient: nextRecipient, password },
          (value) => {
            setReward(value);
            setResult(t("cypher.rewardUpdated"));
          },
        );
        return;
      }
      default: {
        const unexpected: never = action;
        throw new Error(`Unhandled ColossusX action: ${String(unexpected)}`);
      }
    }
  }

  return (
    <openclaw-cypher-page ref={(element) => (host = element)}>
      <CypherView
        tab={tab()}
        wallets={wallets()}
        walletAddress={walletAddress()}
        transfers={transfers()}
        quote={quote()}
        sendRecipient={sendRecipient()}
        amount={amount()}
        confirmed={confirmed()}
        explorerQuery={explorerQuery()}
        status={status()}
        reward={reward()}
        connected={gateway().connected}
        available={isGatewayMethodAdvertised(gateway().snapshot ?? {}, "cypher.status") === true}
        canRead={canCallGatewayMethod(gateway().snapshot, "cypher.status", "operator.read")}
        canAdmin={gateway().snapshot?.hello?.auth?.scopes?.includes("operator.admin") === true}
        busy={busy()}
        error={error()}
        result={result()}
        selectedAccount={selectedAccount()}
        recipient={recipient()}
        threads={threads()}
        duration={duration()}
        allowed={allowed}
        onTab={(next) => {
          clearPasswords();
          setTab(next);
          if (!busyValue) {
            void refresh(true);
          }
        }}
        onWallet={(address) => {
          setWalletAddress(address);
          invalidateQuote();
        }}
        onSendRecipient={(value) => {
          setSendRecipient(value);
          invalidateQuote();
        }}
        onAmount={(value) => {
          setAmount(value);
          invalidateQuote();
        }}
        onConfirmed={setConfirmed}
        onExplorerQuery={setExplorerQuery}
        onAction={(action) => void runAction(action)}
        onAccount={(address) => {
          setSelectedAccount(address);
          setReward(null);
          setRecipient("");
          clearPasswords();
        }}
        onRecipient={setRecipient}
        onThreads={setThreads}
        onDuration={setDuration}
      />
    </openclaw-cypher-page>
  );
}
