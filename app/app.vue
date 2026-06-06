<script setup lang="ts">
// Initialize dark mode on the client
if (import.meta.client) {
  useDarkMode()
}

useHead({
  script: [
    {
      // Inline script to prevent flash of wrong theme on page load
      innerHTML: `(function(){try{var t=localStorage.getItem('newsar-theme');if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
      type: 'text/javascript',
      tagPosition: 'head',
    },
  ],
})
</script>

<template>
  <div>
    <NuxtLayout>
      <NuxtRouteAnnouncer />
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
