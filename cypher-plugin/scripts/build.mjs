import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const common = {
  absWorkingDir: root,
  bundle: true,
  format: "esm",
  sourcemap: false,
  logLevel: "info",
  metafile: true,
};

const backend = await build({
  ...common,
  entryPoints: ["index.ts"],
  outfile: "dist/index.js",
  platform: "node",
  target: "node24",
  external: ["openclaw", "openclaw/*"],
});
for (const file of Object.keys(backend.metafile.inputs)) {
  if (file.startsWith("../")) {
    throw new Error(`Backend input escapes the plugin package: ${file}`);
  }
}

const browser = await build({
  ...common,
  entryPoints: { index: "browser/index.ts" },
  outdir: "dist/control-ui/build",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  write: false,
});
const files = browser.outputFiles.toSorted((a, b) => a.path.localeCompare(b.path));
if (
  files.some((file) => file.contents.length > 4 * 1024 * 1024) ||
  files.reduce((sum, file) => sum + file.contents.length, 0) > 8 * 1024 * 1024
) {
  throw new Error("The browser bundle exceeds OpenClaw's native plugin asset limits.");
}
const hash = createHash("sha256");
for (const file of files) {
  const name = path.basename(file.path);
  if (name !== "index.js" && name !== "index.css") {
    throw new Error(`Unexpected browser asset: ${name}`);
  }
  hash.update(`${name}\0${file.contents.length}\0`).update(file.contents);
}
const output = `dist/control-ui/${hash.digest("hex")}`;
await fs.mkdir(path.join(root, output), { recursive: true, mode: 0o755 });
for (const file of files) {
  await fs.writeFile(path.join(root, output, path.basename(file.path)), file.contents, {
    mode: 0o644,
  });
}
const manifestPath = path.join(root, "openclaw.plugin.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
manifest.controlUi = {
  entry: `${output}/index.js`,
  ...(files.some((file) => file.path.endsWith(".css")) ? { styles: [`${output}/index.css`] } : {}),
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built standalone Cypher plugin and ${output}`);
