import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { runCommandBuffered } from "openclaw/plugin-sdk/process-runtime";
import { WALLET_GENERATOR_SHA256, WALLET_GENERATOR_SOURCE_COMMIT } from "./artifacts.js";
import type {
  WalletGeneratorAuthority,
  WalletGeneratorResult,
  WalletGeneratorStatus,
} from "./types.js";

const failures = {
  unsupported: "Wallet generation is unavailable on this Gateway's OS or CPU architecture.",
  missing: "The wallet generator is missing or cannot run. Reinstall the Cypher plugin.",
  integrity: "The wallet generator failed its integrity check. Reinstall the Cypher plugin.",
  busy: "A wallet is already being generated. Wait for it to finish before trying again.",
  closed: "Wallet generation was interrupted. Reconnect to the Gateway and try again.",
  timeout: "Wallet generation timed out. Try again on this Gateway.",
  output: "The wallet generator returned an invalid result. Reinstall the Cypher plugin.",
  failed: "Wallet generation failed. Check that the bundled generator can run on this Gateway.",
} as const;

export class WalletGeneratorError extends Error {
  constructor(readonly code: keyof typeof failures) {
    super(failures[code]);
    this.name = "WalletGeneratorError";
  }
}

function parseWallet(stdout: Buffer): WalletGeneratorResult {
  const fields = stdout.toString("utf8").split(/\r?\n/);
  const addresses = fields.flatMap((line, index) => (line.startsWith("Address:") ? [index] : []));
  const privateKeys = fields.flatMap((line, index) =>
    line.startsWith("Private Key:") ? [index] : [],
  );
  const addressIndex = addresses[0];
  const keyIndex = privateKeys[0];
  const address =
    addressIndex !== undefined && fields[addressIndex] === "Address:"
      ? fields[addressIndex + 1]?.match(/^(0x[0-9a-fA-F]{40})$/)?.[1]
      : undefined;
  const privateKey =
    keyIndex !== undefined && fields[keyIndex] === "Private Key:"
      ? fields[keyIndex + 1]?.match(/^(0x[0-9a-fA-F]{64})$/)?.[1]
      : undefined;
  if (addresses.length !== 1 || privateKeys.length !== 1 || !address || !privateKey) {
    throw new WalletGeneratorError("output");
  }
  return { address, privateKey };
}

/** Owns one transient generation at a time, independently of any blockchain node. */
export class WalletGeneratorManager {
  readonly #lifetime = new AbortController();
  readonly #gatewaySignal: AbortSignal | undefined;
  readonly #platform = process.platform;
  readonly #arch = process.arch;
  readonly #assetDir: string;
  #active: Promise<void> | undefined;

  constructor(assetDir: string, gatewaySignal?: AbortSignal) {
    this.#assetDir = assetDir;
    this.#gatewaySignal = gatewaySignal;
  }

  get #target(): string | undefined {
    const os = this.#platform === "win32" ? "windows" : this.#platform;
    const arch = this.#arch === "x64" ? "amd64" : this.#arch;
    const target = `${os}-${arch}`;
    return WALLET_GENERATOR_SHA256[target] ? target : undefined;
  }

  async #binaryPath(): Promise<string> {
    const target = this.#target;
    if (!target) {
      throw new WalletGeneratorError("unsupported");
    }
    return path.join(
      this.#assetDir,
      "bin",
      target,
      this.#platform === "win32" ? "coldwalletgenerator.exe" : "coldwalletgenerator",
    );
  }

  async #verifyBinary(binaryPath: string, signal?: AbortSignal): Promise<void> {
    const target = this.#target;
    if (!target) {
      throw new WalletGeneratorError("unsupported");
    }
    let bytes: Buffer;
    try {
      await fs.access(binaryPath, this.#platform === "win32" ? constants.F_OK : constants.X_OK);
      bytes = await fs.readFile(binaryPath, { signal });
    } catch {
      throw new WalletGeneratorError("missing");
    }
    if (createHash("sha256").update(bytes).digest("hex") !== WALLET_GENERATOR_SHA256[target]) {
      throw new WalletGeneratorError("integrity");
    }
  }

  async status(): Promise<WalletGeneratorStatus> {
    let binaryPath: string | null = null;
    let error: string | null = null;
    try {
      binaryPath = await this.#binaryPath();
      await this.#verifyBinary(binaryPath);
    } catch (cause) {
      error = cause instanceof WalletGeneratorError ? cause.message : failures.missing;
    }
    return {
      platform: this.#platform,
      arch: this.#arch,
      supported: this.#target !== undefined,
      available: error === null,
      binaryPath,
      error,
      sourceCommit: WALLET_GENERATOR_SOURCE_COMMIT,
    };
  }

  async generate(authority: WalletGeneratorAuthority): Promise<WalletGeneratorResult> {
    const ownerSignal = AbortSignal.any([
      this.#lifetime.signal,
      ...(this.#gatewaySignal ? [this.#gatewaySignal] : []),
      ...(authority.signal ? [authority.signal] : []),
    ]);
    if (ownerSignal.aborted) {
      throw new WalletGeneratorError("closed");
    }
    authority.assertCurrent();
    if (this.#active) {
      throw new WalletGeneratorError("busy");
    }
    const deadline = new AbortController();
    const expiresAt = Date.now() + 25_000;
    const timer = setTimeout(() => deadline.abort(), 25_000);
    timer.unref();
    const signal = AbortSignal.any([ownerSignal, deadline.signal]);
    const assertCurrent = () => {
      if (deadline.signal.aborted || Date.now() >= expiresAt) {
        throw new WalletGeneratorError("timeout");
      }
      if (ownerSignal.aborted) {
        throw new WalletGeneratorError("closed");
      }
      authority.assertCurrent();
    };
    const operation = this.#generate(signal, assertCurrent, expiresAt);
    // Caller deadlines do not release the native process owner while SDK cleanup is pending.
    // Retain settlement only: completed private keys never become owner state.
    this.#active = operation.then(
      () => {
        this.#active = undefined;
      },
      () => {
        this.#active = undefined;
      },
    );
    let onAbort: () => void = () => {};
    const cancellation = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        try {
          assertCurrent();
        } catch (error) {
          reject(error);
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
    });
    try {
      return await Promise.race([operation, cancellation]);
    } catch (error) {
      assertCurrent();
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  async #generate(
    signal: AbortSignal,
    assertCurrent: () => void,
    expiresAt: number,
  ): Promise<WalletGeneratorResult> {
    const binaryPath = await this.#binaryPath();
    assertCurrent();
    await this.#verifyBinary(binaryPath, signal);
    assertCurrent();
    const result = await runCommandBuffered([binaryPath], {
      signal,
      timeoutMs: Math.max(1, expiresAt - Date.now()),
      maxOutputBytes: { stdout: 4096, stderr: 4096 },
      maxCombinedOutputBytes: 8192,
      input: "",
      terminateOnOutputError: true,
      killProcessTree: true,
      killGraceMs: 1000,
      // The generator needs no credentials or operator configuration.
      baseEnv: {},
      env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {},
    });
    try {
      assertCurrent();
      if (result.termination === "timeout") {
        throw new WalletGeneratorError("timeout");
      }
      if (result.termination !== "exit" || result.code !== 0) {
        throw new WalletGeneratorError("failed");
      }
      return parseWallet(result.stdout);
    } finally {
      result.stdout.fill(0);
      result.stderr.fill(0);
    }
  }

  async close(): Promise<void> {
    this.#lifetime.abort();
    await this.#active;
  }
}
