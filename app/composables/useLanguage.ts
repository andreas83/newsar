const languageOptions = [
  { label: 'All Languages', value: 'all' },
  { label: 'English', value: 'en' },
  { label: 'Deutsch', value: 'de' },
  { label: 'Espanol', value: 'es' },
  { label: 'Francais', value: 'fr' },
]

export function useLanguage() {
  // useState is SSR-safe: scoped per-request on server, shared on client
  const selectedLanguage = useState('newsarLanguage', () => 'all')

  // Load from localStorage on client only
  if (import.meta.client) {
    onMounted(() => {
      const stored = localStorage.getItem('newsarLanguage')
      if (stored) {
        selectedLanguage.value = stored
      }
    })

    watch(selectedLanguage, (value) => {
      localStorage.setItem('newsarLanguage', value)
    })
  }

  function setLanguage(code: string) {
    selectedLanguage.value = code
  }

  return {
    selectedLanguage,
    languageOptions,
    setLanguage,
  }
}
