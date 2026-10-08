/* @vitest-environment jsdom */

import type { LitElement } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { setCurrentThemeBranding } from "../app/theme-branding.ts";
import "./openclaw-mascot.ts";

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.themeMascot;
  setCurrentThemeBranding({ mascot: "claw", critters: [] });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("replaces the supplied mascot with a same-size neutral mark and restores it on theme changes", async () => {
  setCurrentThemeBranding({ mascot: "claw", critters: [] });
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const mascot = document.createElement("openclaw-mascot") as LitElement & { size: number };
  mascot.size = 48;
  document.body.append(mascot);
  await mascot.updateComplete;
  expect(mascot.shadowRoot?.querySelector("img")?.getAttribute("src")).toBe(
    "/cypherclaw-mascot.png",
  );
  expect(mascot.hasAttribute("data-playing")).toBe(true);

  visibility.mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(mascot.hasAttribute("data-playing")).toBe(false);
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(mascot.hasAttribute("data-playing")).toBe(true);

  setCurrentThemeBranding({ mascot: "none", critters: [] });
  document.documentElement.dataset.themeMascot = "none";
  await Promise.resolve();
  await mascot.updateComplete;
  expect(mascot.shadowRoot?.querySelector("img")).toBeNull();
  expect(mascot.shadowRoot?.querySelector(".openclaw-mascot--neutral svg")).not.toBeNull();
  expect(mascot.style.getPropertyValue("--openclaw-mascot-size")).toBe("48px");
  expect(mascot.hasAttribute("data-playing")).toBe(false);

  setCurrentThemeBranding({ mascot: "claw", critters: [] });
  document.documentElement.dataset.themeMascot = "claw";
  await Promise.resolve();
  await mascot.updateComplete;
  expect(mascot.shadowRoot?.querySelector("img")).not.toBeNull();
  expect(mascot.shadowRoot?.querySelector(".openclaw-mascot--neutral")).toBeNull();
  expect(mascot.hasAttribute("data-playing")).toBe(true);
});

it("keeps the supplied artwork still for reduced motion and pauses hidden documents", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const mascot = document.createElement("openclaw-mascot") as LitElement;
  document.body.append(mascot);
  await mascot.updateComplete;
  expect(mascot.shadowRoot?.querySelector("img")).not.toBeNull();
  expect(mascot.hasAttribute("data-playing")).toBe(false);
  visibility.mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(mascot.hasAttribute("data-playing")).toBe(false);
});
