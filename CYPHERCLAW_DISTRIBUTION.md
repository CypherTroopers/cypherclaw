# Prepare and install CypherClaw releases

CypherClaw uses GitHub Releases for a prebuilt package containing the CLI, Gateway, Control UI, and bundled Cypher assets. Maintainers build a reviewed commit from `cypherclaw-stable`; users install the sealed package and complete the existing OpenClaw onboarding wizard. The technical package name remains `openclaw`, with a `cypherclaw` launcher selecting an isolated profile.

**Publication status:** production preparation requires a clean reviewed commit, verifies the bundled Cypher release materials, and requires matching official build provenance and the transaction-finality IPC API for all three native targets before recording `publication.ready=true`. Local candidates record `publication.ready=false` and can retain older binaries with explicit limitations. The public commands install the latest published release; preparing these changes does not update that release.

## Install a published release

Supported node targets are Linux x64, Apple Silicon macOS, and native Windows x64. WSL2 uses the Linux package. Linux runtime requirements are recorded in the selected native manifest; the retained original node requires glibc 2.38+ and GLIBCXX 3.4.32. The macOS node requires macOS 15+. Intel Macs and Linux/Windows ARM64 have no bundled node binary. Node.js 24.22.1 is installed privately; a system Node.js or pnpm installation is unnecessary.

After a release is published, run one command from your user account:

```sh
# macOS / Linux / WSL2
curl -fsSL https://github.com/CypherTroopers/cypherclaw/releases/latest/download/install.sh | bash
```

```powershell
# Native Windows PowerShell
iwr -useb https://github.com/CypherTroopers/cypherclaw/releases/latest/download/install.ps1 | iex
```

The installer resolves an immutable release tag, downloads and checks its assets, provisions private Node.js, installs the prebuilt package, and starts `onboard --install-daemon` in an interactive terminal. Complete the model/provider and Gateway settings in the wizard. The existing wizard owns service installation and dashboard handoff. API credentials and provider login remain interactive user choices.

Open a new terminal for the installed command:

```sh
cypherclaw --version
cypherclaw gateway status
cypherclaw dashboard
```

If setup was skipped or the install ran without a terminal, run `cypherclaw onboard --install-daemon`. On hosts without a supported user service manager, use the existing foreground path `cypherclaw gateway run`, then `cypherclaw dashboard` in another terminal.

The default package/runtime directory is `~/.cypherclaw`. The launcher defaults to `OPENCLAW_PROFILE=cypherclaw`, so configuration and state use `~/.openclaw-cypherclaw`. Bundled-release chain data lives beneath that state's `cypher/chaindbname`; its first relay configuration is copied into `cypher/browser-relay/common-mine.json`. Updates preserve these paths. Explicit `OPENCLAW_PROFILE`, `OPENCLAW_STATE_DIR`, `CYPHER_DATADIR`, and `CYPHER_BROWSER_RELAY_CONFIG` values retain their existing meaning. Changing a selected data directory does not migrate an older installation's data.

The ColossusX page separates Overview, Node, Wallets, Send, Mining, and Explorer, with a short introduction in each tab. Wallets displays exact CLX balances and node-reported lock state. Send requires review before signing and distinguishes acceptance, receipt inclusion, and successful FHS finality. Explorer opens the actual site in another tab only for matching chain ID and genesis; explorer indexing can lag behind the node's result. See the [node UI guide in the README](README.md#install-cypherclaw-and-use-the-cypher-node).

The installer adds the launcher directory to Bash/Zsh startup configuration or Windows User PATH. It prints the absolute launcher path if it cannot save that change. It does not require a system-wide npm prefix.

## Update the installed package

```sh
cypherclaw update
```

The CLI and Control UI use the same existing package updater. Fork metadata directs resolution to this repository's stable GitHub Releases. The selected manifest supplies package SHA-256, byte length, Node engines, and database schema requirements before the updater stages the package. Existing admission, backups, Doctor, activation, service recovery, and rollback remain with that updater. Official npm update notifications and automatic npm updates are disabled for this marked distribution.

The first UI send creates its feature table in the profile's existing `state/openclaw.sqlite`. Minimal transfer metadata and the original hash survive reloads and restarts without automatic expiration; passwords, private keys, and signed raw transactions are never retained. Recovery only queries the original hash. This additive table uses the existing worker, first-use schema, and backup owners; older software ignores it. Ordinary package upgrades and rollbacks preserve chain data and keystore paths. Changing networks requires the explicit genesis migration below. An older native node lacking `eth_getTransactionFinality` remains usable but shows confirmation as unavailable rather than reporting receipt-only completion.

An immutable release can be selected with `cypherclaw update --tag cypherclaw-v<version>-<commit-prefix>`. Re-running the installer also delegates an existing installation to the package updater. Other upstream release channels are unavailable for this distribution. Source checkouts retain their separate [stable intake and update procedure](CYPHERCLAW_UPSTREAM.md).

The 2026.10.6 source requires Node.js 24.22.1+ or 26.12.1+. Previously published CypherClaw packages pin their release-manifest reader to Node.js 24.21.0, so their ordinary `cypherclaw update` cannot resolve a new manifest declaring 24.22.1. Re-run the one-line installer above to make this transition. It provisions the new private runtime, verifies the release assets, and passes the local tarball to the installed updater. Release acceptance requires this installer migration with a running managed Gateway on every supported OS, including actual private Node versions before and after. Source intake alone does not prove migration or change an installed Gateway.

The published 10.5 updater can still select the managed service's old Node after provisioning. If that updater finishes with `target-native-unsupported` and verifies that the original Gateway recovered, the installer can refresh an unpinned service through the installed CLI's existing service reconciliation owner, then retry the same update once. Reconciliation audits the complete service definition, backs it up, preserves recognized policy, and refuses unknown edits. The installer checks installation identity, profile/configuration, readiness, runtime intent, and automatic startup before requesting this refresh; it preserves explicit runtime pins and disabled services for their deployment owner to handle. A failed refresh keeps the existing recovery evidence and reports the next step. If native installation succeeds but the original Gateway subsequently exits on the new runtime, the published owner's runtime-intent guard refuses automatic restoration of a stopped service. The installer reports retained backups for the deployment owner; it does not bypass that guard or replace the original package.

On Windows, an old Gateway can keep the previous private `node.exe` open after the verified new runtime is published. Failure to remove that old backup produces a warning and leaves its remaining files available while the installed updater continues. After those processes stop, remove only the backup directory named in that warning.

Current release verification accepts both the historical 24.21.0 manifest pin and the current 24.22.1 pin, preserving the recorded value. Remove historical acceptance only when those published packages no longer serve as supported upgrade baselines; installers and newly prepared manifests use 24.22.1.

### Migrate to the new genesis

The updated genesis has hash `0xbef1d519ceeba0d303fe63d13bb5fb70cda8947f9ee5c60436135cdb77e4db52`; its chain ID remains `10101919` (`0x9a249f`). An existing initialized directory stays on its original genesis after a package update. Joining the new network requires a fresh directory and synchronization; old balances and pending transactions do not move to it.

The network operator must bring up the validator committee with the same genesis before users join. A Common node alone cannot produce finalized transactions.

1. Record the current **Data directory** and **IPC** paths in **ColossusX → Node**. Stop the old node through its actual owner: **Stop node** for a UI-managed node, or the terminal/service that started an external node. Confirm it has exited before proceeding.
2. Stop the Gateway with `cypherclaw gateway stop` (or stop its foreground process/external supervisor). Back up the complete old node directory, including its encrypted keystore, WAL, ingress, and outbox, and the Gateway profile, including `state/openclaw.sqlite` and its associated SQLite files. Keep these backups and the original directories. Then run `cypherclaw update`.
3. Start the updated Gateway with a new, unused absolute data path and a distinct bare IPC name in its **process environment**. The examples below use the default `cypherclaw` profile; adjust paths to the recorded Node page and your custom profile/state directory. Each example refuses an existing destination. The updater may have restarted the service, so stop it again before starting this foreground Gateway.

Linux/macOS/WSL2, in Bash:

```bash
(
  set -eu
  cypherclaw gateway stop
  export CYPHER_DATADIR="$HOME/.openclaw-cypherclaw/cypher/chaindb-fhs-250ms"
  export CYPHER_IPC_PATH="cypher-fhs-250ms.ipc"
  if [ -e "$CYPHER_DATADIR" ] || [ -L "$CYPHER_DATADIR" ]; then
    echo "Choose a new, unused CYPHER_DATADIR." >&2
    exit 1
  fi
  umask 077
  mkdir -m 700 "$CYPHER_DATADIR"
  cypherclaw gateway run
)
```

Native Windows, in PowerShell:

```powershell
$ErrorActionPreference = "Stop"
cypherclaw gateway stop
if ($LASTEXITCODE -ne 0) { throw "Gateway stop failed; check its owner before continuing." }
$env:CYPHER_DATADIR = Join-Path $HOME ".openclaw-cypherclaw\cypher\chaindb-fhs-250ms"
$env:CYPHER_IPC_PATH = "cypher-fhs-250ms.ipc"
if (Test-Path -LiteralPath $env:CYPHER_DATADIR) {
  throw "Choose a new, unused CYPHER_DATADIR."
}
New-Item -ItemType Directory -Path $env:CYPHER_DATADIR | Out-Null
cypherclaw gateway run
```

Keep the new directory private to the operator. If you want the same wallet addresses, copy only the backed-up **encrypted keystore** into the new directory's `keystore` folder before starting the node. Do not copy old chain, ingress, outbox, or reward state. Retaining keys does not retain the old network's balances. Leave the Gateway SQLite database intact; its transfer history remains bound to each record's original network and IPC endpoint. Old-network pending records are not confirmed or rebroadcast on the new network.

For background operation, persist both variables in the existing service manager's Gateway environment, then restart through that manager. Shell exports do not change an already running Gateway or an installed service's environment. Set these variables before launching the Gateway; do not rely on `.env` or `env.vars` for these overrides. A separate IPC name is especially important on Windows, where the named pipe is independent of the data directory.

4. Open the dashboard from another terminal with `cypherclaw dashboard`. Check the selected paths under **ColossusX → Node**, then select **Start node**. To inspect the connected genesis and wallet addresses, run `cypherclaw gateway call cypher.wallets.list --params '{}'` in that terminal. Its `network.genesisHash` and `network.chainId` must match the values above; verify the expected wallet addresses before sending. Allow the node to synchronize, then configure the signing account and register the reward address again for this network using the [Common RPC setup](cypher/README.md#beginner-setup-common-rpc-node-and-rewards).

If you set `CYPHER_ROOT`, the Gateway uses that external node directory. A package update replaces only the bundled assets; update the selected external binary and genesis from their owner before following this procedure. Explorer links remain guarded by both chain ID and the explorer's verified genesis; matching the new local genesis alone does not establish that the public explorer has switched networks.

## Build a reviewed stable commit

Use the repository's pinned toolchain and a clean checkout whose HEAD is the reviewed full SHA on `origin/cypherclaw-stable`. Preserve upstream package, SDK, licensing, and config identities.

```sh
pnpm install --frozen-lockfile
node scripts/build-cypherclaw-release.mjs \
  --source-sha "$(git rev-parse HEAD)" \
  --output-dir .artifacts/cypherclaw-release
node scripts/build-cypherclaw-release.mjs \
  --check --output-dir .artifacts/cypherclaw-release
```

The builder reuses the canonical package build, including the Control UI, verifies the bundled node's build and source records in this repository's `cypher/` directory, adds fork distribution metadata only in package staging, and checks the resulting tarball again. The Node shell installer embeds the upstream shared installer policy using the canonical standalone assembly. No manual UI build or user-side source checkout is required. Use a new empty output directory for each preparation.

CypherClaw packages the node's build record in [cypher/BUILDINFO.txt](cypher/BUILDINFO.txt), its checksum ledger in [cypher/SHA256SUMS](cypher/SHA256SUMS), licenses in `cypher/licenses/`, and provenance in `cypher/provenance/`. Actions also includes `cypher/cypher-source-<full-FHS-D-SHA>.tar.gz`, containing the selected repository source, build recipes, `go.mod`, and `go.sum`. The [finality patch and native build instructions](cypher/patches/README.md) accompany that source. The original `cypher-source-60b8164-with-go-dependencies.tar.gz` and its dependency evidence remain historical materials; they do not establish current dependency-source completeness. Active metadata and checksums bind the selected source, patch, and binaries.

The Actions workflow imports all native binaries and Windows DLLs produced by FHS-D's existing official build. It does not run a second native build or apply a CypherClaw-specific node patch. The persisted FHS-D records include each target's original `manifest.txt`, embedded `go-build-info.txt`, and `SHA256SUMS` covering every staged file.

The consumer resolves one FHS-D distribution commit and reads the actual build-source SHA from those records. These are distinct identities: FHS-D's publisher commits completed binaries after the source build. All three targets must identify the same source, and the source-to-distribution diff may contain only `build/bin/` and `build/provenance/` outputs. Newer source changes without matching completed outputs stop preparation with an actionable error.

The importer checks the immutable Git source and copies the original files into three target directories. The package builder checks each file's checksum, target, embedded toolchain, dependency references, and IPC finality contract before copying all binaries and DLLs into package staging. DLL updates follow the official FHS-D outputs and their checksums. Active package records identify both source and distribution commits and preserve the historical bundle's records.

The historical patch and build wrapper remain accompanying source material for the original bundle. Their manual build command is described in [the source records guide](cypher/patches/README.md); production Actions does not call that wrapper. A Linux check alone does not prove native macOS or Windows behavior. Production preparation and `--check` reject missing or mismatched finality bindings; local candidates can retain older nodes with explicit limitations and remain unpublishable.

The output contains:

| Asset                                            | Purpose                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `cypherclaw.tgz`                                 | Prebuilt compatible `openclaw` package                                                     |
| `install.sh`, `install.ps1`                      | One-line installer entry points                                                            |
| `install-node.sh`, `install-node.ps1`            | Existing upstream private Node provisioning                                                |
| `install-runtime.mjs`, `cypherclaw-contract.mjs` | Shared package installation and release validation                                         |
| `cypherclaw-release.json`                        | Version, full source SHA, immutable tag, schemas, hashes, sizes, and publication readiness |
| `SHA256SUMS`                                     | Checksums covering the manifest and every payload asset                                    |

Release tags are `cypherclaw-v<version>-<first-12-source-SHA-characters>`. SHA-256 protects asset integrity within the trusted GitHub release; it is not an independent publisher signature.

For local worktree proof, add `--candidate`. The manifest explicitly records that its bytes are not a clean reviewed commit and sets `publication.ready=false`. `--skip-build` is available only with `--candidate` and matching existing build metadata; use a fresh build after source changes. Production preparation always rebuilds the selected clean source and sets `publication.ready=true` after its source and material checks succeed.

Test a prepared release without publishing it or registering a Gateway service:

```sh
bash .artifacts/cypherclaw-release/install.sh \
  --release-dir .artifacts/cypherclaw-release \
  --prefix "$HOME/.cypherclaw-candidate" --no-onboard
```

```powershell
& .artifacts/cypherclaw-release/install.ps1 `
  -ReleaseDir .artifacts/cypherclaw-release `
  -Prefix "$HOME/.cypherclaw-candidate" -NoOnboard
```

Use an isolated account/state for candidate verification. `--no-onboard` skips setup; an existing installation still uses its updater and normal service recovery. Give a candidate a new private prefix to avoid updating an existing installation. Dependency retrieval still uses npm; the local asset option is not an offline dependency bundle.

## Prepare and publish through GitHub Actions

The fork-only [CypherClaw Release workflow](.github/workflows/cypherclaw-release.yml) accepts optional `source_sha` and explicit `publish` through manual dispatch. Leaving `source_sha` blank selects the stable commit selected when the workflow starts; entering a full SHA selects that reviewed stable commit. The workflow resolves `CypherTroopers/cypher`'s `FHS-D` branch once and acquires the complete, unchanged official node outputs and persisted build records from that immutable commit.

FHS-D owns the Linux x64, macOS ARM64, and Windows x64 build and tests. Its existing Actions publishes binaries and provenance together. CypherClaw runs acquisition on Linux, exports the matching repository source, then builds its CLI, Gateway, and Control UI and assembles the package. A newer FHS-D source commit must finish its official build before CypherClaw can package it. `publish` defaults to false, allowing artifact inspection; a branch push alone does not publish a CypherClaw release.

Cypher-only updates produce distinct releases even when CypherClaw's reviewed commit is unchanged. Preparation creates a deterministic Git release snapshot with that reviewed commit as its sole parent. Only the existing finality metadata's `releaseInputs` block and its checksum row change, recording the reviewed CypherClaw, FHS-D build-source, and FHS-D distribution SHAs. The compatible `cypherclaw-v<version>-<snapshot-prefix>` tag and package build identify the real snapshot commit; package and manifest also record all three input SHAs. The publish job verifies that exact snapshot before pushing its tag. Build-only runs keep the snapshot local to Actions.

GitHub requires the manual workflow to exist on the repository's default branch. This repository uses `cypherclaw-stable` as its default branch, so the release workflow runs directly from that branch. No dispatch wrapper on `main` is needed. Push the reviewed workflow and its build scripts to `cypherclaw-stable` before running the intake and package pipeline.

Choose **Actions → CypherClaw Release → Run workflow**, use `cypherclaw-stable` as the workflow branch, leave `source_sha` blank, and check `publish` to prepare, validate, and distribute the release. Leave `publish` unchecked to prepare the same assets and run acceptance without publishing. A reviewed older stable SHA can be entered when needed. Native node artifacts come from the completed FHS-D build. Existing users on the current private Node runtime use `cypherclaw update`; users crossing the Node 24.21.0 → 24.22.1 boundary re-run the one-line installer, as new users do.

### Required app acceptance on each OS

The release workflow captures the latest published stable CypherClaw release once, verifies its immutable tag and sealed assets, and passes that baseline and the exact prepared candidate to three standard GitHub-hosted runners: Linux x64 (`ubuntu-24.04`), macOS ARM64 (`macos-15`), and Windows x64 (`windows-2025`). Maintainers can operate the workflow from Linux; GitHub supplies the other operating systems. The matrix admits at most three concurrent jobs and does not use Blacksmith runners or provider credentials.

Each runner executes the platform installer from the sealed candidate assets in a fresh private prefix, starts a managed Gateway, and checks authenticated RPC and Control UI asset serving. A separate cell installs the captured published baseline and creates a synthetic session through the installed Gateway. When the private Node version changes, the cell runs the sealed candidate installer against that existing prefix while the Gateway is running; the installer must provision Node and delegate the package update to the installed updater. Otherwise the cell invokes the installed updater directly against the candidate tarball. Both paths require the updater's public ledger to record a finished, successful run. Direct package installation cannot replace a failed update. Acceptance checks actual private Node versions, installed and serving build identity, retained configuration and Gateway authentication, old session/transcript contents, new transcript writes, SQLite integrity, and cleanup of the owned service.

Package preparation generates post-replacement module compatibility from `scripts/lib/update-compat-inventory.json`. This includes the verified published CypherClaw 10.1 package alongside the recorded OpenClaw packages. A shared version number does not imply identical module filenames: each artifact retains its own build ID, commit, and SHA-512 integrity. The compatibility outputs preserve the old updater's loaded cleanup queue until its pending work has settled.

The acceptance job requires exactly one successful receipt for each target, bound to the same baseline tag, candidate source, manifest hashes, and package hashes. Missing, skipped, failed, duplicate, or mismatched evidence stops publication. A candidate identical to the captured published package is refused because it cannot prove an upgrade transition. The publish job consumes the already-tested assets; it does not rebuild them. `publication.ready=true` remains the packaging/provenance condition and is also required, but does not replace OS acceptance.

This gate covers the CLI, Gateway, browser UI asset serving, fresh installation, and the published-driver upgrade. It does not run Cypher nodes, mining, transactions, external channel sends, provider login/model inference, or native desktop/mobile apps. Those retain their own validation owners. Browser rendering and every operator configuration are outside this representative app acceptance. A failed OS test leaves the existing public latest release available. Only sanitized acceptance receipts are uploaded; raw service/configuration logs stay private to the disposable runner. Failed update receipts distinguish the update command from its status check and retain exit codes, fixed failure identifiers, and bounded update-ledger facts; arbitrary messages, command arguments, paths, and configuration remain private.

Publication is a separate explicit operation. The optional job has release write permission and requires `publication.ready=true`. It verifies sealed checksums and binds the immutable release tag to the verified release snapshot before creating a draft Release in `CypherTroopers/cypherclaw`. It downloads the uploaded assets again, compares the exact asset inventory and checksums, and only then publishes the draft and promotes it to `latest`. A failure before promotion leaves the existing latest release available. Runs share one stable release concurrency group to prevent simultaneous promotion. It refuses a tag pointing to another commit, preserves existing releases instead of overwriting them, and verifies the tag again after publication. Re-running a failed publish job resumes an identical complete draft; an identical already published release succeeds without moving `latest` again. Incomplete or conflicting assets are preserved for inspection and require a new reviewed commit rather than replacement. Validate the exact release on each supported platform before the first public install promise.

Build/installer checks do not prove macOS, native Windows, WSL2 service behavior, interactive provider authentication, or live Cypher network operation. Track those boundaries in the release's actual validation evidence.
