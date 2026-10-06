// Resize the full supplied logo into Web UI assets, using its authorized background-transparent variant.
// Preserve the opaque photo-based app icons for Apple/PWA launchers.
// Run from the repository root: node scripts/generate-cypherclaw-web-icons.cjs
const fs = require("node:fs");
const path = require("node:path");
const { PhotonImage, resize, SamplingFilter } = require("@silvia-odwyer/photon-node");
const root = path.resolve(__dirname, "..");
const from = (name) =>
  PhotonImage.new_from_byteslice(fs.readFileSync(path.join(root, "assets/branding", name)));
const mark = from("cypherclaw-transparent.png");
const app = from("cypherclaw-app-icon.png");
const mascot = from("cypherclaw-transparent.png");
const png = (source, size) => {
  const image = resize(source, size, size, SamplingFilter.Lanczos3);
  try {
    return Buffer.from(image.get_bytes());
  } finally {
    image.free();
  }
};
const output = new Map();
const put = (file, bytes) => {
  fs.writeFileSync(path.join(root, file), bytes);
  output.set(file, bytes.length);
};
try {
  const embeddedMark = png(mark, 64);
  const dataUrl = `data:image/png;base64,${embeddedMark.toString("base64")}`;
  put(
    "ui/src/components/cypherclaw-logo-data.ts",
    `// Derived from the full artwork in assets/branding/cypherclaw-transparent.png.\n// Self-contained artwork lets status favicons render without external image loads.\nexport const CYPHERCLAW_MARK_DATA_URL =\n  ${JSON.stringify(dataUrl)};\n`,
  );
  put(
    "ui/public/favicon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><title>CypherClaw</title><image width="128" height="128" href="${dataUrl}"/></svg>\n`,
  );
  put("ui/public/favicon-32.png", png(mark, 32));
  put("ui/public/apple-touch-icon.png", png(app, 180));
  put("ui/public/cypherclaw-mascot.png", png(mascot, 512));
  put("ui/public/cypherclaw-mark.png", png(mark, 256));
  put("ui/public/pwa-icon-192.png", png(app, 192));
  put("ui/public/pwa-icon-512.png", png(app, 512));
  // Maskable icons keep all identifying content within the central safe circle.
  const safePixels = Buffer.alloc(512 * 512 * 4, Buffer.from([255, 255, 255, 255]));
  const smaller = resize(app, 352, 352, SamplingFilter.Lanczos3);
  const raw = smaller.get_raw_pixels();
  for (let y = 0; y < 352; y++)
    Buffer.from(raw.slice(y * 352 * 4, (y + 1) * 352 * 4)).copy(
      safePixels,
      ((y + 80) * 512 + 80) * 4,
    );
  const safe = new PhotonImage(safePixels, 512, 512);
  try {
    put("ui/public/pwa-icon-maskable-512.png", Buffer.from(safe.get_bytes()));
  } finally {
    safe.free();
    smaller.free();
  }
  // PNG-backed ICO entries are supported by all targeted modern browsers and Windows.
  const sizes = [16, 32, 48, 64, 128, 256];
  const entries = sizes.map((size) => png(mark, size));
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((bytes, index) => {
    const position = 6 + index * 16;
    header[position] = header[position + 1] = sizes[index] === 256 ? 0 : sizes[index];
    header.writeUInt16LE(1, position + 4);
    header.writeUInt16LE(32, position + 6);
    header.writeUInt32LE(bytes.length, position + 8);
    header.writeUInt32LE(offset, position + 12);
    offset += bytes.length;
  });
  put("ui/public/favicon.ico", Buffer.concat([header, ...entries]));
  console.log(JSON.stringify(Object.fromEntries(output), null, 2));
} finally {
  mark.free();
  app.free();
  mascot.free();
}
