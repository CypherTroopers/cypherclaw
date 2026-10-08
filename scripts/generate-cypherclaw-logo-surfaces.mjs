import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PhotonImage, resize, SamplingFilter } from "@silvia-odwyer/photon-node";

// Deterministically resize the checked-in brand masters for these surfaces.
// This script does not edit the original upload or call image generation APIs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const render = (source, size) => {
  const original = PhotonImage.new_from_byteslice(fs.readFileSync(path.join(root, source)));
  const result = resize(original, size, size, SamplingFilter.Lanczos3);
  try {
    return result.get_bytes();
  } finally {
    result.free();
    original.free();
  }
};
const save = (target, bytes) => fs.writeFileSync(path.join(root, target), bytes);
const mascot = "assets/branding/cypherclaw-mascot.png";
const transparent = "assets/branding/cypherclaw-transparent.png";
save("docs/assets/cypherclaw-logo.png", render(mascot, 512));
save("cypher/browser-llm-lab/public/assets/cypherclaw-logo.png", render(transparent, 256));
save("cypher/browser-llm-lab/public/assets/cypherclaw-mark.png", render(transparent, 128));

// OAuth callback pages run on isolated loopback ports and need no asset server.
const encoded = Buffer.from(render(transparent, 128)).toString("base64");
const logoModule = "src/shared/cypherclaw-logo.ts";
save(
  logoModule,
  "// Compact CypherClaw logo, embedded for isolated OAuth callback pages.\n" +
    "// Source and artwork provenance: assets/branding/README.md.\n" +
    "// Regenerate with node scripts/generate-cypherclaw-logo-surfaces.mjs.\n" +
    "export const CYPHERCLAW_LOGO_DATA_URL =\n  " +
    JSON.stringify("data:image/png;base64," + encoded) +
    ";\n",
);
const formatting = spawnSync(
  process.execPath,
  [path.join(root, "node_modules/oxfmt/bin/oxfmt"), "--write", path.join(root, logoModule)],
  { cwd: root, stdio: "inherit" },
);
if (formatting.status !== 0) process.exit(formatting.status ?? 1);
console.log("Generated README, browser-lab, and self-contained OAuth logos.");
