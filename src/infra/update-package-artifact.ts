import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { buildTimeoutAbortSignal } from "../utils/fetch-timeout.js";
import { cancelUnreadResponseBody } from "./http-body.js";
import { UPDATE_NETWORK_TIMEOUT_MS } from "./update-network-budget.js";

export type PackageUpdateArtifact = {
  url: string;
  sha256: string;
  bytes: number;
};

/** Verify the complete artifact before the package manager can execute its lifecycle. */
export async function downloadPackageUpdateArtifact(
  artifact: PackageUpdateArtifact,
  destination: string,
  timeoutMs = UPDATE_NETWORK_TIMEOUT_MS,
): Promise<void> {
  const { signal, cleanup, refresh } = buildTimeoutAbortSignal({
    timeoutMs,
    operation: "package-update-artifact",
    url: artifact.url,
  });
  let response: Response | undefined;
  try {
    response = await fetch(artifact.url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Package artifact download failed: HTTP ${response.status}.`);
    }
    const digest = createHash("sha256");
    let bytes = 0;
    const file = await fs.open(destination, "wx", 0o600);
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value: chunk, done } = await reader.read();
        if (done) {
          break;
        }
        bytes += chunk.byteLength;
        if (bytes > artifact.bytes) {
          throw new Error("Package artifact exceeds its declared size.");
        }
        digest.update(chunk);
        await file.writeFile(chunk);
        refresh();
      }
    } finally {
      reader.releaseLock();
      await file.close();
    }
    if (bytes !== artifact.bytes || digest.digest("hex") !== artifact.sha256) {
      throw new Error("Package artifact checksum or size does not match the release manifest.");
    }
  } finally {
    await cancelUnreadResponseBody(response);
    cleanup();
  }
}
