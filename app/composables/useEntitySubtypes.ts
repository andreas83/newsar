/**
 * Client-side subtype labels and colors.
 * Mirrors server/utils/entitySubtypes.ts definitions for use in Vue components.
 */

const SUBTYPE_LABELS: Record<string, string> = {
  // Organization
  company: 'Company',
  political_party: 'Political Party',
  government: 'Government',
  military: 'Military',
  law_enforcement: 'Law Enforcement',
  armed_group: 'Armed Group',
  media: 'Media',
  intergovernmental: 'Intergovernmental',
  sports: 'Sports',
  ngo: 'NGO',
  educational: 'Educational',
  religious: 'Religious',
  // Person
  politician: 'Politician',
  executive: 'Executive',
  military_leader: 'Military Leader',
  journalist: 'Journalist',
  athlete: 'Athlete',
  academic: 'Academic',
  entertainer: 'Entertainer',
  activist: 'Activist',
  // Location
  country: 'Country',
  city: 'City',
  region: 'Region',
  strategic: 'Strategic',
  territory: 'Territory',
  // Event
  conflict: 'Conflict',
  election: 'Election',
  sports_event: 'Sports Event',
  diplomatic: 'Diplomatic',
  cultural: 'Cultural',
  disaster: 'Disaster',
  // Topic
  technology: 'Technology',
  health: 'Health',
  science: 'Science',
  ideology: 'Ideology',
  policy: 'Policy',
  economic: 'Economic',
}

const SUBTYPE_COLORS: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  // Organization
  company:            { bg: 'bg-emerald-100', text: 'text-emerald-800', darkBg: 'dark:bg-emerald-900/30', darkText: 'dark:text-emerald-300' },
  political_party:    { bg: 'bg-red-100',     text: 'text-red-800',     darkBg: 'dark:bg-red-900/30',     darkText: 'dark:text-red-300' },
  government:         { bg: 'bg-indigo-100',  text: 'text-indigo-800',  darkBg: 'dark:bg-indigo-900/30',  darkText: 'dark:text-indigo-300' },
  military:           { bg: 'bg-stone-100',   text: 'text-stone-800',   darkBg: 'dark:bg-stone-900/30',   darkText: 'dark:text-stone-300' },
  law_enforcement:    { bg: 'bg-blue-100',    text: 'text-blue-800',    darkBg: 'dark:bg-blue-900/30',    darkText: 'dark:text-blue-300' },
  armed_group:        { bg: 'bg-orange-100',  text: 'text-orange-800',  darkBg: 'dark:bg-orange-900/30',  darkText: 'dark:text-orange-300' },
  media:              { bg: 'bg-purple-100',  text: 'text-purple-800',  darkBg: 'dark:bg-purple-900/30',  darkText: 'dark:text-purple-300' },
  intergovernmental:  { bg: 'bg-cyan-100',    text: 'text-cyan-800',    darkBg: 'dark:bg-cyan-900/30',    darkText: 'dark:text-cyan-300' },
  sports:             { bg: 'bg-lime-100',    text: 'text-lime-800',    darkBg: 'dark:bg-lime-900/30',    darkText: 'dark:text-lime-300' },
  ngo:                { bg: 'bg-teal-100',    text: 'text-teal-800',    darkBg: 'dark:bg-teal-900/30',    darkText: 'dark:text-teal-300' },
  educational:        { bg: 'bg-amber-100',   text: 'text-amber-800',   darkBg: 'dark:bg-amber-900/30',   darkText: 'dark:text-amber-300' },
  religious:          { bg: 'bg-rose-100',    text: 'text-rose-800',    darkBg: 'dark:bg-rose-900/30',    darkText: 'dark:text-rose-300' },
  // Person
  politician:         { bg: 'bg-red-100',     text: 'text-red-800',     darkBg: 'dark:bg-red-900/30',     darkText: 'dark:text-red-300' },
  executive:          { bg: 'bg-emerald-100', text: 'text-emerald-800', darkBg: 'dark:bg-emerald-900/30', darkText: 'dark:text-emerald-300' },
  military_leader:    { bg: 'bg-stone-100',   text: 'text-stone-800',   darkBg: 'dark:bg-stone-900/30',   darkText: 'dark:text-stone-300' },
  journalist:         { bg: 'bg-purple-100',  text: 'text-purple-800',  darkBg: 'dark:bg-purple-900/30',  darkText: 'dark:text-purple-300' },
  athlete:            { bg: 'bg-lime-100',    text: 'text-lime-800',    darkBg: 'dark:bg-lime-900/30',    darkText: 'dark:text-lime-300' },
  academic:           { bg: 'bg-amber-100',   text: 'text-amber-800',   darkBg: 'dark:bg-amber-900/30',   darkText: 'dark:text-amber-300' },
  entertainer:        { bg: 'bg-pink-100',    text: 'text-pink-800',    darkBg: 'dark:bg-pink-900/30',    darkText: 'dark:text-pink-300' },
  activist:           { bg: 'bg-orange-100',  text: 'text-orange-800',  darkBg: 'dark:bg-orange-900/30',  darkText: 'dark:text-orange-300' },
  // Location
  country:            { bg: 'bg-blue-100',    text: 'text-blue-800',    darkBg: 'dark:bg-blue-900/30',    darkText: 'dark:text-blue-300' },
  city:               { bg: 'bg-sky-100',     text: 'text-sky-800',     darkBg: 'dark:bg-sky-900/30',     darkText: 'dark:text-sky-300' },
  region:             { bg: 'bg-indigo-100',  text: 'text-indigo-800',  darkBg: 'dark:bg-indigo-900/30',  darkText: 'dark:text-indigo-300' },
  strategic:          { bg: 'bg-amber-100',   text: 'text-amber-800',   darkBg: 'dark:bg-amber-900/30',   darkText: 'dark:text-amber-300' },
  territory:          { bg: 'bg-orange-100',  text: 'text-orange-800',  darkBg: 'dark:bg-orange-900/30',  darkText: 'dark:text-orange-300' },
  // Event
  conflict:           { bg: 'bg-red-100',     text: 'text-red-800',     darkBg: 'dark:bg-red-900/30',     darkText: 'dark:text-red-300' },
  election:           { bg: 'bg-indigo-100',  text: 'text-indigo-800',  darkBg: 'dark:bg-indigo-900/30',  darkText: 'dark:text-indigo-300' },
  sports_event:       { bg: 'bg-lime-100',    text: 'text-lime-800',    darkBg: 'dark:bg-lime-900/30',    darkText: 'dark:text-lime-300' },
  diplomatic:         { bg: 'bg-cyan-100',    text: 'text-cyan-800',    darkBg: 'dark:bg-cyan-900/30',    darkText: 'dark:text-cyan-300' },
  cultural:           { bg: 'bg-purple-100',  text: 'text-purple-800',  darkBg: 'dark:bg-purple-900/30',  darkText: 'dark:text-purple-300' },
  disaster:           { bg: 'bg-orange-100',  text: 'text-orange-800',  darkBg: 'dark:bg-orange-900/30',  darkText: 'dark:text-orange-300' },
  // Topic
  technology:         { bg: 'bg-cyan-100',    text: 'text-cyan-800',    darkBg: 'dark:bg-cyan-900/30',    darkText: 'dark:text-cyan-300' },
  health:             { bg: 'bg-rose-100',    text: 'text-rose-800',    darkBg: 'dark:bg-rose-900/30',    darkText: 'dark:text-rose-300' },
  science:            { bg: 'bg-indigo-100',  text: 'text-indigo-800',  darkBg: 'dark:bg-indigo-900/30',  darkText: 'dark:text-indigo-300' },
  ideology:           { bg: 'bg-amber-100',   text: 'text-amber-800',   darkBg: 'dark:bg-amber-900/30',   darkText: 'dark:text-amber-300' },
  policy:             { bg: 'bg-blue-100',    text: 'text-blue-800',    darkBg: 'dark:bg-blue-900/30',    darkText: 'dark:text-blue-300' },
  economic:           { bg: 'bg-emerald-100', text: 'text-emerald-800', darkBg: 'dark:bg-emerald-900/30', darkText: 'dark:text-emerald-300' },
}

export function useEntitySubtypes() {
  function getSubtypeLabel(subtype: string | null | undefined): string {
    if (!subtype) return ''
    return SUBTYPE_LABELS[subtype] || subtype.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  function getSubtypeClasses(subtype: string | null | undefined): string {
    if (!subtype) return ''
    const colors = SUBTYPE_COLORS[subtype]
    if (!colors) return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
    return `${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`
  }

  return {
    getSubtypeLabel,
    getSubtypeClasses,
    SUBTYPE_LABELS,
    SUBTYPE_COLORS,
  }
}
