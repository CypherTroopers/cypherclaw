import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CYPHERCLAW_SOURCE_BRANCH } from "./cypherclaw-contract.mjs";
import { assertRealOutputRoot } from "./output-root-guard.mjs";

const METADATA = "cypher/patches/transaction-finality-source.json";
const LEDGER = "cypher/SHA256SUMS";
const METADATA_LEDGER_LINE = /^([a-f0-9]{64}) {2}patches\/transaction-finality-source\.json$/gmu;
const SNAPSHOT_REF = "refs/heads/cypherclaw-release-snapshot";
const AUTOMATION_IDENTITY =
  "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>";

function requireCommit(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(`${label} must be a full lowercase 40-character Git commit SHA`);
  }
}

async function git(root, args, { input, env = {}, allowedExitCodes = [] } = {}) {
  const childEnv = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
    delete childEnv[name];
  }
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: root,
      env: { ...childEnv, ...env, GIT_NO_REPLACE_OBJECTS: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0 || allowedExitCodes.includes(code)) {
        resolve(stdout);
      } else {
        reject(new Error(`git ${args.join(" ")} failed (${code ?? signal}): ${stderr.trim()}`));
      }
    });
    child.stdin.end(input);
  });
}

async function requireCleanHead(root, sourceCommit) {
  if ((await git(root, ["rev-parse", "HEAD"])).trim() !== sourceCommit) {
    throw new Error("The selected release source SHA is not the current checkout HEAD");
  }
  if ((await git(root, ["status", "--porcelain", "--untracked-files=normal"])).trim()) {
    throw new Error("Release source preparation and verification require a clean checkout");
  }
}

async function requireStableCommit(root, sourceCommit) {
  await git(root, [
    "merge-base",
    "--is-ancestor",
    sourceCommit,
    `origin/${CYPHERCLAW_SOURCE_BRANCH}`,
  ]);
}

async function requireUnusedSnapshotRef(root) {
  const symbolic = await git(root, ["symbolic-ref", "--quiet", SNAPSHOT_REF], {
    allowedExitCodes: [1],
  });
  const direct = await git(root, ["rev-parse", "--verify", "--quiet", SNAPSHOT_REF], {
    allowedExitCodes: [1],
  });
  if (symbolic.trim() || direct.trim()) {
    throw new Error(`Release source preparation requires an unused temporary ref: ${SNAPSHOT_REF}`);
  }
}

function readMetadata(text) {
  const metadata = JSON.parse(text);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Invalid Cypher transaction finality source metadata");
  }
  return metadata;
}

async function snapshotInputs(
  root,
  reviewedSourceCommit,
  nativeSourceCommit,
  nativeDistributionCommit,
) {
  const original = await git(root, ["show", `${reviewedSourceCommit}:${METADATA}`]);
  const metadata = readMetadata(original);
  if (Object.hasOwn(metadata, "releaseInputs")) {
    throw new Error("The reviewed stable source already contains a release snapshot stamp");
  }
  const originalLedger = await git(root, ["show", `${reviewedSourceCommit}:${LEDGER}`]);
  const entries = [...originalLedger.matchAll(METADATA_LEDGER_LINE)];
  if (
    entries.length !== 1 ||
    entries[0][1] !== createHash("sha256").update(original).digest("hex")
  ) {
    throw new Error("The reviewed source metadata differs from its retained checksum ledger");
  }
  const stamped = `${JSON.stringify(
    {
      ...metadata,
      releaseInputs: { reviewedSourceCommit, nativeSourceCommit, nativeDistributionCommit },
    },
    null,
    2,
  )}\n`;
  const ledger = originalLedger.replace(
    METADATA_LEDGER_LINE,
    `${createHash("sha256").update(stamped).digest("hex")}  patches/transaction-finality-source.json`,
  );
  const timestamp = (await git(root, ["show", "-s", "--format=%ct", reviewedSourceCommit])).trim();
  if (!/^[0-9]+$/u.test(timestamp)) {
    throw new Error("The reviewed source has an invalid commit timestamp");
  }
  return { stamped, ledger, timestamp };
}

function snapshotCommit(
  tree,
  reviewedSourceCommit,
  nativeSourceCommit,
  nativeDistributionCommit,
  timestamp,
) {
  // Fixed identity and parent-derived dates make the same reviewed inputs one release.
  return [
    `tree ${tree}`,
    `parent ${reviewedSourceCommit}`,
    `author ${AUTOMATION_IDENTITY} ${timestamp} +0000`,
    `committer ${AUTOMATION_IDENTITY} ${timestamp} +0000`,
    "",
    `chore(release): snapshot native source ${nativeSourceCommit}`,
    "",
    `Reviewed CypherClaw source: ${reviewedSourceCommit}`,
    `Native Cypher source: ${nativeSourceCommit}`,
    `Native Cypher distribution: ${nativeDistributionCommit}`,
    "",
  ].join("\n");
}

/** Admit ordinary stable source or the exact deterministic metadata-only descendant. */
export async function verifyCypherClawReleaseSource({ root, sourceCommit }) {
  requireCommit(sourceCommit, "Release source commit");
  root = path.resolve(root);
  await requireCleanHead(root, sourceCommit);
  const metadata = readMetadata(await git(root, ["show", `${sourceCommit}:${METADATA}`]));
  if (!Object.hasOwn(metadata, "releaseInputs")) {
    await requireStableCommit(root, sourceCommit);
    await requireCleanHead(root, sourceCommit);
    return null;
  }
  const inputs = metadata.releaseInputs;
  if (
    !inputs ||
    typeof inputs !== "object" ||
    Array.isArray(inputs) ||
    Object.keys(inputs).length !== 3
  ) {
    throw new Error("Invalid CypherClaw release snapshot inputs");
  }
  const { reviewedSourceCommit, nativeSourceCommit, nativeDistributionCommit } = inputs;
  requireCommit(reviewedSourceCommit, "Reviewed CypherClaw source commit");
  requireCommit(nativeSourceCommit, "Native Cypher source commit");
  requireCommit(nativeDistributionCommit, "Native Cypher distribution commit");
  const parents = (await git(root, ["show", "-s", "--format=%P", sourceCommit])).trim();
  if (parents !== reviewedSourceCommit) {
    throw new Error("The release snapshot must have only the reviewed stable source as parent");
  }
  await requireStableCommit(root, reviewedSourceCommit);
  const changed = (
    await git(root, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "--no-renames",
      "-r",
      reviewedSourceCommit,
      sourceCommit,
    ])
  )
    .trim()
    .split("\n");
  if (changed.length !== 2 || !changed.includes(METADATA) || !changed.includes(LEDGER)) {
    throw new Error("Release snapshots may change only native selection metadata and its checksum");
  }
  const expected = await snapshotInputs(
    root,
    reviewedSourceCommit,
    nativeSourceCommit,
    nativeDistributionCommit,
  );
  for (const [file, content] of [
    [METADATA, expected.stamped],
    [LEDGER, expected.ledger],
  ]) {
    const blob = (await git(root, ["hash-object", "--stdin"], { input: content })).trim();
    if (
      (await git(root, ["ls-tree", sourceCommit, "--", file])) !== `100644 blob ${blob}\t${file}\n`
    ) {
      throw new Error(`The release snapshot does not contain canonical ${file} bytes and mode`);
    }
  }
  const tree = (await git(root, ["show", "-s", "--format=%T", sourceCommit])).trim();
  const expectedCommit = snapshotCommit(
    tree,
    reviewedSourceCommit,
    nativeSourceCommit,
    nativeDistributionCommit,
    expected.timestamp,
  );
  if ((await git(root, ["cat-file", "commit", sourceCommit])) !== expectedCommit) {
    throw new Error("The release snapshot commit identity is not deterministic and canonical");
  }
  await requireCleanHead(root, sourceCommit);
  return { sourceCommit, reviewedSourceCommit, nativeSourceCommit, nativeDistributionCommit };
}

/** Build a real release commit without moving the stable branch or committing binaries. */
export async function createCypherClawReleaseSource({
  root,
  sourceCommit,
  nativeSourceCommit,
  nativeDistributionCommit,
  outputDir,
}) {
  requireCommit(sourceCommit, "Reviewed CypherClaw source commit");
  requireCommit(nativeSourceCommit, "Native Cypher source commit");
  requireCommit(nativeDistributionCommit, "Native Cypher distribution commit");
  root = path.resolve(root);
  outputDir = path.resolve(outputDir);
  await requireCleanHead(root, sourceCommit);
  await requireStableCommit(root, sourceCommit);
  await requireUnusedSnapshotRef(root);
  const inputs = await snapshotInputs(
    root,
    sourceCommit,
    nativeSourceCommit,
    nativeDistributionCommit,
  );
  assertRealOutputRoot(outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  if ((await fs.readdir(outputDir)).length) {
    throw new Error("Release source preparation requires an empty output directory");
  }
  const privateIndex = await fs.mkdtemp(path.join(outputDir, ".source-index-"));
  let snapshot;
  try {
    const env = { GIT_INDEX_FILE: path.join(privateIndex, "index") };
    await git(root, ["read-tree", sourceCommit], { env });
    for (const [file, content] of [
      [METADATA, inputs.stamped],
      [LEDGER, inputs.ledger],
    ]) {
      const blob = (await git(root, ["hash-object", "-w", "--stdin"], { input: content })).trim();
      await git(root, ["update-index", "--add", "--cacheinfo", "100644", blob, file], { env });
    }
    const tree = (await git(root, ["write-tree"], { env })).trim();
    snapshot = (
      await git(root, ["hash-object", "-t", "commit", "-w", "--stdin"], {
        input: snapshotCommit(
          tree,
          sourceCommit,
          nativeSourceCommit,
          nativeDistributionCommit,
          inputs.timestamp,
        ),
      })
    ).trim();
  } finally {
    await fs.rm(privateIndex, { recursive: true, force: true });
  }
  await requireCleanHead(root, sourceCommit);
  await requireUnusedSnapshotRef(root);
  await git(root, ["checkout", "--quiet", "--detach", snapshot]);
  const identity = await verifyCypherClawReleaseSource({ root, sourceCommit: snapshot });
  // A temporary exact-CAS ref gives the differential bundle a named import target.
  await git(root, ["update-ref", "--no-deref", SNAPSHOT_REF, snapshot, "0".repeat(40)]);
  try {
    await git(root, [
      "bundle",
      "create",
      path.join(outputDir, "cypherclaw-source.bundle"),
      SNAPSHOT_REF,
      `^${sourceCommit}`,
    ]);
  } finally {
    await git(root, ["update-ref", "--no-deref", "-d", SNAPSHOT_REF, snapshot]);
  }
  await requireCleanHead(root, snapshot);
  return identity;
}
