/**
 * Entity subtype definitions, labels, colors, and rule-based classifiers.
 * Shared across backend scripts, API endpoints, and (via API) frontend.
 */

// ── Subtype constants ───────────────────────────────────────────────

export const ORG_SUBTYPES = [
  'company', 'political_party', 'government', 'military', 'law_enforcement',
  'armed_group', 'media', 'intergovernmental', 'sports', 'ngo', 'educational', 'religious',
] as const
export type OrgSubtype = typeof ORG_SUBTYPES[number]

export const PERSON_SUBTYPES = [
  'politician', 'executive', 'military_leader', 'journalist', 'athlete',
  'academic', 'entertainer', 'activist',
] as const
export type PersonSubtype = typeof PERSON_SUBTYPES[number]

export const LOCATION_SUBTYPES = [
  'country', 'city', 'region', 'strategic', 'territory',
] as const
export type LocationSubtype = typeof LOCATION_SUBTYPES[number]

export const EVENT_SUBTYPES = [
  'conflict', 'election', 'sports_event', 'diplomatic', 'cultural', 'disaster',
] as const
export type EventSubtype = typeof EVENT_SUBTYPES[number]

export const TOPIC_SUBTYPES = [
  'technology', 'health', 'science', 'ideology', 'policy', 'economic',
] as const
export type TopicSubtype = typeof TOPIC_SUBTYPES[number]

export type EntitySubtype = OrgSubtype | PersonSubtype | LocationSubtype | EventSubtype | TopicSubtype

export const ALL_SUBTYPES_BY_TYPE: Record<string, readonly string[]> = {
  organization: ORG_SUBTYPES,
  person: PERSON_SUBTYPES,
  location: LOCATION_SUBTYPES,
  event: EVENT_SUBTYPES,
  topic: TOPIC_SUBTYPES,
}

// ── Labels ──────────────────────────────────────────────────────────

export const SUBTYPE_LABELS: Record<string, string> = {
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

// ── Colors (Tailwind class names for badges) ────────────────────────

export const SUBTYPE_COLORS: Record<string, string> = {
  // Organization
  company: 'emerald',
  political_party: 'red',
  government: 'indigo',
  military: 'stone',
  law_enforcement: 'blue',
  armed_group: 'orange',
  media: 'purple',
  intergovernmental: 'cyan',
  sports: 'lime',
  ngo: 'teal',
  educational: 'amber',
  religious: 'rose',
  // Person
  politician: 'red',
  executive: 'emerald',
  military_leader: 'stone',
  journalist: 'purple',
  athlete: 'lime',
  academic: 'amber',
  entertainer: 'pink',
  activist: 'orange',
  // Location
  country: 'blue',
  city: 'sky',
  region: 'indigo',
  strategic: 'amber',
  territory: 'orange',
  // Event
  conflict: 'red',
  election: 'indigo',
  sports_event: 'lime',
  diplomatic: 'cyan',
  cultural: 'purple',
  disaster: 'orange',
  // Topic
  technology: 'cyan',
  health: 'rose',
  science: 'indigo',
  ideology: 'amber',
  policy: 'blue',
  economic: 'emerald',
}

// ── Subtype alias map (normalizes LLM output) ──────────────────────

const SUBTYPE_ALIASES: Record<string, string> = {
  // Organization aliases
  'corp': 'company', 'corporation': 'company', 'business': 'company', 'tech': 'company', 'bank': 'company', 'firm': 'company',
  'party': 'political_party', 'political': 'political_party',
  'govt': 'government', 'gov': 'government', 'agency': 'government', 'institution': 'government', 'state_agency': 'government',
  'mil': 'military', 'armed_forces': 'military', 'defense': 'military', 'navy': 'military', 'army': 'military',
  'police': 'law_enforcement', 'intelligence': 'law_enforcement', 'security': 'law_enforcement', 'intelligence_agency': 'law_enforcement',
  'militant': 'armed_group', 'terrorist': 'armed_group', 'militia': 'armed_group', 'rebel': 'armed_group', 'insurgent': 'armed_group',
  'news': 'media', 'press': 'media', 'broadcaster': 'media', 'outlet': 'media', 'streaming': 'media', 'social_media': 'media',
  'international': 'intergovernmental', 'igo': 'intergovernmental', 'multilateral': 'intergovernmental',
  'sport': 'sports', 'team': 'sports', 'club': 'sports', 'league': 'sports',
  'nonprofit': 'ngo', 'non_profit': 'ngo', 'charity': 'ngo', 'foundation': 'ngo', 'civil_society': 'ngo',
  'university': 'educational', 'school': 'educational', 'research': 'educational', 'academy': 'educational',
  'church': 'religious', 'religion': 'religious', 'faith': 'religious',
  // Person aliases
  'politics': 'politician', 'political_leader': 'politician', 'head_of_state': 'politician', 'diplomat': 'politician', 'lawmaker': 'politician',
  'ceo': 'executive', 'business_leader': 'executive', 'entrepreneur': 'executive', 'founder': 'executive',
  'commander': 'military_leader', 'general': 'military_leader', 'admiral': 'military_leader',
  'reporter': 'journalist', 'anchor': 'journalist', 'correspondent': 'journalist', 'editor': 'journalist',
  'player': 'athlete', 'coach': 'athlete', 'sportsperson': 'athlete',
  'scientist': 'academic', 'researcher': 'academic', 'professor': 'academic', 'scholar': 'academic',
  'actor': 'entertainer', 'musician': 'entertainer', 'singer': 'entertainer', 'director': 'entertainer', 'artist': 'entertainer',
  'campaigner': 'activist', 'union_leader': 'activist', 'advocate': 'activist', 'dissident': 'activist',
  // Location aliases
  'nation': 'country', 'state': 'country',
  'town': 'city', 'municipality': 'city', 'capital': 'city', 'metropolitan': 'city',
  'province': 'region', 'area': 'region', 'continent': 'region', 'subregion': 'region',
  'base': 'strategic', 'facility': 'strategic', 'strait': 'strategic', 'installation': 'strategic',
  'disputed': 'territory', 'occupied': 'territory', 'autonomous': 'territory',
  // Event aliases
  'war': 'conflict', 'battle': 'conflict', 'attack': 'conflict', 'operation': 'conflict', 'invasion': 'conflict',
  'vote': 'election', 'referendum': 'election', 'primary': 'election',
  'tournament': 'sports_event', 'championship': 'sports_event', 'match': 'sports_event', 'cup': 'sports_event', 'olympics': 'sports_event',
  'summit': 'diplomatic', 'conference': 'diplomatic', 'treaty': 'diplomatic', 'talks': 'diplomatic', 'negotiations': 'diplomatic',
  'festival': 'cultural', 'holiday': 'cultural', 'celebration': 'cultural', 'ceremony': 'cultural',
  'earthquake': 'disaster', 'hurricane': 'disaster', 'flood': 'disaster', 'wildfire': 'disaster', 'pandemic': 'disaster', 'accident': 'disaster',
  // Topic aliases
  'tech': 'technology', 'ai': 'technology', 'software': 'technology', 'cyber': 'technology', 'digital': 'technology',
  'medical': 'health', 'disease': 'health', 'virus': 'health', 'mental_health': 'health', 'healthcare': 'health',
  'research': 'science', 'physics': 'science', 'biology': 'science', 'chemistry': 'science', 'climate': 'science', 'space': 'science',
  'political_ideology': 'ideology', 'movement': 'ideology', 'philosophy': 'ideology', 'religion': 'ideology',
  'regulation': 'policy', 'law': 'policy', 'legislation': 'policy', 'reform': 'policy', 'sanctions': 'policy',
  'economy': 'economic', 'trade': 'economic', 'finance': 'economic', 'inflation': 'economic', 'market': 'economic',
}

/**
 * Normalize an LLM-returned subtype string into a valid subtype for the given entity type.
 * Returns undefined if the subtype is invalid or doesn't belong to the entity type.
 */
export function normalizeSubtype(type: string, rawSubtype: string | undefined | null): string | undefined {
  if (!rawSubtype) return undefined
  const lower = rawSubtype.toLowerCase().trim().replace(/[\s-]+/g, '_')
  const validSubtypes = ALL_SUBTYPES_BY_TYPE[type]
  if (!validSubtypes) return undefined
  // Direct match
  if (validSubtypes.includes(lower)) return lower
  // Alias match
  const aliased = SUBTYPE_ALIASES[lower]
  if (aliased && validSubtypes.includes(aliased)) return aliased
  return undefined
}

// ── Rule-based classifiers ──────────────────────────────────────────

// --- ORGANIZATIONS ---

const KNOWN_ARMED_GROUPS = new Set([
  'hamas', 'hezbollah', 'taliban', 'isis', 'isil', 'islamic state', 'al-qaeda', 'al qaeda',
  'al-shabab', 'al shabab', 'boko haram', 'houthis', 'ansar allah', 'pkk',
  'eln', 'farc', 'wagner group', 'wagner', 'pyd', 'ypg',
  'islamic jihad', 'palestinian islamic jihad', 'pij',
  'al-nusra', 'jabhat al-nusra', 'hayat tahrir al-sham', 'hts',
  'eta', 'ira', 'provisional ira', 'real ira',
])

const KNOWN_INTERGOVERNMENTAL = new Set([
  'united nations', 'european union', 'nato', 'north atlantic treaty organization',
  'world health organization', 'world trade organization', 'world bank',
  'international monetary fund', 'imf', 'african union',
  'asean', 'association of southeast asian nations', 'opec', 'brics',
  'g7', 'g20', 'g-7', 'g-20', 'oecd',
  'international court of justice', 'international criminal court',
  'european central bank', 'european commission', 'european parliament', 'european council',
  'un security council', 'unesco', 'unicef', 'unhcr',
  'international atomic energy agency', 'iaea',
  'world food programme', 'wfp',
  'interpol',
  'arab league', 'league of arab states',
  'osce', 'mercosur', 'gulf cooperation council', 'gcc',
])

const KNOWN_MEDIA = new Set([
  'bbc', 'cnn', 'fox news', 'msnbc', 'nbc', 'abc news', 'cbs news', 'pbs',
  'reuters', 'associated press', 'ap', 'afp', 'agence france-presse',
  'new york times', 'washington post', 'wall street journal', 'los angeles times',
  'the guardian', 'the telegraph', 'daily mail', 'the times', 'financial times',
  'der spiegel', 'spiegel', 'bild', 'die zeit', 'süddeutsche zeitung', 'faz', 'frankfurter allgemeine',
  'le monde', 'le figaro', 'libération',
  'el país', 'el mundo', 'la vanguardia', 'abc (spain)',
  'al jazeera', 'al arabiya', 'rt', 'russia today',
  'xinhua', 'cgtn', 'south china morning post',
  'nhk', 'kyodo news',
  'times of india', 'ndtv', 'the hindu',
  'sky news', 'euronews', 'dw', 'deutsche welle', 'france 24',
  'bloomberg', 'cnbc', 'business insider', 'forbes', 'fortune',
  'politico', 'axios', 'the hill', 'vox', 'the intercept', 'huffpost',
  'buzzfeed', 'vice news', 'breitbart', 'infowars',
  'tiktok', 'youtube', 'facebook', 'instagram', 'twitter', 'x (twitter)',
  'netflix', 'disney', 'disney+', 'hbo', 'hulu', 'spotify',
  'meta', 'alphabet',
])

const KNOWN_POLITICAL_PARTIES = new Set([
  // US
  'republican party', 'republican national committee', 'rnc',
  'democratic party', 'democratic national committee', 'dnc',
  // UK
  'labour party', 'labour', 'conservative party', 'conservatives', 'tories',
  'liberal democrats', 'reform uk', 'snp', 'scottish national party',
  // Germany
  'cdu', 'csu', 'spd', 'fdp', 'afd', 'alternative for germany', 'alternative für deutschland',
  'bündnis 90/die grünen', 'die grünen', 'die linke', 'bsw',
  // France
  'renaissance', 'rassemblement national', 'les républicains',
  'la france insoumise', 'parti socialiste',
  // Spain
  'psoe', 'partido popular', 'pp', 'vox', 'podemos', 'sumar',
  // Italy
  'fratelli d\'italia', 'lega', 'forza italia', 'movimento 5 stelle',
  // Other
  'likud', 'fidesz', 'pis', 'law and justice', 'akp',
  'bharatiya janata party', 'bjp', 'indian national congress',
  'communist party of china', 'cpc',
])

const KNOWN_NGO = new Set([
  'amnesty international', 'human rights watch', 'greenpeace',
  'red cross', 'red crescent', 'icrc', 'doctors without borders', 'médecins sans frontières', 'msf',
  'world economic forum', 'wef',
  'oxfam', 'save the children', 'care international',
  'transparency international', 'reporters without borders', 'rsf',
  'aclu', 'eff', 'electronic frontier foundation',
  'bill & melinda gates foundation', 'gates foundation',
  'open society foundations', 'ford foundation', 'rockefeller foundation',
  'wwf', 'world wildlife fund',
])

const KNOWN_SPORTS_ORGS = new Set([
  // Football (soccer)
  'real madrid', 'fc barcelona', 'barcelona', 'atletico madrid', 'atlético de madrid',
  'bayern munich', 'bayern münchen', 'borussia dortmund', 'bvb',
  'manchester united', 'manchester city', 'liverpool', 'chelsea', 'arsenal', 'tottenham',
  'paris saint-germain', 'psg', 'juventus', 'ac milan', 'inter milan', 'as roma',
  'ajax', 'benfica', 'porto',
  // Leagues
  'la liga', 'premier league', 'bundesliga', 'serie a', 'ligue 1',
  'champions league', 'uefa', 'fifa', 'mls',
  // US sports
  'nba', 'nfl', 'mlb', 'nhl', 'pga',
  // Other
  'ioc', 'international olympic committee',
  'formula 1', 'f1', 'world athletics', 'world rugby',
  'atp', 'wta', 'itf',
])

const KNOWN_RELIGIOUS = new Set([
  'vatican', 'holy see', 'catholic church', 'roman catholic church',
  'church of england', 'anglican church',
  'southern baptist convention', 'evangelical church',
  'al-azhar', 'al azhar',
])

const KNOWN_LAW_ENFORCEMENT = new Set([
  'fbi', 'federal bureau of investigation',
  'cia', 'central intelligence agency',
  'nsa', 'national security agency',
  'dea', 'drug enforcement administration',
  'atf', 'secret service', 'us marshals',
  'mi5', 'mi6', 'gchq',
  'mossad', 'shin bet',
  'fsb', 'svr', 'gru',
  'bnd', 'bundesnachrichtendienst',
  'dgse', 'dgsi',
  'cni', 'guardia civil',
  'metropolitan police', 'scotland yard',
  'europol',
])

export function classifyOrgSubtype(name: string, description?: string): OrgSubtype | undefined {
  const lower = name.toLowerCase().trim()

  // Armed groups (check first — most specific)
  if (KNOWN_ARMED_GROUPS.has(lower)) return 'armed_group'

  // Intergovernmental
  if (KNOWN_INTERGOVERNMENTAL.has(lower)) return 'intergovernmental'

  // Political parties
  if (KNOWN_POLITICAL_PARTIES.has(lower)) return 'political_party'

  // Sports
  if (KNOWN_SPORTS_ORGS.has(lower)) return 'sports'

  // Media
  if (KNOWN_MEDIA.has(lower)) return 'media'

  // Law enforcement / intelligence
  if (KNOWN_LAW_ENFORCEMENT.has(lower)) return 'law_enforcement'

  // NGO
  if (KNOWN_NGO.has(lower)) return 'ngo'

  // Religious
  if (KNOWN_RELIGIOUS.has(lower)) return 'religious'

  // Regex patterns
  if (/\b(?:FC|CF|AC|SC|SV|TSV|VfB|VfL|1\. FC|Borussia|Sporting|Atlético|Olympique)\s/i.test(name)) return 'sports'
  if (/\b(?:United|City|Rovers|Wanderers|Athletic)\s*(?:FC|CF)?$/i.test(name)) return 'sports'

  if (/\b(?:Party|Partido|Partei|Parti|Partij|Partito)\b/i.test(name)) return 'political_party'

  if (/\b(?:USS |HMS |HMAS |INS |KRI |ARA |Bundeswehr|Navy|Air Force|Marine Corps|Army|armed forces|Coast Guard)\b/i.test(name)) return 'military'

  if (/\b(?:Police|Polizei|Policía|Polizia|Gendarmerie|Carabinieri)\b/i.test(name)) return 'law_enforcement'

  if (/\b(?:Department of|Ministry of|Ministerio de|Ministère|Tribunal|Court|Congress|Parliament|Bundestag|Senate|House of Representatives|Duma|Knesset|Assemblée|Cortes)\b/i.test(name)) return 'government'
  if (/\b(?:Pentagon|White House|Downing Street|Élysée|Kremlin)\b/i.test(name)) return 'government'
  if (/\b(?:Supreme Court|Constitutional Court|High Court|Federal Court)\b/i.test(name)) return 'government'

  if (/\b(?:University|Universität|Universidad|Université|Università|Institut|Institute of Technology|MIT|Caltech|ETH)\b/i.test(name)) return 'educational'
  if (/^(?:NASA|ESA|CERN|DARPA|NIH|CDC|NOAA)$/i.test(name)) return 'educational'

  if (/\b(?:Inc\.?|Corp\.?|GmbH|AG|Ltd\.?|plc|S\.?A\.?|S\.?p\.?A\.?|Co\.?|LLC|N\.?V\.?|B\.?V\.?|KG|SE|AB|AS|Oy|Oyj)\b/i.test(name)) return 'company'

  if (/\b(?:News|Times|Post|Journal|Tribune|Herald|Gazette|Chronicle|Telegraph|Observer|Enquirer|Dispatch|Zeitung|Corriere|Stampa)\b/i.test(name)) return 'media'
  if (/\b(?:TV|Television|Broadcasting|Radio|Channel)\b/i.test(name)) return 'media'

  // Description-based fallback
  if (description) {
    return classifyOrgByDescription(description)
  }

  return undefined
}

function classifyOrgByDescription(desc: string): OrgSubtype | undefined {
  const lower = desc.toLowerCase()
  const scores: Partial<Record<OrgSubtype, number>> = {}

  const keywords: Record<OrgSubtype, string[]> = {
    company: ['company', 'corporation', 'tech', 'manufacturer', 'automaker', 'bank', 'financial', 'pharmaceutical', 'conglomerate', 'startup', 'enterprise', 'firm', 'business', 'retailer', 'e-commerce', 'software', 'chipmaker', 'semiconductor', 'oil', 'energy company', 'airline', 'telecom'],
    political_party: ['political party', 'party', 'coalition', 'left-wing', 'right-wing', 'far-right', 'far-left', 'centrist', 'conservative party', 'liberal party', 'social democrat'],
    government: ['government', 'ministry', 'department', 'agency', 'federal', 'state agency', 'bureau', 'administration', 'parliament', 'congress', 'senate', 'court', 'judiciary', 'legislative', 'executive branch', 'regulatory', 'customs'],
    military: ['military', 'armed forces', 'defense force', 'navy', 'air force', 'marines', 'army', 'missile', 'warship', 'carrier strike'],
    law_enforcement: ['police', 'law enforcement', 'intelligence agency', 'intelligence service', 'spy agency', 'security service', 'counterterrorism', 'investigation bureau'],
    armed_group: ['militant', 'terrorist', 'insurgent', 'guerrilla', 'paramilitary', 'rebel group', 'armed group', 'extremist', 'jihadist', 'militia'],
    media: ['news', 'media', 'broadcaster', 'newspaper', 'outlet', 'network', 'television', 'streaming', 'social media', 'press agency', 'wire service', 'magazine', 'publication', 'podcast'],
    intergovernmental: ['international organization', 'intergovernmental', 'multilateral', 'united nations', 'european union', 'alliance', 'treaty organization', 'bloc'],
    sports: ['football', 'soccer', 'basketball', 'baseball', 'tennis', 'cricket', 'rugby', 'sports team', 'club', 'league', 'athletic', 'racing'],
    ngo: ['non-governmental', 'ngo', 'nonprofit', 'non-profit', 'charity', 'humanitarian', 'advocacy', 'human rights', 'foundation', 'civil society', 'think tank'],
    educational: ['university', 'college', 'school', 'institute', 'research', 'academic', 'laboratory', 'space agency', 'scientific'],
    religious: ['church', 'religious', 'faith', 'vatican', 'mosque', 'temple', 'diocese', 'archdiocese', 'clergy'],
  }

  for (const [subtype, kws] of Object.entries(keywords)) {
    let score = 0
    for (const kw of kws) {
      if (lower.includes(kw)) score++
    }
    if (score > 0) scores[subtype as OrgSubtype] = score
  }

  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return undefined
  if (entries.length === 1) return entries[0][0] as OrgSubtype
  // Require 2x lead over runner-up
  if (entries[0][1] >= entries[1][1] * 2) return entries[0][0] as OrgSubtype
  // If top two are tied or close, return first if it has 2+ hits
  if (entries[0][1] >= 2) return entries[0][0] as OrgSubtype
  return undefined
}

// --- PERSONS ---

const KNOWN_POLITICIANS = new Set([
  'donald trump', 'joe biden', 'kamala harris', 'barack obama', 'hillary clinton',
  'mike pence', 'marco rubio', 'jd vance', 'ron desantis', 'nancy pelosi',
  'mitch mcconnell', 'chuck schumer', 'mike johnson', 'bernie sanders',
  'pete hegseth', 'tulsi gabbard', 'kristi noem', 'kash patel',
  'volodymyr zelenskyy', 'volodymyr zelensky', 'vladimir putin',
  'emmanuel macron', 'olaf scholz', 'keir starmer', 'rishi sunak', 'boris johnson',
  'pedro sánchez', 'pedro sanchez', 'giorgia meloni', 'ursula von der leyen',
  'benjamin netanyahu', 'netanyahu', 'xi jinping', 'narendra modi',
  'recep tayyip erdogan', 'erdoğan', 'bashar al-assad', 'kim jong un',
  'lula da silva', 'andrés manuel lópez obrador', 'amlo',
  'justin trudeau', 'anthony albanese', 'fumio kishida', 'shigeru ishiba',
  'mohammed bin salman', 'mbs',
  'hassan nasrallah', 'ismail haniyeh', 'yahya sinwar',
  'alexander lukashenko', 'viktor orbán', 'viktor orban',
  'friedrich merz', 'robert habeck', 'christian lindner', 'markus söder',
  'alice weidel', 'sahra wagenknecht', 'boris pistorius',
  'marine le pen', 'jean-luc mélenchon',
  'alberto núñez feijóo', 'santiago abascal', 'yolanda díaz',
  'sergei lavrov', 'dmitry medvedev',
  'antony blinken', 'lloyd austin', 'jake sullivan',
  'mark rutte', 'jens stoltenberg',
])

const KNOWN_EXECUTIVES = new Set([
  'elon musk', 'tim cook', 'satya nadella', 'sundar pichai', 'mark zuckerberg',
  'jeff bezos', 'sam altman', 'jensen huang', 'andy jassy', 'larry fink',
  'jamie dimon', 'warren buffett', 'bill gates', 'reed hastings',
  'bob iger', 'lisa su', 'pat gelsinger', 'arvind krishna',
  'dara khosrowshahi', 'brian chesky', 'daniel ek',
])

export function classifyPersonSubtype(name: string, description?: string): PersonSubtype | undefined {
  const lower = name.toLowerCase().trim()

  if (KNOWN_POLITICIANS.has(lower)) return 'politician'
  if (KNOWN_EXECUTIVES.has(lower)) return 'executive'

  // Description-based
  if (description) {
    const dl = description.toLowerCase()
    const scores: Partial<Record<PersonSubtype, number>> = {}

    const keywords: Record<PersonSubtype, string[]> = {
      politician: ['president', 'prime minister', 'chancellor', 'minister', 'senator', 'congressman', 'congresswoman', 'governor', 'mayor', 'ambassador', 'diplomat', 'lawmaker', 'legislator', 'political leader', 'head of state', 'secretary of state', 'foreign minister', 'defense minister', 'mp ', 'member of parliament'],
      executive: ['ceo', 'chief executive', 'founder', 'co-founder', 'chairman', 'chairwoman', 'president of', 'chief operating', 'chief technology', 'cfo', 'cto', 'coo', 'business leader', 'entrepreneur', 'billionaire', 'tech mogul', 'tycoon'],
      military_leader: ['general', 'admiral', 'commander', 'military chief', 'defense chief', 'joint chiefs', 'field marshal', 'colonel', 'warlord'],
      journalist: ['journalist', 'reporter', 'anchor', 'correspondent', 'editor', 'columnist', 'commentator', 'broadcaster', 'news presenter'],
      athlete: ['player', 'footballer', 'tennis player', 'basketball player', 'quarterback', 'striker', 'goalkeeper', 'coach', 'manager (sports)', 'olympic', 'champion', 'world record'],
      academic: ['professor', 'scientist', 'researcher', 'dr.', 'physicist', 'economist', 'biologist', 'historian', 'sociologist', 'Nobel laureate', 'scholar'],
      entertainer: ['actor', 'actress', 'singer', 'musician', 'director', 'filmmaker', 'comedian', 'rapper', 'artist', 'performer', 'producer (film)', 'screenwriter', 'pop star', 'rock star'],
      activist: ['activist', 'campaigner', 'advocate', 'dissident', 'protester', 'union leader', 'rights defender', 'whistleblower', 'environmentalist'],
    }

    for (const [subtype, kws] of Object.entries(keywords)) {
      let score = 0
      for (const kw of kws) {
        if (dl.includes(kw)) score++
      }
      if (score > 0) scores[subtype as PersonSubtype] = score
    }

    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1])
    if (entries.length >= 1 && entries[0][1] >= 1) return entries[0][0] as PersonSubtype
  }

  return undefined
}

// --- LOCATIONS ---

// Major countries for quick classification
const KNOWN_COUNTRIES = new Set([
  'united states', 'china', 'russia', 'india', 'japan', 'germany', 'france',
  'united kingdom', 'brazil', 'italy', 'canada', 'australia', 'south korea',
  'north korea', 'spain', 'mexico', 'indonesia', 'turkey', 'saudi arabia',
  'iran', 'iraq', 'israel', 'egypt', 'south africa', 'nigeria', 'pakistan',
  'argentina', 'colombia', 'thailand', 'vietnam', 'poland', 'ukraine',
  'netherlands', 'belgium', 'sweden', 'norway', 'denmark', 'finland',
  'switzerland', 'austria', 'czech republic', 'czechia', 'portugal', 'greece',
  'romania', 'hungary', 'ireland', 'new zealand', 'singapore', 'malaysia',
  'philippines', 'taiwan', 'afghanistan', 'syria', 'lebanon', 'jordan',
  'yemen', 'libya', 'tunisia', 'morocco', 'algeria', 'ethiopia', 'kenya',
  'somalia', 'sudan', 'myanmar', 'bangladesh', 'sri lanka', 'nepal',
  'cuba', 'venezuela', 'chile', 'peru', 'ecuador', 'bolivia',
  'united arab emirates', 'qatar', 'kuwait', 'bahrain', 'oman',
  'palestine', 'north macedonia', 'serbia', 'croatia', 'bosnia and herzegovina',
  'montenegro', 'albania', 'kosovo', 'moldova', 'georgia', 'armenia',
  'azerbaijan', 'kazakhstan', 'uzbekistan', 'turkmenistan',
  'laos', 'cambodia', 'mongolia', 'papua new guinea',
  'democratic republic of the congo', 'republic of the congo',
  'ivory coast', 'ghana', 'cameroon', 'senegal', 'mali', 'niger',
  'chad', 'central african republic', 'eritrea', 'djibouti',
  'rwanda', 'burundi', 'uganda', 'tanzania', 'mozambique',
  'zimbabwe', 'zambia', 'angola', 'namibia', 'botswana', 'madagascar',
  'soviet union',
])

const KNOWN_CITIES = new Set([
  'washington', 'washington d.c.', 'new york', 'new york city', 'los angeles', 'chicago',
  'london', 'paris', 'berlin', 'madrid', 'rome', 'moscow', 'beijing', 'tokyo',
  'seoul', 'delhi', 'new delhi', 'mumbai', 'shanghai', 'hong kong',
  'istanbul', 'ankara', 'cairo', 'riyadh', 'dubai', 'abu dhabi', 'doha', 'tehran',
  'baghdad', 'damascus', 'beirut', 'jerusalem', 'tel aviv', 'ramallah',
  'kyiv', 'kiev', 'warsaw', 'prague', 'budapest', 'bucharest', 'vienna', 'zurich', 'geneva',
  'brussels', 'amsterdam', 'copenhagen', 'stockholm', 'oslo', 'helsinki',
  'lisbon', 'athens', 'dublin', 'edinburgh',
  'toronto', 'ottawa', 'montreal', 'vancouver',
  'sydney', 'melbourne', 'canberra', 'auckland', 'wellington',
  'são paulo', 'rio de janeiro', 'brasília', 'buenos aires', 'bogotá', 'lima', 'santiago',
  'mexico city', 'havana', 'caracas',
  'nairobi', 'lagos', 'johannesburg', 'cape town', 'addis ababa', 'accra',
  'bangkok', 'hanoi', 'ho chi minh city', 'singapore', 'kuala lumpur', 'jakarta', 'manila',
  'kabul', 'islamabad', 'karachi', 'dhaka', 'colombo', 'kathmandu',
  'gaza city', 'rafah', 'khan younis',
  'san francisco', 'houston', 'dallas', 'miami', 'atlanta', 'boston', 'seattle', 'denver',
  'detroit', 'phoenix', 'philadelphia', 'san diego', 'las vegas', 'portland', 'austin',
  'barcelona', 'valencia', 'seville', 'bilbao', 'málaga',
  'munich', 'hamburg', 'frankfurt', 'cologne', 'düsseldorf', 'stuttgart', 'dresden', 'leipzig',
  'marseille', 'lyon', 'toulouse', 'nice', 'strasbourg',
  'milan', 'naples', 'turin', 'florence', 'venice',
  'pyongyang', 'taipei',
  'minsk', 'tbilisi', 'yerevan', 'baku',
  'kharkiv', 'odesa', 'zaporizhzhia', 'dnipro', 'mariupol', 'kherson',
])

const KNOWN_REGIONS = new Set([
  'middle east', 'north africa', 'sub-saharan africa', 'east africa', 'west africa',
  'central asia', 'southeast asia', 'south asia', 'east asia',
  'eastern europe', 'western europe', 'southern europe', 'northern europe',
  'latin america', 'central america', 'south america', 'north america',
  'caribbean', 'pacific', 'asia-pacific', 'indo-pacific',
  'europe', 'africa', 'asia', 'americas', 'oceania', 'arctic', 'antarctica',
  'sahel', 'balkans', 'caucasus', 'levant', 'gulf', 'persian gulf', 'arabian peninsula',
  'gaza strip', 'west bank', 'golan heights',
  'donbas', 'donbass', 'crimea', 'transnistria',
  'xinjiang', 'tibet', 'inner mongolia',
  'kashmir', 'kurdistan',
  'silicon valley', 'wall street',
  'catalonia', 'basque country', 'scotland', 'wales', 'northern ireland',
  'bavaria', 'saxony', 'north rhine-westphalia',
  'normandy', 'brittany', 'provence',
  'andalusia', 'galicia',
  'lombardy', 'sicily', 'sardinia',
  'california', 'texas', 'florida', 'new england',
])

const KNOWN_STRATEGIC = new Set([
  'strait of hormuz', 'suez canal', 'strait of malacca', 'bosphorus', 'dardanelles',
  'south china sea', 'taiwan strait', 'black sea', 'red sea', 'baltic sea', 'mediterranean',
  'white house', 'kremlin', 'élysée palace', 'downing street', 'capitol hill',
  'pentagon', 'camp david', 'mar-a-lago',
  'guantanamo bay', 'ramstein', 'incirlik', 'diego garcia',
  'chernobyl', 'fukushima', 'zaporizhzhia nuclear',
  'temple mount', 'al-aqsa',
])

const KNOWN_TERRITORIES = new Set([
  'west bank', 'crimea', 'donbas', 'transnistria',
  'northern cyprus', 'south ossetia', 'abkhazia',
  'nagorno-karabakh', 'western sahara',
  'falkland islands', 'malvinas',
  'puerto rico', 'guam', 'american samoa',
  'hong kong', 'macau',
])

export function classifyLocationSubtype(name: string, description?: string): LocationSubtype | undefined {
  const lower = name.toLowerCase().trim()

  if (KNOWN_COUNTRIES.has(lower)) return 'country'
  if (KNOWN_CITIES.has(lower)) return 'city'
  if (KNOWN_TERRITORIES.has(lower)) return 'territory'
  if (KNOWN_STRATEGIC.has(lower)) return 'strategic'
  if (KNOWN_REGIONS.has(lower)) return 'region'

  // Pattern matching
  if (/\b(?:Republic of|Kingdom of|State of|People's Republic of|Federation of)\b/i.test(name)) return 'country'
  if (/\b(?:Province|Oblast|Prefecture|Canton|County|State of|District of|Département)\b/i.test(name)) return 'region'
  if (/\b(?:Strait of|Canal|Sea of|Gulf of|Bay of|Channel|Cape|Mount|Island of)\b/i.test(name)) return 'strategic'

  // Description-based
  if (description) {
    const dl = description.toLowerCase()
    if (/\bcountry\b|\bnation\b|\bsovereign state\b/i.test(dl)) return 'country'
    if (/\bcity\b|\bcapital of\b|\bmetropolis\b|\bmunicipality\b/i.test(dl)) return 'city'
    if (/\bregion\b|\bcontinent\b|\barea\b|\bzone\b/i.test(dl)) return 'region'
    if (/\bterritory\b|\bdisputed\b|\boccupied\b|\bautonomous\b/i.test(dl)) return 'territory'
    if (/\bstrategic\b|\bstrait\b|\bnaval base\b|\bmilitary base\b/i.test(dl)) return 'strategic'
  }

  return undefined
}

// --- EVENTS ---

export function classifyEventSubtype(name: string, description?: string): EventSubtype | undefined {
  const lower = name.toLowerCase().trim()

  // Pattern matching
  if (/\b(?:war|operation|offensive|siege|bombing|strike|battle|invasion|conflict|attack|insurgency|intifada)\b/i.test(lower)) return 'conflict'
  if (/\b(?:election|vote|referendum|primary|ballot|runoff|caucus)\b/i.test(lower)) return 'election'
  if (/\b(?:cup|championship|league|tournament|open|grand prix|olympics|world series|super bowl|match)\b/i.test(lower)) return 'sports_event'
  if (/\b(?:summit|conference|accord|treaty|talks|negotiations|peace process|ceasefire|deal)\b/i.test(lower)) return 'diplomatic'
  if (/\b(?:festival|holiday|celebration|ceremony|ramadan|christmas|easter|eid|lunar new year|semana santa)\b/i.test(lower)) return 'cultural'
  if (/\b(?:earthquake|hurricane|typhoon|cyclone|flood|tsunami|wildfire|eruption|famine|pandemic|outbreak|drought|landslide)\b/i.test(lower)) return 'disaster'

  // Description fallback
  if (description) {
    const dl = description.toLowerCase()
    if (/\b(?:military|combat|armed|warfare)\b/i.test(dl)) return 'conflict'
    if (/\b(?:voters|electoral|polling|elected)\b/i.test(dl)) return 'election'
    if (/\b(?:sports|athletic|competition|championship)\b/i.test(dl)) return 'sports_event'
    if (/\b(?:diplomatic|international meeting|bilateral|multilateral)\b/i.test(dl)) return 'diplomatic'
    if (/\b(?:cultural|religious|traditional|ceremonial)\b/i.test(dl)) return 'cultural'
    if (/\b(?:natural disaster|catastrophe|emergency|devastation)\b/i.test(dl)) return 'disaster'
  }

  return undefined
}

// --- TOPICS ---

export function classifyTopicSubtype(name: string, description?: string): TopicSubtype | undefined {
  const lower = name.toLowerCase().trim()

  // Pattern matching
  if (/\b(?:artificial intelligence|machine learning|deep learning|AI|blockchain|cryptocurrency|quantum computing|5G|6G|cybersecurity|ransomware|malware|software|robotics|autonomous|VR|AR|metaverse|cloud computing|internet of things|IoT)\b/i.test(lower)) return 'technology'
  if (/\b(?:COVID|coronavirus|pandemic|epidemic|disease|cancer|diabetes|virus|vaccine|mental health|obesity|drug|opioid|fentanyl|mpox|ebola|malaria|tuberculosis|HIV|AIDS|influenza|bird flu|health care|healthcare)\b/i.test(lower)) return 'health'
  if (/\b(?:climate change|global warming|space exploration|genome|CRISPR|fusion|particle|asteroid|exoplanet|dark matter|neuroscience|evolution|biodiversity|renewable energy|nuclear|stem cell)\b/i.test(lower)) return 'science'
  if (/\b(?:communism|fascism|socialism|capitalism|liberalism|conservatism|populism|nationalism|feminism|islamism|woke|anti-|extremism|radicalism|authoritarianism|democracy|anarchism)\b/i.test(lower)) return 'ideology'
  if (/\b(?:immigration|abortion|gun control|death penalty|privacy|surveillance|censorship|regulation|deregulation|sanctions|tariff|embargo|reform|legislation|mandate|ban)\b/i.test(lower)) return 'policy'
  if (/\b(?:inflation|recession|GDP|unemployment|trade war|supply chain|debt ceiling|interest rate|stock market|housing market|crypto market|economic|economy)\b/i.test(lower)) return 'economic'

  // Description fallback
  if (description) {
    const dl = description.toLowerCase()
    if (/\b(?:technology|software|digital|computing|algorithm|data|cyber)\b/i.test(dl)) return 'technology'
    if (/\b(?:health|medical|disease|treatment|patients|clinical|pharmaceutical)\b/i.test(dl)) return 'health'
    if (/\b(?:scientific|research|discovery|study|theory|experiment)\b/i.test(dl)) return 'science'
    if (/\b(?:ideology|political movement|belief system|doctrine|philosophy)\b/i.test(dl)) return 'ideology'
    if (/\b(?:policy|regulation|legislation|law|mandate|government program)\b/i.test(dl)) return 'policy'
    if (/\b(?:economic|financial|monetary|fiscal|trade|market|GDP)\b/i.test(dl)) return 'economic'
  }

  return undefined
}

// ── Master classifier ───────────────────────────────────────────────

/**
 * Classify the subtype of any entity using rule-based matching.
 * Returns undefined if no confident match.
 */
export function classifySubtype(type: string, name: string, description?: string): string | undefined {
  switch (type) {
    case 'organization': return classifyOrgSubtype(name, description)
    case 'person': return classifyPersonSubtype(name, description)
    case 'location': return classifyLocationSubtype(name, description)
    case 'event': return classifyEventSubtype(name, description)
    case 'topic': return classifyTopicSubtype(name, description)
    default: return undefined
  }
}
