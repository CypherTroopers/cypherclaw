import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  draw_text,
  PhotonImage,
  resize,
  SamplingFilter,
  watermark,
} from "@silvia-odwyer/photon-node";
import type { Plugin } from "vite";

/** Render the independent fork's supplied artwork and product identity. */
export function controlUiSocialCardPlugin(): Plugin {
  return {
    name: "control-ui-social-card",
    apply: "build",
    buildStart() {
      const artworkPath = fileURLToPath(
        new URL("../../assets/branding/cypherclaw-transparent.png", import.meta.url),
      );
      this.addWatchFile(artworkPath);
      const pixels = Buffer.alloc(1200 * 630 * 4, Buffer.from([11, 16, 22, 255]));
      const canvas = new PhotonImage(pixels, 1200, 630);
      const original = PhotonImage.new_from_byteslice(readFileSync(artworkPath));
      let artwork: PhotonImage | undefined;
      try {
        artwork = resize(original, 430, 430, SamplingFilter.Lanczos3);
        watermark(canvas, artwork, 50n, 100n);
        draw_text(canvas, "CypherClaw", 480, 225, 94);
        draw_text(canvas, "Your personal AI assistant", 486, 355, 36);
        this.emitFile({ type: "asset", fileName: "social-card.png", source: canvas.get_bytes() });
      } finally {
        artwork?.free();
        original.free();
        canvas.free();
      }
    },
  };
}
