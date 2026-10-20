export type NativeTarget =
  | "linux-amd64"
  | "linux-arm64"
  | "darwin-amd64"
  | "darwin-arm64"
  | "windows-amd64"
  | "windows-arm64";

export type NativeSetupAuthority = {
  assertCurrent(): void;
  signal?: AbortSignal;
};

export type NativePin = {
  repository: string;
  distributionCommit: string;
  sourceCommit: string;
};

export type NativeArtifact = {
  path: string;
  bytes: number;
  sha256: string;
  executable?: boolean;
};

export type NativeSetupProgress = {
  file: string;
  downloadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
};

export type NativeSetupStatus = {
  state: "missing" | "preparing" | "ready" | "unsupported" | "error";
  target: NativeTarget | null;
  node: { supported: boolean; ready: boolean; pin: NativePin };
  wallet: { supported: boolean; ready: boolean; pin: NativePin };
  progress: NativeSetupProgress | null;
  error: { code: NativeSetupErrorCode; message: string } | null;
};

const messages = {
  unsupported: "Native tools are unavailable for this Gateway's OS or CPU architecture.",
  download: "Native tools could not be downloaded. Check this Gateway's network and retry setup.",
  integrity:
    "A native download failed verification. Retry setup to download the pinned files again.",
  filesystem:
    "Native tools could not be prepared. Check the Gateway's plugin data directory and retry setup.",
  authority: "Setup authorization ended. Reconnect to the Gateway and retry setup.",
  closed:
    "Native setup was interrupted because the Gateway service closed. Retry after reconnecting.",
} as const;

export type NativeSetupErrorCode = keyof typeof messages;

export class NativeSetupError extends Error {
  constructor(readonly code: NativeSetupErrorCode) {
    super(messages[code]);
    this.name = "NativeSetupError";
  }
}
