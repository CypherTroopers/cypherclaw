import type { TranslationMap } from "../lib/types.ts";
import { en } from "./en.ts";

const enWalletGenerator = {
  walletGenerator: {
    title: "Wallet generator",
    description:
      "Generate a wallet on the connected Gateway's computer. A running node is not required.",
    offline: "Connect to the Gateway to generate a wallet.",
    readRequired: "Operator read access is required to check the wallet generator.",
    adminRequired: "Administrator access is required to generate a wallet.",
    unsupported: "No wallet generator binary is available for this Gateway's OS and architecture.",
    unavailable:
      "The wallet generator binary is missing or failed verification. Reinstall this build and check again.",
    platform: "Gateway platform",
    executionHint: "The wallet is generated on the Gateway computer and sent to this browser.",
    command: "Command",
    refresh: "Check availability",
    checking: "Checking the wallet generator…",
    generate: "Generate wallet",
    generating: "Generating wallet…",
    clearBeforeGenerate: "Save this wallet, then clear the display before generating another.",
    statusFailed:
      "Could not check the wallet generator. Check the Gateway connection and try again.",
    generateFailed: "Wallet generation did not complete. Check availability and try again.",
    address: "Wallet address",
    privateKey: "Private key",
    keyHint:
      "Save this key securely before leaving. It is cleared when you leave this page or disconnect. Anyone with it can spend the wallet's funds.",
    keyHidden: "Private key hidden",
    showKey: "Show private key",
    hideKey: "Hide private key",
    copyAddress: "Copy address",
    copyKey: "Copy private key",
    clear: "Clear display",
    addressCopied: "Wallet address copied.",
    keyCopied: "Private key copied. Clear your clipboard after saving it.",
    copyFailed: "Copy failed. Select and copy the value manually.",
  },
} satisfies TranslationMap;

export const registerWalletGeneratorEnglish = Object.assign(
  () => Object.assign(en, enWalletGenerator),
  { catalog: enWalletGenerator },
);
