import { createEffect } from "solid-js";
import { inferControlUiPublicAssetPath } from "../app/public-assets.ts";
import { createDocumentVisibility, createMediaQuery } from "../lib/reactive/platform.ts";
import { themeBrandingProjection } from "../lib/reactive/theme-branding.ts";
import { defineSolidBridge } from "../lib/solid-bridge.ts";
import { MASCOT_MOODS, type MascotMood } from "./mascot-pose.ts";
import { ThemeBrandIcon } from "./theme-brand-icon.tsx";
import "./openclaw-mascot.css";

type Props = { mood: MascotMood; size: number; tease: boolean };
const moods = new Set<MascotMood>(MASCOT_MOODS);

defineSolidBridge<Props>(
  "openclaw-mascot",
  (props, host) => {
    host.setAttribute("aria-hidden", "true");
    const branding = themeBrandingProjection;
    const mood = () => (moods.has(props.mood) ? props.mood : "idle");
    const size = () => (Number.isFinite(props.size) && props.size > 0 ? props.size : 120);
    const reducedMotion = createMediaQuery("(prefers-reduced-motion: reduce)");
    const documentVisible = createDocumentVisibility();
    createEffect(
      () =>
        [size(), branding.read().brandIcon, reducedMotion(), documentVisible()] as const,
      ([currentSize, brandIcon, motionReduced, documentIsVisible]) => {
        host.style.setProperty("--openclaw-mascot-size", `${currentSize}px`);
        const playing = brandIcon === "claw" && !motionReduced && documentIsVisible;
        if (playing) {
          host.setAttribute("data-playing", "");
        } else {
          host.removeAttribute("data-playing");
        }
      },
    );
    return (
      <>
        {branding.read().brandIcon === "claw" ? (
          <img
            src={inferControlUiPublicAssetPath("cypherclaw-mascot.png")}
            alt=""
            data-mood={mood()}
            width="512"
            height="512"
            draggable={false}
          />
        ) : (
          <span class="openclaw-mascot--neutral">
            <ThemeBrandIcon branding={branding.read()} />
          </span>
        )}
      </>
    );
  },
  {
    properties: {
      mood: { default: "idle", reflect: true },
      size: { default: 120, type: Number },
      tease: { default: false, type: Boolean },
    },
  },
);
