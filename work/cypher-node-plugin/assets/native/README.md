# Immutable native downloads

`src/native/pins.ts` owns the runtime download URLs, sizes, and SHA-256 pins.
Setup downloads only the Gateway host's artifacts. It does not clone repositories,
follow branch tips, or download tools at plugin import, startup, or status reads.
Chain data and keystores stay outside these replaceable runtime directories.

Cypher node distribution:
`CypherTroopers/cypher@9ca4b9793d6e3527f4439ab4cc29a500a160c134`.
Its three target manifests identify build source
`546d43442e8156591786dc3c1ca1596f014509e3`. Setup retains the host's
manifest, Go build information, and checksum ledger alongside the executable
(plus the five Windows DLLs). Linux requires glibc 2.38 and GLIBCXX 3.4.32;
the macOS ARM64 build requires macOS 15. Setup verifies files without executing
them; platform runtime requirements are checked when the operator starts a tool.

Wallet downloads use the immutable available distribution
`CypherTroopers/offlinewalletgenerator@629b3122aab207a7d7149439101c571a3360eecf`.
All six executable sizes, SHA-256 values, and Git blob identities match the
retained CypherClaw artifacts originally recorded as distribution
`63dfd53949c5b7523e42369251512fd7e8a2f0d6`, historical source
`8879d9e4c0490999096bb299a0e2da31a1b20e50`.
The original commits no longer resolve in the public repository. The available
distribution rewrites adjacent build-info source fields to `031b794…` despite
the identical executable bytes; this does not establish a different binary
source. `wallet-build-info/` preserves the original retained per-target metadata,
including its historical source attribution, for those exact bytes. Setup copies
this metadata instead of downloading the contradictory rewritten files.

`browser-relay.sh` is the small helper required by the packaged POSIX launchers.
No downloaded executable, source archive, JSON installation state, or mutable
branch reference is included here. Existing third-party license notices remain
under `assets/cypher/licenses` and `assets/wallet-generator` and are copied to
the corresponding prepared runtime root.
