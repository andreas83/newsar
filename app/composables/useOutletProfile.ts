/**
 * Labels for an outlet's profile: left–right lean (where it applies),
 * ownership and home country. Mirrors feeds.ownership / feeds.lean_applicable.
 */

const OWNERSHIP_LABELS: Record<string, string> = {
  private: 'Privately owned',
  public: 'Public broadcaster',
  state: 'State media',
  nonprofit: 'Nonprofit',
  trust: 'Trust-owned',
}

// Pinned to 'en' so server and client render the same names
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

export function getOwnershipLabel(ownership: string | null | undefined): string | null {
  if (!ownership) return null
  return OWNERSHIP_LABELS[ownership] || ownership
}

// Node's ICU and browsers name these differently ("Hong Kong SAR China" vs
// "Hong Kong"), which breaks hydration; pin them
const COUNTRY_NAME_OVERRIDES: Record<string, string> = {
  HK: 'Hong Kong',
  MO: 'Macao',
  PS: 'Palestine',
}

export function getCountryName(code: string | null | undefined): string | null {
  if (!code) return null
  const override = COUNTRY_NAME_OVERRIDES[code.toUpperCase()]
  if (override) return override
  try {
    return regionNames.of(code.toUpperCase()) || code
  } catch {
    return code
  }
}

export function getLeanLabel(bias: number | null | undefined): string | null {
  if (bias === null || bias === undefined) return null
  if (bias <= -0.6) return 'Far Left'
  if (bias <= -0.2) return 'Center-Left'
  if (bias < 0.2) return 'Center'
  if (bias < 0.6) return 'Center-Right'
  return 'Far Right'
}

/**
 * One-line outlet descriptor for badges: the lean for rated outlets,
 * otherwise ownership and country ("State media · Qatar").
 */
export function getOutletTag(outlet: {
  bias?: number | null
  leanApplicable?: boolean | null
  ownership?: string | null
  country?: string | null
}): string | null {
  if (outlet.leanApplicable === false) {
    const parts = [getOwnershipLabel(outlet.ownership), getCountryName(outlet.country)].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : 'Not rated'
  }
  return getLeanLabel(outlet.bias)
}

export const NOT_RATED_EXPLANATION =
  'Not rated on the left–right scale. It describes Western party politics and doesn’t fit state media or outlets outside that system, so we show ownership and country instead.'
