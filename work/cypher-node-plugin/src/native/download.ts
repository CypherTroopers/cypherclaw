import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { NativeSetupError, type NativeArtifact, type NativePin } from "./types.js";

const allowedHosts = new Set(["raw.githubusercontent.com", "media.githubusercontent.com"]);
const timeoutMs = 10 * 60 * 1000;

function assertSource(url: URL, pin: NativePin): void {
  if (
    url.protocol !== "https:" ||
    !allowedHosts.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(`/${pin.repository}/${pin.distributionCommit}/`) ||
    url.search ||
    url.hash
  ) {
    throw new NativeSetupError("download");
  }
}

/** Stream one immutable artifact into an exclusively owned staging file. */
export async function downloadArtifact(options: {
  pin: NativePin;
  artifact: NativeArtifact;
  destination: string;
  signal: AbortSignal;
  assertCurrent(): void;
  onProgress(bytes: number): void;
}): Promise<void> {
  const { pin, artifact, destination, assertCurrent, onProgress } = options;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]);
  let url = new URL(
    `https://raw.githubusercontent.com/${pin.repository}/${pin.distributionCommit}/${artifact.path}`,
  );
  let response: Response | undefined;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      assertSource(url, pin);
      assertCurrent();
      signal.throwIfAborted();
      response = await fetch(url, {
        redirect: "manual",
        signal,
        headers: { "accept-encoding": "identity" },
      });
      assertCurrent();
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 3) throw new NativeSetupError("download");
      url = new URL(location, url);
    }
    if (!response?.ok || !response.body) throw new NativeSetupError("download");
    const encoding = response.headers.get("content-encoding");
    const length = response.headers.get("content-length");
    if (
      (encoding && encoding !== "identity") ||
      (length !== null && Number(length) !== artifact.bytes)
    ) {
      throw new NativeSetupError("integrity");
    }
    assertCurrent();
    signal.throwIfAborted();
    const handle = await open(destination, "wx", 0o600).catch(() => {
      throw new NativeSetupError("filesystem");
    });
    try {
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of response.body) {
        assertCurrent();
        signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > artifact.bytes) throw new NativeSetupError("integrity");
        hash.update(chunk);
        // FileHandle.write may write fewer bytes than requested.
        let offset = 0;
        while (offset < chunk.byteLength) {
          assertCurrent();
          signal.throwIfAborted();
          const result = await handle.write(chunk, offset, chunk.byteLength - offset).catch(() => {
            throw new NativeSetupError("filesystem");
          });
          if (result.bytesWritten === 0) throw new NativeSetupError("filesystem");
          offset += result.bytesWritten;
        }
        onProgress(bytes);
      }
      if (bytes !== artifact.bytes || hash.digest("hex") !== artifact.sha256) {
        throw new NativeSetupError("integrity");
      }
      assertCurrent();
      signal.throwIfAborted();
      await handle.sync().catch(() => {
        throw new NativeSetupError("filesystem");
      });
    } finally {
      await handle.close().catch(() => {
        throw new NativeSetupError("filesystem");
      });
    }
  } catch (error) {
    await response?.body?.cancel().catch(() => {});
    assertCurrent();
    if (error instanceof NativeSetupError) throw error;
    throw new NativeSetupError("download");
  }
}
