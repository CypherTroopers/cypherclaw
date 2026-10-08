# Bundled wallet generator

This directory contains the standalone generator used by **Generate wallet** at
the bottom of the Cypher page. It runs on the Gateway host and does not depend on
the Cypher node, its account store, mining, or IPC.

## Provenance

- Upstream: [CypherTroopers/offlinewalletgenerator](https://github.com/CypherTroopers/offlinewalletgenerator).
- Binary distribution commit: `63dfd53949c5b7523e42369251512fd7e8a2f0d6`.
- Binary source commit, recorded by every target's `build-info.json`:
  `8879d9e4c0490999096bb299a0e2da31a1b20e50`.
- Toolchain recorded in the binaries: Go `1.27.1`, `CGO_ENABLED=0`,
  `-trimpath`, `-buildvcs=false`.
- `bin/SHA256SUMS` and all six `build-info.json` files are unmodified upstream
  files. Each executable was downloaded from the fixed distribution commit and
  verified against both records. The Gateway also pins these digests in its
  source; adjacent metadata is not its source of trust.
- `BUILDINFO.txt` records metadata read from the executables without running them.

The binaries were copied without rebuilding them. Upstream native execution
evidence belongs to the [source commit's Actions run](https://github.com/CypherTroopers/offlinewalletgenerator/actions/runs/37563877724).
That evidence does not establish CypherClaw integration behavior on every OS.

## Included executables

Paths below are relative to the package root. The Gateway selects its own OS and
CPU, which can differ from those of the browser. It invokes the selected file
without arguments or a shell.

| Gateway host        | Executable                                                   |
| ------------------- | ------------------------------------------------------------ |
| Linux x64           | `wallet-generator/bin/linux-amd64/coldwalletgenerator`       |
| Linux ARM64         | `wallet-generator/bin/linux-arm64/coldwalletgenerator`       |
| macOS Intel         | `wallet-generator/bin/darwin-amd64/coldwalletgenerator`      |
| macOS Apple Silicon | `wallet-generator/bin/darwin-arm64/coldwalletgenerator`      |
| Windows x64         | `wallet-generator/bin/windows-amd64/coldwalletgenerator.exe` |
| Windows ARM64       | `wallet-generator/bin/windows-arm64/coldwalletgenerator.exe` |

The Unix files retain executable permissions. Windows files need no DLLs from the
Cypher node. `package.json` explicitly includes the six executables, provenance,
license files, and corresponding source archive.

## Corresponding source and licenses

Original generator code retains the upstream [MIT license](LICENSE). The imported
Go libraries retain their own licenses, including go-ethereum's LGPL-3.0-or-later.
Keep [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), `third-party-licenses/`, and
`coldwalletgenerator-source-with-dependencies.tar.gz` with the binaries when
redistributing them.

The source archive contains the exact binary source commit's project files,
tests, build scripts, and workflows, plus the dependency sources produced by
Go 1.27.1's `go mod vendor`. Dependencies were downloaded with
`GOSUMDB=sum.golang.org` and checked with `go mod verify`. It contains no wallet
output or prebuilt executables. The archive SHA-256 is recorded in `BUILDINFO.txt`.

License files recognized by the upstream release script are copied from those
dependencies. `GO-LICENSE` comes from Go 1.27.1. Supplemental notices cover the
source-only Ziren module at `1fe7b43fc4d614fbc539db0ce0877841a296e9c9`
([MIT](https://github.com/ProjectZKM/Ziren/blob/1fe7b43fc4d614fbc539db0ce0877841a296e9c9/LICENSE-MIT),
[Apache](https://github.com/ProjectZKM/Ziren/blob/1fe7b43fc4d614fbc539db0ce0877841a296e9c9/LICENSE-APACHE))
and its [attributed Solana serializer](https://github.com/blocto/solana-go-sdk/blob/v1.30.0/LICENSE).
Those supplemental notices are also present inside the archive.

To rebuild or use modified library code, extract the archive and install Go
1.27.1. Edit the relevant code under `vendor/`, then build without downloading
dependencies:

```sh
tar -xzf coldwalletgenerator-source-with-dependencies.tar.gz
cd coldwalletgenerator
CGO_ENABLED=0 GOPROXY=off GOSUMDB=off go build -mod=vendor -trimpath -buildvcs=false -o coldwalletgenerator .
```

On PowerShell, set `$env:CGO_ENABLED = "0"`, `$env:GOPROXY = "off"`, and
`$env:GOSUMDB = "off"`, then use the same `go build` flags with
`-o coldwalletgenerator.exe`. `GOOS` and `GOARCH` select another target. This
compiles a standalone executable; it does not generate a wallet. A modified
executable has a new digest and requires a reviewed update to the Gateway's
pinned artifact manifest before it can be used from the UI.
