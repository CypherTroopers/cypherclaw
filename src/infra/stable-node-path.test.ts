// Covers stable Node binary resolution from Homebrew Cellar paths.
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { resolveLaunchableNodePath, resolveStableNodePath } from "./stable-node-path.js";

describe("resolveStableNodePath", () => {
  it("returns non-cellar paths unchanged", async () => {
    await expect(resolveStableNodePath("/usr/local/bin/node")).resolves.toBe("/usr/local/bin/node");
  });

  it("prefers the Homebrew opt symlink for default and versioned formulas", async () => {
    await withTestDir({ prefix: "openclaw-stable-node-" }, async (prefix) => {
      const defaultNode = path.join(prefix, "Cellar", "node", "25.9.0", "bin", "node");
      const versionedNode = path.join(prefix, "Cellar", "node@22", "22.22.3", "bin", "node");
      const optDefault = path.join(prefix, "opt", "node", "bin", "node");
      const optVersioned = path.join(prefix, "opt", "node@22", "bin", "node");

      await fs.mkdir(path.dirname(optDefault), { recursive: true });
      await fs.mkdir(path.dirname(optVersioned), { recursive: true });
      await fs.writeFile(optDefault, "", "utf8");
      await fs.writeFile(optVersioned, "", "utf8");

      await expect(resolveStableNodePath(defaultNode)).resolves.toBe(optDefault);
      await expect(resolveStableNodePath(versionedNode)).resolves.toBe(optVersioned);
    });
  });

  it("falls back to the bin symlink for the default formula, otherwise original path", async () => {
    await withTestDir({ prefix: "openclaw-stable-node-" }, async (prefix) => {
      const defaultNode = path.join(prefix, "Cellar", "node", "25.9.0", "bin", "node");
      const versionedNode = path.join(prefix, "Cellar", "node@22", "22.22.3", "bin", "node");
      const binNode = path.join(prefix, "bin", "node");

      await fs.mkdir(path.dirname(binNode), { recursive: true });
      await fs.writeFile(binNode, "", "utf8");

      await expect(resolveStableNodePath(defaultNode)).resolves.toBe(binNode);
      await expect(resolveStableNodePath(versionedNode)).resolves.toBe(versionedNode);
      await fs.rm(binNode);
      await expect(resolveStableNodePath(defaultNode)).resolves.toBe(defaultNode);
    });
  });

  it("prefers the private Node alias when it is the same executable", async () => {
    await withTestDir({ prefix: "openclaw-private-node-" }, async (prefix) => {
      const current = path.join(prefix, "tools", "node-v24.22.1", "bin", "node");
      const next = path.join(prefix, "tools", "node-v24.23.0", "bin", "node");
      const alias = path.join(prefix, "tools", "node", "bin", "node");
      await fs.mkdir(path.dirname(current), { recursive: true });
      await fs.mkdir(path.dirname(next), { recursive: true });
      await fs.writeFile(current, "current");
      await fs.writeFile(next, "next");
      await fs.symlink(
        path.join(prefix, "tools", "node-v24.23.0"),
        path.join(prefix, "tools", "node"),
        "dir",
      );

      await expect(resolveStableNodePath(next)).resolves.toBe(alias);
      await expect(resolveStableNodePath(current)).resolves.toBe(current);
      await fs.rm(path.join(prefix, "tools", "node"));
      await expect(resolveStableNodePath(next)).resolves.toBe(next);
    });
  });
});

describe("resolveLaunchableNodePath", () => {
  it("keeps the running Cellar executable until an upgrade removes it", async () => {
    await withTestDir({ prefix: "openclaw-launchable-node-" }, async (prefix) => {
      const cellarNode = path.join(prefix, "Cellar", "node", "26.8.1", "bin", "node");
      const optNode = path.join(prefix, "opt", "node", "bin", "node");
      await fs.mkdir(path.dirname(cellarNode), { recursive: true });
      await fs.mkdir(path.dirname(optNode), { recursive: true });
      await fs.writeFile(cellarNode, "", "utf8");
      await fs.writeFile(optNode, "", "utf8");

      expect(resolveLaunchableNodePath(cellarNode)).toBe(cellarNode);
      await fs.rm(cellarNode);
      expect(resolveLaunchableNodePath(cellarNode)).toBe(optNode);
      await fs.rm(optNode);
      expect(resolveLaunchableNodePath(cellarNode)).toBe(cellarNode);
    });
  });

  it("uses the private Node alias after the versioned executable is removed", async () => {
    await withTestDir({ prefix: "openclaw-private-node-launch-" }, async (prefix) => {
      const removed = path.join(prefix, "tools", "node-v24.21.0", "bin", "node");
      const current = path.join(prefix, "tools", "node-v24.22.1", "bin", "node");
      const alias = path.join(prefix, "tools", "node", "bin", "node");
      await fs.mkdir(path.dirname(current), { recursive: true });
      await fs.writeFile(current, "current");
      await fs.symlink(
        path.join(prefix, "tools", "node-v24.22.1"),
        path.join(prefix, "tools", "node"),
        "dir",
      );

      expect(resolveLaunchableNodePath(removed)).toBe(alias);
      expect(resolveLaunchableNodePath(current)).toBe(current);
    });
  });
});
