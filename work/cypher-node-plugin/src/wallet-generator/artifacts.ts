import { WALLET_ARTIFACTS, WALLET_PIN } from "../native/pins.js";

// Execution verification consumes the same immutable pin owner as installation.
export const WALLET_GENERATOR_SOURCE_COMMIT = WALLET_PIN.sourceCommit;

export const WALLET_GENERATOR_SHA256: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(WALLET_ARTIFACTS).flatMap(([target, artifacts]) => {
    const executable = artifacts.find((artifact) => artifact.executable);
    return executable ? [[target, executable.sha256]] : [];
  }),
);
