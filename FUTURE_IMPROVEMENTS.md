# Future Improvements

Last reviewed: 2026-03-23

## Completed

### /topics → /entities (DONE)
- Replaced with a full **entity browser** at `/entities`.
- Tabbed interface (People, Organizations, Locations, Events) with search, sort, pagination.
- `/topics` now redirects 301 to `/entities`.
- Network graph moved to individual entity detail pages with fullscreen support.

### /location/{slug} - OpenStreetMap (DONE)
- Leaflet map with CartoDB Voyager tiles, auto-geocoded via Nominatim.
- Fullscreen support with scroll wheel zoom toggle.

### Entity Network Graph on Detail Pages (DONE)
- All four entity types (person, organization, location, event) now show an interactive D3 network graph.
- Fullscreen toggle with proper re-rendering on size change.

---

## Tier 1: Performance & Data Integrity

_Breaks things if ignored. Fix these before adding features._

### 1. Fix N+1 Query Explosions

**Problem:** Multiple API endpoints make hundreds of individual DB queries per request.

- `server/api/articles.get.ts:110-151` — loops through ~50 articles, making ~7 queries each (keywords, entities, classifications, etc.). That's ~350 queries per page load.
- `server/api/dashboard.get.ts:93-102` — fetches entities one-by-one in a loop.

**Fix:** Batch-fetch with `inArray()` for all article IDs at once. Collect all IDs first, run one query per join table, then map results back to articles in JS.

**Impact:** 350 queries → ~5 queries per request. Massive latency and DB load reduction.

### 2. Entity Deduplication System

**Problem:** 56k+ entities with massive duplication ("Trump" / "Donald Trump" / "Donald J. Trump", "EU" / "European Union").

**Approach:**
1. Fuzzy name matching (Jaro-Winkler distance) as fast pre-filter
2. Embedding similarity between entity names for borderline cases
3. Admin merge UI for manual review and bulk operations (see Tier 4, item #14)
4. Merge tool that reassigns all `article_entities` + `story_entities` references

**Impact:** Accurate mention counts, clean entity pages, reliable network graphs.

### 3. Article Near-Duplicate Detection

**Problem:** SHA-256 catches exact dupes but syndicated/cross-posted content slips through with minor formatting differences.

**Approach:**
1. Title fuzzy match as fast pre-filter (Jaro-Winkler > 0.85)
2. Embedding cosine similarity for flagged pairs (> 0.95 threshold = duplicate)
3. Prefer the highest-quality source when duplicates found (longest content, best extraction)

**Impact:** Cleaner story clusters, accurate article counts per entity.

### 4. Add Missing Database Indexes

**Problem:** Key query patterns lack supporting indexes, causing full table scans.

**Add these indexes:**
- `articles(excluded, content_extracted, published_at DESC)` — used in every article listing query
- `article_entities(entity_id, relevance_score DESC)` — entity page article lookups
- `classifications(article_id, language)` — language filtering joins
- `story_members(story_id, is_representative) INCLUDE (article_id)` — covering index for story queries

**Impact:** Immediate query speedup, especially on article listing and entity pages.

---

## Tier 2: Discoverability

_Determines whether anyone finds the site. SEO and search are table stakes._

### 5. SEO: Open Graph + Twitter Cards + Structured Data

**Problem:** Zero `og:image`/`og:title`/`twitter:card` tags on any page. Social sharing shows blank previews. Google has no structured data to parse.

**Fix:**
- Add Open Graph and Twitter Card meta tags to all public pages (articles, stories, entities, frontpage)
- Add JSON-LD structured data (`NewsArticle` schema) to article detail pages
- Use `useHead()` / `useSeoMeta()` in each page component

**Impact:** Social sharing actually works. Google rich results become possible.

### 6. Sitemap.xml Generation

**Problem:** No sitemap exists. Google has to guess which pages exist.

**Fix:**
- Generate dynamic `sitemap.xml` with all articles, stories, and entity pages
- Add `sitemap` entry to `robots.txt`
- Use `nuxt-simple-sitemap` or a custom server route at `/sitemap.xml`
- Include `<lastmod>` timestamps and `<changefreq>` hints

**Impact:** Google indexes the full site instead of a random subset.

### 7. Search Improvements

**Problem:** Current search is ILIKE-based (slow), has no filters, no pagination, and caps at 50 results.

**Fix:**
- Add filter controls: date range, political bias, language, entity type
- Add proper pagination to search results
- Consider PostgreSQL full-text search (`tsvector`/`tsquery`) for relevance ranking
- Long-term: leverage existing article embeddings for semantic search

**Impact:** Users can actually find specific content.

### 8. Frontpage Redesign

**Problem:** Current frontpage doesn't differentiate from `/stories`. First-time visitors have no idea what Newsar does differently.

**Recommended approach:** Hybrid layout —
- Hero section with Newsar's value proposition (multi-perspective, bias classification)
- Top trending story with coverage diversity visualization (left/center/right bars)
- Trending entities section (people, orgs in the news)
- "Latest stories" grid below
- Must make clear what makes Newsar different from a standard news aggregator

**Impact:** First impressions, user retention, explains the product.

---

## Tier 3: Reliability & Resilience

_Prevents silent degradation. These compound over time if ignored._

### 9. API Response Caching

**Problem:** Zero caching on any endpoint. Every page load hits the database directly.

**Fix:**
- Add Redis cache layer with tiered TTLs:
  - Dashboard stats: 60s
  - Trending stories: 2-5 min
  - Trending entities: 10 min
  - Entity summaries: until explicitly invalidated
  - Article detail: 5 min
- Add `Cache-Control` headers on all public GET endpoints

**Impact:** 10-50x fewer DB queries under load. Much faster page loads.

### 10. Rate Limiting on Public APIs

**Problem:** All endpoints are completely unprotected. A single client can hammer the DB.

**Fix:**
- Add rate limiting middleware: 100 req/min per IP on public endpoints
- Higher limits for admin endpoints (authenticated)
- Return `429 Too Many Requests` with `Retry-After` header
- Use Redis for distributed rate counting

**Impact:** Prevents scraping abuse and accidental DDoS from crawlers.

### 11. Feed Health Monitoring

**Problem:** No tracking of feed errors, no stale feed detection, no quality metrics. Broken feeds silently degrade coverage.

**Fix:**
- Add columns: `feeds.last_error`, `feeds.consecutive_failures`, `feeds.avg_extraction_success_rate`
- Auto-flag feeds with no new articles in 14 days
- Admin dashboard card showing feed health (green/yellow/red per feed)
- Alert when a feed has 5+ consecutive failures

**Impact:** Catch broken feeds before they silently degrade coverage diversity.

### 12. Story Clustering Improvements

**Problem:** No temporal constraints (articles weeks apart can cluster). No story merging. O(n²) comparison complexity.

**Fix:**
- Add temporal constraint: reject articles >72h apart from cluster centroid
- Add story merging: if >50% article overlap between two stories, merge them
- Better representative article selection: highest avg cosine similarity to cluster centroid (not arbitrary first article)
- Consider lowering similarity threshold from 0.80 to 0.72-0.75 for broader multi-perspective coverage
- Optimization: pre-filter candidates by publish date before computing embeddings similarity

**Impact:** Higher-quality story groupings, fewer duplicate stories, better representative articles.

### 13. Content Extraction Robustness

**Problem:** No paywall detection (extracts login prompts as article content). No retry logic (network blip = permanent failure). No domain-specific rules.

**Fix:**
- Paywall pattern detection: check for common paywall markers ("subscribe to read", login forms, truncated content)
- 3-attempt retry with exponential backoff for network failures
- Mark paywall articles with a flag instead of storing garbage content
- Domain-specific extraction rules for major news sites that resist Readability

**Impact:** Higher extraction success rate, fewer garbage articles polluting analysis.

---

## Tier 4: Admin & Operations

_Makes maintenance sustainable as the platform grows._

### 14. Entity Merge Admin UI

**Problem:** Entity deduplication (Tier 1, item #2) needs a human-in-the-loop interface.

**Fix:**
- Admin page to search, compare, and merge duplicate entities
- Side-by-side comparison: mention counts, article overlap, summary previews
- Bulk merge with undo capability (soft-delete the merged entity, keep a redirect reference)
- AI-suggested merge candidates ranked by confidence

**Impact:** Makes entity deduplication actionable. Required for Tier 1 item #2 to work at scale.

### 15. Error Pages (404, 500)

**Problem:** No custom error pages exist. Broken links show raw Nuxt error screens.

**Fix:**
- Add `app/error.vue` with branded design and navigation back to home
- Handle 404 and 500 distinctly with appropriate messaging
- Suggest related content on 404 pages (search or trending stories)

**Impact:** Professional UX on broken links. Reduces bounce rate.

### 16. Public Health Endpoint

**Problem:** No `/api/health` for uptime monitoring. No way to know if the app is degraded.

**Fix:**
- Add `GET /api/health` that checks: PostgreSQL connection, Redis connection, app process uptime
- Return structured JSON with component statuses and response times
- Enables external monitoring (UptimeRobot, Healthchecks.io, etc.)

**Impact:** Catch outages before users notice. Required for any SLA commitment.

### 17. Structured Logging & Error Tracking

**Problem:** Currently `console.log`/`console.error` only. Errors are invisible unless you're watching logs.

**Fix:**
- Add Sentry (or similar) for error aggregation, alerting, and stack traces
- Add structured logging with log levels (debug/info/warn/error) and JSON format
- Include request context (URL, user agent, duration) in log entries

**Impact:** Catch and fix errors before users report them. Operational visibility.

### 18. Feed Quality Dashboard

**Problem:** No visibility into per-feed performance. Can't tell which feeds are valuable vs noisy.

**Fix:**
- Per-feed metrics: articles/day, extraction success rate, avg classification confidence, language distribution
- Highlight worst-performing feeds for review or removal
- Feed discovery suggestions based on coverage gaps (political bias distribution, geographic coverage)

**Impact:** Data-driven feed curation. Better coverage diversity.

---

## Tier 5: Polish & Engagement

_Makes users come back. Nice-to-have features that add real value._

### 19. RSS Output Feeds

**Problem:** No RSS feeds for consuming Newsar content. Power users and RSS readers can't subscribe.

**Fix:**
- `/rss/stories` — trending stories feed
- `/rss/entity/{type}/{slug}` — per-entity feed (e.g., follow all news about a person)
- `/rss/bias/{category}` — feed filtered by political bias
- Standard Atom/RSS 2.0 format with proper metadata

**Impact:** Enables RSS reader users, increases content distribution.

### 20. Story Timeline View

**Problem:** No way to see how a story evolved over time.

**Fix:**
- Chronological timeline showing when each article was added to a story
- Source diversity chart over time (when did left/center/right sources cover it?)
- Visual indicator of story "heat" (article velocity over time)

**Impact:** Unique feature that demonstrates Newsar's multi-perspective value proposition.

### 21. Dark Mode

**Problem:** No dark mode on a content-heavy reading site. Modern expectation.

**Fix:**
- Implement with CSS custom properties (`--color-bg`, `--color-text`, etc.)
- Toggle in header, persist preference in localStorage
- Respect `prefers-color-scheme` media query as default

**Impact:** Better reading experience, especially for evening/night usage.

### 22. Person Portrait Photos

**Problem:** Person entity pages lack photos. Just text and graphs.

**Fix:**
- Source from Wikipedia/Wikidata API as fallback (free, good coverage for public figures)
- Cache locally to avoid repeated API calls
- Fallback to initials avatar if no photo found

**Impact:** More engaging person entity pages.

### 23. Org-Person Relationship Graph

**Problem:** Organization pages don't show associated people, despite the data existing in entity co-occurrences.

**Fix:**
- Filter existing `EntityNetworkGraph` to person↔org edges for the current organization
- Show on organization detail pages as a secondary visualization
- Reuses existing D3 graph components

**Impact:** Richer organization pages with minimal new code.

---

## Tier 6: Future Architecture

_Only needed when scale demands it. Don't build prematurely._

### 24. Database Partitioning

**When:** Articles table exceeds ~500K rows and queries slow down despite indexes.

**Approach:**
- Partition `articles` table by `published_at` (monthly partitions)
- Archive partitions older than 90 days to cheaper storage
- Transparent to application code with PostgreSQL declarative partitioning

### 25. Test Suite

**Problem:** Zero tests exist. No Vitest/Jest configured.

**Priority order:**
1. Clustering algorithm unit tests (most complex, most impactful if broken)
2. Top 5 API endpoint integration tests (articles, stories, entities, dashboard, search)
3. Content extraction edge cases
4. Entity deduplication logic

**Setup:** Vitest + `@nuxt/test-utils` for server-side testing.

### 26. Cursor-Based Pagination

**When:** Offset pagination degrades noticeably (typically beyond ~1000 pages or 50K+ rows per query).

**Approach:**
- Switch to cursor-based pagination (`after=<published_at timestamp>`) for articles and stories
- More efficient than `OFFSET` for deep pagination
- Requires index on the cursor column (already covered by Tier 1 index additions)

---

## Pages That Are Good (No Changes Needed Now)

- `/stories` — Card design could be polished later, but functional and clear.
- `/articles` — Very insightful page. No improvements needed.
- `/entities` — Entity browser working well. Tabs, search, sort, pagination all functional.
- `/person/{slug}` — Working well with summary, articles, and network graph.
- `/organisation/{slug}` — Working well.
- `/location/{slug}` — Good summary, article lists, and OpenStreetMap integration.
