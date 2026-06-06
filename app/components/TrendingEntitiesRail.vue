<template>
  <section v-if="entities.length > 0">
    <!-- Section header -->
    <div class="intel-sect-head">
      <Icon name="i-heroicons-user-group" class="w-4 h-4 text-ink-3" />
      <h2 class="sect-title">Tracking</h2>
      <span class="sect-tag">
        <Icon name="i-heroicons-fire" class="w-3 h-3 text-intel-red" />
        {{ entities.length }} trending
      </span>
    </div>

    <!-- Horizontal scroll rail -->
    <div class="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 snap-x">
      <NuxtLink
        v-for="entity in entities"
        :key="entity.id"
        :to="`/${entity.type}/${entity.slug}`"
        class="group flex-shrink-0 w-44 snap-start"
      >
        <!-- Portrait -->
        <div class="relative w-full aspect-square overflow-hidden bg-paper-2 border border-rule mb-2 group-hover:border-accent transition-colors">
          <EntityPortrait
            v-if="entity.imageUrl"
            :name="entity.name"
            :entity-type="entity.type"
            :entity-id="entity.id"
            :existing-image-url="entity.imageUrl"
            fill
          />
          <div v-else class="w-full h-full flex items-center justify-center">
            <Icon
              :name="entity.type === 'person' ? 'i-heroicons-user' :
                     entity.type === 'organization' ? 'i-heroicons-building-office' :
                     entity.type === 'location' ? 'i-heroicons-map-pin' :
                     'i-heroicons-calendar'"
              class="w-8 h-8 text-ink-4 opacity-30"
            />
          </div>
          <!-- Type indicator -->
          <div class="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/60 to-transparent">
            <span class="font-mono text-[9px] font-semibold tracking-widest uppercase text-white/80">
              {{ entity.type }}
            </span>
          </div>
        </div>

        <!-- Name -->
        <h3 class="text-sm font-semibold text-ink leading-tight group-hover:text-accent transition-colors line-clamp-1">
          {{ entity.name }}
        </h3>

        <!-- Description -->
        <p v-if="entity.shortDescription" class="text-[11px] text-ink-4 line-clamp-2 mt-0.5 leading-snug">
          {{ entity.shortDescription }}
        </p>
      </NuxtLink>
    </div>
  </section>
</template>

<script setup lang="ts">
interface Props {
  entities: Array<{
    id: number
    name: string
    type: string
    slug: string | null
    shortDescription: string | null
    imageUrl: string | null
    trendingScore: number | null
  }>
}

defineProps<Props>()
</script>
