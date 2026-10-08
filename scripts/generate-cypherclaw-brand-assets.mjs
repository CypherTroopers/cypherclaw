import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PhotonImage, resize, SamplingFilter } from "@silvia-odwyer/photon-node";

// Preserve the complete supplied image, its colors, proportions and text.
// The optional transparent master changes only the user-authorized background alpha.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "assets/branding");
const source = PhotonImage.new_from_byteslice(
  fs.readFileSync(path.join(assets, "cypherclaw-original.jpg")),
);
const images = [source];
try {
  if (source.get_width() !== source.get_height()) {
    throw new Error("The supplied logo must be square; do not crop or stretch it.");
  }
  fs.writeFileSync(path.join(assets, "cypherclaw-mascot.png"), source.get_bytes());
  for (const [name, size] of [
    ["cypherclaw-app-icon.png", 1024],
    ["cypherclaw-mark.png", 256],
  ]) {
    const image = resize(source, size, size, SamplingFilter.Lanczos3);
    images.push(image);
    fs.writeFileSync(path.join(assets, name), image.get_bytes());
  }
  const mask = PhotonImage.new_from_byteslice(
    fs.readFileSync(path.join(assets, "cypherclaw-background-mask.png")),
  );
  images.push(mask);
  if (mask.get_width() !== source.get_width() || mask.get_height() !== source.get_height()) {
    throw new Error("The background alpha must use the original image's unchanged canvas.");
  }
  const originalPixels = source.get_raw_pixels();
  const maskPixels = mask.get_raw_pixels();
  const transparentPixels = new Uint8Array(originalPixels);
  for (let index = 0; index < transparentPixels.length; index += 4) {
    const alpha = maskPixels[index + 3];
    transparentPixels[index + 3] = alpha;
    // Use the extraction's edge colors only where the white backdrop was mixed
    // into boundary pixels. Keep the supplied subject's interior RGB intact.
    const whiteBackdrop =
      Math.min(originalPixels[index], originalPixels[index + 1], originalPixels[index + 2]) >=
        245 && Math.max(maskPixels[index], maskPixels[index + 1], maskPixels[index + 2]) < 200;
    if (alpha > 0 && (alpha < 240 || whiteBackdrop)) {
      transparentPixels.set(maskPixels.subarray(index, index + 3), index);
    }
    // Fully invisible pixels carry no background color into reduced-size edges.
    if (alpha === 0) transparentPixels.fill(0, index, index + 3);
  }
  const transparent = new PhotonImage(transparentPixels, source.get_width(), source.get_height());
  images.push(transparent);
  fs.writeFileSync(path.join(assets, "cypherclaw-transparent.png"), transparent.get_bytes());
  console.log(
    "Encoded the original logo, proportional sizes, and a background-alpha variant retaining subject RGB with backdrop-edge cleanup.",
  );
} finally {
  for (const image of images) image.free();
}
