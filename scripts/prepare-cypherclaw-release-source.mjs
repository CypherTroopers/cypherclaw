#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { booleanFlag, parseFlagArgs, stringFlag } from "./lib/arg-utils.runtime.mjs";
import {
  createCypherClawReleaseSource,
  verifyCypherClawReleaseSource,
} from "./lib/cypherclaw-release-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return [
    "Usage: node scripts/prepare-cypherclaw-release-source.mjs --source-sha <reviewed SHA> --native-source-sha <native source SHA> --native-distribution-sha <native distribution SHA> --output-dir <directory>",
    "       node scripts/prepare-cypherclaw-release-source.mjs --verify --source-sha <snapshot SHA>",
    "",
    "Creates a deterministic metadata-only snapshot and a differential Git bundle.",
    "The output directory must be empty and outside the checkout or Git-ignored.",
    "Creation leaves a clean detached snapshot HEAD without changing cypherclaw-stable.",
    "--verify checks the current clean HEAD without creating commits or changing HEAD.",
  ].join("\n");
}

async function main() {
  const options = parseFlagArgs(
    process.argv.slice(2),
    {
      sourceSha: "",
      nativeSourceSha: "",
      nativeDistributionSha: "",
      outputDir: "",
      verify: false,
      help: false,
    },
    [
      stringFlag("--source-sha", "sourceSha"),
      stringFlag("--native-source-sha", "nativeSourceSha"),
      stringFlag("--native-distribution-sha", "nativeDistributionSha"),
      stringFlag("--output-dir", "outputDir"),
      booleanFlag("--verify", "verify"),
      booleanFlag("--help", "help"),
    ],
  );
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.verify) {
    if (options.nativeSourceSha || options.nativeDistributionSha || options.outputDir) {
      throw new Error("--verify accepts only --source-sha");
    }
    console.log(
      JSON.stringify(
        await verifyCypherClawReleaseSource({ root: ROOT, sourceCommit: options.sourceSha }),
      ),
    );
    return;
  }
  if (!options.outputDir) {
    throw new Error("--output-dir is required");
  }
  console.log(
    JSON.stringify(
      await createCypherClawReleaseSource({
        root: ROOT,
        sourceCommit: options.sourceSha,
        nativeSourceCommit: options.nativeSourceSha,
        nativeDistributionCommit: options.nativeDistributionSha,
        outputDir: options.outputDir,
      }),
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
