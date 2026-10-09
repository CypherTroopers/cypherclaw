# Maintain CypherClaw from official stable releases

CypherClaw takes upstream source from published OpenClaw stable tags and retains its own Cypher, wallet, and branding changes. Maintainers prepare each intake in an isolated checkout, review and verify it, then publish the reviewed fork branch. Source users update from the CypherTroopers repository.

This file owns the fork's source provenance and intake procedure. Update the upstream tag and commit together whenever a new stable intake is adopted. The CLI/package/config identity remains `openclaw`; the displayed product name remains CypherClaw, with upstream licensing and notices preserved.

## Pinned source

| Source                  | Pin                                                                        |
| ----------------------- | -------------------------------------------------------------------------- |
| Official repository     | `https://github.com/openclaw/openclaw.git`                                 |
| Official stable release | [`v2026.9.9`](https://github.com/openclaw/openclaw/releases/tag/v2026.9.9) |
| Official peeled commit  | `bcfc88812a35243893585dbeca87ca41b48272ca`                                 |
| Fork repository         | `https://github.com/CypherTroopers/cypherclaw.git`                         |

### Initial stable migration

The initial candidate applies the aggregate changes from nine fork commits onto the pinned stable release:

- Previous fork head: `4ec3b02f83e6e7b6d60def9006aa95026cf74dea`.
- Previous official development base: `12dd488dfeffcc6529e9a02e8ffe99920358ffe4`.
- Original fork commits, in order: `3e4b90c6d107`, `e1fccef528b9`, `79c02d9de3b8`, `8d3d6c4b69cc`, `c27acef584b8`, `fba81f9cbd74`, `93a7b3e9d750`, `bdd9f88d28f2`, `4ec3b02f83e6`.

The development commits between the stable release and the previous development base are excluded. The original fork history remains on the existing `main`; the candidate has stable ancestry and is not its descendant. Adoption requires choosing a fork branch publication and default-branch transition explicitly. Preparing this source does not change remote branches, publish a release, or replace a running Gateway.

The candidate declares shared state schema **19** and agent schema **24**. The previous development-based source declares state schema **20**. A source version does not prove which schema an operator's databases contain. Use isolated state for candidate verification. Before switching an existing installation, verify its actual schemas and choose a supported recovery or separate-state path. Never lower database schema markers or edit SQL to make newer state open in this candidate. See the [database recovery contract](docs/reference/database-schemas/integrity-and-recovery.md).

## Prepare the next stable intake

Start with a clean checkout of the reviewed fork branch and verify `origin` is the CypherTroopers repository. Confirm the selected official release is published, is not a draft or prerelease, and belongs to the regular stable channel. Record its full peeled commit from the official tag. Moving official `main` and `release/*` branch tips are not intake targets.

Fetch only the selected tag into a private reference. Replace the example tag with the release selected for this intake:

```sh
cypherclaw_tag=v2026.9.9
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
