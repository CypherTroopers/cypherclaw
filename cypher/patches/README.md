# IPC transaction finality patch

`transaction-finality-source.json` pins the FHS-D base commit and patch SHA256.
The patch adds `eth_getTransactionFinality(transactionHash) -> boolean` to the
full-node API and delegates to `BlockChain.IsFinalizedTransaction`. Only the
IPC transport may call it; HTTP, WebSocket, and in-process calls return JSON-RPC
error `-32601`. Receipt availability alone does not establish finality.

Build on each target's native host using the existing Cypher native builder:

```sh
bash cypher/patches/build-finality-node.sh \
  --source-dir /path/to/cypher \
  --output-dir /path/to/new/finality-build
```

The builder supports Linux x64, macOS ARM64, and Windows x64 under MSYS2. It
keeps the original checkout and bundled binaries unchanged, applies the patch
to a private checkout, and stages binaries and checksums under the output
directory. The native manifest records both the original source commit and
the patch checksum. Embedded Go build metadata and the final staged checksums
are written after that patch identity is recorded. Windows runtime DLLs remain
part of its native bundle.
The source patch and metadata must accompany redistributed artifacts.

The retained `cypher-source-60b8164-with-go-dependencies.tar.gz` archive has
SHA256 `884ba41ad79bc7264ca2fffe6e5c0a40ca00e138b8f21550b464da7bb9374291`.
Its native Go and build source matches the pinned FHS-D base; the intervening
changes affect built artifacts, ignore rules, and an example SearXNG config.
Keep that source archive, this patch, metadata, native manifests, checksums,
dependency notices, and licenses together when preparing the updated bundle.
The CypherClaw release workflow uses Go 1.26.2 on all three native hosts and
passes their target directories to the package builder's
`--native-artifacts-dir` input. Assembly updates package staging without
changing the clean reviewed source checkout. Windows compiler and runtime
packages are installed from the retained checksummed package identities so
the existing five runtime DLLs and their provenance remain consistent.

Run the focused API and existing core finality contract checks in the patched
source tree with its native libraries installed:

```sh
go test -mod=readonly ./eth ./core \
  -run '^(TestTransactionFinalityRegisteredIPC|TestIsFinalizedTransactionRejectsReceiptSyncLookupAheadOfStateHead)$' \
  -count=1 -timeout=2m
```

The registered API test uses an isolated IPC listener and in-memory chain. The
core test protects dedicated finalized indexing, receipt-only indexing,
canonical identity, and the full-state head. These tests do not prove a live
network transfer or native behavior on a different operating system. Older
bundled binaries do not implement the new API; clients must display finality
as unavailable instead of promoting receipt availability to completion.
