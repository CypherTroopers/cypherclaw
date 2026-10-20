# Local validation — 2026-10-20

This record covers the standalone project in `work/cypher-node-plugin`. Original CypherClaw source, its built-in node feature, Git branches, and operator state were not changed. Nothing was published to ClawHub, npm, or GitHub.

## Package

`artifacts/cyphertroopers-openclaw-cypher-0.1.0.tgz`:

- Compressed: **524,306 bytes**; unpacked: **1,993,782 bytes**, 66 files.
- SHA-256: `fd1290b8c5e03a5971bba1aaf5e80c23308cd8f5eca06d6f3b68fdb5c1b89bd1`.
- Browser: **183,059 bytes** (JavaScript 174,749; CSS 8,310).
- Actual tar inventory contains no native executable, DLL, source archive, development dependency, or test. Native file signatures were also checked.
- Unpacked payload fits the reviewed ClawHub 50 MiB budget; browser assets fit OpenClaw's 4 MiB/file and 8 MiB aggregate budgets. Registry acceptance and publication remain separate.

See `artifacts/package-verification.json` and `artifacts/npm-pack.json`. These validation files and browser recordings are development evidence and are excluded from the distributed tarball.

## Automated checks

- Standalone build, TypeScript check, size check, and formatter check passed.
- Vitest: **12 files, 163 tests passed**, 4.13 seconds runner time / 4.99 seconds wall time on this host.
- After consolidating unchanged wallet pins and correcting setup error guidance, typecheck and the affected **21 wallet tests** passed again (0.627 seconds runner time).
- HTTP fixtures use a private loopback server. This managed sandbox denies ordinary socket binds; the passing run used the supported elevated execution route. Fixture listen failures now reject immediately and clean up safely.
- Initial failures found a missing stopping-status translation, whitespace-sensitive tab assertions, and a stale expectation for an intentionally sanitized authority error. Each was corrected before the passing run.

## Real native download

The production `NativeInstaller.prepare` downloaded the Linux x64 files from immutable public Cypher repository commits into fresh temporary state. All five HTTP requests returned the full pinned bytes; all installed sizes and SHA-256 values were independently checked:

- Node executable: 52,854,872 bytes.
- Three node provenance records.
- Independent wallet generator: 5,375,467 bytes.

Repeated preparation and cold admission returned ready without additional HTTP requests (5 → 5). Synthetic chain/keystore data and original wallet build metadata were preserved. Native executables were **not run**. Large downloaded proof files were removed after verification. Receipt: `artifacts/validation/native-download.json`.

The wallet generator's available immutable distribution has identical executable bytes to the original retained release but rewritten upstream build-info source fields. The original historical source metadata is preserved; see README and THIRD_PARTY_NOTICES.

## Browser and logo

Playwright exercised the actual built browser bundle through a public Control UI host fixture: **7 check groups passed**, 17 retained screenshots, no page errors.

Checks cover six-tab registration, original embedded artwork, no preparation on mount, wallet selection and masked generator output, transfer confirmation and finality, separate mining signer/reward controls, mobile overflow, explicit preparation/progress/failure/retry, and read-only/unsupported/wallet-only states.

Evidence: `artifacts/proof/after-PjAR40/report.json`. The before/after comparison reuses a prior actual CypherClaw Node-page capture because the relevant original UI files are unchanged at the current checkout. File/commit comparison and image hashes are in `comparison-receipt.json` beside the report. Both before and after images were inspected. The standalone fixture demonstrates plugin rendering; it does not claim a live blockchain transaction.

## MCP and independent review

The actual bundled stdio MCP executable completed initialization and tools/list, exposing only three read-only diagnostic tools. Discovery invoked no Gateway operation. Receipt: `artifacts/validation/mcp-stdio.json`. The sandbox's ordinary child-process pipes silently lost output even for a plain Node control process; supported elevated execution passed without a product change.

Canonical autoreview reviewed the full fixed source snapshot in two passes and returned `scoped-clean` at **P0/P1**. This is a scoped assessment, not a claim of absence of all defects. The reviewer could not independently access the exact host SDK release; the official-host installation proof addresses that boundary separately. Subsequent wallet pin projection, setup wording, and minimum-host metadata corrections received an independent source review with no material finding. Results: `artifacts/validation/review.txt` and `review-status.json`.

## Official host

The final tarball was installed through the released OpenClaw **2026.10.5 (1b58cb9)** managed `npm-pack:` installer, using its normal local-source confirmation and reviewed capability acceptance. No install-policy override was used. The initial install found an invalid bare `minHostVersion`; the candidate now declares the required `>=2026.10.5` form and the real installer passed.

`plugins inspect cypher --runtime --json` reported `loaded`, no diagnostics, the Cypher service, **21 Gateway methods**, hashed Control UI assets, and the MCP descriptor. A task-owned Gateway with private temporary state/config and a free loopback port passed health, `cypher.setup.status`, and `cypher.status`. These were real official-host calls, not the browser fixture. Operator Gateway/state were not used.

`cypher.transfers.list {}` returned `{"transfers":[]}` through that managed package, exercising its compiled SQLite worker without a prepared node or IPC connection. A proof-only directory assertion initially mistook packaged `assets/native` metadata for downloaded `state/native`; the fixture was corrected, and the explicit-endpoint transfer read passed. No native runtime was downloaded automatically. The task-owned Gateway was stopped and private state/config/cache were removed after validation. Receipt: `artifacts/validation/official-host.json`.

## Platform and publication limits

Node artifacts are available for Linux x64, macOS ARM64, and Windows x64 (including five pinned DLLs). Other listed targets support only the independent wallet generator. Windows/macOS native process behavior was not exercised on real devices. Live chain synchronization, mining, and funded transfers were not performed.

Official OpenClaw 2026.10.5 is the supported host for this candidate. Custom plugin UI requires the host's Labs setting. Do not enable this plugin beside CypherClaw's built-in `cypher.*` implementation. ClawHub ownership, registry scanning, and publication have not been performed.
