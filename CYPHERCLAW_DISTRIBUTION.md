# Prepare and install CypherClaw releases

CypherClaw uses GitHub Releases for a prebuilt package containing the CLI, Gateway, Control UI, and bundled Cypher assets. Maintainers build a reviewed commit from `cypherclaw-stable`; users install the sealed package and complete the existing OpenClaw onboarding wizard. The technical package name remains `openclaw`, with a `cypherclaw` launcher selecting an isolated profile.

**Publication status:** production preparation from a clean reviewed commit verifies the bundled Cypher release materials and records `publication.ready=true`. Local candidates record `publication.ready=false` and cannot be published by the workflow. The public commands below become usable after the first GitHub Release is actually published; preparing assets alone does not make those URLs available.

## Install a published release

Supported node targets are Linux x64, Apple Silicon macOS, and native Windows x64. WSL2 uses the Linux package. The Linux node requires glibc 2.38+ and GLIBCXX 3.4.32; the macOS node requires macOS 15+. Intel Macs and Linux/Windows ARM64 have no bundled node binary. Node.js 24.21.0 is installed privately; a system Node.js or pnpm installation is unnecessary.

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

The installer adds the launcher directory to Bash/Zsh startup configuration or Windows User PATH. It prints the absolute launcher path if it cannot save that change. It does not require a system-wide npm prefix.

## Update the installed package

```sh
cypherclaw update
```

The CLI and Control UI use the same existing package updater. Fork metadata directs resolution to this repository's stable GitHub Releases. The selected manifest supplies package SHA-256, byte length, Node engines, and database schema requirements before the updater stages the package. Existing admission, backups, Doctor, activation, service recovery, and rollback remain with that updater. Official npm update notifications and automatic npm updates are disabled for this marked distribution.

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

CypherClaw packages the node's build record in [cypher/BUILDINFO.txt](cypher/BUILDINFO.txt), its checksum ledger in [cypher/SHA256SUMS](cypher/SHA256SUMS), licenses in `cypher/licenses/`, provenance in `cypher/provenance/`, and the source archive `cypher/cypher-source-60b8164-with-go-dependencies.tar.gz`. The builder verifies these retained materials and the bundled binaries against the checksum ledger.

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

The fork-only [CypherClaw Release workflow](.github/workflows/cypherclaw-release.yml) accepts `source_sha` and `publish`. It checks out the full SHA, builds/seals the assets, and uploads an Actions artifact. `publish` defaults to false. Preparation can be inspected without a public release.

Publication is a separate explicit operation. The optional job has release write permission and requires `publication.ready=true`. It verifies sealed checksums and binds the immutable release tag to the selected full source SHA before creating the Release in `CypherTroopers/cypherclaw`. It refuses a tag pointing to another commit and verifies the tag again after publication. Validate the exact release on each supported platform before the first public install promise.

Build/installer checks do not prove macOS, native Windows, WSL2 service behavior, interactive provider authentication, or live Cypher network operation. Track those boundaries in the release's actual validation evidence.
