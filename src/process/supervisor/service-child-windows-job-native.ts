import { WindowsJob, retainCurrentProcessJobUntilExit } from "@openclaw/proc-safe/windows-job";

let retainedProcessJob = false;

// 2026.9.3–2026.9.9 and 2026.10.1-beta.1/beta.2 record this updater export.
// Remove it when those releases leave scripts/lib/update-compat-inventory.json.
export function retainWindowsProcessJobUntilExit(_legacyKoffi?: unknown): void {
  if (retainedProcessJob) {
    return;
  }
  const job = WindowsJob.create();
  try {
    retainCurrentProcessJobUntilExit(job);
    retainedProcessJob = true;
  } finally {
    job.close();
  }
}

// CypherClaw update-compat inventory still records these names through 2026.10.2
// (including CypherClaw 10.1/10.2 packages). Official 11.5 dropped the chunks; this
// fork keeps the published hashed imports bridgable until those releases age out.
export function bindWindowsProcessJobToOwner(
  _bindings?: unknown,
  _owner?: unknown,
): void {
  retainWindowsProcessJobUntilExit();
}

export function createWindowsJobBindings(_koffi?: unknown): {
  assertLayouts(): void;
} {
  return {
    assertLayouts() {},
  };
}
