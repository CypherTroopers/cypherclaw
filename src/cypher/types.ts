export type CypherProcessState = "stopped" | "starting" | "running" | "stopping" | "error";

export type CypherRewardRegistration = {
  configured: boolean;
  signer: string;
  rewardRecipient?: string;
  chainId?: string;
  genesisHash?: string;
};

export type CypherNodeSnapshot = {
  clientVersion: string;
  chainId: string;
  blockNumber: string;
  peerCount: string;
  mining: boolean;
  hashrate: string;
  accounts: string[];
  signer: string | null;
};

export type CypherStatus = {
  platform: string;
  arch: string;
  supported: boolean;
  rootDir: string;
  dataDir: string;
  binaryPath: string;
  ipcPath: string;
  state: CypherProcessState;
  owned: boolean;
  pid: number | null;
  connected: boolean;
  node: CypherNodeSnapshot | null;
  logs: string[];
  error: string | null;
};

export type CypherNetwork = {
  chainId: string;
  genesisHash: string;
  currency: "CLX";
  decimals: 18;
};

export type CypherWallet = {
  address: string;
  balance: string;
  balanceWei: string;
  locked: boolean | null;
};

export type CypherSubmissionReadiness = { ready: boolean; reason: string | null };

export type CypherWallets = {
  network: CypherNetwork;
  wallets: CypherWallet[];
  total: number;
  offset: number;
  limit: number;
  readiness: CypherSubmissionReadiness;
  finalitySupported: boolean;
};

export type CypherTransferQuote = {
  quoteId: string;
  network: CypherNetwork;
  from: string;
  to: string;
  amount: string;
  value: string;
  nonce: string;
  gas: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  estimatedFee: string;
  total: string;
  expiresAt: number;
};

export type CypherTransferStatus = "unknown" | "submitted" | "included" | "complete" | "failed";

export type CypherTransferRecord = Omit<CypherTransferQuote, "total" | "expiresAt"> & {
  requestId: string;
  nodeKey: string;
  hash: string;
  status: CypherTransferStatus;
  finalitySupported: boolean | null;
  blockNumber: string | null;
  actualFee: string | null;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
};

/** Persistence belongs to the profile's canonical SQLite worker, not the IPC manager. */
export type CypherTransferStore = {
  get(requestId: string): Promise<CypherTransferRecord | null>;
  insert(record: CypherTransferRecord, assertCurrent?: () => void): Promise<CypherTransferRecord>;
  update(record: CypherTransferRecord, assertCurrent?: () => void): Promise<CypherTransferRecord>;
  list(options: {
    nodeKey?: string;
    limit?: number;
    pendingOnly?: boolean;
  }): Promise<CypherTransferRecord[]>;
};
