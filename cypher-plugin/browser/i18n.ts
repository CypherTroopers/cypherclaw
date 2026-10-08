const nodeCopy = {
  cypher: {
    title: "Cypher",
    subtitle: "Manage the Cypher node on the connected Gateway's computer.",
    node: "Node",
    nodeHint:
      "Start the bundled node or explicitly connect to a node already running on this computer.",
    start: "Start node",
    stop: "Stop node",
    connect: "Connect IPC",
    disconnect: "Disconnect IPC",
    refresh: "Refresh status and logs",
    offline: "Connect to the Gateway to manage Cypher.",
    readRequired: "Operator read access is required to view node status and logs.",
    working: "Waiting for the node to complete this action…",
    adminRequired:
      "Administrator access is required to change the node, accounts, mining, or rewards.",
    unsupported: "No bundled Cypher binary is available for this Gateway's OS and architecture.",
    external: "Connected to an existing node. Stop it through the application that started it.",
    owned: "Started by this Gateway",
    notOwned: "Existing or stopped node",
    ipcConnected: "IPC connected",
    ipcDisconnected: "IPC disconnected",
    state: "Process",
    platform: "Gateway platform",
    block: "Block",
    peers: "Peers",
    hashrate: "Hashrate",
    chain: "Chain ID",
    paths: "Node locations",
    binary: "Binary",
    data: "Data directory",
    ipc: "IPC endpoint",
    noStatus: "Refresh to load node status.",
    unknown: "Unknown",
    states: {
      stopped: "Stopped",
      starting: "Starting",
      running: "Running",
      stopping: "Stopping",
      error: "Error",
    },
    accounts: "Accounts and signer A",
    accountsHint:
      "The signer identifies this node. Selecting an account does not change the separate reward recipient B.",
    account: "Local account",
    selectAccount: "Use as signer A",
    signer: "Current signer A",
    noAccounts: "No local accounts",
    accountPassword: "Account password",
    createAccount: "Create account",
    unlock: "Unlock account",
    lock: "Lock account",
    unlockDuration: "Unlock duration (seconds)",
    passwordHint:
      "Passwords are cleared as soon as an action is submitted and are not saved in settings or chat.",
    created: "Created account {address}.",
    unlocked: "The selected account is unlocked.",
    locked: "The selected account is locked.",
    refused: "The node did not complete this account action. Refresh and check the node status.",
    selected: "Signer A updated.",
    mining: "Mining",
    miningHint:
      "Mining uses the selected local signer A. Reward routing is configured separately below.",
    miningActive: "Mining active",
    miningInactive: "Mining stopped",
    threads: "Mining threads",
    miningPassword: "Signer password",
    startMining: "Start mining",
    stopMining: "Stop mining",
    threadsInvalid: "Enter a whole number of mining threads from 1 to 256.",
    durationInvalid: "Enter a whole number of unlock seconds from 1 to 86400.",
    signerRequired: "Select a local signer account first.",
    rewards: "Reward recipient B",
    rewardsHint:
      "Register a reward recipient B for signer A. New fixed-mode Common candidates use this recipient; existing candidates keep their recipient. A remains the signer and BFT identity.",
    recipient: "Recipient address B",
    rewardPassword: "Signer A password",
    readReward: "Check registration",
    setReward: "Register recipient B",
    registered: "Registered recipient B",
    unregistered: "No separate recipient B is registered for this signer.",
    rewardUpdated: "Reward recipient B registered.",
    recipientInvalid: "Enter a recipient address with 0x followed by 40 hexadecimal characters.",
    logs: "Node logs",
    logsHint: "Recent output from the node started by this Gateway. Refresh to read new lines.",
    noLogs: "No node output captured yet.",
    success: "Action completed.",
    stopRequested: "Stop requested. Waiting for the node to exit…",
    stopComplete: "The node has stopped.",
    requestFailed: "The action did not complete. Refresh node status and try again.",
  },
};

const walletCopy = {
  walletGenerator: {
    title: "Wallet generator",
    description:
      "Generate a wallet on the connected Gateway's computer. A running node is not required.",
    offline: "Connect to the Gateway to generate a wallet.",
    readRequired: "Operator read access is required to check the wallet generator.",
    adminRequired: "Administrator access is required to generate a wallet.",
    unsupported: "No wallet generator binary is available for this Gateway's OS and architecture.",
    unavailable:
      "The wallet generator binary is missing or failed verification. Reinstall this build and check again.",
    platform: "Gateway platform",
    executionHint: "The wallet is generated on the Gateway computer and sent to this browser.",
    command: "Command",
    refresh: "Check availability",
    checking: "Checking the wallet generator…",
    generate: "Generate wallet",
    generating: "Generating wallet…",
    clearBeforeGenerate: "Save this wallet, then clear the display before generating another.",
    statusFailed:
      "Could not check the wallet generator. Check the Gateway connection and try again.",
    generateFailed: "Wallet generation did not complete. Check availability and try again.",
    address: "Wallet address",
    privateKey: "Private key",
    keyHint:
      "Save this key securely before leaving. It is cleared when you leave this page or disconnect. Anyone with it can spend the wallet's funds.",
    keyHidden: "Private key hidden",
    showKey: "Show private key",
    hideKey: "Hide private key",
    copyAddress: "Copy address",
    copyKey: "Copy private key",
    clear: "Clear display",
    addressCopied: "Wallet address copied.",
    keyCopied: "Private key copied. Clear your clipboard after saving it.",
    copyFailed: "Copy failed. Select and copy the value manually.",
  },
};

type TranslationTree = { [key: string]: string | TranslationTree };
const english: TranslationTree = { ...nodeCopy, ...walletCopy };

export function t(key: string, values: Record<string, string | number> = {}): string {
  let value: string | TranslationTree = english;
  for (const part of key.split(".")) {
    if (typeof value === "string") {
      return key;
    }
    value = value[part] ?? key;
  }
  if (typeof value !== "string") {
    return key;
  }
  for (const [name, replacement] of Object.entries(values)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}
