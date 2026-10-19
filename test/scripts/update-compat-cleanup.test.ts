import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import {
  listUpdateCompatibilityChunkPaths,
  parseUpdateCompatibilityInventory,
  recordUpdateCompatibilityRelease,
  writeUpdateCompatibilityChunks,
} from "../../scripts/lib/update-compat-chunks.mts";
import { createScriptTestHarness } from "./test-helpers.js";

const { createTempDir } = createScriptTestHarness();

it.each([
  {
    product: "OpenClaw 10.1",
    version: "2026.10.1",
    owner: "runtime-cleanup-Dowg583v.mjs",
    facade: "runtime-cleanup-DlrF_x2c.mjs",
  },
  {
    product: "CypherClaw 10.1",
    version: "2026.10.1",
    owner: "runtime-cleanup-C5Rr8QWt.mjs",
    facade: "runtime-cleanup-C-KosKg2.mjs",
  },
  {
    product: "CypherClaw 10.2",
    version: "2026.10.2",
    owner: "runtime-cleanup-wqb3qv85.mjs",
    facade: "runtime-cleanup-BP1bw1d2.mjs",
  },
])(
  "keeps $product pending cleanup ahead of shared-state shutdown after replacement",
  async ({ version, owner, facade }) => {
    const root = createTempDir("update-compat-cleanup-");
    const dist = path.join(root, "dist");
    fs.mkdirSync(dist);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "openclaw", version, type: "module" }),
    );
    fs.writeFileSync(
      path.join(dist, "build-info.json"),
      JSON.stringify({ version, buildId: "fixture", commit: "0".repeat(40) }),
    );
    const write = (file: string, source: string) => fs.writeFileSync(path.join(dist, file), source);
    const load = (file: string) => import(pathToFileURL(path.join(dist, file)).href);
    write("observe.mjs", "export const entered = Promise.withResolvers();");
    // Each published driver preloads its queue owner, but its cleanup scope first
    // loads the facade at exit. Preserve those exact URLs and export aliases.
    write(
      owner,
      `
    import { entered } from "./observe.mjs";
//#region src/cli/runtime-cleanup.ts
    const pending = new Set();
    export function retain(operation) { pending.add(operation); }
    async function runCliDisposerAfterPending(name, dispose) {
      entered.resolve();
      await Promise.all(pending);
      await dispose();
    }
    export { runCliDisposerAfterPending as i };
  `,
    );
    write(facade, `export { i as runCliDisposerAfterPending } from "./${owner}";`);
    write(
      "scope.mjs",
      `
//#region src/cli/runtime-cleanup-scope.ts
    export async function command(run, close) {
      try { return await run(); }
      finally {
        const { runCliDisposerAfterPending } = await import("./${facade}");
        await runCliDisposerAfterPending("shared-state", close);
      }
    }
  `,
    );
    const inventory = {
      schemaVersion: 1 as const,
      releases: [
        recordUpdateCompatibilityRelease({
          packageDir: root,
          integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
        }),
      ],
    };
    const { retain } = await load(owner);
    const { command } = await load("scope.mjs");
    const { entered } = await load("observe.mjs");
    const pending = Promise.withResolvers<void>();
    let disposed = false;
    let closed = false;
    retain(
      pending.promise.then(() => {
        disposed = true;
      }),
    );
    const updating = command(
      async () => {
        fs.unlinkSync(path.join(dist, owner));
        fs.unlinkSync(path.join(dist, facade));
        write(
          "current.mjs",
          `
      import { entered } from "./observe.mjs";
//#region src/cli/runtime-cleanup.ts
      async function runCliDisposerAfterPending(name, dispose) {
        entered.resolve();
        await dispose();
      }
      export { runCliDisposerAfterPending as cleanup };
    `,
        );
        writeUpdateCompatibilityChunks({ distDir: dist, sourceDir: root, inventory });
        return "updated";
      },
      async () => {
        closed = true;
      },
    );
    try {
      await Promise.race([entered.promise, updating]);
      expect(closed).toBe(false);
      pending.resolve();
      expect(await updating).toBe("updated");
      expect(disposed).toBe(true);
      expect(closed).toBe(true);
      // Postinstall's output inventory must retain the resolver-visible owner too.
      expect(listUpdateCompatibilityChunkPaths(inventory)).toContain(owner);
    } finally {
      pending.resolve();
      await updating;
    }
  },
);

it("records distinct artifacts of the same version while rejecting an exact duplicate", () => {
  const official = {
    version: "2026.10.1",
    buildId: "official",
    commit: "0".repeat(40),
    integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
    chunks: [],
  };
  const fork = {
    ...official,
    buildId: "fork",
    commit: "1".repeat(40),
    integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
  };
  expect(
    parseUpdateCompatibilityInventory({ schemaVersion: 1, releases: [official, fork] }).releases,
  ).toEqual([official, fork]);
  expect(() =>
    parseUpdateCompatibilityInventory({ schemaVersion: 1, releases: [official, fork, fork] }),
  ).toThrow("duplicate release identity");
});
