import type { JSX } from "@solidjs/web";
import { inferControlUiPublicAssetPath } from "../app/public-assets.ts";

/** Keep the full supplied logo in a versioned image asset instead of startup JavaScript. */
export function CypherClawMark(props?: {
  class?: string;
  style?: string | JSX.CSSProperties;
  "aria-label"?: string;
}) {
  return (
    <svg
      viewBox="0 0 128 128"
      width="100%"
      height="100%"
      class={props?.class}
      style={props?.style ?? { animation: "none", transform: "none" }}
      aria-hidden={props?.["aria-label"] ? undefined : "true"}
      aria-label={props?.["aria-label"]}
      role={props?.["aria-label"] ? "img" : undefined}
      data-cypherclaw-logo=""
    >
      <image href={inferControlUiPublicAssetPath("cypherclaw-mark.png")} width="128" height="128" />
    </svg>
  );
}
