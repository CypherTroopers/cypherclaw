# Third-party notices

The MIT license at this project's root covers original project files only. It does not replace the licenses of imported libraries or the Go toolchain.

The direct dependency is:

- `github.com/ethereum/go-ethereum v1.17.6`: the imported Go library is licensed under LGPL-3.0-or-later. Source and notices: https://github.com/ethereum/go-ethereum/tree/v1.17.6, including `COPYING.LESSER` and `COPYING`.

Its transitive dependencies retain their respective licenses. The resolved graph is recorded by `go.mod` and `go.sum`; retain both files when distributing source.

The release script copies recognized license/notice files from the vendored dependencies into each binary ZIP. It also publishes the project source and vendored dependency source in `coldwalletgenerator-source-with-dependencies.tar.gz`, with instructions to rebuild and use modified library code. Do not omit that corresponding source or the dependency notices when redistributing release packages.

Go toolchain source and license are available at https://go.dev/dl/ and https://go.dev/LICENSE. The build toolchain version is recorded in `BUILDINFO.txt`.

Maintainers remain responsible for reviewing the final dependency inventory and distribution obligations before publishing or redistributing binaries. This notice is not a claim that an unbuilt source snapshot has passed a licensing audit.
