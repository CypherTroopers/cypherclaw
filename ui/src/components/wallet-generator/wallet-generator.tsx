import { createSignal, onCleanup, untrack } from "solid-js";
import type {
  WalletGeneratorResult,
  WalletGeneratorStatus,
} from "../../../../src/wallet-generator/types.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import { canCallGatewayMethod } from "../../lib/gateway-methods.ts";
import { useApplication } from "../../lib/reactive/context.ts";
import { useGatewayPage } from "../../lib/reactive/gateway-page.ts";
import { t } from "../../lib/reactive/i18n.ts";
import { listen } from "../../lib/reactive/listener.ts";
import { WalletGeneratorView } from "./view.tsx";
import "./style.css";

type WalletGeneratorHost = HTMLElement & { releaseSecrets?: () => void };
type WalletAction = "status" | "generate";

declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "openclaw-wallet-generator": HTMLAttributes<HTMLElement>;
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get("openclaw-wallet-generator")) {
  customElements.define(
    "openclaw-wallet-generator",
    class extends HTMLElement {
      disconnectedCallback() {
        (this as WalletGeneratorHost).releaseSecrets?.();
      }
    },
  );
}

type WalletResponses = {
  status: WalletGeneratorStatus;
  generate: WalletGeneratorResult;
};

export function WalletGenerator() {
  const context = useApplication();
  const [status, setStatus] = createSignal<WalletGeneratorStatus | null>(null);
  const [result, setResult] = createSignal<WalletGeneratorResult | null>(null);
  const [busy, setBusy] = createSignal<WalletAction | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [revealed, setRevealed] = createSignal(false);
  let host: WalletGeneratorHost | undefined;
  let pending: AbortController | null = null;
  let alive = true;

  const wipeSecrets = () => {
    for (const output of host?.querySelectorAll("[data-wallet-value]") ?? []) {
      output.textContent = "";
    }
  };
  const clear = () => {
    pending?.abort();
    pending = null;
    wipeSecrets();
    if (!alive) {
      return;
    }
    setBusy(null);
    setResult(null);
    setRevealed(false);
    setError(null);
    setNotice(null);
  };
  const gatewayRef: { current?: ReturnType<typeof useGatewayPage> } = {};
  const gateway = () => {
    const current = gatewayRef.current;
    if (!current) {
      throw new Error("Wallet generator gateway binding is unavailable");
    }
    return current;
  };
  const allowed = (action: WalletAction) =>
    canCallGatewayMethod(
      gateway().snapshot,
      `wallet.generator.${action}`,
      action === "status" ? "operator.read" : "operator.admin",
      { requireAdvertisement: false },
    );
  gatewayRef.current = useGatewayPage({
    getGateway: () => context.gateway,
    invalidateRequests: () => {
      clear();
      if (alive) {
        setStatus(null);
      }
    },
    ensureInitialData: () => void refresh(),
    onSnapshot: () => {
      untrack(() => {
        if (result() && !allowed("generate")) {
          clear();
        }
      });
    },
  });

  onCleanup(listen(globalThis, "pagehide", () => clear()));
  onCleanup(() => {
    alive = false;
    pending?.abort();
    pending = null;
    wipeSecrets();
  });

  async function request<Action extends keyof WalletResponses>(
    action: Action,
    accept: (value: WalletResponses[Action]) => void,
  ): Promise<void> {
    if (pending || !allowed(action)) {
      return;
    }
    const scope = gateway().capture();
    if (!scope) {
      return;
    }
    const controller = new AbortController();
    pending = controller;
    setBusy(action);
    setError(null);
    setNotice(null);
    const current = () =>
      alive &&
      pending === controller &&
      host?.isConnected === true &&
      context.gateway === gateway().gateway &&
      gateway().isCurrent(scope) &&
      allowed(action);
    try {
      const value = await scope.client.request<WalletResponses[Action]>(
        `wallet.generator.${action}`,
        {},
        {
          signal: controller.signal,
          timeoutMs: 35_000,
        },
      );
      if (current()) {
        accept(value);
      }
    } catch {
      if (current()) {
        // Process and transport failures may contain raw output; never render their messages.
        setError(
          t(
            action === "status" ? "walletGenerator.statusFailed" : "walletGenerator.generateFailed",
          ),
        );
      }
    } finally {
      if (pending === controller) {
        pending = null;
        if (alive) {
          setBusy(null);
        }
      }
    }
  }

  function refresh(): Promise<void> {
    return request("status", (next) => setStatus(next));
  }

  function generate(): Promise<void> | void {
    if (result() || !status()?.available) {
      return;
    }
    return request("generate", (generated) => {
      setResult(generated);
      setRevealed(false);
    });
  }

  async function copy(field: "address" | "privateKey"): Promise<void> {
    const generated = result();
    const scope = gateway().capture();
    if (!generated || !scope || !allowed("generate")) {
      return;
    }
    const current = () =>
      alive &&
      host?.isConnected === true &&
      result() === generated &&
      context.gateway === gateway().gateway &&
      gateway().isCurrent(scope) &&
      allowed("generate");
    const copied = await copyToClipboard(generated[field], current);
    if (current()) {
      setNotice(
        copied
          ? t(field === "address" ? "walletGenerator.addressCopied" : "walletGenerator.keyCopied")
          : t("walletGenerator.copyFailed"),
      );
    }
  }

  return (
    <openclaw-wallet-generator
      ref={(element: WalletGeneratorHost) => {
        host = element;
        element.releaseSecrets = () => clear();
      }}
    >
      <WalletGeneratorView
        status={status()}
        result={result()}
        connected={gateway().connected}
        canRead={allowed("status")}
        canGenerate={allowed("generate")}
        busy={busy()}
        error={error()}
        notice={notice()}
        revealed={revealed()}
        onRefresh={() => void refresh()}
        onGenerate={() => void generate()}
        onReveal={() => setRevealed((value) => !value)}
        onCopy={(field) => void copy(field)}
        onClear={() => clear()}
      />
    </openclaw-wallet-generator>
  );
}
