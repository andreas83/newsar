/**
 * Outlet columns for coverage grids (frontpage matrix, stories list):
 * lean bucket, column order and a short display name.
 */
export type LeanGroup = 'left' | 'center' | 'right' | 'unrated'

export const LEAN_ORDER: LeanGroup[] = ['left', 'center', 'right', 'unrated']

export function leanGroup(bias: number | null, leanApplicable: boolean): LeanGroup {
  if (!leanApplicable || bias === null) return 'unrated'
  if (bias < -0.2) return 'left'
  if (bias > 0.2) return 'right'
  return 'center'
}

// "BBC News - World" → "BBC News"; long names fall back to initials ("SCMP")
export function outletShortName(name: string) {
  const stripped = name.replace(/\s*[-–]\s*World( News)?$/i, '').trim()
  if (stripped.length <= 16) return stripped
  return stripped.split(/\s+/).filter(w => /^[A-Z]/.test(w)).map(w => w[0]).join('')
}

// Left → right, unrated last; busiest first within a bucket
export function sortOutlets<T extends { group: LeanGroup; bias: number | null; weekCount: number }>(outlets: T[]) {
  return outlets.sort((a, b) =>
    LEAN_ORDER.indexOf(a.group) - LEAN_ORDER.indexOf(b.group)
    || (a.bias ?? 0) - (b.bias ?? 0)
    || b.weekCount - a.weekCount
  )
}
