import path from "node:path";
import type { runCommandBuffered } from "openclaw/plugin-sdk/process-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type BufferedCommandOptions = NonNullable<Parameters<typeof runCommandBuffered>[1]>;
type BufferedCommandResult = Awaited<ReturnType<typeof runCommandBuffered>>;
import { WalletGeneratorManager } from "./manager.js";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  readFile: vi.fn(),
  run: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { access: mocks.access, readFile: mocks.readFile },
}));
// mock-isolation: Keep native subprocess execution and broker lifecycle outside the wallet owner's fixture.
vi.mock("openclaw/plugin-sdk/process-runtime", () => ({ runCommandBuffered: mocks.run }));
vi.mock("./artifacts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./artifacts.js")>()),
  WALLET_GENERATOR_SOURCE_COMMIT: "fixture-source",
  // SHA-256's published abc vector, independent of the implementation under test.
  WALLET_GENERATOR_SHA256: Object.fromEntries(
    ["linux", "darwin", "windows"].flatMap((os) =>
      ["amd64", "arm64"].map((arch) => [
        `${os}-${arch}`,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      ]),
    ),
  ),
}));

// Public Ethereum scalar-one vector; never a funded or user-owned wallet.
const wallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  privateKey: "0x" + "0".repeat(63) + "1",
};
const validOutput = `COLD WALLET GENERATOR

Use only on a trusted, offline computer.
This program does not check your network connection.
The private key below is NOT encrypted.

Address:
${wallet.address}

Private Key:
${wallet.privateKey}

Never share, photograph, cloud-sync, or commit your private key.
Securely back up and verify it BEFORE sending assets to the address.
Importing this key into an online wallet makes it a hot-wallet key.
Rotating afterward does not protect funds during a compromised import.
`;
const authority = { assertCurrent: () => {} };
const managers: WalletGeneratorManager[] = [];

function manager(signal?: AbortSignal) {
  const owner = new WalletGeneratorManager(
    path.resolve("fixture-package", "assets", "wallet-generator"),
    signal,
  );
  managers.push(owner);
  return owner;
}

function commandResult(stdout = validOutput): BufferedCommandResult {
  return {
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
    code: 0,
    signal: null,
    killed: false,
    termination: "exit",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(undefined);
  mocks.readFile.mockResolvedValue(Buffer.from("abc"));
  mocks.run.mockImplementation(async () => commandResult());
});

afterEach(async () => {
  await Promise.all(managers.splice(0).map((owner) => owner.close()));
  vi.useRealTimers();
});

describe("wallet generator execution owner", () => {
  it("generates from the installed pinned binary and keeps status free of results", async () => {
    const owner = manager();
    const before = await owner.status();
    const output = commandResult();
    mocks.run.mockResolvedValueOnce(output);
    await expect(owner.generate(authority)).resolves.toEqual(wallet);
    const [argv, options] = mocks.run.mock.calls[0] as [string[], BufferedCommandOptions];
    expect(argv).toEqual([before.binaryPath]);
    expect(argv[0]).toContain(path.join("fixture-package", "assets", "wallet-generator", "bin"));
    expect(options).toMatchObject({
      timeoutMs: 25_000,
      maxOutputBytes: { stdout: 4096, stderr: 4096 },
      maxCombinedOutputBytes: 8192,
      baseEnv: {},
      input: "",
    });
    expect(output.stdout.every((byte) => byte === 0)).toBe(true);
    expect(await owner.status()).toEqual(before);
    expect(JSON.stringify(before)).not.toContain(wallet.privateKey);
  });

  it.each([
    [
      "missing executable",
      () => mocks.access.mockRejectedValue(new Error("fixture private path")),
      "missing",
    ],
    [
      "modified executable",
      () => mocks.readFile.mockResolvedValue(Buffer.from("changed bytes")),
      "integrity",
    ],
  ])("refuses a %s before launching", async (_name, prepare, code) => {
    prepare();
    const owner = manager();
    await expect(owner.generate(authority)).rejects.toMatchObject({ code });
    expect(mocks.run).not.toHaveBeenCalled();
    const status = await owner.status();
    expect(status.available).toBe(false);
    expect(status.error).not.toContain("fixture private path");
  });

  it("rechecks the executable when generation follows an earlier successful status", async () => {
    const owner = manager();
    expect((await owner.status()).available).toBe(true);
    mocks.readFile.mockResolvedValue(Buffer.from("modified after status"));
    await expect(owner.generate(authority)).rejects.toMatchObject({ code: "integrity" });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it.each(["access", "readFile"] as const)(
    "ends stalled %s preparation at the shared 25-second deadline without spawning",
    async (phase) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      mocks[phase].mockImplementationOnce(async () => {
        entered.resolve();
        await release.promise;
        return phase === "readFile" ? Buffer.from("abc") : undefined;
      });
      const active = manager().generate(authority);
      const rejected = expect(active).rejects.toMatchObject({ code: "timeout" });
      await entered.promise;
      try {
        await vi.advanceTimersByTimeAsync(25_000);
        await rejected;
        expect(mocks.run).not.toHaveBeenCalled();
      } finally {
        release.resolve();
      }
    },
  );

  it("subtracts binary preparation from the generation budget and reports deadline cancellation as timeout", async () => {
    const preparing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const spawned = Promise.withResolvers<void>();
    mocks.readFile.mockImplementationOnce(async () => {
      preparing.resolve();
      await release.promise;
      return Buffer.from("abc");
    });
    const output = commandResult();
    mocks.run.mockImplementationOnce((_argv: string[], options: BufferedCommandOptions) => {
      expect(options.timeoutMs).toBe(20_000);
      spawned.resolve();
      return new Promise<BufferedCommandResult>((resolve) => {
        options.signal!.addEventListener(
          "abort",
          () => resolve({ ...output, code: null, termination: "signal" }),
          { once: true },
        );
      });
    });
    const active = manager().generate(authority);
    const rejected = expect(active).rejects.toMatchObject({ code: "timeout" });
    await preparing.promise;
    await vi.advanceTimersByTimeAsync(5000);
    release.resolve();
    await spawned.promise;
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(output.stdout.every((byte) => byte === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns the deadline error while retaining native cleanup for concurrency and close", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const output = commandResult();
    output.stderr = Buffer.from(wallet.privateKey);
    let executionSignal: AbortSignal | undefined;
    mocks.run.mockImplementationOnce(async (_argv: string[], options: BufferedCommandOptions) => {
      executionSignal = options.signal;
      entered.resolve();
      await release.promise;
      return output;
    });
    const owner = manager();
    const active = owner.generate(authority);
    const rejected = expect(active).rejects.toMatchObject({ code: "timeout" });
    let closed = false;
    let closing: Promise<void> | undefined;
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(25_000);
      await rejected;
      expect(executionSignal?.aborted).toBe(true);
      await expect(owner.generate(authority)).rejects.toMatchObject({ code: "busy" });
      closing = owner.close().then(() => {
        closed = true;
      });
      // Windows taskkill settlement can outlast the browser's 30-second request window.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(closed).toBe(false);
      expect(mocks.run).toHaveBeenCalledOnce();
    } finally {
      release.resolve();
      await (closing ?? owner.close());
    }
    expect(closed).toBe(true);
    expect(output.stdout.every((byte) => byte === 0)).toBe(true);
    expect(output.stderr.every((byte) => byte === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects revoked authority after file preparation and before spawn", async () => {
    let current = true;
    mocks.readFile.mockImplementationOnce(async () => {
      current = false;
      return Buffer.from("abc");
    });
    await expect(
      manager().generate({
        assertCurrent() {
          if (!current) {
            throw new Error("Authority revoked");
          }
        },
      }),
    ).rejects.toThrow("Authority revoked");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it.each([
    ["missing key", `Address:\n${wallet.address}\n`],
    ["duplicate result", validOutput + validOutput],
    ["truncated key", validOutput.replace(wallet.privateKey, wallet.privateKey.slice(0, -1))],
    ["invalid address", validOutput.replace(wallet.address, "0xBAD")],
    [
      "key with trailing text",
      validOutput.replace(wallet.privateKey, wallet.privateKey + " extra"),
    ],
  ])("rejects %s without exposing the captured output", async (_name, stdout) => {
    const result = commandResult(stdout);
    result.stderr = Buffer.from(wallet.privateKey);
    mocks.run.mockResolvedValueOnce(result);
    const failure = await manager()
      .generate(authority)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "output" });
    expect(String(failure)).not.toContain(wallet.privateKey);
    expect(result.stdout.every((byte) => byte === 0)).toBe(true);
    expect(result.stderr.every((byte) => byte === 0)).toBe(true);
  });

  it.each([
    ["timeout", "timeout"],
    ["output-limit", "failed"],
    ["error", "failed"],
  ] as const)("never returns partial keys after %s", async (termination, code) => {
    const output = commandResult();
    mocks.run.mockResolvedValueOnce({ ...output, termination, code: null });
    await expect(manager().generate(authority)).rejects.toMatchObject({ code });
    expect(output.stdout.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects a nonzero exit even when the output contains a complete wallet", async () => {
    mocks.run.mockResolvedValueOnce({ ...commandResult(), code: 1 });
    await expect(manager().generate(authority)).rejects.toMatchObject({ code: "failed" });
  });

  it.each(["caller", "gateway", "owner"] as const)(
    "cancels active generation with its %s and refuses concurrent generation",
    async (source) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const caller = new AbortController();
      const gateway = new AbortController();
      const output = commandResult();
      let signal: AbortSignal | undefined;
      mocks.run.mockImplementationOnce(async (_argv: string[], options: BufferedCommandOptions) => {
        signal = options.signal;
        entered.resolve();
        await release.promise;
        return output;
      });
      const owner = manager(gateway.signal);
      const active = owner.generate({ ...authority, signal: caller.signal });
      const outcome = active.catch((error: unknown) => error);
      let closing: Promise<void> | undefined;
      try {
        await entered.promise;
        await expect(owner.generate(authority)).rejects.toMatchObject({ code: "busy" });
        if (source === "owner") {
          closing = owner.close();
        } else {
          (source === "caller" ? caller : gateway).abort();
        }
        expect(signal?.aborted).toBe(true);
        expect(await outcome).toMatchObject({ code: "closed" });
      } finally {
        release.resolve();
        await (closing ?? owner.close());
      }
      expect(output.stdout.every((byte) => byte === 0)).toBe(true);
      expect(mocks.run).toHaveBeenCalledOnce();
    },
  );
});
