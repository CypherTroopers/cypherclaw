import { describe, expect, it } from "vitest";
import {
  hashControlUiTranslationText,
  materializeControlUiLocaleCatalog,
} from "../../../scripts/lib/control-ui-i18n-catalog-values.ts";
import type { TranslationMemoryEntry } from "../../../scripts/lib/control-ui-i18n-sync-plan.ts";
import { rebrandControlUiTranslationMemory } from "../../config/control-ui-branding.ts";

function memoryEntry(overrides: Partial<TranslationMemoryEntry> = {}): TranslationMemoryEntry {
  const text = "OpenClaw";
  return {
    cache_key: "original",
    segment_id: "aboutPage.productName",
    segment_ids: ["aboutPage.upstreamName"],
    source_path: "ui/src/i18n/locales/ja-JP.ts",
    src_lang: "en",
    text,
    text_hash: hashControlUiTranslationText(text),
    tgt_lang: "ja-JP",
    translated: "OpenClaw に質問",
    updated_at: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

function catalog(source: Map<string, string>, entry = memoryEntry()) {
  const memory = new Map([[entry.cache_key, entry]]);
  return materializeControlUiLocaleCatalog(
    source,
    rebrandControlUiTranslationMemory(source, memory),
  );
}

describe("CypherClaw locale memory", () => {
  it("keeps Japanese text for name-only changes and retains the upstream alias", () => {
    const source = new Map([
      ["aboutPage.productName", "CypherClaw"],
      ["aboutPage.upstreamName", "OpenClaw"],
    ]);
    expect(catalog(source)).toEqual({
      aboutPage: { productName: "CypherClaw に質問", upstreamName: "OpenClaw に質問" },
    });
  });

  it("does not reuse translations for other wording changes", () => {
    expect(catalog(new Map([["aboutPage.productName", "The CypherClaw fork"]]))).toEqual({});
  });

  it("does not modify original copyright or license translations", () => {
    const text = "© 2026 OpenClaw Foundation — MIT License.";
    const entry = memoryEntry({
      segment_id: "aboutPage.license",
      segment_ids: [],
      text,
      text_hash: hashControlUiTranslationText(text),
      translated: text,
    });
    expect(catalog(new Map([["aboutPage.license", text]]), entry)).toEqual({
      aboutPage: { license: text },
    });
  });

  it("rejects source-hash mismatches rather than laundering stale translations", () => {
    expect(
      catalog(
        new Map([["aboutPage.productName", "CypherClaw"]]),
        memoryEntry({
          text_hash: "mismatched",
        }),
      ),
    ).toEqual({});
  });
});
