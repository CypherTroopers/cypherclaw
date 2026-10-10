import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callCypherIpc, CypherIpcError } from "./ipc.js";

const netMock = vi.hoisted(() => ({ Socket: vi.fn() }));
vi.mock("node:net", () => ({ Socket: netMock.Socket }));

class FakeSocket extends EventEmitter {
  connect = vi.fn(() => this);
  write = vi.fn((data: string) => Boolean(data));
  destroy = vi.fn(() => {
    this.emit("close");
    return this;
  });

  request(): { jsonrpc: string; id: string; method: string; params: unknown[] } {
    this.emit("connect");
    return JSON.parse(this.write.mock.calls[0]![0]);
  }

  respond(result: unknown, id = this.request().id) {
    this.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`));
  }
}

describe("Cypher IPC adapter", () => {
  let sockets: FakeSocket[];

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    netMock.Socket.mockImplementation(function () {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("sends the three Cypher mining arguments as JSON and decodes fragmented UTF-8", async () => {
    const password = 'secret"; miner.stop();\n日本語';
    const result = callCypherIpc("/owned/cypher.ipc", "miner_start", [2, "0x1234", password]);
    const socket = sockets[0]!;
    const request = socket.request();
    expect(socket.connect).toHaveBeenCalledWith("/owned/cypher.ipc");
    expect(request).toMatchObject({
      jsonrpc: "2.0",
      method: "miner_start",
      params: [2, "0x1234", password],
    });
    expect(socket.write.mock.calls[0]![0]).toMatch(/\n$/);
    const reply = Buffer.from(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "採掘開始" }) + "\n",
    );
    const split = reply.indexOf(Buffer.from("採")) + 1;
    socket.emit("data", reply.subarray(0, split));
    socket.emit("data", reply.subarray(split, split + 1));
    socket.emit("data", reply.subarray(split + 1));
    await expect(result).resolves.toBe("採掘開始");
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a fresh connection and unique request IDs, including named pipe endpoints", async () => {
    const endpoint = "\\\\.\\pipe\\cypher.ipc";
    const first = callCypherIpc(endpoint, "personal_getCommonRPCRewardAddress", ["0x1234"]);
    const second = callCypherIpc(endpoint, "eth_mining", []);
    const firstRequest = sockets[0]!.request();
    const secondRequest = sockets[1]!.request();
    expect(firstRequest.id).not.toBe(secondRequest.id);
    expect(sockets[0]!.connect).toHaveBeenCalledWith(endpoint);
    sockets[0]!.respond({ configured: false }, firstRequest.id);
    sockets[1]!.respond(false, secondRequest.id);
    await expect(first).resolves.toEqual({ configured: false });
    await expect(second).resolves.toBe(false);
    expect(sockets.every((socket) => socket.destroy.mock.calls.length === 1)).toBe(true);
  });

  it("distinguishes cancellation before a write from an uncertain outcome after a write", async () => {
    const before = new AbortController();
    const canceled = callCypherIpc("/owned/cypher.ipc", "eth_sendRawTransaction", ["0xabcd"], {
      signal: before.signal,
    });
    before.abort();
    await expect(canceled).rejects.toMatchObject({ code: "IPC_CANCELLED", requestSent: false });
    expect(sockets[0]!.write).not.toHaveBeenCalled();
    const after = new AbortController();
    const uncertain = callCypherIpc("/owned/cypher.ipc", "eth_sendRawTransaction", ["0xabcd"], {
      signal: after.signal,
    });
    sockets[1]!.request();
    after.abort();
    await expect(uncertain).rejects.toMatchObject({ code: "IPC_CANCELLED", requestSent: true });
  });

  it("reports the native Common admission requirement without copying error secrets", async () => {
    const operation = callCypherIpc("/owned/cypher.ipc", "eth_sendRawTransaction", ["0xabcd"]);
    const socket = sockets[0]!;
    const { id } = socket.request();
    socket.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message:
              "Fair HotStuff transactions must be submitted through an admission-enabled common RPC node: fixture-private-value",
          },
        }) + "\n",
      ),
    );
    await expect(operation).rejects.toMatchObject({
      code: "CYPHER_ADMISSION_REQUIRED",
      requestSent: true,
    });
    await expect(operation).rejects.not.toThrow("fixture-private-value");
  });

  it.each([
    ["wrong request ID", (id: string) => ({ jsonrpc: "2.0", id: `${id}-wrong`, result: true })],
    ["wrong version", (id: string) => ({ jsonrpc: "1.0", id, result: true })],
    ["missing result", (id: string) => ({ jsonrpc: "2.0", id })],
    [
      "ambiguous outcome",
      (id: string) => ({ jsonrpc: "2.0", id, result: true, error: { code: -32000 } }),
    ],
    ["malformed error", (id: string) => ({ jsonrpc: "2.0", id, error: { code: "secret" } })],
  ] as const)(
    "rejects %s instead of accepting an unrelated or ambiguous response",
    async (_label, response) => {
      const result = callCypherIpc("/owned/cypher.ipc", "miner_stop", []);
      const socket = sockets[0]!;
      socket.emit("data", Buffer.from(`${JSON.stringify(response(socket.request().id))}\n`));
      await expect(result).rejects.toMatchObject({ code: "IPC_PROTOCOL" });
      expect(socket.destroy).toHaveBeenCalledOnce();
    },
  );

  it("redacts node error messages and data that reflect the submitted password", async () => {
    const password = "do-not-expose-this-password";
    const result = callCypherIpc("/owned/cypher.ipc", "personal_newAccount", [password]);
    const socket = sockets[0]!;
    const id = socket.request().id;
    socket.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: password, data: { password } },
        }) + "\n",
      ),
    );
    const error: unknown = await result.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CypherIpcError);
    expect(error).toMatchObject({ code: -32000 });
    expect(String(error)).not.toContain(password);
    expect(JSON.stringify(error)).not.toContain(password);
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it.each(["ENOENT", "ECONNREFUSED", "EACCES", "EBUSY"])(
    "preserves safe %s connection errors without server text",
    async (code) => {
      const result = callCypherIpc("/owned/cypher.ipc", "web3_clientVersion", []);
      const socket = sockets[0]!;
      socket.emit("error", Object.assign(new Error("secret server text"), { code }));
      await expect(result).rejects.toMatchObject({ code, requestSent: false });
      await expect(result).rejects.not.toThrow("secret server text");
      expect(socket.destroy).toHaveBeenCalledOnce();
      expect(netMock.Socket).toHaveBeenCalledOnce();
    },
  );

  it("reports a nonexistent native IPC endpoint as a proven pre-write failure", async () => {
    const native = await vi.importActual<typeof import("node:net")>("node:net");
    const socket = new native.Socket();
    const write = vi.spyOn(socket, "write");
    netMock.Socket.mockImplementationOnce(function () {
      return socket;
    });
    const endpoint =
      process.platform === "win32"
        ? `\\\\.\\pipe\\cypherclaw-missing-${randomUUID()}`
        : path.join(os.tmpdir(), `cypherclaw-missing-${randomUUID()}.sock`);
    const result = callCypherIpc(endpoint, "eth_sendRawTransaction", ["0xabcd"]);
    const error: unknown = await result.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CypherIpcError);
    expect(error).toMatchObject({
      code: expect.stringMatching(/^(ENOENT|ECONNREFUSED)$/),
      requestSent: false,
    });
    expect(write).not.toHaveBeenCalled();
    expect(socket.destroyed).toBe(true);
  });

  it("rejects responses above the byte budget even when they arrive in fragments", async () => {
    const result = callCypherIpc("/owned/cypher.ipc", "eth_accounts", []);
    const socket = sockets[0]!;
    socket.request();
    socket.emit("data", Buffer.alloc(64 * 1024, " "));
    socket.emit("data", Buffer.alloc(64 * 1024 + 1, " "));
    await expect(result).rejects.toMatchObject({ code: "IPC_PROTOCOL" });
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it("closes a timed-out mutation without reconnecting or retrying it", async () => {
    const result = callCypherIpc("/owned/cypher.ipc", "miner_stop", []);
    const rejected = expect(result).rejects.toMatchObject({
      code: "IPC_TIMEOUT",
      requestSent: true,
    });
    sockets[0]!.request();
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(sockets[0]!.destroy).toHaveBeenCalledOnce();
    expect(sockets[0]!.write).toHaveBeenCalledOnce();
    expect(netMock.Socket).toHaveBeenCalledOnce();
  });

  it("cancels pending I/O and removes its abort listener", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = callCypherIpc(
      "/owned/cypher.ipc",
      "personal_unlockAccount",
      ["0x1234", "secret", 300],
      { signal: controller.signal },
    );
    sockets[0]!.request();
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "IPC_CANCELLED" });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(sockets[0]!.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not open a connection when canceled before invocation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      callCypherIpc("/owned/cypher.ipc", "miner_stop", [], { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "IPC_CANCELLED" });
    expect(netMock.Socket).not.toHaveBeenCalled();
  });

  it("does not write a mutation when authority was revoked while connecting", async () => {
    let current = true;
    const result = callCypherIpc("/owned/cypher.ipc", "miner_stop", [], {
      assertCurrent: () => {
        if (!current) {
          throw new Error("secret authority error");
        }
      },
    });
    current = false;
    sockets[0]!.emit("connect");
    await expect(result).rejects.toMatchObject({ code: "IPC_CANCELLED" });
    await expect(result).rejects.not.toThrow("secret authority error");
    expect(sockets[0]!.write).not.toHaveBeenCalled();
    expect(sockets[0]!.destroy).toHaveBeenCalledOnce();
  });

  it("rejects unsupported operations before connecting", async () => {
    // @ts-expect-error Exercise the runtime boundary for an untyped caller.
    const result = callCypherIpc("/owned/cypher.ipc", "admin_stop", []);
    await expect(result).rejects.toMatchObject({ code: "IPC_PROTOCOL" });
    expect(netMock.Socket).not.toHaveBeenCalled();
  });

  it("requires all three mining arguments before connecting", async () => {
    // @ts-expect-error Cypher mining differs from the upstream single-argument API.
    const result = callCypherIpc("/owned/cypher.ipc", "miner_start", [2]);
    await expect(result).rejects.toMatchObject({ code: "IPC_PROTOCOL" });
    expect(netMock.Socket).not.toHaveBeenCalled();
  });

  it("closes the connection after malformed JSON", async () => {
    const result = callCypherIpc("/owned/cypher.ipc", "miner_stop", []);
    sockets[0]!.request();
    sockets[0]!.emit("data", Buffer.from("{not-json}\n"));
    await expect(result).rejects.toMatchObject({ code: "IPC_PROTOCOL" });
    expect(sockets[0]!.destroy).toHaveBeenCalledOnce();
  });

  it.each(["end", "close"])("rejects premature %s without a response", async (event) => {
    const result = callCypherIpc("/owned/cypher.ipc", "miner_stop", []);
    sockets[0]!.request();
    sockets[0]!.emit(event);
    await expect(result).rejects.toMatchObject({ code: "IPC_CONNECTION" });
    expect(sockets[0]!.destroy).toHaveBeenCalledOnce();
  });

  it("accepts a final complete response when the peer ends without a trailing newline", async () => {
    const result = callCypherIpc("/owned/cypher.ipc", "miner_stop", []);
    const socket = sockets[0]!;
    socket.emit(
      "data",
      Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: socket.request().id, result: null })),
    );
    socket.emit("end");
    await expect(result).resolves.toBeNull();
    expect(socket.destroy).toHaveBeenCalledOnce();
  });
});
