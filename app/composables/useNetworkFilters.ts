export function useNetworkFilters() {
  const hiddenEntityTypes = useState<string[]>('network-hidden-entity-types', () => [])
  const searchHighlight = useState<string | null>('network-search-highlight', () => null)

  function isTypeHidden(type: string) {
    return hiddenEntityTypes.value.includes(type)
  }

  function toggleEntityType(type: string) {
    if (hiddenEntityTypes.value.includes(type)) {
      hiddenEntityTypes.value = hiddenEntityTypes.value.filter(t => t !== type)
    } else {
      hiddenEntityTypes.value = [...hiddenEntityTypes.value, type]
    }
  }

  function setSearchHighlight(name: string | null) {
    searchHighlight.value = name
  }

  function resetFilters() {
    hiddenEntityTypes.value = []
    searchHighlight.value = null
  }

  return { hiddenEntityTypes, isTypeHidden, toggleEntityType, searchHighlight, setSearchHighlight, resetFilters }
}
