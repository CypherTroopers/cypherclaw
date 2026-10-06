import { svg } from "lit";
import { inferControlUiPublicAssetPath } from "../app/public-assets.ts";

/** Keep the full supplied logo in a versioned image asset instead of startup JavaScript. */
export function renderCypherClawMark() {
  return svg`<svg viewBox="0 0 128 128" width="100%" height="100%" aria-hidden="true" data-cypherclaw-logo
    style="animation: none; transform: none;">
    <image href=${inferControlUiPublicAssetPath("cypherclaw-mark.png")} width="128" height="128" />
  </svg>`;
}
