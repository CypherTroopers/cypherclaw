import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadArtifact } from "./download.js";

const pin = {
  repository: "CypherTroopers/cypher",
  distributionCommit: "a".repeat(40),
  sourceCommit: "b".repeat(40),
};
const bytes = Buffer.from("independently pinned fixture bytes\n");
const artifact = {
  path: "build/bin/fixture",
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
const nativeFetch = globalThis.fetch;
let serve: (response: http.ServerResponse) => void;
let server: http.Server;
let origin: string;
let directory: string;
let requests: string[];

beforeAll(async () => {
  server = http.createServer((request, response) => {
    requests.push(request.url ?? "");
    serve(response);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not listen");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(async () => {
  // openclaw-temp-dir: allow standalone plugin fixture verifies owned staging files without importing core internals.
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "cypher-native-download-"));
  requests = [];
  serve = (response) => response.end(bytes);
  // Real HTTP exercises the body, status, redirect, and cancellation boundary;
  // the production downloader still validates the original immutable URL.
  vi.stubGlobal("fetch", (input: URL, init: RequestInit) =>
    nativeFetch(new URL(input.pathname, origin), init),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

function download(overrides: Partial<Parameters<typeof downloadArtifact>[0]> = {}) {
  return downloadArtifact({
    pin,
    artifact,
    destination: path.join(directory, "artifact"),
    signal: new AbortController().signal,
    assertCurrent() {},
    onProgress() {},
    ...overrides,
  });
}

describe("immutable artifact HTTP boundary", () => {
  it("writes exact verified bytes and reports streaming progress", async () => {
    const progress: number[] = [];
    await download({ onProgress: (value) => progress.push(value) });
    expect(await fs.readFile(path.join(directory, "artifact"))).toEqual(bytes);
    expect(progress.at(-1)).toBe(bytes.length);
    expect(requests).toEqual([`/${pin.repository}/${pin.distributionCommit}/${artifact.path}`]);
  });

  it.each(["hash", "oversize", "truncated", "length"])("rejects %s corruption", async (kind) => {
    serve = (response) => {
      if (kind === "length") response.setHeader("content-length", bytes.length + 1);
      response.end(
        kind === "hash"
          ? Buffer.alloc(bytes.length, 1)
          : kind === "oversize"
            ? Buffer.concat([bytes, bytes])
            : kind === "truncated"
              ? bytes.subarray(1)
              : bytes,
      );
    };
    await expect(download()).rejects.toMatchObject({ code: "integrity" });
  });

  it.each([
    "http://raw.githubusercontent.com/",
    "https://example.com/",
    `https://raw.githubusercontent.com/${pin.repository}/main/build/bin/fixture`,
  ])("rejects redirect outside immutable source: %s", async (location) => {
    serve = (response) => {
      response.writeHead(302, { location });
      response.end();
    };
    await expect(download()).rejects.toMatchObject({ code: "download" });
    expect(requests).toHaveLength(1);
  });

  it("does not create a file after authority is revoked while awaiting headers", async () => {
    let current = true;
    serve = (response) => {
      current = false;
      response.end(bytes);
    };
    await expect(
      download({
        assertCurrent() {
          if (!current) throw new Error("revoked");
        },
      }),
    ).rejects.toThrow("revoked");
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("reports a staging filesystem failure separately from network failures", async () => {
    await expect(
      download({ destination: path.join(directory, "missing-parent", "artifact") }),
    ).rejects.toMatchObject({ code: "filesystem" });
  });
});
