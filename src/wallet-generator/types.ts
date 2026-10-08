export type WalletGeneratorStatus = {
  platform: string;
  arch: string;
  supported: boolean;
  available: boolean;
  binaryPath: string | null;
  error: string | null;
  sourceCommit: string;
};

export type WalletGeneratorResult = {
  address: string;
  privateKey: string;
};

export type WalletGeneratorAuthority = {
  assertCurrent: () => void;
  signal?: AbortSignal;
};
