import { hashControlUiTranslationText } from "../../scripts/lib/control-ui-i18n-catalog-values.ts";
import type { TranslationMemoryEntry } from "../../scripts/lib/control-ui-i18n-sync-plan.ts";

/** Reuse a translation only when its source changed by the product name alone. */
export function rebrandControlUiTranslationMemory(
  sourceFlat: ReadonlyMap<string, string>,
  memory: ReadonlyMap<string, TranslationMemoryEntry>,
): ReadonlyMap<string, TranslationMemoryEntry> {
  const branded = new Map(memory);
  for (const [cacheKey, entry] of memory) {
    const text = entry.text.replaceAll("OpenClaw", "CypherClaw");
    if (text === entry.text || entry.text_hash !== hashControlUiTranslationText(entry.text)) {
      continue;
    }
    const segments = [entry.segment_id, ...(entry.segment_ids ?? [])].filter(
      (key) => sourceFlat.get(key) === text,
    );
    const firstSegment = segments[0];
    if (!firstSegment) {
      continue;
    }
    const brandedKey = `${cacheKey}:cypherclaw`;
    branded.set(brandedKey, {
      ...entry,
      cache_key: brandedKey,
      segment_id: firstSegment,
      segment_ids: segments.slice(1),
      text,
      text_hash: hashControlUiTranslationText(text),
      translated: entry.translated.replaceAll("OpenClaw", "CypherClaw"),
    });
  }
  // Retain original records for copyright, upstream resources, and mixed aliases.
  return branded;
}
