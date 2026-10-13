import {
  UPDATE_NPM_ERROR_CODES,
  UPDATE_RUN_PHASES,
  UPDATE_RUN_STATUSES,
  UPDATE_RUN_STEP_STATUSES,
} from "../../packages/gateway-protocol/src/update-run-vocabulary.ts";
import { isRecord } from "../../packages/normalization-core/src/record-coerce.ts";
import { UPDATE_PREFLIGHT_DETAILS } from "../../src/infra/update-preflight-details.ts";

// This receipt permits only fixed vocabulary; updater prose and command output stay private.
const codes = [
  ...Object.keys(UPDATE_PREFLIGHT_DETAILS),
  ...UPDATE_NPM_ERROR_CODES,
  "EPERM",
  "ENOENT",
  "EXDEV",
  "command-failed",
  "doctor-failed",
  "global-install-failed",
  "update-failed",
  "unexpected-error",
  "runtime-verification-failed",
  "managed-service-preflight",
  "database-schema-preflight",
  "target-metadata-preflight",
  "managed-service-handoff-failed",
  "managed-service-stop-failed",
  "rollback-state-unverified",
  "restart-unhealthy",
  "service-not-running",
  "readyz-unhealthy",
  "gateway-probe-failed",
  "post-update-plugins",
  "finalization-failed",
  "finalization-timeout",
  "swap-failed",
  "candidate-runtime-failed",
  "candidate-startup-failed",
  "candidate-readiness-failed",
  "candidate-readiness-probe-failed",
  "candidate-checks-timeout",
  "candidate-config-failed",
  "candidate-plugins-failed",
  "update-executor-settlement-failed",
  "package-backup-retention-failed",
  "update-activation-timeout",
  "post-update-failed",
  "snapshot-capacity-insufficient",
  "npm-lifecycle-policy-preflight",
  "package-integrity-changed",
  "update-recovery-pending",
  "Error",
  "TypeError",
  "SyntaxError",
  "RangeError",
];
const stepNames = [
  "package-stage",
  "package-install",
  "package-swap",
  "package-verify",
  "package-stage-cleanup",
  "npm-lifecycle-policy-preflight",
  "npm-package-lifecycle",
  "npm-package-postinstall",
  "candidate canary",
  "candidate doctor",
  "candidate-doctor",
  "candidate-doctor-lint",
  "candidate-config",
  "candidate-plugins",
  "candidate-recovery",
  "candidate-runtime",
  "candidate-state-snapshot",
  "candidate-gateway-startup",
  "target-resolution",
  "post-install-verify",
  "gateway verification",
  "gateway recovery verification",
  "update-executor-settlement",
  "package-backup-retention",
  "openclaw doctor",
  "updater-runtime-retention",
];
const failureSignals = {
  finalizerTerminalUnconfirmed:
    "Update finalization did not confirm the admitted run's terminal outcome.",
  migratedWorkerCleanupFailed: "Update finalization and resource cleanup failed.",
  terminalCapturedOutcomeLost: "Update terminal publication lost its captured outcome.",
  terminalPublicationFailed: "Update result publication failed",
  finalizationProgressFailed: "Update finalization and progress reporting failed",
  packageBackupCleanupFailed: "Update backup cleanup failed:",
  retainedWorkerSettlementFailed: "Retained updater workers did not settle",
  retainedRuntimeCleanupFailed: "Update and retained runtime cleanup failed",
  succeededPublicationWarning: "Update succeeded, but result publication failed:",
  moduleMissing: "Cannot find module",
  packageMissing: "Cannot find package",
  sqliteContention: "database is locked",
  circularJson: "Converting circular structure to JSON",
  bigintJson: "Do not know how to serialize a BigInt",
};
function fixed(value: unknown, allowed: readonly string[]) {
  return typeof value === "string" && allowed.includes(value) ? value : undefined;
}
function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}
function facts(value: unknown) {
  return Array.isArray(value)
    ? value
        .slice(0, 5)
        .filter(isRecord)
        .map((fact) => ({
          code: fixed(fact.code, codes),
          npmErrorCode: fixed(fact.npmErrorCode, UPDATE_NPM_ERROR_CODES),
          errorName: fixed(fact.errorName, codes),
        }))
    : undefined;
}
function step(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    name: fixed(value.name ?? value.step, stepNames) ?? "redacted",
    status: fixed(value.status, UPDATE_RUN_STEP_STATUSES),
    exitCode: value.exitCode === null ? null : integer(value.exitCode),
    termination: fixed(value.termination, ["exit", "timeout", "no-output-timeout", "signal"]),
    failureFacts: facts(value.failureFacts),
  };
}
function record(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  const verification = value.verification;
  return {
    status: fixed(value.status, ["ok", "error", ...UPDATE_RUN_STATUSES]),
    phase: fixed(value.phase, UPDATE_RUN_PHASES),
    mode: fixed(value.mode, ["git", "pnpm", "bun", "npm", "unknown"]),
    reason: fixed(value.reason, codes) ?? (value.reason ? "redacted" : undefined),
    failureFacts: facts(value.failureFacts),
    failedStep: step(value.failedStep),
    steps: Array.isArray(value.steps) ? value.steps.slice(0, 128).map(step) : undefined,
    verification: isRecord(verification)
      ? Object.fromEntries(
          ["booted", "serviceRunning", "versionMatch", "readyz", "settled"]
            .filter((key) => typeof verification[key] === "boolean")
            .map((key) => [key, verification[key]]),
        )
      : undefined,
  };
}

export function projectUpdateCommand(
  operation: "installed-update" | "update-status",
  result: { exitCode: number; stdout: string; stderr: string },
) {
  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    // Invalid JSON still leaves the exit code and fixed runtime error signatures available.
  }
  const output = `${result.stdout}\n${result.stderr}`;
  return {
    operation,
    exitCode: result.exitCode,
    jsonObject: isRecord(payload),
    stdoutNonempty: result.stdout.trim().length > 0,
    stdoutStartsJson: result.stdout.trimStart().startsWith("{"),
    outputContainsOkStatus: /"status"\s*:\s*"ok"/u.test(output),
    outputContainsErrorStatus: /"status"\s*:\s*"error"/u.test(output),
    failureSignals: Object.fromEntries(
      Object.entries(failureSignals).map(([name, phrase]) => [name, output.includes(phrase)]),
    ),
    result: record(payload),
    run: isRecord(payload) ? record(payload.run) : undefined,
    lastRun: isRecord(payload) ? record(payload.lastRun) : undefined,
    activeRun: isRecord(payload) ? record(payload.activeRun) : undefined,
    runStatusError: isRecord(payload) && typeof payload.runStatusError === "string",
    runtimeErrorCodes: [
      "ERR_MODULE_NOT_FOUND",
      "ERR_PACKAGE_PATH_NOT_EXPORTED",
      "ERR_UNKNOWN_FILE_EXTENSION",
      "ERR_DLOPEN_FAILED",
      "SQLITE_ERROR",
      "SQLITE_BUSY",
    ].filter((code) => new RegExp(`\\b${code}\\b`, "u").test(output)),
  };
}
