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
