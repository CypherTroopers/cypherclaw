import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root, "openclaw.plugin.json"), "utf8"));
const browserDirectory = path.dirname(manifest.controlUi.entry);
async function filesAt(directory) {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesAt(file)));
    else if (entry.isFile())
      files.push({ file, bytes: (await fs.stat(path.join(root, file))).size });
    else throw new Error(`Unsupported package entry: ${file}`);
  }
  return files;
}
const files = [...(await filesAt("dist")), ...(await filesAt("assets"))];
for (const file of [
  "package.json",
  "openclaw.plugin.json",
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
]) {
  files.push({ file, bytes: (await fs.stat(path.join(root, file))).size });
}
const native = files.filter(
  ({ file }) => /\.(?:exe|dll|tgz|tar\.gz)$/i.test(file) || /\/bin\//.test(file),
);
if (native.length)
  throw new Error(
    `Native payloads must stay outside the published plugin: ${native.map(({ file }) => file).join(", ")}`,
  );
const browser = files.filter(({ file }) => file.startsWith(`${browserDirectory}/`));
if (
  browser.length > 128 ||
  browser.some(({ bytes }) => bytes > 4 * 1024 * 1024) ||
  browser.reduce((sum, { bytes }) => sum + bytes, 0) > 8 * 1024 * 1024
)
  throw new Error("Plugin browser assets exceed the host budget.");
const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
if (bytes > 50 * 1024 * 1024)
  throw new Error("Plugin exceeds ClawHub's 50 MiB unpacked payload budget.");
console.log(
  JSON.stringify(
    {
      unpackedBytes: bytes,
      browserBytes: browser.reduce((sum, file) => sum + file.bytes, 0),
      fileCount: files.length,
      nativePayloads: native.length,
    },
    null,
    2,
  ),
);
