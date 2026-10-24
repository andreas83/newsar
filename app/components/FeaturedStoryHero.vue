<script setup lang="ts">
/**
 * Lead story: the AI narrative's lede and per-outlet framing on the left,
 * how much each outlet ran on it (and when) on the right.
 */
type LeanGroup = 'left' | 'center' | 'right' | 'unrated'

interface Outlet {
  id: number
  name: string
  shortName: string
  group: LeanGroup
}

interface Props {
  story: {
    id: number
    title: string | null
    description: string | null
    summary?: string | null
    status: string | null
    articleCount: number
    sourceCount: number
    firstSeen: string | Date | null
    lastUpdated: string | Date | null
    imageUrl: string | null
    imageLocalPath: string | null
    outletCounts: Record<number, number>
    outletFresh: number[]
    daily: number[]
    narrative: {
      lede: string
      perspectives: Array<{ outlet: string; feedIds: number[]; framing: string }>
      disagreement: string | null
      generatedAt: string | Date
    } | null
  }
  outlets: Outlet[]
  days: string[]
}

const props = defineProps<Props>()

const LEAN_VAR: Record<LeanGroup, string> = {
  left: 'var(--color-blue)',
  center: 'var(--color-ink-3)',
  right: 'var(--color-red)',
  unrated: 'var(--color-violet)',
}

const LEAN_LABEL: Record<LeanGroup, string> = {
  left: 'Left-leaning outlet',
  center: 'Centre outlet',
  right: 'Right-leaning outlet',
  unrated: 'Outlet not rated on left–right',
}

const outletById = computed(() => new Map(props.outlets.map(o => [o.id, o])))

const lede = computed(() => props.story.narrative?.lede || props.story.summary || props.story.description)

// Up to four framings, each tied to its outlet for the lean marker and count
const perspectives = computed(() =>
  (props.story.narrative?.perspectives || []).slice(0, 4).map((p) => {
    const outlet = p.feedIds.map(id => outletById.value.get(id)).find(Boolean)
    const count = p.feedIds.reduce((sum, id) => sum + (props.story.outletCounts[id] || 0), 0)
    return { ...p, outlet: outlet?.shortName || p.outlet, group: outlet?.group || 'unrated' as LeanGroup, count }
  })
)

const coverage = computed(() => {
  const rows = props.outlets.map(o => ({
    ...o,
    count: props.story.outletCounts[o.id] || 0,
    fresh: props.story.outletFresh.includes(o.id),
  }))
  const max = Math.max(1, ...rows.map(r => r.count))
  return rows.map(r => ({ ...r, pct: (r.count / max) * 100 }))
})

const silent = computed(() => coverage.value.filter(r => r.count === 0).map(r => r.name))

const maxDaily = computed(() => Math.max(1, ...props.story.daily))

function shortDate(d: string | Date | null | undefined) {
  if (!d) return ''
  const date = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : new Date(d)
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

function weekday(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'narrow' })
}
</script>

<template>
  <article class="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-x-12 gap-y-8">
    <!-- Narrative -->
    <div class="min-w-0">
      <p class="text-[13px] text-ink-3 mb-3">
        <span class="font-semibold text-accent-ink">Lead story</span>
        <template v-if="story.firstSeen">, followed since {{ shortDate(story.firstSeen) }}</template>
        <template v-if="story.lastUpdated">, updated {{ shortDate(story.lastUpdated) }}</template>
      </p>

      <NuxtLink :to="`/stories/${story.id}`" class="group block">
        <h1 class="font-serif text-[30px] sm:text-[38px] lg:text-[44px] font-bold leading-[1.08] tracking-[-0.01em] text-ink group-hover:text-accent transition-colors text-balance">
          {{ story.title }}
        </h1>
      </NuxtLink>

      <p v-if="lede" class="font-serif text-[18px] sm:text-[19px] leading-[1.55] text-ink-2 mt-4 max-w-[62ch]">
        {{ lede }}
      </p>

      <!-- How outlets tell it -->
      <div v-if="perspectives.length" class="mt-8">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule pb-2 mb-1">
          <h2 class="font-serif text-[17px] font-semibold text-ink">How each outlet tells it</h2>
          <AiLabel kind="generated" :date="story.narrative?.generatedAt" basis="article summaries" />
        </div>
        <dl class="divide-y divide-rule-soft">
          <div v-for="p in perspectives" :key="p.outlet" class="grid grid-cols-[120px_minmax(0,1fr)] gap-4 py-3 max-sm:grid-cols-1 max-sm:gap-1">
            <dt class="flex items-start gap-2 text-[13px] font-semibold text-ink leading-snug">
              <span
                class="mt-[5px] w-2 h-2 shrink-0"
                :style="{ background: LEAN_VAR[p.group] }"
                :title="LEAN_LABEL[p.group]"
              />
              <span>
                {{ p.outlet }}
                <span class="block font-normal text-ink-4 text-[12px]">{{ p.count }} article{{ p.count === 1 ? '' : 's' }}</span>
              </span>
            </dt>
            <dd class="text-[14px] leading-relaxed text-ink-2 line-clamp-3 max-w-[68ch]">{{ p.framing }}</dd>
          </div>
        </dl>
      </div>

      <blockquote v-if="story.narrative?.disagreement" class="mt-6 border-l-[3px] border-accent pl-4">
        <p class="text-[13px] font-semibold text-ink mb-1">Where they differ</p>
        <p class="text-[14px] leading-relaxed text-ink-2 max-w-[68ch]">{{ story.narrative.disagreement }}</p>
      </blockquote>

      <NuxtLink
        :to="`/stories/${story.id}`"
        class="inline-flex items-center gap-1.5 mt-6 text-[14px] font-semibold text-accent-ink hover:text-accent underline underline-offset-4 decoration-1"
      >
        Read the full story and all {{ story.articleCount }} articles
      </NuxtLink>
    </div>

    <!-- Evidence column -->
    <aside class="min-w-0">
      <NuxtLink v-if="story.imageLocalPath || story.imageUrl" :to="`/stories/${story.id}`" tabindex="-1" class="block aspect-[4/3] overflow-hidden bg-paper-2">
        <img
          :src="story.imageLocalPath || story.imageUrl || ''"
          alt=""
          class="w-full h-full object-cover"
          @error="($event.target as HTMLElement)?.parentElement?.style.setProperty('display', 'none')"
        >
      </NuxtLink>

      <!-- Articles per outlet -->
      <div class="mt-6">
        <h2 class="text-[13px] font-semibold text-ink mb-3">Articles on this story, by outlet</h2>
        <ul class="space-y-2">
          <li v-for="r in coverage" :key="r.id" class="grid grid-cols-[104px_minmax(0,1fr)_28px] items-center gap-3 text-[13px]">
            <span class="flex items-center gap-2 text-ink-2 truncate" :title="`${r.name}, ${LEAN_LABEL[r.group].toLowerCase()}`">
              <span class="w-2 h-2 shrink-0" :style="{ background: LEAN_VAR[r.group] }" />
              {{ r.shortName }}
            </span>
            <span class="h-[10px] bg-paper-2 relative" aria-hidden="true">
              <span
                v-if="r.count"
                class="absolute inset-y-0 left-0"
                :class="r.fresh ? 'bg-accent' : 'bg-ink-3'"
                :style="{ width: `${Math.max(2, r.pct)}%` }"
              />
            </span>
            <span class="text-right tabular-nums" :class="r.count ? 'text-ink' : 'text-ink-4'">{{ r.count || '–' }}</span>
          </li>
        </ul>
        <p class="text-[12px] text-ink-3 mt-3 leading-snug">
          <template v-if="story.outletFresh.length"><span class="inline-block w-2 h-2 bg-accent align-middle mr-1" /> published on it in the last 24h.</template>
          <template v-if="silent.length"> No coverage yet from {{ silent.join(', ') }}.</template>
        </p>
      </div>

      <!-- Articles per day -->
      <div v-if="story.daily.length" class="mt-6">
        <h2 class="text-[13px] font-semibold text-ink mb-3">Articles per day</h2>
        <div class="flex items-end gap-1.5 h-16" role="img" :aria-label="`Articles per day over the last week: ${story.daily.join(', ')}`">
          <div v-for="(n, i) in story.daily" :key="i" class="flex-1 flex flex-col items-center justify-end h-full" :title="`${shortDate(days[i])}: ${n} articles`">
            <span class="text-[11px] tabular-nums text-ink-3 mb-1">{{ n || '' }}</span>
            <span
              class="w-full rounded-t-[2px]"
              :class="i === story.daily.length - 1 ? 'bg-accent' : (n ? 'bg-ink-4' : 'bg-rule')"
              :style="{ height: n ? `${Math.max(6, (n / maxDaily) * 70)}%` : '2px' }"
            />
          </div>
        </div>
        <div class="flex gap-1.5 mt-1 text-[11px] text-ink-4" aria-hidden="true">
          <span v-for="(d, i) in days" :key="d" class="flex-1 text-center">{{ i === days.length - 1 ? 'Today' : weekday(d) }}</span>
        </div>
      </div>
    </aside>
  </article>
</template>
