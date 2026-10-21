/**
 * Leaflet tile URL for a CARTO basemap style ('dark_all', 'rastertiles/voyager', …).
 *
 * Since 2026 CARTO serves an "API key required" watermark tile to keyless
 * requests. The key is restricted to our domain by Referer, so it is safe to
 * ship to the browser; it lives in NUXT_PUBLIC_CARTO_API_KEY so it stays out of git.
 */
export function useCartoTileUrl(style: string): string {
  const key = useRuntimeConfig().public.cartoApiKey as string
  const url = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`
  return key ? `${url}?key=${encodeURIComponent(key)}` : url
}
