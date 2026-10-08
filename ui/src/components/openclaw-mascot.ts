import { css, html, LitElement, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import { inferControlUiPublicAssetPath } from "../app/public-assets.ts";
import type { MascotMood } from "./mascot-pose.ts";
import { currentThemeBranding, neutralMark } from "./neutral-mark.ts";

const DEFAULT_SIZE = 120;
const MASCOT_MOODS = new Set<MascotMood>([
  "idle",
  "curious",
  "thinking",
  "working",
  "happy",
  "celebrating",
  "sad",
  "sleepy",
  "attentive",
]);

// Preserve the shared element and mood contract while displaying the fork's artwork.
class OpenClawMascot extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
      width: var(--openclaw-mascot-size, 120px);
      height: var(--openclaw-mascot-size, 120px);
      overflow: visible;
      contain: layout style;
      pointer-events: none;
      line-height: 0;
    }

    img,
    .openclaw-mascot--neutral,
    .openclaw-mascot--neutral svg {
      display: block;
      width: 100%;
      height: 100%;
    }

    img {
      object-fit: contain;
      animation: cypher-mascot-float 5s ease-in-out infinite;
      animation-play-state: paused;
    }

    :host([data-playing]) img {
      animation-play-state: running;
    }

    img[data-mood="thinking"],
    img[data-mood="working"] {
      animation-duration: 2.8s;
    }

    img[data-mood="sleepy"],
    img[data-mood="sad"] {
      animation: none;
    }

    @keyframes cypher-mascot-float {
      0%,
      100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-2%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      img {
        animation: none;
      }
    }
  `;

  @property({ reflect: true }) mood: MascotMood = "idle";
  @property({ type: Number }) size = DEFAULT_SIZE;
  @property({ type: Boolean }) tease = false;

  private visible = true;
  private reducedMotion = false;
  private intersectionObserver: IntersectionObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private motionQuery: MediaQueryList | null = null;

  private readonly handleVisibilityChange = () => this.syncPlayback();
  private readonly handleMotionChange = (event: MediaQueryListEvent) => {
    this.reducedMotion = event.matches;
    this.syncPlayback();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute("aria-hidden", "true");
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.reducedMotion = this.motionQuery?.matches ?? false;
    this.motionQuery?.addEventListener("change", this.handleMotionChange);
    if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.visible = entries.some((entry) => entry.isIntersecting);
        this.syncPlayback();
      });
      this.intersectionObserver.observe(this);
    }
    if (typeof MutationObserver !== "undefined") {
      this.themeObserver = new MutationObserver(() => this.requestUpdate());
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme-mode", "data-theme-mascot"],
      });
    }
  }

  override disconnectedCallback(): void {
    this.removeAttribute("data-playing");
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.motionQuery?.removeEventListener("change", this.handleMotionChange);
    this.motionQuery = null;
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("size")) {
      this.style.setProperty("--openclaw-mascot-size", `${this.resolvedSize}px`);
    }
    this.syncPlayback();
  }

  override render() {
    return currentThemeBranding().mascot === "none"
      ? html`<span class="openclaw-mascot--neutral">${neutralMark}</span>`
      : html`<img
          src=${inferControlUiPublicAssetPath("cypherclaw-mascot.png")}
          alt=""
          width="512"
          height="512"
          data-mood=${MASCOT_MOODS.has(this.mood) ? this.mood : "idle"}
          draggable="false"
        />`;
  }

  private get resolvedSize(): number {
    return Number.isFinite(this.size) && this.size > 0 ? this.size : DEFAULT_SIZE;
  }

  private syncPlayback(): void {
    this.toggleAttribute(
      "data-playing",
      this.isConnected &&
        currentThemeBranding().mascot === "claw" &&
        this.visible &&
        !this.reducedMotion &&
        document.visibilityState !== "hidden",
    );
  }
}

if (!customElements.get("openclaw-mascot")) {
  customElements.define("openclaw-mascot", OpenClawMascot);
}
