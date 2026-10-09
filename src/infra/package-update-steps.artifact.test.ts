import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { runGlobalPackageUpdateSteps } from "./package-update-steps.js";
import {
  createNpmTarget,
  createRootRunner,
  writePackageRoot,
} from "./package-update-steps.test-support.js";

describe("release artifact package update", () => {
  it.runIf(process.platform !== "win32")(
    "verifies a release artifact before installing and preserves the fork launcher through activation",
    async () => {
      await withTestDir({ prefix: "openclaw-release-artifact-" }, async (base) => {
        const prefix = path.join(base, "prefix");
        const globalRoot = path.join(prefix, "lib", "node_modules");
        const packageRoot = path.join(globalRoot, "openclaw");
        await writePackageRoot(packageRoot, "1.0.0");
        await fs.mkdir(path.join(prefix, "bin"));
        await fs.writeFile(path.join(prefix, "bin", "openclaw"), "old compatibility launcher\n");
        await fs.writeFile(path.join(prefix, "bin", "cypherclaw"), "fork launcher\n");
        const payload = Buffer.from("verified package bytes");
        const artifact = {
          url: "https://example.invalid/releases/package.tgz",
          sha256: createHash("sha256").update(payload).digest("hex"),
          bytes: payload.length,
        };
        const fetchArtifact = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(new Response(payload));
        try {
          const result = await runGlobalPackageUpdateSteps({
            installTarget: createNpmTarget(globalRoot),
            installSpec: artifact.url,
            expectedArtifact: artifact,
            packageName: "openclaw",
            packageRoot,
            runCommand: createRootRunner(globalRoot),
            runStep: async ({ name, argv, cwd }) => {
              expect(name).toBe("package-install");
              const localArtifact = argv.find(
                (value) => path.isAbsolute(value) && value.endsWith("package.tgz"),
              );
              expect(localArtifact).toBeDefined();
              expect(localArtifact).not.toBe(artifact.url);
              expect(await fs.readFile(localArtifact!)).toEqual(payload);
              const stagePrefix = argv[argv.indexOf("--prefix") + 1]!;
              await writePackageRoot(
                path.join(stagePrefix, "lib", "node_modules", "openclaw"),
                "2.0.0",
              );
              await fs.mkdir(path.join(stagePrefix, "bin"), { recursive: true });
              await fs.writeFile(
                path.join(stagePrefix, "bin", "openclaw"),
                "updated compatibility launcher\n",
              );
              return {
                name,
                command: argv.join(" "),
                cwd: cwd ?? base,
                durationMs: 0,
                exitCode: 0,
              };
            },
            timeoutMs: 1000,
          });
          expect(result.failedStep).toBeNull();
          expect(result.afterVersion).toBe("2.0.0");
          expect(await fs.readFile(path.join(prefix, "bin", "cypherclaw"), "utf8")).toBe(
            "fork launcher\n",
          );
          expect(await fs.readFile(path.join(prefix, "bin", "openclaw"), "utf8")).toBe(
            "updated compatibility launcher\n",
          );
          expect(fetchArtifact).toHaveBeenCalledOnce();
        } finally {
          fetchArtifact.mockRestore();
        }
      });
    },
  );

  it.each(["checksum", "short", "long"])(
    "rejects a release artifact with invalid %s before running package lifecycle",
    async (invalid) => {
      await withTestDir({ prefix: "openclaw-rejected-artifact-" }, async (base) => {
        const globalRoot = path.join(base, "prefix", "lib", "node_modules");
        const packageRoot = path.join(globalRoot, "openclaw");
        await writePackageRoot(packageRoot, "1.0.0");
        const payload = Buffer.from("release bytes");
        const artifact = {
          url: "https://example.invalid/releases/package.tgz",
          sha256:
            invalid === "checksum"
              ? "0".repeat(64)
              : createHash("sha256").update(payload).digest("hex"),
          bytes: payload.length + (invalid === "short" ? 1 : invalid === "long" ? -1 : 0),
        };
        const fetchArtifact = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(new Response(payload));
        const runStep = vi.fn();
        const activate = vi.fn();
        try {
          const result = await runGlobalPackageUpdateSteps({
            installTarget: createNpmTarget(globalRoot),
            installSpec: artifact.url,
            expectedArtifact: artifact,
            packageName: "openclaw",
            packageRoot,
            runCommand: createRootRunner(globalRoot),
            runStep,
            beforeActivate: activate,
            timeoutMs: 1000,
          });
          expect(result.failedStep?.name).toBe("package-artifact-verification");
          expect(runStep).not.toHaveBeenCalled();
          expect(activate).not.toHaveBeenCalled();
          expect(result.recovery).toMatchObject({ serviceRestartSafe: true, version: "1.0.0" });
          expect(await fs.readFile(path.join(packageRoot, "package.json"), "utf8")).toContain(
            '"version":"1.0.0"',
          );
        } finally {
          fetchArtifact.mockRestore();
        }
      });
    },
  );
});
