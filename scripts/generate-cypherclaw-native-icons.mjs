#!/usr/bin/env node
// Reproduce native logo resources from the user-supplied CypherClaw artwork.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { PhotonImage, resize, SamplingFilter } from "@silvia-odwyer/photon-node";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => !["--write", "--check"].includes(arg))) {
  throw new Error("Usage: node scripts/generate-cypherclaw-native-icons.mjs [--write|--check]");
}
const masters = Object.fromEntries(
  ["mascot", "transparent"].map((name) => [
    name,
    PhotonImage.new_from_byteslice(
      fs.readFileSync(path.join(root, "assets/branding", `cypherclaw-${name}.png`)),
    ),
  ]),
);
const previousManifest = path.join(root, ".artifacts/logo-native-generated-files.json");
const previousOutputs = fs.existsSync(previousManifest)
  ? JSON.parse(fs.readFileSync(previousManifest, "utf8"))
  : [];
const outputs = new Map();
const cache = new Map();
function pixels(name, size) {
  const key = `${name}:${size}`;
  if (!cache.has(key)) {
    const image = resize(masters[name], size, size, SamplingFilter.Lanczos3);
    cache.set(key, image.get_raw_pixels());
    image.free();
  }
  return cache.get(key);
}
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const typeBuffer = Buffer.from(type);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, body])));
  return Buffer.concat([header, typeBuffer, body, footer]);
}
// Explicit RGB/RGBA and sRGB output keeps Apple app-icon requirements predictable.
function png(data, size, opaque = false) {
  const channels = opaque ? 3 : 4;
  const raw = Buffer.alloc((size * channels + 1) * size);
  for (let y = 0; y < size; y++) {
    const line = y * (size * channels + 1);
    for (let x = 0; x < size; x++) {
      const source = (y * size + x) * 4;
      const target = line + 1 + x * channels;
      for (let c = 0; c < channels; c++) raw[target + c] = data[source + c];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("sRGB", Buffer.from([0])),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function tile(size, { dark = false } = {}) {
  // Dark and debug slots use the same original image. Only the PNG container's
  // alpha-channel shape varies for the platform catalog, never the artwork.
  return png(pixels("mascot", size), size, !dark);
}
function foreground(name, size) {
  const artSize = Math.round(size * 0.6);
  const art = pixels(name, artSize);
  const image = Buffer.alloc(size * size * 4);
  const inset = Math.floor((size - artSize) / 2);
  for (let y = 0; y < artSize; y++) {
    Buffer.from(art.buffer, art.byteOffset + y * artSize * 4, artSize * 4).copy(
      image,
      ((y + inset) * size + inset) * 4,
    );
  }
  return png(image, size);
}
function output(filename, data) {
  outputs.set(filename, Buffer.isBuffer(data) ? data : Buffer.from(data));
}
function svg(data, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image width="${size}" height="${size}" href="data:image/png;base64,${data.toString("base64")}"/></svg>\n`;
}
function icns(dark) {
  const types = new Map([
    [16, "icp4"],
    [32, "icp5"],
    [64, "icp6"],
    [128, "ic07"],
    [256, "ic08"],
    [512, "ic09"],
    [1024, "ic10"],
  ]);
  const entries = [...types].map(([size, type]) => {
    const data = tile(size, { dark });
    const head = Buffer.alloc(8);
    head.write(type);
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(
    entries.reduce((sum, entry) => sum + entry.length, 8),
    4,
  );
  return Buffer.concat([header, ...entries]);
}
function ico() {
  const entries = [16, 32, 48, 64, 128, 256].map((size) => {
    const image = PhotonImage.new_from_byteslice(tile(size));
    const data = png(image.get_raw_pixels(), size);
    image.free();
    return { size, data };
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const directory = entries.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.data)]);
}
const appAssets = [
  "apps/ios/Sources/Assets.xcassets/AppIcon.appiconset",
  "apps/ios/Sources/Assets.xcassets/AppIconDebug.appiconset",
  "apps/ios/WatchApp/Assets.xcassets/AppIcon.appiconset",
  "apps/ios/WatchApp/Assets.xcassets/AppIconDebug.appiconset",
];
for (const folder of appAssets) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, folder, "Contents.json"), "utf8"));
  for (const image of manifest.images) {
    if (!image.filename) continue;
    const size = image["expected-size"]
      ? Number(image["expected-size"])
      : Number(image.size.split("x")[0]) * Number((image.scale ?? "1x").replace("x", ""));
    const dark = image.appearances?.some((entry) => entry.value === "dark") ?? false;
    output(`${folder}/${image.filename}`, tile(size, { dark }));
  }
}
const mascot = png(pixels("mascot", 512), 512);
const uiMascot = png(pixels("transparent", 512), 512);
output("apps/shared/OpenClawKit/Sources/OpenClawChatUI/Resources/CypherClawLogo.png", uiMascot);
output("apps/macos/Sources/OpenClaw/Resources/cypherclaw-logo.png", uiMascot);
output("apps/ios/WatchApp/Assets.xcassets/CypherClawLogo.imageset/CypherClawLogo.png", uiMascot);
output(
  "apps/ios/WatchApp/Assets.xcassets/CypherClawLogo.imageset/Contents.json",
  JSON.stringify(
    {
      images: [{ filename: "CypherClawLogo.png", idiom: "universal" }],
      info: { author: "xcode", version: 1 },
    },
    null,
    2,
  ) + "\n",
);
output(
  "apps/ios/WatchApp/Assets.xcassets/OpenClawIcon.imageset/openclaw-icon.png",
  png(pixels("transparent", 180), 180),
);
for (const module of ["app", "wear"]) {
  output(`apps/android/${module}/src/main/res/drawable-nodpi/cypherclaw_mascot.png`, uiMascot);
  for (const [density, size, launcher] of [
    ["mdpi", 108, 48],
    ["hdpi", 162, 72],
    ["xhdpi", 216, 96],
    ["xxhdpi", 324, 144],
    ["xxxhdpi", 432, 192],
  ]) {
    output(
      `apps/android/${module}/src/main/res/mipmap-${density}/ic_launcher_foreground.png`,
      foreground("mascot", size),
    );
    if (module === "app")
      output(
        `apps/android/${module}/src/main/res/mipmap-${density}/ic_launcher.png`,
        tile(launcher),
      );
  }
}
output("apps/android/fastlane/metadata/android/en-US/images/icon.png", tile(512));
for (const [filename, size] of [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
]) {
  output(`apps/linux/src-tauri/icons/${filename}`, tile(size));
}
output("apps/linux/src-tauri/icons/icon.ico", ico());
output("apps/linux/src-tauri/icons/icon.svg", svg(png(pixels("mascot", 256), 256), 256));
output("apps/linux/src-tauri/icons/icon-tile.svg", svg(tile(512), 512));
output("apps/linux/src-tauri/icons/tray-template.png", png(pixels("transparent", 36), 36));
output(
  "apps/linux/src-tauri/icons/tray-template.svg",
  svg(png(pixels("transparent", 256), 256), 256),
);
output("apps/linux/ui/mascot.svg", svg(png(pixels("transparent", 256), 256), 256));
output("apps/linux/omarchy/cypherclaw-logo.png", uiMascot);
const iconFolders = [
  "Icon.icon",
  ...["Heritage", "Clawmark", "Origami", "Pincer", "OpenC"].map(
    (name) => `AppIconDesigns/${name}.icon`,
  ),
];
for (const folder of iconFolders) {
  output(`apps/macos/${folder}/Assets/cypherclaw.png`, mascot);
  // Retain the editable source path for tools referring to the historical filename.
  output(`apps/macos/${folder}/Assets/molty.svg`, svg(mascot, 512));
  const filename = `apps/macos/${folder}/icon.json`;
  const document = JSON.parse(fs.readFileSync(path.join(root, filename), "utf8"));
  document.fill = { solid: "srgb:1.00000,1.00000,1.00000,1.00000" };
  for (const group of document.groups) {
    group.shadow = { kind: "neutral", opacity: 0 };
    for (const layer of group.layers) {
      layer["image-name"] = "cypherclaw.png";
      layer.name = "CypherClaw";
      layer.position = { scale: 1, "translation-in-points": [0, 0] };
    }
  }
  output(filename, JSON.stringify(document, null, 2) + "\n");
}
const lightIcon = icns(false);
const darkIcon = icns(true);
for (const style of ["paper", "heritage", "clawmark", "origami", "pincer", "openC"]) {
  output(`apps/macos/Sources/OpenClaw/Resources/AppIcons/${style}-light.icns`, lightIcon);
  output(`apps/macos/Sources/OpenClaw/Resources/AppIcons/${style}-dark.icns`, darkIcon);
}
output("apps/macos/Sources/OpenClaw/Resources/OpenClaw.icns", lightIcon);
// Retain the Wear resource identifier as a generic notification glyph; the OS
// small-icon slot cannot show a full-color photograph without altering it.
output(
  "apps/android/wear/src/main/res/drawable/ic_notification.xml",
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF" android:pathData="M4,3H20V17H8L4,21Z"/>
</vector>
`,
);
const mismatches = [];
for (const [filename, data] of outputs) {
  const destination = path.join(root, filename);
  if (fs.existsSync(destination) && fs.readFileSync(destination).equals(data)) continue;
  if (check) mismatches.push(filename);
  else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
  }
}
for (const master of Object.values(masters)) master.free();
if (mismatches.length)
  throw new Error(`Stale CypherClaw native resources:\n${mismatches.join("\n")}`);
if (!check) {
  // Clean only obsolete files newly generated by this task, never legacy assets.
  for (const filename of previousOutputs) {
    if (
      !outputs.has(filename) &&
      (filename.includes("cypherclaw_template.png") ||
        filename.includes("ic_launcher_monochrome.png") ||
        filename.endsWith("cypherclaw-template.png"))
    ) {
      fs.rmSync(path.join(root, filename), { force: true });
    }
  }
  fs.mkdirSync(path.join(root, ".artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".artifacts/logo-native-generated-files.json"),
    JSON.stringify([...outputs.keys()], null, 2) + "\n",
  );
}
console.log(
  `${check ? "Verified" : "Generated"} ${outputs.size} CypherClaw native icon resources.`,
);
