# Prepare and install CypherClaw releases

CypherClaw uses GitHub Releases for a prebuilt package containing the CLI, Gateway, Control UI, and bundled Cypher assets. Maintainers build a reviewed commit from `cypherclaw-stable`; users install the sealed package and complete the existing OpenClaw onboarding wizard. The technical package name remains `openclaw`, with a `cypherclaw` launcher selecting an isolated profile.

**Publication status:** production preparation requires a clean reviewed commit, verifies the bundled Cypher release materials, and requires matching official build provenance and the transaction-finality IPC API for all three native targets before recording `publication.ready=true`. Local candidates record `publication.ready=false` and can retain older binaries with explicit limitations. The public commands install the latest published release; preparing these changes does not update that release.

## Install a published release

Supported node targets are Linux x64, Apple Silicon macOS, and native Windows x64. WSL2 uses the Linux package. Linux runtime requirements are recorded in the selected native manifest; the retained original node requires glibc 2.38+ and GLIBCXX 3.4.32. The macOS node requires macOS 15+. Intel Macs and Linux/Windows ARM64 have no bundled node binary. Node.js 24.21.0 is installed privately; a system Node.js or pnpm installation is unnecessary.

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

The first UI send creates its feature table in the profile's existing `state/openclaw.sqlite`. Minimal transfer metadata and the original hash survive reloads and restarts without automatic expiration; passwords, private keys, and signed raw transactions are never retained. Recovery only queries the original hash. This additive table uses the existing worker, first-use schema, and backup owners; older software ignores it. Keep chain data and keystore paths unchanged during upgrade or rollback. An older native node lacking `eth_getTransactionFinality` remains usable but shows confirmation as unavailable rather than reporting receipt-only completion.

An immutable release can be selected with `cypherclaw update --tag cypherclaw-v<version>-<commit-prefix>`. Re-running the installer also delegates an existing installation to the package updater. Other upstream release channels are unavailable for this distribution. Source checkouts retain their separate [stable intake and update procedure](CYPHERCLAW_UPSTREAM.md).

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

The builder reuses the canonical package build, including the Control UI, verifies the bundled node's build and source records in this repository's `cypher/` directory, adds fork distribution metadata only in package staging, and checks the resulting tarball again. No manual UI build or user-side source checkout is required. Use a new empty output directory for each preparation.

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

Choose **Actions → CypherClaw Release → Run workflow**, use `cypherclaw-stable` as the workflow branch, leave `source_sha` blank, and check `publish` to build and distribute the current FHS-D version. Leave `publish` unchecked for preparation and artifact inspection. A reviewed older stable SHA can be entered when needed. Native node artifacts come from the completed FHS-D build. After publishing, existing users obtain the new node with `cypherclaw update`; new users use the same one-line installer.

Publication is a separate explicit operation. The optional job has release write permission and requires `publication.ready=true`. It verifies sealed checksums and binds the immutable release tag to the verified release snapshot before creating a draft Release in `CypherTroopers/cypherclaw`. It downloads the uploaded assets again, compares the exact asset inventory and checksums, and only then publishes the draft and promotes it to `latest`. A failure before promotion leaves the existing latest release available. Runs share one stable release concurrency group to prevent simultaneous promotion. It refuses a tag pointing to another commit, preserves existing releases instead of overwriting them, and verifies the tag again after publication. Re-running a failed publish job resumes an identical complete draft; an identical already published release succeeds without moving `latest` again. Incomplete or conflicting assets are preserved for inspection and require a new reviewed commit rather than replacement. Validate the exact release on each supported platform before the first public install promise.

Build/installer checks do not prove macOS, native Windows, WSL2 service behavior, interactive provider authentication, or live Cypher network operation. Track those boundaries in the release's actual validation evidence.
