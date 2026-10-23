import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { satisfies } from "semver";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  SUPPORTED_NODE_VERSION_RANGE,
  isSupportedOpenClawNodeVersion,
} from "../../node-version.mjs";
import {
  assertAcceptance,
  assertExpectedIdentities,
  verifyReleaseDirectory,
} from "../../scripts/cypherclaw-release-validation.mjs";
import {
  CYPHERCLAW_NODE_VERSION,
  CYPHERCLAW_SUPPORTED_NODE_RANGE,
  isAcceptedCypherClawManifestNodeVersion,
  isSupportedCypherClawNodeVersion,
} from "../../scripts/lib/cypherclaw-contract.mjs";
import {
  projectGatewayServiceStatus,
  projectUpdateCommand,
} from "../../scripts/lib/cypherclaw-update-diagnostics.mts";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const candidate = {
  releaseTag: `cypherclaw-v2026.10.2-${"a".repeat(12)}`,
  sourceCommit: "a".repeat(40),
  reviewedSourceCommit: "b".repeat(40),
  nativeSourceCommit: "c".repeat(40),
  nativeDistributionCommit: "d".repeat(40),
  package: { sha256: "1".repeat(64) },
  manifestSha256: "2".repeat(64),
  publication: { ready: true },
};
const baseline = {
  releaseTag: `cypherclaw-v2026.10.1-${"e".repeat(12)}`,
  sourceCommit: "e".repeat(40),
  package: { sha256: "3".repeat(64) },
  manifestSha256: "4".repeat(64),
  publication: { ready: true },
};

function receipt(target: string) {
  const identity = (release: typeof baseline) => ({
    releaseTag: release.releaseTag,
    sourceCommit: release.sourceCommit,
    packageSha256: release.package.sha256,
    manifestSha256: release.manifestSha256,
  });
  return {
    schemaVersion: 1,
    target,
    status: "passed",
    baseline: identity(baseline),
    candidate: identity(candidate),
    updateRunId: `fixture-update-${target}`,
    checks: {
      freshInstall: true,
      managedGateway: true,
      installedUpdater: true,
      servingIdentity: true,
      configPreserved: true,
      authentication: true,
      sessionPreserved: true,
      databaseIntegrity: true,
      controlUi: true,
      cleanup: true,
    },
  };
}

function receipts() {
  return [receipt("linux-x64"), receipt("darwin-arm64"), receipt("win32-x64")];
}

describe("CypherClaw publication acceptance", () => {
  it.each(["running", "stopped", "unknown"])(
    "retains the %s cleanup observation without publishing service details",
    (runtimeStatus) => {
      const privateText = "synthetic-private-token /private/operator/home";
      const projected = projectGatewayServiceStatus({
        service: {
          loaded: false,
          command: privateText,
          runtime: {
            status: runtimeStatus,
            pid: 12345,
            detail: privateText,
            inspectionFailure: { detail: privateText },
          },
        },
        config: privateText,
      });
      expect(projected).toEqual({ loaded: false, runtimeStatus });
      expect(JSON.stringify(projected)).not.toContain(privateText);
    },
  );

  it("redacts unexpected cleanup status values and omits malformed service fields", () => {
    const privateText = "synthetic-private-token /private/operator/home";
    expect(
      projectGatewayServiceStatus({
        service: { loaded: privateText, runtime: { status: privateText } },
      }),
    ).toEqual({ loaded: undefined, runtimeStatus: "redacted" });
    expect(JSON.stringify(projectGatewayServiceStatus(null))).toBe("{}");
    expect(JSON.stringify(projectGatewayServiceStatus({ service: [] }))).toBe("{}");
  });

  it("retains updater failure facts without publishing private command or ledger text", () => {
    const privateText = "synthetic-private-token /private/operator/home";
    const failedStep = {
      name: "global install verify",
      exitCode: 1,
      termination: "exit",
      command: privateText,
      cwd: privateText,
      stderrTail: privateText,
      failureFacts: [
        {
          check: "package-verify",
          code: "global-install-failed",
          npmErrorCode: "ENOSPC",
          message: privateText,
        },
      ],
    };
    const payload = {
      status: "error",
      mode: "npm",
      reason: "global-install-failed",
      failedStep,
      run: {
        status: "failed",
        phase: "finished",
        reason: "target-native-unsupported",
        steps: [{ step: "package-update", status: "failed", detail: privateText }],
        verification: { booted: false, serviceRunning: true, doctorHint: privateText },
      },
      lastRun: {
        status: "failed",
        phase: "staging",
        reason: privateText,
        steps: [{ ...failedStep, name: privateText, status: "failed" }],
        origin: { requester: privateText },
      },
    };
    const projected = projectUpdateCommand("installed-update", {
      exitCode: 1,
      stdout: JSON.stringify(payload),
      stderr: [
        privateText,
        `At ${privateText}/install-node.ps1:708 char:13`,
        `At ${privateText}/unrelated.ps1:4`,
        `At ${privateText}/install-node.ps1:708 char:13`,
      ].join("\n"),
    });
    expect(projected).toMatchObject({
      operation: "installed-update",
      exitCode: 1,
      jsonObject: true,
      installerErrorLocations: ["install-node.ps1:708"],
      run: {
        status: "failed",
        phase: "finished",
        reason: "target-native-unsupported",
        steps: [{ name: "package-update", status: "failed" }],
        verification: { booted: false, serviceRunning: true },
      },
      result: {
        status: "error",
        reason: "global-install-failed",
        failedStep: {
          name: "global install verify",
          exitCode: 1,
          failureFacts: [
            { check: "package-verify", code: "global-install-failed", npmErrorCode: "ENOSPC" },
          ],
        },
      },
      lastRun: {
        status: "failed",
        phase: "staging",
        reason: "redacted",
        steps: [{ name: "redacted" }],
      },
    });
    expect(JSON.stringify(projected)).not.toContain(privateText);
    const failed = Object.assign(receipt("linux-x64"), {
      status: "failed",
      updateDiagnostics: [projected],
    });
    expect(() =>
      assertAcceptance(
        [failed, receipt("darwin-arm64"), receipt("win32-x64")],
        candidate,
        baseline,
      ),
    ).toThrow("OS acceptance did not pass");
  });

  it.each([
    "not JSON",
    "null",
    "[]",
    JSON.stringify({
      status: "private",
      reason: "private",
      failedStep: {
        name: "private",
        exitCode: "private",
        failureFacts: [
          { check: "private", code: "private", npmErrorCode: "private", errorName: "private" },
        ],
      },
    }),
  ])("keeps malformed or unknown updater diagnostics private: %s", (stdout) => {
    const projected = projectUpdateCommand("update-status", {
      exitCode: 2,
      stdout,
      stderr: "private/path: ERR_MODULE_NOT_FOUND",
    });
    expect(projected.exitCode).toBe(2);
    expect(projected.runtimeErrorCodes).toEqual(["ERR_MODULE_NOT_FOUND"]);
    expect(JSON.stringify(projected)).not.toContain("private");
  });

  it.each([
    [
      "finalizerTerminalUnconfirmed",
      "Update finalization did not confirm the admitted run's terminal outcome.",
    ],
    ["migratedWorkerCleanupFailed", "Update finalization and resource cleanup failed."],
    ["terminalCapturedOutcomeLost", "Update terminal publication lost its captured outcome."],
    ["terminalPublicationFailed", "Update result publication failed"],
    ["packageBackupCleanupFailed", "Update backup cleanup failed:"],
    ["retainedWorkerSettlementFailed", "Retained updater workers did not settle"],
    ["nodeProvisioningFailed", "Private Node provisioning failed with exit code"],
    ["missingPackagedDistFile", "missing packaged dist file "],
    ["unexpectedPackagedDistFile", "unexpected packaged dist file "],
    ["invalidDistInventory", "invalid package dist inventory "],
    ["missingDistInventory", "missing package dist inventory "],
    ["missingRuntimeSidecar", "missing bundled runtime sidecar "],
    [
      "invalidDistContentInventory",
      "Invalid package dist content inventory at dist/postinstall-content-inventory.json:",
    ],
    ["unsafeDistPath", "Unsafe package dist path: "],
    ["installedVersionMismatch", "expected installed version "],
    ["nodeRuntimeTooOld", "[openclaw] error: this OpenClaw release requires Node "],
    ["packageLifecycleUncertain", "OpenClaw package lifecycle ownership is uncertain ("],
    [
      "packageLifecycleIncomplete",
      "OpenClaw package postinstall did not complete its lifecycle marker",
    ],
    ["launcherIdentityChanged", "Selected package launcher identity changed."],
    ["launcherFingerprintChanged", "Selected package launcher fingerprint changed."],
    ["publicationJournalMismatch", "Package publication journal does not match its installation"],
  ])("identifies %s in non-JSON output without exposing the error body", (name, phrase) => {
    const privateText = "synthetic-private-token /private/operator/home";
    const projected = projectUpdateCommand("installed-update", {
      exitCode: 1,
      stdout: `notice ${privateText}\n{"status":"ok"}`,
      stderr: `${phrase} ${privateText}`,
    });
    expect(projected).toMatchObject({
      exitCode: 1,
      jsonObject: false,
      stdoutNonempty: true,
      stdoutStartsJson: false,
      outputContainsOkStatus: true,
      failureSignals: { [name]: true },
    });
    expect(JSON.stringify(projected)).not.toContain(privateText);
  });

  it("requires all three OS results for the exact sealed candidate and baseline", () => {
    expect(() => assertAcceptance(receipts(), candidate, baseline)).not.toThrow();
    const cases = [
      receipts().slice(0, 2),
      [receipt("linux-x64"), receipt("linux-x64"), receipt("win32-x64")],
      receipts().map((value, index) =>
        index === 1 ? Object.assign(value, { status: "skipped" }) : value,
      ),
      receipts().map((value, index) => {
        if (index === 1) {
          value.checks.installedUpdater = false;
        }
        return value;
      }),
      receipts().map((value, index) => {
        if (index === 1) {
          value.candidate.packageSha256 = "5".repeat(64);
        }
        return value;
      }),
      receipts().map((value, index) => {
        if (index === 1) {
          value.baseline.sourceCommit = "f".repeat(40);
        }
        return value;
      }),
      receipts().map((value, index) =>
        index === 1 ? Object.assign(value, { updateRunId: "" }) : value,
      ),
    ];
    for (const invalid of cases) {
      expect(() => assertAcceptance(invalid, candidate, baseline)).toThrow();
    }
  });

  it("rejects missing or changed workflow identity pins before package execution", () => {
    const env = {
      EXPECTED_CANDIDATE_SOURCE_SHA: candidate.sourceCommit,
      EXPECTED_REVIEWED_SOURCE_SHA: candidate.reviewedSourceCommit,
      EXPECTED_NATIVE_SOURCE_SHA: candidate.nativeSourceCommit,
      EXPECTED_NATIVE_DISTRIBUTION_SHA: candidate.nativeDistributionCommit,
      EXPECTED_BASELINE_RELEASE_TAG: baseline.releaseTag,
      EXPECTED_BASELINE_SOURCE_SHA: baseline.sourceCommit,
      EXPECTED_BASELINE_PACKAGE_SHA256: baseline.package.sha256,
      EXPECTED_BASELINE_MANIFEST_SHA256: baseline.manifestSha256,
    };
    expect(() => assertExpectedIdentities(candidate, baseline, env)).not.toThrow();
    expect(() =>
      assertExpectedIdentities(candidate, candidate, {
        ...env,
        EXPECTED_BASELINE_RELEASE_TAG: candidate.releaseTag,
        EXPECTED_BASELINE_SOURCE_SHA: candidate.sourceCommit,
        EXPECTED_BASELINE_PACKAGE_SHA256: candidate.package.sha256,
        EXPECTED_BASELINE_MANIFEST_SHA256: candidate.manifestSha256,
      }),
    ).toThrow("different from the published baseline");
    expect(() => assertExpectedIdentities(candidate, baseline, {})).toThrow("Missing expected");
    expect(() =>
      assertExpectedIdentities(candidate, baseline, {
        ...env,
        EXPECTED_BASELINE_RELEASE_TAG: `cypherclaw-v2026.10.1-${"f".repeat(12)}`,
      }),
    ).toThrow("Release identity changed");
    expect(() =>
      assertExpectedIdentities({ ...candidate, publication: { ready: false } }, baseline, env),
    ).toThrow("publication blockers");
  });

  it("pins the installer runtime to a Node version supported by the package", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
    expect(satisfies(CYPHERCLAW_NODE_VERSION, packageJson.engines.node)).toBe(true);
    expect(CYPHERCLAW_SUPPORTED_NODE_RANGE).toBe(SUPPORTED_NODE_VERSION_RANGE);
    for (const version of [
      "24.21.0",
      "24.22.0",
      "24.22.1",
      "24.23.2",
      "25.0.0",
      "26.12.0",
      "26.12.1",
      "27.0.1",
      "v24.22.1",
      "24.22.1+local.1",
      "not-a-version",
    ]) {
      expect(isSupportedCypherClawNodeVersion(version)).toBe(
        isSupportedOpenClawNodeVersion(version),
      );
    }
    expect(isSupportedCypherClawNodeVersion("24.21.0")).toBe(false);
    expect(isAcceptedCypherClawManifestNodeVersion("24.21.0")).toBe(true);
    expect(isAcceptedCypherClawManifestNodeVersion("24.23.0")).toBe(true);
    expect(isAcceptedCypherClawManifestNodeVersion("25.0.0")).toBe(false);
  });

  it.each(["24.21.0", "24.22.1", "24.23.0", "26.12.1"])(
    "verifies a sealed Node %s release without accepting altered payloads",
    async (nodeVersion) => {
      const directory = tempDirs.make("cypherclaw-acceptance-seal-");
      const entries = [
        "cypherclaw.tgz",
        "install.sh",
        "install.ps1",
        "install-node.sh",
        "install-node.ps1",
        "install-runtime.mjs",
        "cypherclaw-contract.mjs",
      ].map((file) => {
        const bytes = Buffer.from(`Synthetic sealed fixture: ${file}\n`);
        writeFileSync(path.join(directory, file), bytes);
        return {
          file,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      });
      const manifest = {
        schemaVersion: 1,
        repository: "CypherTroopers/cypherclaw",
        sourceBranch: "cypherclaw-stable",
        channel: "stable",
        version: "2026.10.2",
        releaseTag: candidate.releaseTag,
        sourceCommit: candidate.sourceCommit,
        nodeVersion,
        supportedTargets: ["linux-x64", "darwin-arm64", "win32-x64"],
        publication: { ready: true, limitations: [] },
        package: {
          ...entries[0],
          name: "openclaw",
          nodeEngine: ">=24.16.0 <25 || >=26.1.0",
          schemaVersions: { state: 20, agent: 24 },
        },
        assets: entries.slice(1),
      };
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
      writeFileSync(path.join(directory, "cypherclaw-release.json"), manifestBytes);
      writeFileSync(
        path.join(directory, "SHA256SUMS"),
        [
          ...entries,
          {
            file: "cypherclaw-release.json",
            sha256: createHash("sha256").update(manifestBytes).digest("hex"),
          },
        ]
          .map((entry) => `${entry.sha256}  ${entry.file}\n`)
          .join(""),
      );
      await expect(verifyReleaseDirectory(directory)).resolves.toMatchObject({
        sourceCommit: candidate.sourceCommit,
        nodeVersion,
      });
      writeFileSync(path.join(directory, "cypherclaw.tgz"), "Altered candidate payload");
      await expect(verifyReleaseDirectory(directory)).rejects.toThrow("checksum or size mismatch");
    },
  );

  it("makes OS acceptance a required publication dependency without platform failure exceptions", () => {
    const workflow = parse(
      readFileSync(path.resolve(".github/workflows/cypherclaw-release.yml"), "utf8"),
    );
    const matrix = workflow.jobs["upgrade-app"];
    expect(
      matrix.strategy.matrix.include.map((row: { target: string }) => row.target).toSorted(),
    ).toEqual(["darwin-arm64", "linux-x64", "win32-x64"]);
    expect(matrix.strategy["fail-fast"]).toBe(false);
    expect(matrix["continue-on-error"]).toBeUndefined();
    expect(
      matrix.steps.some((step: { "continue-on-error"?: boolean }) => step["continue-on-error"]),
    ).toBe(false);
    expect(workflow.jobs["upgrade-acceptance"].needs).toContain("upgrade-app");
    expect(workflow.jobs.publish.needs).toContain("upgrade-acceptance");
    expect(workflow.jobs.publish.if).not.toContain("always()");
  });
});
