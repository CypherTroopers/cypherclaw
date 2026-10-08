# Third-party notices

This plugin includes separately licensed native executables and source materials. The plugin's [MIT license](LICENSE), with the original OpenClaw Foundation copyright notice, covers the OpenClaw-derived plugin code. It does not replace the licenses of the bundled Cypher node, wallet generator, or their dependencies.

## Browser components

The built browser bundle includes Lit 3.3.3, lit-html 3.3.3, lit-element 4.2.2,
and @lit/reactive-element 2.1.2. Their original BSD-3-Clause license texts and
Google LLC copyright notices are retained under `assets/browser-licenses/`.
The bundle also retains upstream legal comments.

## Cypher node

The node executables come from [CypherTroopers/cypher](https://github.com/CypherTroopers/cypher), source commit `60b8164405a4d5531c65f778e5661b9272cedbc2`, distributed in commit `e07269480dd29b0a2b2ffa665a119c70f2e56764`. The [original successful build](https://github.com/CypherTroopers/cypher/actions/runs/37360945224) produced the exact binaries preserved here. The node command's source header credits **The cypherium Authors (2020)** and grants **GPL-3.0-or-later**. Many library source files retain **The go-ethereum Authors** copyright notices and **LGPL-3.0-or-later** terms. Additional components have their own notices in their source files.

[assets/cypher/BUILDINFO.txt](assets/cypher/BUILDINFO.txt) records the source and distribution pins, platform requirements, original CI artifact hashes, dependency versions, and evidence limits. Unmodified artifact manifests and checksums are under `assets/cypher/provenance/`. [assets/cypher/SHA256SUMS](assets/cypher/SHA256SUMS) identifies the packaged files.

[assets/cypher/cypher-source-60b8164-with-go-dependencies.tar.gz](assets/cypher/cypher-source-60b8164-with-go-dependencies.tar.gz) includes the relevant upstream project source, build scripts, bounded LevelDB patch, source for the 74 Go modules recorded in the binaries, pinned Herumi BLS/MCL sources, upstream GMP 6.3.0 source, and original source notices. The archive excludes browser-llm-lab, operational data, prebuilt artifacts, and executable dependency test fixtures; its inventory records those exclusions. Downloaded Go module sums were checked before this source-only assembly. The source archive is a distribution artifact and is not loaded by the plugin at runtime.

Included dependency notices and evidence:

- **Go 1.26.2:** the Go Authors' BSD-style license is in `assets/cypher/licenses/go1.26.2-LICENSE`.
- **Herumi BLS and MCL:** their exact pinned READMEs declare the modified new BSD license (BSD-3-Clause); these are retained under `assets/cypher/licenses/`, and the source archive preserves their copyright headers and incorporated source notices.
- **GNU GMP 6.3.0:** upstream license texts and author credits are in `assets/cypher/licenses/gmp-*`. The original GMP source archive is included. The Windows package metadata declares LGPL3 and GPL; this notice does not relicense its contents.
- **OpenSSL 3.6.4:** the exact Windows package's Apache-2.0 license is retained under `assets/cypher/provenance/msys2/mingw-w64-x86_64-openssl-3.6.4-1-any/`.
- **GCC 16.2.0 runtime libraries:** the exact Windows packages' GPLv3 and GCC Runtime Library Exception 3.1 texts are retained in their respective `provenance/msys2/` directories.
- **MinGW-w64 winpthreads:** the exact Windows package's MIT and BSD-3-Clause-Clear notices are preserved in its `provenance/msys2/` directory.
- **Go modules:** individual copyright and license files are retained with their source. `assets/cypher/provenance/go-modules.tsv` identifies the exact module versions, Go module sums, and original download archive hashes.

All five Windows DLLs were matched byte-for-byte against their original versioned MSYS2 packages. Their `PKGINFO`, `BUILDINFO`, available license files, and package download hashes are preserved. CI log excerpts identify the native package versions used for all three operating systems.

**The native node redistribution materials remain incomplete.** This local package does not claim to contain every native dependency's complete corresponding source, distribution patches, build recipes, or static relinking materials. Exact GCC, OpenSSL, MinGW-w64, and distribution-specific GMP source/build materials remain to be assembled and reviewed before publication. The bundled upstream GMP source and the recorded package provenance do not establish that completeness. Whole-project vendoring and offline rebuilding were not proven; the detailed limitations are recorded in `assets/cypher/BUILDINFO.txt`. These gaps originate in the existing native binary distribution and are recorded here explicitly.

## Offline wallet generator

The independent wallet generator comes from [CypherTroopers/offlinewalletgenerator](https://github.com/CypherTroopers/offlinewalletgenerator), distribution commit `63dfd53949c5b7523e42369251512fd7e8a2f0d6` and source commit `8879d9e4c0490999096bb299a0e2da31a1b20e50`. The original 33-file asset distribution is preserved without changes under `assets/wallet-generator/`.

Its [LICENSE](assets/wallet-generator/LICENSE), [upstream third-party notices](assets/wallet-generator/THIRD_PARTY_NOTICES.md), [build information](assets/wallet-generator/BUILDINFO.txt), dependency license texts, and [source archive](assets/wallet-generator/coldwalletgenerator-source-with-dependencies.tar.gz) are included. The original project files use the MIT license, copyright 2026 CypherTroopers; the imported go-ethereum library uses LGPL-3.0-or-later, and other dependencies retain their own licenses. `assets/wallet-generator/bin/SHA256SUMS` pins the six platform executables. Refer to those notices and source files for their individual copyright and licensing terms.

The wallet generator's source archive and notices are independent of the node's native source-distribution gaps described above.
