<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin',
})
</script>

<template>
  <div class="p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Stock Market Tracking</h1>
      <p class="text-ink-3">Manage tracked tickers, entity mappings, and price collection.</p>
    </div>

    <AdminStockCollectionStatusCard class="mb-6" />

    <AdminStockWatchlistManager />
  </div>
</template>
