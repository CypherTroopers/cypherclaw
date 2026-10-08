// OpenClaw 2026.9.8 publishes this documented runtime subpath without its declarations.
// These two consumed signatures match that release's inspected implementations.
// Remove this local declaration when the pinned host includes its public types.
declare module "openclaw/plugin-sdk/process-runtime" {
  import type { Buffer } from "node:buffer";

  export function runCommandBuffered(
    argv: string[],
    options?: {
      timeoutMs?: number;
      cwd?: string;
      input?: string | Uint8Array;
      baseEnv?: NodeJS.ProcessEnv;
      env?: NodeJS.ProcessEnv;
      signal?: AbortSignal;
      maxOutputBytes?: number | { stdout?: number; stderr?: number };
      maxCombinedOutputBytes?: number;
      discardOutput?: { stdout?: boolean; stderr?: boolean };
      tolerateOutputError?: { stdout?: boolean; stderr?: boolean };
      terminateOnOutputError?: boolean | { stdout?: boolean; stderr?: boolean };
      killProcessTree?: boolean;
      killGraceMs?: number;
    },
  ): Promise<{
    stdout: Buffer;
    stderr: Buffer;
    code: number | null;
    signal: NodeJS.Signals | null;
    killed: boolean;
    termination: "exit" | "timeout" | "signal" | "output-limit" | "error";
    outputLimitStream?: "stdout" | "stderr";
    errorStream?: "stdout" | "stderr";
    error?: Error;
  }>;

  export function spawnTerminalPty(
    params: {
      file: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
      name?: string;
      cols: number;
      rows: number;
    },
    lifecycle?: { abortSignal?: AbortSignal; assertCurrent?: () => void },
  ): Promise<{
    pid: number;
    write(data: string | Buffer): void;
    resize(cols: number, rows: number): void;
    pause(): void;
    resume(): void;
    onData(listener: (chunk: string) => void): { dispose(): void } | void;
    onExit(
      listener: (event: { exitCode: number; signal?: number }) => void,
    ): { dispose(): void } | void;
    kill(signal?: string): void;
  }>;
}
