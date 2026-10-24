<script setup lang="ts">
/**
 * Stories × outlets grid: dot area = articles an outlet ran on the story,
 * amber = it published on it in the last 24h, a dash = no coverage at all.
 * The point is the gaps: which outlets skip which stories.
 */
type LeanGroup = 'left' | 'center' | 'right' | 'unrated'

interface Outlet {
  id: number
  name: string
  shortName: string
  group: LeanGroup
  ownership: string | null
  country: string | null
}

interface MatrixStory {
  id: number
  title: string | null
  articleCount: number
  lastUpdated: string | Date | null
  counts: Record<number, number>
  latest: Record<number, string | Date>
  fresh: number[]
  daily: number[]
}

interface Props {
  outlets: Outlet[]
  stories: MatrixStory[]
  days: string[]
}

const props = defineProps<Props>()

const GROUP_LABELS: Record<LeanGroup, string> = {
  left: 'Left',
  center: 'Centre',
  right: 'Right',
  unrated: 'Not rated',
}

const GROUP_CLASS: Record<LeanGroup, string> = {
  left: 'lean-left',
  center: 'lean-center',
  right: 'lean-right',
  unrated: 'lean-unrated',
}

// Consecutive outlets that share a lean, for the header bands
const groups = computed(() => {
  const out: Array<{ group: LeanGroup; span: number }> = []
  for (const o of props.outlets) {
    const last = out[out.length - 1]
    if (last && last.group === o.group) last.span++
    else out.push({ group: o.group, span: 1 })
  }
  return out
})

const maxCount = computed(() => {
  let max = 1
  for (const s of props.stories) for (const n of Object.values(s.counts)) max = Math.max(max, n)
  return max
})

const maxDaily = computed(() => Math.max(1, ...props.stories.flatMap(s => s.daily)))

// Area ∝ count; 3px floor so a single article stays visible
const MAX_R = 11
function radius(n: number) {
  return Math.max(3, Math.sqrt(n / maxCount.value) * MAX_R)
}


const gridStyle = computed(() => ({
  '--outlets': String(props.outlets.length),
}))

function relTime(d: string | Date | undefined) {
  if (!d) return ''
  // Only called on hover, so client time is fine
  const hours = Math.floor((Date.now() - new Date(d).getTime()) / 3600000)
  if (hours < 1) return 'within the hour'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

function dayLabel(iso: string | undefined) {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
}

// Screen-reader sentence per row; the dots are aria-hidden
function rowSummary(s: MatrixStory) {
  const covered = props.outlets.filter(o => s.counts[o.id]).map(o => `${o.name} ${s.counts[o.id]}`)
  const missing = props.outlets.filter(o => !s.counts[o.id]).map(o => o.name)
  let text = `${s.articleCount} articles. Covered by ${covered.join(', ') || 'none of the tracked outlets'}.`
  if (missing.length) text += ` Not covered by ${missing.join(', ')}.`
  return text
}

// ── Tooltip ──
const wrap = ref<HTMLElement | null>(null)
const tip = ref<{ x: number; y: number; title: string; body: string } | null>(null)
const hoverCol = ref<number | null>(null)

function showCell(e: MouseEvent, s: MatrixStory, o: Outlet) {
  const n = s.counts[o.id] || 0
  hoverCol.value = o.id
  place(e, o.name, n
    ? `${n} article${n === 1 ? '' : 's'} on this story, latest ${relTime(s.latest[o.id])}`
    : 'No articles on this story')
}

function showDay(e: MouseEvent, n: number, i: number) {
  place(e, dayLabel(props.days[i]), `${n} article${n === 1 ? '' : 's'} published`)
}

function place(e: MouseEvent, title: string, body: string) {
  const box = wrap.value?.getBoundingClientRect()
  const cell = (e.currentTarget as HTMLElement).getBoundingClientRect()
  if (!box) return
  tip.value = {
    x: cell.left + cell.width / 2 - box.left,
    y: cell.top - box.top,
    title,
    body,
  }
}

function hide() {
  tip.value = null
  hoverCol.value = null
}
</script>

<template>
  <div ref="wrap" class="relative" :style="gridStyle">
    <div class="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <div class="matrix min-w-max sm:min-w-0">
        <!-- Lean bands -->
        <div class="m-row m-head-bands" aria-hidden="true">
          <div class="m-title" />
          <div class="m-vol" />
          <div class="m-cells">
            <div
              v-for="(g, i) in groups"
              :key="i"
              :title="`${GROUP_LABELS[g.group]}${g.group === 'unrated' ? ' on left–right (e.g. state media)' : '-leaning outlets'}`"
              class="m-band"
              :class="GROUP_CLASS[g.group]"
              :style="{ gridColumn: `span ${g.span}` }"
            >
              {{ GROUP_LABELS[g.group] }}
            </div>
          </div>
        </div>

        <!-- Outlet names -->
        <div class="m-row m-head">
          <div class="m-title text-[12px] text-ink-3 pl-2 max-sm:pl-0">Story</div>
          <div class="m-vol text-[12px] text-ink-3" :title="`Articles per day, ${dayLabel(days[0])} to today`">Last 7 days</div>
          <div class="m-cells">
            <div
              v-for="o in outlets"
              :key="o.id"
              class="m-outlet"
              :class="{ 'is-hot': hoverCol === o.id }"
              :title="o.name"
            >
              {{ o.shortName }}
            </div>
          </div>
        </div>

        <!-- Stories -->
        <NuxtLink
          v-for="s in stories"
          :key="s.id"
          :to="`/stories/${s.id}`"
          class="m-row m-story group"
        >
          <div class="m-title">
            <span class="font-serif text-[16px] leading-snug font-semibold text-ink group-hover:text-accent transition-colors line-clamp-2">
              {{ s.title }}
            </span>
            <span class="sr-only">{{ rowSummary(s) }}</span>
          </div>

          <div class="m-vol" aria-hidden="true">
            <div class="flex items-end gap-[2px] h-6">
              <span
                v-for="(n, i) in s.daily"
                :key="i"
                class="vol-bar"
                :class="{ 'is-today': i === s.daily.length - 1, 'is-zero': n === 0 }"
                :style="{ height: n ? `${Math.max(12, (n / maxDaily) * 100)}%` : '2px' }"
                @mouseenter="showDay($event, n, i)"
                @mouseleave="hide"
              />
            </div>
          </div>

          <div class="m-cells" aria-hidden="true">
            <div
              v-for="o in outlets"
              :key="o.id"
              class="m-cell"
              :class="{ 'is-hot': hoverCol === o.id }"
              @mouseenter="showCell($event, s, o)"
              @mouseleave="hide"
            >
              <svg v-if="s.counts[o.id]" :width="MAX_R * 2 + 4" :height="MAX_R * 2 + 4">
                <circle
                  :cx="MAX_R + 2"
                  :cy="MAX_R + 2"
                  :r="radius(s.counts[o.id])"
                  :class="s.fresh.includes(o.id) ? 'dot-fresh' : 'dot-old'"
                />
              </svg>
              <span v-else class="m-gap" />
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>

    <!-- Legend -->
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-[12px] text-ink-3">
      <span class="inline-flex items-center gap-1.5">
        <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" class="dot-fresh" /></svg>
        Published on it in the last 24h
      </span>
      <span class="inline-flex items-center gap-1.5">
        <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" class="dot-old" /></svg>
        Earlier coverage only
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="m-gap" aria-hidden="true" />
        No coverage
      </span>
      <span>Dot size: number of articles (largest = {{ maxCount }})</span>
    </div>

    <!-- Tooltip -->
    <div
      v-if="tip"
      class="m-tip"
      role="tooltip"
      :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
    >
      <div class="font-semibold text-ink">{{ tip.title }}</div>
      <div class="text-ink-3">{{ tip.body }}</div>
    </div>
  </div>
</template>

<style scoped>
.matrix {
  --cell: 64px;
  --vol: 92px;
}

.m-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--vol) calc(var(--cell) * var(--outlets));
  align-items: center;
  column-gap: 20px;
}

.m-cells {
  display: grid;
  grid-template-columns: repeat(var(--outlets), var(--cell));
  align-self: stretch;
}

.m-head-bands { align-items: end; }
.m-band {
  border-top: 3px solid currentColor;
  margin: 0 3px;
  padding-top: 4px;
  font-size: 11px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-band.lean-left    { color: var(--color-blue); }
.m-band.lean-center  { color: var(--color-ink-3); }
.m-band.lean-right   { color: var(--color-red); }
.m-band.lean-unrated { color: var(--color-violet); }

.m-head {
  padding: 6px 0 10px;
  border-bottom: 1px solid var(--color-ink);
}
.m-outlet {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  color: var(--color-ink-2);
  padding: 0 4px;
  align-self: end;
}

.m-story {
  border-bottom: 1px solid var(--color-rule-soft);
  min-height: 60px;
}
.m-story:hover, .m-story:focus-visible { background: var(--color-paper-2); }
.m-story:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
.m-story .m-title { padding: 10px 0 10px 8px; }

.m-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}
.m-cell.is-hot, .m-outlet.is-hot { background: color-mix(in srgb, var(--color-accent) 8%, transparent); }
.m-outlet.is-hot { color: var(--color-ink); }

.dot-fresh { fill: var(--color-accent); }
.dot-old   { fill: var(--color-ink-3); }

.m-gap {
  display: inline-block;
  width: 10px;
  height: 1.5px;
  background: var(--color-rule);
}

.vol-bar {
  flex: 1;
  background: var(--color-ink-4);
  border-radius: 1px 1px 0 0;
}
.vol-bar.is-today { background: var(--color-accent); }
.vol-bar.is-zero  { background: var(--color-rule); }

.m-tip {
  position: absolute;
  z-index: 20;
  transform: translate(-50%, calc(-100% - 8px));
  pointer-events: none;
  background: var(--color-panel);
  border: 1px solid var(--color-rule);
  box-shadow: 0 4px 14px var(--color-card-shadow);
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
}

/* Phones: title on its own line, volume + dots underneath */
@media (max-width: 640px) {
  .matrix { --cell: 50px; --vol: 44px; }
  .m-row {
    grid-template-columns: var(--vol) calc(var(--cell) * var(--outlets));
    column-gap: 10px;
  }
  .m-row > .m-title { grid-column: 1 / -1; }
  .m-head > .m-title, .m-head-bands > .m-title { display: none; }
  .m-story .m-title { padding: 12px 0 4px; }
  .m-story .m-cells, .m-story .m-vol { padding-bottom: 10px; }
  /* Names run bottom-to-top so long ones don't collide in narrow columns */
  .m-outlet {
    font-size: 11px;
    padding: 0;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    justify-self: center;
    text-align: left;
    white-space: nowrap;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .m-story circle { transition: r 0.2s ease; }
}
</style>
