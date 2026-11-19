/* @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { resolveThemeBranding } from "../../../packages/gateway-protocol/src/theme.ts";
import { setCurrentThemeBranding } from "../app/theme-branding.ts";
import { waitForSolid } from "../test-helpers/solid-settle.ts";
import "./openclaw-mascot.tsx";

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.themeMascot;
  setCurrentThemeBranding(resolveThemeBranding({ mascot: "claw", critters: [] }));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountMascot(attributes: Record<string, string> = {}) {
  const mascot = document.createElement("openclaw-mascot");
  for (const [name, value] of Object.entries(attributes)) {
    mascot.setAttribute(name, value);
  }
  document.body.append(mascot);
  return mascot;
}

it("replaces the supplied mascot with a same-size neutral mark and restores it on theme changes", async () => {
  const warning = vi.spyOn(console, "warn");
  setCurrentThemeBranding(resolveThemeBranding({ mascot: "claw", critters: [] }));
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const mascot = mountMascot({ size: "48" });
  await waitForSolid(() =>
    expect(mascot.querySelector("img")?.getAttribute("src")).toBe("/cypherclaw-mascot.png"),
  );
  expect(mascot.hasAttribute("data-playing")).toBe(true);
  expect(mascot.style.getPropertyValue("--openclaw-mascot-size")).toBe("48px");

  visibility.mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  await waitForSolid(() => expect(mascot.hasAttribute("data-playing")).toBe(false));
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  await waitForSolid(() => expect(mascot.hasAttribute("data-playing")).toBe(true));

  setCurrentThemeBranding(resolveThemeBranding({ mascot: "none", critters: [] }));
  document.documentElement.dataset.themeMascot = "none";
  await waitForSolid(() => expect(mascot.querySelector("img")).toBeNull());
  expect(mascot.querySelector(".openclaw-mascot--neutral svg")).not.toBeNull();
  expect(mascot.style.getPropertyValue("--openclaw-mascot-size")).toBe("48px");
  expect(mascot.hasAttribute("data-playing")).toBe(false);

  setCurrentThemeBranding(resolveThemeBranding({ mascot: "claw", critters: [] }));
  document.documentElement.dataset.themeMascot = "claw";
  await waitForSolid(() => expect(mascot.querySelector("img")).not.toBeNull());
  expect(mascot.querySelector(".openclaw-mascot--neutral")).toBeNull();
  expect(mascot.hasAttribute("data-playing")).toBe(true);
  expect(warning.mock.calls.flat().join(" ")).not.toContain("STRICT_READ_UNTRACKED");
});

it("keeps the supplied artwork still for reduced motion and pauses hidden documents", async () => {
  const warning = vi.spyOn(console, "warn");
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const mascot = mountMascot();
  await waitForSolid(() => expect(mascot.querySelector("img")).not.toBeNull());
  expect(mascot.hasAttribute("data-playing")).toBe(false);
  visibility.mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(mascot.hasAttribute("data-playing")).toBe(false);
  expect(warning.mock.calls.flat().join(" ")).not.toContain("STRICT_READ_UNTRACKED");
});
