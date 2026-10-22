# Maintain CypherClaw from official stable releases

CypherClaw takes upstream source from published OpenClaw stable tags and retains its own Cypher, wallet, and branding changes. Maintainers prepare each intake in an isolated checkout, review and verify it, then publish the reviewed fork branch. Source users update from the CypherTroopers repository.

This file owns the fork's source provenance and intake procedure. Update the upstream tag and commit together whenever a new stable intake is adopted. The CLI/package/config identity remains `openclaw`; the displayed product name remains CypherClaw, with upstream licensing and notices preserved.

## Pinned source

| Source                  | Pin                                                                          |
| ----------------------- | ---------------------------------------------------------------------------- |
| Official repository     | `https://github.com/openclaw/openclaw.git`                                   |
| Official stable release | [`v2026.10.6`](https://github.com/openclaw/openclaw/releases/tag/v2026.10.6) |
| Official peeled commit  | `fe06181dc5ecc01cf8904abbfc26925925efefbc`                                   |
| Fork repository         | `https://github.com/CypherTroopers/cypherclaw.git`                           |

### Initial stable migration

The initial `v2026.9.9` candidate applied the aggregate changes from nine fork commits onto that stable release:

- Previous fork head: `4ec3b02f83e6e7b6d60def9006aa95026cf74dea`.
- Previous official development base: `12dd488dfeffcc6529e9a02e8ffe99920358ffe4`.
- Original fork commits, in order: `3e4b90c6d107`, `e1fccef528b9`, `79c02d9de3b8`, `8d3d6c4b69cc`, `c27acef584b8`, `fba81f9cbd74`, `93a7b3e9d750`, `bdd9f88d28f2`, `4ec3b02f83e6`.

The development commits between the stable release and the previous development base are excluded. The original fork history remains on the existing `main`; the candidate has stable ancestry and is not its descendant. Adoption requires choosing a fork branch publication and default-branch transition explicitly. Preparing this source does not change remote branches, publish a release, or replace a running Gateway.

The initial `v2026.9.9` candidate declared shared state schema **19** and agent schema **24**. The previous development-based source declared state schema **20**. A source version does not prove which schema an operator's databases contain. Use isolated state for candidate verification. Before switching an existing installation, verify its actual schemas and choose a supported recovery or separate-state path. Never lower database schema markers or edit SQL to make newer state open in an older release. See the [database recovery contract](docs/reference/database-schemas/integrity-and-recovery.md).

### October stable intake

The `v2026.10.1` intake uses official commit `e178c39e9aae3fa440735217f9aef9574f286677` and the reviewed fork delta through `d6ed2b8ee9975da15558419fc4982b351aba2eb7`. The September and October stable lines diverge, so the candidate tree reapplies the fork delta relative to `bcfc88812a35243893585dbeca87ca41b48272ca` onto the October release. Its merge commit preserves the existing fork history and records the new official commit as a parent; it does not replay September-only upstream changes onto October.

This source declares shared state schema **20** and agent schema **24**. Existing migration, backup, admission, and rollback owners control the upgrade. The additive Cypher transfer table remains in the profile's canonical state database, and the node data and IPC paths retain their existing contracts. Upstream build-time generation owns Kysely declarations and native localization outputs; retired generated source files are not restored.

### October patch intake

The `v2026.10.2` intake merges official commit `b8952d477f0c932d8ddc6da5c89cab5a169b6ff1` into fork head `0f305c46b627e1dd55246b914967b2df2bdd1365`. The previous official `v2026.10.1` commit is its ancestor, so this intake uses a regular merge and retains both histories. It includes 105 upstream commits across 655 files. The only content conflict is the database-worker test inventory: both the Cypher transfer-store test and the upstream prompt-cache test retain their worker routing.

Shared state schema **20** and agent schema **24** remain unchanged. The intake retains Cypher and wallet operations, node data and IPC paths, CypherClaw branding, fork package inventory, standalone installers, and the packaged fork's GitHub Releases update identity. Source intake does not deploy a Gateway or publish distribution artifacts.

### October 2026.10.5 intake

The `v2026.10.5` intake reapplies the reviewed fork delta through `1716a4133adbacb2f70fbc1b02c8df4bf7537d4f`, relative to official `v2026.10.2` commit `b8952d477f0c932d8ddc6da5c89cab5a169b6ff1`, onto official `1b58cb9a1b4f4353e1add63c8506db4d890962e8`. The official release lines diverge, so older upstream changes are not merged wholesale into this candidate. The integration commit retains the prior fork and new official histories as its two parents.

The ColossusX Overview, Node, Wallets, Send, Mining, and Explorer tabs retain their layout and operations, along with the independent wallet generator and custom logo assets. The intake preserves the packaged fork's GitHub Releases identity and the published CypherClaw 10.1 and 10.2 updaters' compatibility modules, while retaining upstream update recovery and worker admission changes.

Shared state remains schema **20**; agent databases migrate from **24** to **25** through the official migration and backup owners. Preserve a verified pre-upgrade backup before activating this source against existing state. After migration, returning to the previous binary requires restoring its matching backup; a package-only rollback cannot reopen schema 25, and writes made after the backup are not retained. See the [schema migration and recovery contract](docs/reference/database-schemas/agent-schema-history.md#canonical-writer-validation). This source intake does not activate a live Gateway or publish a release.

Validation in the isolated intake checkout included the complete `pnpm build`, core/UI/scripts/extensions type checks, final package-boundary SDK declaration generation, 432 related runtime and update tests across 28 files, 299 theme/UI/favicon tests, and 73 tests after the final lazy-catalog changes. Browser checks exercised the six node tabs, wallet locking and generation, reviewed send/finality, mining signer and reward selection, explorer links, favicon, desktop branding, and 390-pixel layouts with synthetic data. All 181 custom branding assets retain their pre-intake bytes; the native icon generator check also verified 152 resources. The pre-commit UI startup payload measured **373424 B gzip**, within the unchanged **373454 B** hard limit. After the final type/fixture moves, the three affected package-update and wizard files passed all 79 tests. These groups overlap; their counts are not a unique aggregate.

Scoped lint passed all 232 selected source, test, and build-script files after adapting retained scripts to the upstream rules. Database-worker admission, generated Kysely declarations, native localization, and workflow static checks passed. Independent reviews of the integration and subsequent fixes found no actionable P0/P1 findings.

The published CypherClaw `2026.10.2` artifact at `ec944b6de83cb69969388c4b0d19ceae11d2b21b` was seal/source-verified. A narrow published-driver × candidate cleanup probe confirmed the cached owner and pending-disposer ordering survive the compatibility-module replacement, without modifying the released artifact. This proves the cleanup bridge, not a complete installation upgrade.

Inherited static-check findings remain explicit: `check:max-lines-ratchet --staged --base 1b58cb9a1b4f4353e1add63c8506db4d890962e8` rejects the upstream `src/commands/doctor-memory-search.test.ts` suppression (1045 counted lines against its 1000-line cap); that file is byte-identical to the official tag. A full `git diff --cached --check` against the tag also reports whitespace in 28 retained vendor, license, and provenance files, all byte-identical to the previous fork head. No baseline, threshold, or ignore exceptions were added. Native app builds/device behavior, OS-specific installation acceptance, and a live Gateway upgrade were not exercised.

### October 2026.10.6 intake

The `v2026.10.6` intake merges official `fe06181dc5ecc01cf8904abbfc26925925efefbc` into fork head `647c893f98200d638971d38003052361a053c5f3`. Official `v2026.10.5` is its ancestor, so this regular merge retains both histories and all nine intervening fork commits. The official delta contains 294 commits across 1,669 files.

The four content conflicts combine the fork's About, Cypher, and wallet catalogs with upstream lazy catalog declarations and Secrets composition; use the upstream shared approval terminal-message owner with CypherClaw copy; and keep both install/restart failure coverage and the fork's failed-Gateway TUI launch guard. The Cypher English catalog is also included in its owner's source-hash dependencies. Node data and IPC paths, the updated genesis, unlocking any local account, physical Gateway shutdown verification, custom branding, wallet generation, and the six ColossusX tabs remain part of the fork.

Shared state schema **20**, agent schema **25**, and update admission protocol **1** are unchanged. Existing migration, backup, admission, and rollback owners continue to control deployment. Upstream raises the source runtime floor to Node **24.22.1** or **26.12.1** and pins pnpm **12.15.0**. Fork installers and release jobs use private Node **24.22.1**. Historical manifests declaring **24.21.0** remain readable for baseline verification; new releases advertise their actual **24.22.1** runtime.

**Packaged upgrade limitation:** published fork updaters that require manifest Node **24.21.0** reject a new **24.22.1** manifest before downloading the candidate. Candidate compatibility modules cannot repair that earlier gate. Those installations need a verified installer migration, or a separately prepared and authorized bridge release, before accepting this runtime transition. Do not rewrite the new manifest to advertise an unsupported runtime. Full installation migration and a published-driver × candidate upgrade have not been proven by this source intake. Preparing this source does not publish a release or activate a live Gateway.

Validation used an independent physical dependency installation with the frozen lockfile. The complete build passed in **10m 56.7s**, and the supported CLI entry point reported **2026.10.6** with isolated state. The UI startup payload measured **371704 B gzip**, within the unchanged **373454 B** hard limit. All 268 custom branding assets retain their previous bytes, and the native icon generator verified 152 resources. Synthetic browser checks captured 32 desktop/mobile before-and-after screenshots: all 14 Cypher-tab and wallet-generator pairs were byte-identical; the About page changed only its release version. These checks cover real components and controllers with an isolated Gateway fixture, not a live chain or a complete application handshake.

The latest complete attempt for each selected test file passed **319 tests across 17 files**. The first completed run exposed one stale `OpenClaw apps` expectation after the shared approval message retained fork branding. Correcting that expectation to `CypherClaw apps` preserved the expiry, no-change, fresh-request, and explicit-approval assertions; all 27 approval tests then passed. The affected approval and wizard groups took **124.39s** and **37.23s** respectively with one worker. Release validation passed 21 tests in **210ms** of test time within its **29.13s** tooling group, including the current runtime floor and both historical/current sealed manifests. CI duration was not measured. The original run took **404.98s**; the corrected suite and four previously unrun files took **296.41s**. Passing unaffected groups were reused.

Core, UI, scripts, and extensions type checks and scoped type-aware lint passed. The lint prerequisite initially exceeded its five-minute SDK declaration budget. Using the existing supported ten-minute compiler-preparation budget completed declaration generation and the same lint commands; source thresholds and test timeouts were unchanged. Workflow static checks, keyless i18n validation, native state-schema verification, formatting, and whitespace checks passed. Independent scoped integration review and review of the final assertion correction found no actionable P0/P1 findings.

The first sandbox build stopped in postbuild without child diagnostics. The official postbuild entry point and then the complete build passed on the supported host with the same production tree; the sandbox failure remains unclassified. An earlier test preparation attempt overlapped build output mutation and rejected its package topology before discovering tests; serializing artifact preparation and tests removed that fixture conflict. Native application builds, real-device behavior, OS-specific installer migration, and a live Gateway upgrade were not exercised.

## Prepare the next stable intake

Start with a clean checkout of the reviewed fork branch and verify `origin` is the CypherTroopers repository. Confirm the selected official release is published, is not a draft or prerelease, and belongs to the regular stable channel. Record its full peeled commit from the official tag. Moving official `main` and `release/*` branch tips are not intake targets.

Fetch only the selected tag into a private reference. Replace the example tag with the release selected for this intake:

```sh
cypherclaw_tag=v2026.10.6
git fetch --no-tags --no-write-fetch-head https://github.com/openclaw/openclaw.git \
  "refs/tags/${cypherclaw_tag}:refs/cypherclaw/upstream/${cypherclaw_tag}"
git rev-parse "refs/cypherclaw/upstream/${cypherclaw_tag}^{commit}"
```

Compare the resolved full commit with the official release pin before continuing. A moved or mismatched tag requires investigation. These private references keep official intake tags separate from fork release tags; importing them into `refs/tags` can expose them to the inherited Git updater's release selection.

Create an isolated intake branch from the reviewed fork head. Check whether the previous pinned official commit is an ancestor of the new official commit:

```sh
git merge-base --is-ancestor <PREVIOUS_OFFICIAL_COMMIT> <NEW_OFFICIAL_COMMIT>
```

If it succeeds, merge the pinned commit into that isolated branch with `git merge --no-ff --no-commit <NEW_OFFICIAL_COMMIT>`. Resolve conflicts at their owners, preserving the official release behavior and the fork additions. If it fails, the release lines diverge: rebuild an isolated candidate from the new stable commit and replay the reviewed fork delta. Do not merge the old development-based branch into a stable candidate or choose one side wholesale to clear conflicts.

Verify the Cypher node controls, IPC behavior, wallet generation, bundled assets, package metadata, and branding affected by the intake. Run the relevant build, checks, and tests; obtain fresh review before committing nontrivial code. Update this file's source pin and record validation in the task or PR. Preserve the prior working installation and its data until deployment acceptance. Publish only the reviewed branch to the verified fork repository, with publication authority; never push intake refs or tags to the official repository.

## Update a source installation

Source users update from the reviewed `cypherclaw-stable` branch in the CypherTroopers repository. Verify `origin` and the checked-out branch before using a fast-forward-only pull:

```sh
git remote get-url origin
git status -sb
git pull --ff-only origin cypherclaw-stable
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` includes the Control UI build. Dependency installation and rebuilding are update-time work; an unchanged configured checkout normally starts with `pnpm openclaw gateway run`. Follow the existing process manager's lifecycle when activating rebuilt code. Changing or restarting an existing live Gateway requires the operator's approval and compatible state.

The inherited `openclaw update` command is not the fork's upstream intake procedure. Unmarked source/official package installs retain upstream registry and channel behavior. Keep source installation updates on the reviewed fork branch. Packages produced by the [CypherClaw release builder](CYPHERCLAW_DISTRIBUTION.md) carry distribution metadata: their CLI and Control UI update path selects this fork's stable GitHub Releases, verifies the artifact, and uses the existing package update lifecycle. This marker is added only to the packaged artifact; it does not change the source checkout's update identity.

## Keep official publication with its owner

The docs publication, release translation dispatch, and website installer publication jobs run only in `openclaw/openclaw`. Generic installer validation remains available in the fork. Other inherited official publication workflows retain their own credentials, package identities, environments, and approval contracts; they do not establish CypherClaw release or installer capability. A fork distribution workflow must explicitly own its destinations and artifacts before use.
