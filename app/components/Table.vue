<script setup lang="ts" generic="T extends Record<string, any>">
interface Column {
  key: string
  label?: string
  sortable?: boolean
}

interface Props {
  columns: Column[]
  rows: T[]
}

const props = defineProps<Props>()

// Ensure rows is always an array
const safeRows = computed(() => {
  if (!props.rows) return []
  if (Array.isArray(props.rows)) return props.rows
  console.warn('Table rows prop should be an array, got:', typeof props.rows)
  return []
})
</script>

<template>
  <div class="overflow-x-auto">
    <table class="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
      <thead class="bg-gray-50 dark:bg-slate-800">
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider"
          >
            {{ column.label || column.key }}
          </th>
        </tr>
      </thead>
      <tbody class="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
        <tr v-for="(row, index) in safeRows" :key="index" class="hover:bg-gray-50 dark:hover:bg-slate-700/50">
          <td
            v-for="column in columns"
            :key="column.key"
            class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-slate-200"
          >
            <slot :name="`${column.key}-data`" :row="row">
              {{ row[column.key] }}
            </slot>
          </td>
        </tr>
        <tr v-if="safeRows.length === 0">
          <td :colspan="columns.length" class="px-6 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
            No data available
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
