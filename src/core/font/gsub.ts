// Builds the OpenType GSUB table (glyph substitution) for ligatures and
// contextual alternates, in the structure opentype.js serializes.
//
// - Ligatures (lookup type 4): a sequence of glyphs becomes one glyph.
//   Feature `liga` (standard, on by default in browsers; Word: Ligatures
//   "Standard Only"), `dlig` (discretionary; Word: "All"), or `calt`
//   (contextual; Word: "Use Contextual Alternates").
// - Contextual alternates (lookup type 6, format 3 + a type 1 lookup):
//   a glyph is swapped for an alternate when it follows / precedes given glyphs.

export type LigatureFeature = 'liga' | 'dlig' | 'calt'

export interface LigatureRule {
  feature: LigatureFeature
  /** Component glyph indices, in order. */
  components: number[]
  /** The ligature glyph index. */
  glyph: number
}

export interface AlternateRule {
  /** Glyphs that must come right before the target, in reading order. */
  before: number[]
  target: number
  /** Glyphs that must come right after the target, in reading order. */
  after: number[]
  /** The alternate glyph index to use. */
  glyph: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Lookup = { lookupType: number; lookupFlag: number; subtables: any[] }

const coverage = (glyphs: number[]) => ({ format: 1, glyphs: [...new Set(glyphs)].sort((a, b) => a - b) })

/** One ligature lookup (type 4) for a set of rules. Longer ligatures are tried first. */
function ligatureLookup(rules: LigatureRule[]): Lookup {
  const byFirst = new Map<number, LigatureRule[]>()
  for (const r of rules) byFirst.set(r.components[0], [...(byFirst.get(r.components[0]) ?? []), r])
  const firsts = [...byFirst.keys()].sort((a, b) => a - b)
  return {
    lookupType: 4,
    lookupFlag: 0,
    subtables: [
      {
        substFormat: 1,
        coverage: { format: 1, glyphs: firsts },
        ligatureSets: firsts.map((g) =>
          byFirst
            .get(g)!
            .sort((a, b) => b.components.length - a.components.length)
            .map((r) => ({ ligGlyph: r.glyph, components: r.components.slice(1) })),
        ),
      },
    ],
  }
}

/**
 * The GSUB table for the given rules, or null if there are none.
 * Lookup order (= application order): ligatures (liga, dlig, calt), then contextual alternates.
 */
export function buildGsub(ligatures: LigatureRule[], alternates: AlternateRule[]): any | null {
  if (ligatures.length === 0 && alternates.length === 0) return null
  const lookups: Lookup[] = []
  const featureLookups = new Map<LigatureFeature, number[]>()
  const addTo = (f: LigatureFeature, index: number) => featureLookups.set(f, [...(featureLookups.get(f) ?? []), index])

  for (const f of ['liga', 'dlig', 'calt'] as LigatureFeature[]) {
    const rules = ligatures.filter((r) => r.feature === f && r.components.length >= 2)
    if (!rules.length) continue
    addTo(f, lookups.length)
    lookups.push(ligatureLookup(rules))
  }

  if (alternates.length) {
    // The chain lookup goes first in the list; the single substitutions it calls follow it.
    const chainIndex = lookups.length
    lookups.push({ lookupType: 6, lookupFlag: 0, subtables: [] })
    addTo('calt', chainIndex)
    // More specific rules (longer context) first: the first matching subtable wins.
    const ordered = [...alternates].sort((a, b) => b.before.length + b.after.length - (a.before.length + a.after.length))
    for (const r of ordered) {
      const singleIndex = lookups.length
      lookups.push({
        lookupType: 1,
        lookupFlag: 0,
        subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [r.target] }, substitute: [r.glyph] }],
      })
      lookups[chainIndex].subtables.push({
        substFormat: 3,
        // Backtrack coverages run outward from the target: the glyph just before it comes first.
        backtrackCoverage: [...r.before].reverse().map((g) => coverage([g])),
        inputCoverage: [coverage([r.target])],
        lookaheadCoverage: r.after.map((g) => coverage([g])),
        lookupRecords: [{ sequenceIndex: 0, lookupListIndex: singleIndex }],
      })
    }
  }

  // Features sorted by tag; every script uses all of them.
  const tags = [...featureLookups.keys()].sort()
  const features = tags.map((tag) => ({ tag, feature: { featureParams: 0, lookupListIndexes: featureLookups.get(tag)! } }))
  const langSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: tags.map((_, i) => i) }
  return {
    version: 1,
    scripts: ['DFLT', 'latn'].map((tag) => ({ tag, script: { defaultLangSys: { ...langSys }, langSysRecords: [] } })),
    features,
    lookups,
  }
}
