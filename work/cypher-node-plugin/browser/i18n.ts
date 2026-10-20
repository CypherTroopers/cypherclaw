const nodeCopy = {
  cypher: {
    title: "ColossusX",
    tabsLabel: "ColossusX management",
    tabs: {
      overview: "Overview",
      node: "Node",
      wallets: "Wallets",
      send: "Send",
      mining: "Mining",
      explorer: "Explorer",
    },
    overview: "Your node at a glance",
    overviewHint:
      "Check your node and network here. First, confirm that the node is connected; then open Wallets to view your funds.",
    wallets: "Your wallets",
    walletsHint:
      "These wallets belong to the node on your Gateway computer. Select one to use it, or create a wallet if the list is empty.",
    wallet: "Wallet",
    connectFirst: "Open the Node tab and start or connect to your node first.",
    emptyWallets:
      "No wallets were found on this node. Enter a password below and choose Create wallet.",
    walletLocked: "Locked",
    walletUnlocked: "Unlocked",
    lockUnknown: "Lock state unavailable",
    sendFromWallet: "Send from this wallet",
    viewExplorer: "View in explorer ↗",
    walletPage: "Wallets {start}–{end} of {total}",
    previous: "Previous",
    next: "Next",
    copyAddress: "Copy address",
    addressCopied: "Wallet address copied.",
    copyFailed: "The address could not be copied. Select and copy the address manually.",
    refreshWallets: "Refresh wallets and balances",
    openWallets: "Open wallets",
    send: "Send CLX",
    sendHint:
      "Send funds from a wallet on your node. Choose the wallet, enter the recipient and amount, then review the transfer before sending.",
    transferDetails: "Transfer details",
    sendFrom: "From",
    sendRecipient: "Recipient address",
    amount: "Amount (CLX)",
    reviewTransfer: "Review amount and fee",
    confirmTransfer: "Review and confirm",
    confirmHint:
      "Check the recipient, amount and estimated fee. Enter this wallet's password only when you are ready to send.",
    estimatedFee: "Estimated maximum fee",
    actualFee: "Actual fee",
    total: "Amount plus estimated maximum fee",
    confirmCheckbox: "I checked the recipient and amount and want to send this transfer.",
    sendNow: "Confirm and send",
    editTransfer: "Edit transfer",
    quoteExpired: "This fee estimate expired. Review the amount and fee again before sending.",
    sendAccepted: "The transfer was submitted. Follow its result below until it is complete.",
    sendComplete: "Transfer complete: {amount} CLX.",
    sendUnknown:
      "The node has not confirmed acceptance. The original transaction hash is being checked below; do not send the payment again yet.",
    sendFailed: "This transfer failed. {reason}",
    sendAdmissionRejected:
      "The node rejected the transfer because Common admission is not ready. Check the Node and Mining settings before trying again.",
    sendExecutionFailed:
      "The transaction was finalized with failed execution. Check its receipt and your balance before trying again.",
    sendFailedHint: "Check the transfer record and node logs for the cause before trying again.",
    sendUnavailable:
      "This node is not ready to accept transfers. Check its Common admission configuration.",
    finalityUnavailable:
      "This node cannot report FHS finality. A receipt alone does not confirm completion; use the prepared node build to enable this check.",
    transferHistory: "Your outgoing transfers",
    historyHint:
      "Transfers sent from this screen are saved by your Gateway. Refresh or return here later to check their results.",
    emptyTransfers: "No transfers have been sent from this screen yet.",
    txHash: "Transaction hash",
    unknownTransfer:
      "The result is still being checked using this transaction hash. Avoid sending the same payment again while its result is unknown.",
    transferError: "The node reported {code}. Check the transfer result before trying again.",
    transferStates: {
      unknown: "Checking result",
      submitted: "Accepted by node",
      included: "Included · awaiting finality",
      complete: "Complete",
      failed: "Failed",
    },
    explorer: "Blockchain explorer",
    explorerHint:
      "Look up an address, transfer or block on ColossusX. Enter it below, or use a wallet or transfer's View in explorer link.",
    explorerSearch: "Look up on ColossusX",
    explorerQuery: "Wallet address, transaction hash or block number",
    openExplorer: "Open result ↗",
    explorerHome: "Open explorer home ↗",
    explorerMatched:
      "Your node matches the ColossusX explorer network. Results open in a new browser tab.",
    explorerMismatch:
      "Connect to the ColossusX network to use these links. Your node's chain ID and genesis must both match the explorer.",
    explorerInvalid:
      "Enter a complete 0x address, transaction hash or decimal block number. Explorer links also require a matching network.",
    explorerDelay:
      "The explorer may take time to index a transfer. Its indexing delay does not change a completion result confirmed by your node.",
    independentGenerator: "Independent wallet generator (advanced)",
    independentGeneratorHint:
      "This generator creates a separate address and private key; it does not add a wallet to your node. Save the key before clearing it or leaving the ColossusX page.",
    subtitle: "Manage the ColossusX node on the connected Gateway's computer.",
    node: "Node",
    nodeHint:
      "Start or connect to the node that holds your wallets. Choose Start node for the prepared node, or Connect IPC if a node is already running on this computer.",
    start: "Start node",
    stop: "Stop node",
    connect: "Connect IPC",
    disconnect: "Disconnect IPC",
    refresh: "Refresh status and logs",
    offline: "Connect to the Gateway to manage ColossusX.",
    readRequired: "Operator read access is required to view node status and logs.",
    working: "Waiting for the node to complete this action…",
    adminRequired:
      "Administrator access is required to change the node, accounts, mining, or rewards.",
    unsupported: "No ColossusX node build is available for this Gateway's OS and architecture.",
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
    accounts: "Mining signer",
    accountsHint:
      "The signer identifies this node. Selecting an account does not change the separate reward recipient B.",
    account: "Local account",
    selectAccount: "Use as signer A",
    signer: "Current signer A",
    noAccounts: "No local accounts",
    accountPassword: "Account password",
    createAccount: "Create wallet",
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
      "Mining uses a separate signer account. Choose the signer and thread count, then start mining; reward routing is configured below.",
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
      "The wallet generator is not prepared or failed verification. Open Node and choose Prepare node, then check again.",
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

const japanese: Readonly<Record<string, string>> = {
  "cypher.stopRequested": "停止を要求しました。ノードの終了を待っています…",
  "cypher.stopComplete": "ノードを停止しました。",
};

export function t(
  key: string,
  values: Record<string, string | number> = {},
  locale = "en",
): string {
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
  if (locale.toLowerCase().startsWith("ja")) {
    value = japanese[key] ?? value;
  }
  for (const [name, replacement] of Object.entries(values)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

const setupEnglish = {
  title: "Node preparation",
  description:
    "Prepare the node and independent wallet generator on the Gateway computer, then start the node or connect to an existing IPC endpoint.",
  state: "Preparation",
  prepare: "Prepare node",
  verify: "Verify prepared files",
  inUse:
    "Stop the node started by this Gateway, or disconnect an existing node, before preparing or verifying files.",
  refresh: "Check preparation",
  explicit:
    "Downloads begin only when you choose Prepare node or Verify prepared files. Neither action starts the node.",
  checking: "Checking preparation…",
  missing: "Not prepared",
  preparing: "Preparing…",
  ready: "Ready",
  unsupported: "Unavailable on this platform",
  error: "Preparation failed",
  nodeFiles: "Node files",
  walletFiles: "Independent wallet generator",
  progress: "Download progress",
  progressFiles: "{done} of {total} files verified",
};
const setupJapanese: typeof setupEnglish = {
  title: "ノードの準備",
  description:
    "Gateway のコンピューターにノードと独立ウォレット生成ツールを準備してから、ノードを起動するか、既存の IPC に接続します。",
  state: "準備状況",
  prepare: "ノードを準備",
  verify: "準備済みファイルを検証",
  inUse:
    "この Gateway で起動したノードは停止し、外部ノードは IPC を切断してから準備・検証してください。",
  refresh: "準備状況を確認",
  explicit:
    "「ノードを準備」または「準備済みファイルを検証」を押したときだけダウンロードします。どちらもノードは起動しません。",
  checking: "準備状況を確認中…",
  missing: "未準備",
  preparing: "準備中…",
  ready: "準備完了",
  unsupported: "この環境では利用できません",
  error: "準備に失敗しました",
  nodeFiles: "ノードのファイル",
  walletFiles: "独立ウォレット生成ツール",
  progress: "ダウンロード状況",
  progressFiles: "{total} ファイル中 {done} ファイルを検証済み",
};

export function setupText(
  locale: string,
  key: keyof typeof setupEnglish,
  values: Record<string, string | number> = {},
): string {
  let value = (locale.toLowerCase().startsWith("ja") ? setupJapanese : setupEnglish)[key];
  for (const [name, replacement] of Object.entries(values)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}
