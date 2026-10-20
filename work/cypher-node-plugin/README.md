# Cypher node management for OpenClaw

A standalone plugin for **official OpenClaw 2026.10.5**. It preserves the CypherClaw node management page, its six tabs (Overview, Node, Wallets, Send, Mining, Explorer), independent wallet generation, and original CypherClaw logo. Node programs run on the Gateway machine, not in the browser.

This is a local development package. It has not been published to ClawHub or npm. Do not load it beside CypherClaw's built-in `cypher.*` methods: both provide the same operations. Test or install it in an official OpenClaw installation with its own state directory.

## Install and prepare

1. Install the local tarball through the normal OpenClaw plugin installer:

   ```sh
   openclaw plugins install npm-pack:/absolute/path/cyphertroopers-openclaw-cypher-0.1.0.tgz
   ```

   Review the source and capability information printed by OpenClaw and follow its reload instructions.

2. Enable **Settings → Labs → Custom plugin UI**. Open the **Cypher** navigation entry through the Gateway's HTTPS or trusted localhost URL.
3. In Overview or Node, press **Prepare node** / **ノードを準備**. This is the explicit network/setup action; installation, service startup, and status reads never download native programs.
4. Setup detects the Gateway's operating system and CPU. It downloads only that target's pinned node program, Windows DLLs when applicable, and independent wallet generator. Every file must match its fixed byte length and SHA-256 before activation.
5. Use Start, Connect IPC, wallets, transfers, mining, and Explorer from the same page. Preparing files does not start a node, mine, unlock a wallet, or send a transaction.

Existing compatible native programs are reused after verification. A failed or interrupted setup reports an error and can be retried. The previous runtime is retained until replacement has been verified. Unknown existing files and operator chain/keystore data are not deleted by setup.

## What is distributed

The ClawHub package contains browser code and logos, backend controllers, setup pins, launch scripts, licenses, and read-only MCP diagnostics. It contains **no node executable, DLL, wallet executable, or source archive**. Native downloads live outside the installed package, under the Gateway state directory. They do not count toward the plugin archive's unpacked capacity.

The build enforces the native Control UI budget (4 MiB per file; 8 MiB total), and `pnpm check:size` rejects native payloads and checks ClawHub's 50 MiB unpacked package budget. The final tarball inventory is also checked during validation. These are separate from the disk space required to run a full node.

### Fixed native sources

- Node: `CypherTroopers/cypher`, distribution commit `9ca4b9793d6e3527f4439ab4cc29a500a160c134`, build source `546d43442e8156591786dc3c1ca1596f014509e3`.
- Independent wallet generator: `CypherTroopers/offlinewalletgenerator`, available distribution commit `629b3122aab207a7d7149439101c571a3360eecf`. Its executable hashes match the retained CypherClaw wallet distribution byte for byte. The original build metadata identifies historical source `8879d9e4c0490999096bb299a0e2da31a1b20e50`; the available repository rewrote its build-info source field. The plugin retains the original metadata and does not claim the rewritten source field establishes a new build. See `THIRD_PARTY_NOTICES.md`.

`src/native/pins.ts` owns the immutable repository commits, filenames, sizes, and hashes. Runtime never resolves a moving branch or latest release. Downloads use bounded HTTPS streaming. Native executables are not run during setup.

### Platform support

| Gateway target                        | Node                           | Independent wallet generator |
| ------------------------------------- | ------------------------------ | ---------------------------- |
| Linux x64                             | Yes                            | Yes                          |
| macOS ARM64                           | Yes                            | Yes                          |
| Windows x64                           | Yes, with the pinned five DLLs | Yes                          |
| Linux ARM64, macOS x64, Windows ARM64 | No node artifact               | Wallet-only setup            |

Native OS/library prerequisites still apply. Artifact availability is not a claim of live native-node testing on every OS. The validation record states which paths were exercised.

## State and updates

Chain data and keystore default to `<Gateway state directory>/cypher/chaindbname`. Transfer records are kept in the plugin's dedicated SQLite database at `<Gateway state directory>/cypher/transfers.sqlite`, accessed only by its worker. Only bounded transaction metadata is stored; wallet passwords, private keys, and signed raw transactions are not persisted.

For an existing node, retain its actual `CYPHER_DATADIR` and `CYPHER_IPC_PATH` settings. The plugin does not discover, move, or initialize another installation's data during installation or setup. Existing CypherClaw transfer history is not automatically imported into the new plugin database. Stop an old managed process through its current owner before starting another process on that data; use Connect IPC when keeping an externally managed node. Disconnect never stops an external process.

Plugin updates retain external chain, keystore, transfer, and native files. A changed native pin requires an explicit setup action. Service shutdown cancels setup and wallet generation and gracefully settles a plugin-owned node. This can interrupt node uptime; it does not restart an operator's unrelated Gateway or node.

## Authority and sensitive operations

Read operations require `operator.read`; native setup and mutations require `operator.admin`. Current connection and service authority are checked after awaited preparation and before effects. The Send tab preserves quoted amounts, explicit confirmation, original transaction hashes, restart-safe duplicate protection, and finality tracking. Mining retains separate signer and reward recipient controls.

Generated wallet keys are returned only to the authenticated UI, initially masked, and can be cleared. They are not sent to a model or stored in browser storage. Clipboard contents remain operator-controlled.

## MCP diagnostics

The manifest contributes a stdio server, `cypher-diagnostics`, only while the plugin is enabled. It forwards reads through the official public Gateway client to the same backend owner:

- `cypher_setup_status`
- `cypher_node_status`
- `cypher_wallet_balances`

MCP discovery does not contact the Gateway or download native files. These tools do not start/stop nodes, prepare downloads, mine, send, unlock, or generate private keys. Those operations remain in the management page with their existing authority and confirmation flow. Gateway authentication and MCP tool policy still apply.

## Develop and package

Use Node.js supported by OpenClaw 2026.10.5 and the package's pinned pnpm version. This directory has its own dependency installation and lockfile; it does not import surrounding CypherClaw implementation files.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm check:size
npm pack --ignore-scripts --pack-destination artifacts
```

The backend, transfer worker, MCP bridge, and browser dependencies are bundled. `openclaw/plugin-sdk/*` imports remain external to use the installed host. Development dependencies, tests, proof artifacts, and downloaded native programs are excluded from the package.

All current OpenClaw plugin APIs are experimental. Compatibility is pinned to 2026.10.5; test another host release before widening the range. A managed install and live platform tests are separate from static package checks. See `VALIDATION.md` for observed proof and limitations.

ClawHub publication requires ownership, source/provenance metadata, and its normal validation/security review. A local successful build is not registry approval or OpenClaw official endorsement.
