<script setup lang="ts">
import { getOutletTag, NOT_RATED_EXPLANATION } from '~/composables/useOutletProfile'

const route = useRoute()
const storyId = parseInt(route.params.id as string)

const { data: story } = await useFetch<any>(`/api/stories/${storyId}`)

// Stories can dissolve into a successor when articles are reclustered
if (story.value?.redirectTo) {
  await navigateTo(`/stories/${story.value.redirectTo}`, { redirectCode: 301 })
}

const showAllCoverage = ref(false)
const COVERAGE_PREVIEW_DAYS = 3

// ─── Formatting (pinned to en-US + UTC so SSR and client agree) ───

function shortDate(date: string | Date | null) {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

function longDate(date: string | Date | null) {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function timeOfDay(date: string | Date | null) {
  if (!date) return ''
  return new Date(date).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false })
}

function relative(date: string | Date | null) {
  if (!date) return ''
  const hours = Math.floor((Date.now() - new Date(date).getTime()) / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return shortDate(date)
}

/** "Oct 12 – Oct 23"; years appear once the range leaves the current year */
function dateRange(start: string | Date | null, end: string | Date | null) {
  if (!start) return ''
  const thisYear = new Date().getUTCFullYear()
  const startYear = new Date(start).getUTCFullYear()
  const endYear = end ? new Date(end).getUTCFullYear() : startYear
  const withYear = (d: string | Date | null) => new Date(d!).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
  const s = startYear !== endYear || startYear !== thisYear ? withYear(start) : shortDate(start)
  const e = endYear !== thisYear ? withYear(end) : shortDate(end)
  return s === e ? s : `${s} – ${e}`
}

function spanDays(start: string | Date | null, end: string | Date | null) {
  if (!start || !end) return 0
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1)
}

// ─── Hero ───

const latestArticle = computed(() => {
  const list = story.value?.articles || []
  return list[list.length - 1] || null
})

const isDeveloping = computed(() => {
  if (!story.value?.lastUpdated) return false
  return Date.now() - new Date(story.value.lastUpdated).getTime() < 48 * 3_600_000
})

/** Without a narrative, the newest article's summary is the best "what is this" we have */
const fallbackLede = computed(() => {
  if (story.value?.narrative) return null
  const withSummary = [...(story.value?.articles || [])].reverse().find((a: any) => a.summary)
  if (!withSummary) return null
  // The API trims summaries; end on the last full sentence
  const text: string = withSummary.summary
  if (text.length < 320) return text
  const lastStop = text.lastIndexOf('. ')
  return lastStop > 80 ? text.slice(0, lastStop + 1) : text
})

// Activity chart: one bar per day, height = articles that day
const activityMax = computed(() => Math.max(1, ...(story.value?.activity || []).map((d: any) => d.count)))
const activityPeakDay = computed(() => {
  const days = story.value?.activity || []
  return days.reduce((best: any, d: any) => (!best || d.count > best.count ? d : best), null)
})

// ─── Timeline ───

/** Day-by-day fallback when no narrative exists: each day's headlines from distinct outlets */
const dailyHeadlines = computed(() => {
  const byDay = new Map<string, any[]>()
  for (const a of story.value?.articles || []) {
    if (!a.publishedAt) continue
    const day = new Date(a.publishedAt).toISOString().slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(a)
  }
  return [...byDay.entries()].map(([date, list]) => {
    const seen = new Set<number>()
    const picks = list.filter((a) => {
      if (seen.has(a.feedId)) return false
      seen.add(a.feedId)
      return true
    }).slice(0, 2)
    return { date, total: list.length, picks }
  })
})

// ─── Perspectives ───

const coverageSegments = computed(() => {
  const c = story.value?.coverage
  if (!c) return []
  const total = c.leftCount + c.centerCount + c.rightCount + (c.unratedCount || 0)
  if (!total) return []
  return [
    { key: 'left', label: 'Left-leaning', count: c.leftCount, cls: 'bg-intel-blue' },
    { key: 'center', label: 'Center', count: c.centerCount, cls: 'bg-ink-4' },
    { key: 'right', label: 'Right-leaning', count: c.rightCount, cls: 'bg-intel-red' },
    { key: 'unrated', label: 'Not rated', count: c.unratedCount || 0, cls: 'bg-rule' },
  ]
    .filter(s => s.count > 0)
    .map(s => ({ ...s, pct: (s.count / total) * 100 }))
})

const framingTotal = computed(() => (story.value?.framing || []).reduce((s: number, f: any) => s + f.count, 0))

const outletsWithFraming = computed(() => (story.value?.outlets || []).filter((o: any) => o.framing))
const outletsWithoutFraming = computed(() => (story.value?.outlets || []).filter((o: any) => !o.framing))

function outletTag(o: any) {
  return getOutletTag({ bias: o.bias, leanApplicable: o.leanApplicable, ownership: o.ownership, country: o.country })
}

function leanDotClass(o: any) {
  if (o.leanApplicable === false || o.bias === null) return 'bg-rule'
  if (o.bias <= -0.2) return 'bg-intel-blue'
  if (o.bias >= 0.2) return 'bg-intel-red'
  return 'bg-ink-4'
}

// ─── Entities ───

const ENTITY_DOT: Record<string, string> = {
  person: 'bg-blue-500',
  organization: 'bg-green-600',
  location: 'bg-orange-500',
  event: 'bg-purple-500',
  topic: 'bg-teal-500',
}

function entityPath(e: any) {
  return e.slug ? `/${e.type}/${e.slug}` : null
}

// ─── All coverage ───

const coverageDays = computed(() => [...dailyHeadlines.value].reverse().map(d => ({
  date: d.date,
  articles: (story.value?.articles || [])
    .filter((a: any) => a.publishedAt && new Date(a.publishedAt).toISOString().slice(0, 10) === d.date)
    .reverse(),
})))

const visibleCoverageDays = computed(() => showAllCoverage.value
  ? coverageDays.value
  : coverageDays.value.slice(0, COVERAGE_PREVIEW_DAYS))

const hiddenCoverageCount = computed(() => coverageDays.value
  .slice(COVERAGE_PREVIEW_DAYS)
  .reduce((s, d) => s + d.articles.length, 0))

// ─── SEO ───

const siteUrl = 'https://newsar.codejungle.org'
const pageUrl = `${siteUrl}/stories/${storyId}`
const storyTitle = story.value?.headline || 'Story'
const pageTitle = `${storyTitle} - Newsar`
const pageDescription = story.value?.narrative?.lede
  || `How ${story.value?.sourceCount || 0} outlets covered "${storyTitle}" in ${story.value?.articleCount || 0} articles, compared side by side.`

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogUrl: pageUrl,
  ogType: 'article',
  ogSiteName: 'Newsar',
  twitterCard: 'summary',
  twitterTitle: pageTitle,
  twitterDescription: pageDescription,
})

useHead({
  link: [{ rel: 'canonical', href: pageUrl }],
  script: story.value && !story.value.redirectTo ? [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: storyTitle,
      description: pageDescription,
      url: pageUrl,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: story.value.articleCount,
        ...(story.value.entities?.length && {
          about: story.value.entities.map((e: any) => ({
            '@type': e.type === 'person' ? 'Person' : e.type === 'organization' ? 'Organization' : 'Thing',
            name: e.name,
          })),
        }),
      },
      ...(story.value.lastUpdated && { dateModified: story.value.lastUpdated }),
      publisher: { '@type': 'Organization', name: 'Newsar' },
    }),
  }] : [],
})
</script>

<template>
  <div v-if="story && !story.redirectTo" class="intel-wrap max-w-[1180px]">
    <!-- ═══ BREADCRUMB ═══ -->
    <div class="intel-breadcrumb">
      <NuxtLink to="/" class="hover:text-accent-ink">News</NuxtLink>
      <span class="text-ink-4">/</span>
      <NuxtLink to="/stories" class="hover:text-accent-ink">Stories</NuxtLink>
      <span class="text-ink-4">/</span>
      <span class="text-ink">{{ story.headline?.slice(0, 60) }}{{ (story.headline?.length || 0) > 60 ? '…' : '' }}</span>
    </div>

    <!-- ═══ HERO ═══ -->
    <header class="py-6 pb-10 border-b-2 border-ink">
      <div class="flex items-center gap-3 font-mono text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-3 mb-5 flex-wrap">
        <span v-if="isDeveloping" class="px-2 py-[3px] bg-accent text-white rounded-sm">Developing</span>
        <span v-else class="px-2 py-[3px] bg-ink text-paper rounded-sm">Story</span>
        <span>{{ dateRange(story.firstSeen, story.lastUpdated) }}</span>
        <span class="sep-dot" />
        <span>{{ spanDays(story.firstSeen, story.lastUpdated) }} days</span>
        <span class="sep-dot" />
        <span>{{ story.articleCount }} articles</span>
        <span class="sep-dot" />
        <span>{{ story.outlets.length }} outlets</span>
        <template v-if="story.primaryRegion">
          <span class="sep-dot" />
          <span>{{ story.primaryRegion }}</span>
        </template>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">
        <div>
          <h1 class="font-serif text-[34px] md:text-[46px] font-semibold leading-[1.08] tracking-tight m-0 mb-6 text-balance">
            {{ story.headline }}
          </h1>

          <template v-if="story.narrative">
            <p class="font-serif text-[21px] md:text-[23px] leading-[1.5] text-ink m-0 mb-5 max-w-[720px] text-pretty">
              {{ story.narrative.lede }}
            </p>
            <p v-if="story.narrative.background" class="text-[17px] leading-relaxed text-ink-2 m-0 mb-5 max-w-[720px] text-pretty">
              <span class="font-semibold text-ink">Why it matters:</span> {{ story.narrative.background }}
            </p>
            <AiLabel kind="generated" :date="story.narrative.generatedAt" :basis="`from ${story.narrative.articleCount} articles`" />
          </template>
          <template v-else-if="fallbackLede">
            <p class="font-serif text-[20px] leading-[1.55] text-ink-2 m-0 mb-4 max-w-[720px] text-pretty">
              {{ fallbackLede }}
            </p>
            <div class="flex items-center gap-2 flex-wrap">
              <AiLabel kind="generated" basis="summary of the latest article" />
              <span class="font-mono text-[10px] tracking-wider uppercase text-ink-4">Story overview not written yet</span>
            </div>
          </template>
        </div>

        <!-- Activity + latest -->
        <aside class="flex flex-col gap-6">
          <div v-if="story.activity.length > 1">
            <div class="text-kicker">Coverage per day</div>
            <div class="flex items-end gap-[2px] h-[72px] border-b border-rule" role="img" :aria-label="`Articles per day, peak ${activityPeakDay?.count} on ${shortDate(activityPeakDay?.date)}`">
              <div
                v-for="day in story.activity"
                :key="day.date"
                class="flex-1 min-w-[3px] hover:bg-accent transition-colors"
                :class="day.date === activityPeakDay?.date ? 'bg-accent' : 'bg-ink-3'"
                :style="{ height: `${Math.max(day.count ? 6 : 0, (day.count / activityMax) * 100)}%` }"
                :title="`${shortDate(day.date)}: ${day.count} article${day.count === 1 ? '' : 's'}`"
              />
            </div>
            <div class="flex justify-between font-mono text-[10px] text-ink-4 mt-1.5">
              <span>{{ shortDate(story.activity[0].date) }}</span>
              <span>max {{ activityPeakDay?.count }}/day · {{ shortDate(activityPeakDay?.date) }}</span>
              <span>{{ shortDate(story.activity[story.activity.length - 1].date) }}</span>
            </div>
          </div>

          <div v-if="latestArticle" class="border-l-2 border-accent pl-4">
            <div class="text-kicker !mb-1.5">Latest · {{ relative(latestArticle.publishedAt) }}</div>
            <NuxtLink :to="`/articles/${latestArticle.id}`" class="font-serif text-[17px] leading-snug font-semibold text-ink hover:text-accent-ink text-balance">
              {{ latestArticle.title }}
            </NuxtLink>
            <div class="font-mono text-[11px] text-ink-3 mt-1">{{ latestArticle.outlet }}</div>
          </div>
        </aside>
      </div>
    </header>

    <!-- ═══ § 01 THE STORY SO FAR ═══ -->
    <section class="intel-sect mt-10">
      <div class="intel-sect-head">
        <span class="sect-num">§ 01</span>
        <h2 class="sect-title !text-[22px]">The story so far</h2>
        <AiLabel v-if="story.developments.length" class="ml-auto" kind="generated" />
      </div>

      <!-- Narrated developments -->
      <ol v-if="story.developments.length" class="list-none m-0 p-0">
        <li
          v-for="(dev, i) in story.developments"
          :key="i"
          class="grid grid-cols-[76px_20px_1fr] md:grid-cols-[110px_24px_1fr] gap-x-3"
        >
          <div class="font-mono text-[12px] font-semibold tracking-wider uppercase text-ink-3 pt-[5px] text-right">
            {{ shortDate(dev.date) }}
          </div>
          <div class="relative flex justify-center">
            <span class="absolute w-px bg-rule" :class="[i === 0 ? 'top-[12px]' : 'top-0', i === story.developments.length - 1 ? 'h-[12px]' : 'bottom-0']" />
            <span class="relative mt-[8px] w-[11px] h-[11px] rounded-full border-2 border-paper" :class="i === story.developments.length - 1 ? 'bg-accent' : 'bg-ink-3'" />
          </div>
          <div class="pb-7">
            <p class="font-serif text-[19px] leading-[1.5] text-ink m-0 text-pretty">{{ dev.text }}</p>
            <div v-if="dev.sources.length" class="flex flex-wrap gap-1.5 mt-2">
              <NuxtLink
                v-for="src in dev.sources"
                :key="src.id"
                :to="`/articles/${src.id}`"
                class="intel-chip !text-[11px]"
                :title="src.title"
              >
                {{ src.outlet }}
              </NuxtLink>
            </div>
          </div>
        </li>
      </ol>

      <!-- Fallback: day by day headlines -->
      <ol v-else class="list-none m-0 p-0">
        <li
          v-for="(day, i) in dailyHeadlines"
          :key="day.date"
          class="grid grid-cols-[76px_20px_1fr] md:grid-cols-[110px_24px_1fr] gap-x-3"
        >
          <div class="font-mono text-[12px] font-semibold tracking-wider uppercase text-ink-3 pt-[3px] text-right">
            {{ shortDate(day.date) }}
          </div>
          <div class="relative flex justify-center">
            <span class="absolute w-px bg-rule" :class="[i === 0 ? 'top-[10px]' : 'top-0', i === dailyHeadlines.length - 1 ? 'h-[10px]' : 'bottom-0']" />
            <span class="relative mt-[6px] w-[9px] h-[9px] rounded-full bg-ink-3" />
          </div>
          <div class="pb-6">
            <NuxtLink
              v-for="a in day.picks"
              :key="a.id"
              :to="`/articles/${a.id}`"
              class="block font-serif text-[17px] leading-snug text-ink hover:text-accent-ink mb-1.5"
            >
              {{ a.title }} <span class="font-mono text-[11px] text-ink-3 whitespace-nowrap">— {{ a.outlet }}</span>
            </NuxtLink>
            <div v-if="day.total > day.picks.length" class="font-mono text-[11px] text-ink-4">
              +{{ day.total - day.picks.length }} more that day
            </div>
          </div>
        </li>
      </ol>
    </section>

    <!-- ═══ § 02 HOW OUTLETS COVER IT ═══ -->
    <section class="intel-sect">
      <div class="intel-sect-head">
        <span class="sect-num">§ 02</span>
        <h2 class="sect-title !text-[22px]">How outlets cover it</h2>
        <span class="sect-tag">{{ story.outlets.length }} outlets</span>
      </div>

      <!-- Agree / differ -->
      <div
        v-if="story.narrative && (story.narrative.agreements.length || story.narrative.disagreements.length)"
        class="grid grid-cols-1 md:grid-cols-2 border border-rule bg-panel mb-6"
      >
        <div class="p-[22px] border-b md:border-b-0 md:border-r border-rule">
          <div class="text-kicker flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-intel-green" /> Outlets agree
          </div>
          <ul class="m-0 pl-5 space-y-2.5">
            <li v-for="(item, i) in story.narrative.agreements" :key="i" class="text-[16px] leading-relaxed text-ink">{{ item }}</li>
          </ul>
        </div>
        <div class="p-[22px]">
          <div class="text-kicker flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-accent" /> Coverage differs
          </div>
          <ul class="m-0 pl-5 space-y-2.5">
            <li v-for="(item, i) in story.narrative.disagreements" :key="i" class="text-[16px] leading-relaxed text-ink">{{ item }}</li>
          </ul>
        </div>
      </div>

      <!-- Outlet cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <article v-for="o in outletsWithFraming" :key="o.feedId" class="intel-card p-[22px] flex flex-col">
          <header class="flex items-start justify-between gap-3 mb-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" :class="leanDotClass(o)" />
                <h3 class="font-serif text-[20px] font-semibold tracking-tight m-0">{{ o.shortName }}</h3>
              </div>
              <div class="font-mono text-[10.5px] tracking-wider uppercase text-ink-3 mt-1" :title="o.leanApplicable === false ? NOT_RATED_EXPLANATION : undefined">
                {{ outletTag(o) }}
              </div>
            </div>
            <div class="text-right font-mono text-[11px] text-ink-3 whitespace-nowrap">
              <div class="text-ink font-semibold text-[15px]">{{ o.articleCount }}</div>
              article{{ o.articleCount === 1 ? '' : 's' }}
            </div>
          </header>
          <p class="font-serif text-[17px] leading-[1.55] text-ink m-0 mb-4 text-pretty">{{ o.framing }}</p>
          <div class="mt-auto pt-3 border-t border-rule-soft">
            <div class="text-label mb-2">Its headlines</div>
            <NuxtLink
              v-for="h in o.headlines"
              :key="h.id"
              :to="`/articles/${h.id}`"
              class="block text-[14.5px] leading-snug text-ink-2 hover:text-accent-ink mb-2 last:mb-0"
            >
              “{{ h.title }}” <span class="font-mono text-[10.5px] text-ink-4 whitespace-nowrap">{{ shortDate(h.publishedAt) }}</span>
            </NuxtLink>
          </div>
        </article>
      </div>

      <!-- Outlets without a narrative perspective: headline comparison only -->
      <div v-if="outletsWithoutFraming.length" class="intel-card mt-4">
        <div v-for="o in outletsWithoutFraming" :key="o.feedId" class="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-x-6 gap-y-2 px-[22px] py-4 border-t border-rule-soft first:border-t-0">
          <div>
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full flex-shrink-0" :class="leanDotClass(o)" />
              <span class="font-semibold text-[15px] text-ink">{{ o.shortName }}</span>
            </div>
            <div class="font-mono text-[10px] tracking-wider uppercase text-ink-3 mt-1">
              {{ outletTag(o) }} · {{ o.articleCount }} article{{ o.articleCount === 1 ? '' : 's' }}
            </div>
          </div>
          <div>
            <NuxtLink
              v-for="h in o.headlines"
              :key="h.id"
              :to="`/articles/${h.id}`"
              class="block text-[15px] leading-snug text-ink-2 hover:text-accent-ink mb-1.5 last:mb-0"
            >
              “{{ h.title }}” <span class="font-mono text-[10.5px] text-ink-4 whitespace-nowrap">{{ shortDate(h.publishedAt) }}</span>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Lean + framing mix -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <div v-if="coverageSegments.length">
          <div class="text-kicker">Articles by outlet lean</div>
          <div class="flex h-3 overflow-hidden rounded-sm bg-paper-2">
            <div v-for="seg in coverageSegments" :key="seg.key" :class="seg.cls" :style="{ width: `${seg.pct}%` }" :title="`${seg.label}: ${seg.count}`" />
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            <span v-for="seg in coverageSegments" :key="seg.key" class="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
              <span class="w-2 h-2 rounded-sm" :class="seg.cls" /> {{ seg.label }} {{ seg.count }}
            </span>
          </div>
          <p v-if="story.coverage?.unratedCount" class="text-[12.5px] text-ink-4 mt-2 mb-0">{{ NOT_RATED_EXPLANATION }}</p>
        </div>
        <div v-if="story.framing.length">
          <div class="text-kicker flex items-center gap-2">Main angle of each article <AiLabel kind="classified" /></div>
          <div class="space-y-1.5">
            <div v-for="f in story.framing.slice(0, 6)" :key="f.key" class="grid grid-cols-[150px_1fr_28px] items-center gap-3 text-[13px]">
              <span class="text-ink-2 truncate">{{ f.label }}</span>
              <div class="meter-h !h-1.5"><div class="meter-fill" :style="{ width: `${(f.count / framingTotal) * 100}%` }" /></div>
              <span class="font-mono text-[11px] text-ink-3 text-right">{{ f.count }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ § 03 OPEN QUESTIONS & CLAIMS ═══ -->
    <section v-if="story.narrative?.openQuestions?.length || story.claims.length" class="intel-sect">
      <div class="intel-sect-head">
        <span class="sect-num">§ 03</span>
        <h2 class="sect-title !text-[22px]">Open questions and key claims</h2>
      </div>

      <div v-if="story.narrative?.openQuestions?.length" class="mb-6">
        <div class="text-kicker flex items-center gap-2">Still unresolved <AiLabel kind="generated" /></div>
        <ul class="m-0 p-0 list-none space-y-2">
          <li v-for="(q, i) in story.narrative.openQuestions" :key="i" class="flex gap-3 font-serif text-[18px] leading-snug text-ink">
            <span class="text-accent font-semibold">?</span> {{ q }}
          </li>
        </ul>
      </div>

      <div v-if="story.claims.length" class="intel-card">
        <div class="intel-card-hd">
          <span class="text-label">Who said what</span>
          <AiLabel kind="extracted" :basis="`${story.claims.length} claims`" />
        </div>
        <div v-for="(claim, i) in story.claims" :key="i" class="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-x-6 gap-y-1 px-[22px] py-4 border-t border-rule-soft first:border-t-0">
          <p class="text-[15.5px] leading-relaxed text-ink m-0">
            {{ claim.claimText }}
          </p>
          <div class="font-mono text-[11px] text-ink-3 md:text-right">
            <div v-if="claim.attribution" class="text-ink-2 font-semibold">{{ claim.attribution }}</div>
            <NuxtLink v-if="claim.source" :to="`/articles/${claim.source.id}`" class="hover:text-accent-ink">
              via {{ claim.source.outlet }} · {{ shortDate(claim.source.publishedAt) }}
            </NuxtLink>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ § 04 PEOPLE & PLACES ═══ -->
    <section v-if="story.entities.length" class="intel-sect">
      <div class="intel-sect-head">
        <span class="sect-num">§ 04</span>
        <h2 class="sect-title !text-[22px]">Who and where</h2>
      </div>
      <div class="flex flex-wrap gap-2">
        <component
          :is="entityPath(e) ? resolveComponent('NuxtLink') : 'span'"
          v-for="e in story.entities"
          :key="e.id"
          :to="entityPath(e) || undefined"
          class="inline-flex items-center gap-2 px-3 py-1.5 border border-rule bg-panel text-[14px] text-ink hover:border-accent hover:text-accent-ink transition-colors"
        >
          <span class="w-2 h-2 rounded-full" :class="ENTITY_DOT[e.type] || 'bg-ink-4'" />
          {{ e.name }}
          <span class="font-mono text-[10px] uppercase tracking-wider text-ink-4">{{ e.type }}</span>
        </component>
      </div>
    </section>

    <!-- ═══ § 05 TOPIC HISTORY ═══ -->
    <section v-if="story.chapters.length" class="intel-sect">
      <div class="intel-sect-head">
        <span class="sect-num">§ 05</span>
        <h2 class="sect-title !text-[22px]">Related stories over time</h2>
        <span class="sect-tag">same people and places</span>
      </div>
      <ol class="list-none m-0 p-0 intel-card">
        <template v-for="(ch, i) in story.chapters" :key="ch.id">
          <!-- Mark where this story sits among its chapters -->
          <li
            v-if="ch.relation !== 'earlier' && (i === 0 || story.chapters[i - 1].relation === 'earlier')"
            class="grid grid-cols-[130px_1fr] gap-4 px-[22px] py-3 bg-accent-tint border-t border-rule-soft first:border-t-0"
          >
            <span class="font-mono text-[11px] font-semibold text-accent-ink">{{ dateRange(story.firstSeen, story.lastUpdated) }}</span>
            <span class="font-mono text-[11px] font-semibold uppercase tracking-wider text-accent-ink">◆ This story</span>
          </li>
          <li class="grid grid-cols-[130px_1fr] gap-4 px-[22px] py-4 border-t border-rule-soft first:border-t-0">
            <span class="font-mono text-[11px] text-ink-3 pt-0.5">
              {{ dateRange(ch.firstSeen, ch.lastUpdated) }}
              <span class="block text-ink-4 mt-0.5">{{ ch.relation === 'overlapping' ? 'at the same time' : ch.relation }}</span>
            </span>
            <div>
              <NuxtLink :to="`/stories/${ch.id}`" class="font-serif text-[17px] leading-snug font-semibold text-ink hover:text-accent-ink">{{ ch.title }}</NuxtLink>
              <p v-if="ch.lede" class="text-[14px] leading-relaxed text-ink-3 m-0 mt-1 line-clamp-2">{{ ch.lede }}</p>
              <div class="font-mono text-[10.5px] text-ink-4 mt-1">{{ ch.articleCount }} articles · {{ ch.sourceCount }} outlets</div>
            </div>
          </li>
        </template>
        <li
          v-if="story.chapters.every((c: any) => c.relation === 'earlier')"
          class="grid grid-cols-[130px_1fr] gap-4 px-[22px] py-3 bg-accent-tint border-t border-rule-soft"
        >
          <span class="font-mono text-[11px] font-semibold text-accent-ink">{{ dateRange(story.firstSeen, story.lastUpdated) }}</span>
          <span class="font-mono text-[11px] font-semibold uppercase tracking-wider text-accent-ink">◆ This story</span>
        </li>
      </ol>
    </section>

    <!-- ═══ § 06 ALL COVERAGE ═══ -->
    <section class="intel-sect">
      <div class="intel-sect-head">
        <span class="sect-num">§ 06</span>
        <h2 class="sect-title !text-[22px]">All coverage</h2>
        <span class="sect-tag">{{ story.articleCount }} articles · newest first</span>
      </div>

      <div v-for="day in visibleCoverageDays" :key="day.date" class="mb-6">
        <h3 class="font-mono text-[11px] font-semibold tracking-widest uppercase text-ink-3 m-0 mb-2 pb-1.5 border-b border-rule-soft">
          {{ longDate(day.date) }} · {{ day.articles.length }}
        </h3>
        <NuxtLink
          v-for="a in day.articles"
          :key="a.id"
          :to="`/articles/${a.id}`"
          class="group grid grid-cols-[44px_1fr] md:grid-cols-[52px_130px_1fr_auto] gap-x-4 gap-y-0.5 py-2.5 border-b border-rule-soft last:border-b-0 hover:bg-panel"
        >
          <span class="font-mono text-[11px] text-ink-4 pt-0.5">{{ timeOfDay(a.publishedAt) }}</span>
          <span class="font-mono text-[11px] text-ink-3 pt-0.5 hidden md:block truncate">{{ a.outlet }}</span>
          <span class="text-[15.5px] leading-snug text-ink group-hover:text-accent-ink">
            {{ a.title }}
            <span class="md:hidden font-mono text-[10.5px] text-ink-3 block mt-0.5">{{ a.outlet }}</span>
          </span>
          <span v-if="a.framing" class="hidden md:inline font-mono text-[10px] uppercase tracking-wider text-ink-4 pt-1 whitespace-nowrap">{{ a.framing }}</span>
        </NuxtLink>
      </div>

      <button
        v-if="!showAllCoverage && hiddenCoverageCount > 0"
        class="w-full py-3 font-mono text-[11px] font-semibold tracking-wider uppercase border border-rule bg-panel text-ink-2 rounded-sm hover:bg-accent-tint hover:text-accent-ink transition-colors"
        @click="showAllCoverage = true"
      >
        Show {{ hiddenCoverageCount }} earlier articles
      </button>
    </section>
  </div>

  <div v-else-if="!story?.redirectTo" class="min-h-[60vh] flex items-center justify-center">
    <div class="text-center">
      <Icon name="i-heroicons-newspaper" class="w-12 h-12 text-ink-4 mx-auto mb-4" />
      <p class="text-ink-3">Story not found</p>
      <NuxtLink to="/stories" class="btn-nav mt-4">All stories</NuxtLink>
    </div>
  </div>
</template>
