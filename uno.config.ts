import { defineConfig, presetUno, presetAttributify, presetIcons } from 'unocss'

export default defineConfig({
  presets: [
    presetUno({
      dark: 'class',
    }),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      warn: false,
    }),
  ],

  theme: {
    colors: {
      // Intel palette via CSS custom properties (auto dark mode)
      paper:      'var(--color-paper)',
      'paper-2':  'var(--color-paper-2)',
      panel:      'var(--color-panel)',
      rule:       'var(--color-rule)',
      'rule-soft':'var(--color-rule-soft)',
      ink:        'var(--color-ink)',
      'ink-2':    'var(--color-ink-2)',
      'ink-3':    'var(--color-ink-3)',
      'ink-4':    'var(--color-ink-4)',
      accent:     'var(--color-accent)',
      'accent-2': 'var(--color-accent-2)',
      'accent-tint':'var(--color-accent-tint)',
      'accent-ink':'var(--color-accent-ink)',
      // Semantic
      'intel-red':    'var(--color-red)',
      'intel-amber':  'var(--color-amber)',
      'intel-green':  'var(--color-green)',
      'intel-blue':   'var(--color-blue)',
      'intel-violet': 'var(--color-violet)',
      // Legacy compatibility
      primary: {
        50: '#FEF3C7',
        100: '#FDE68A',
        200: '#FCD34D',
        300: '#FBBF24',
        400: '#F59E0B',
        500: '#D97706',
        600: '#B45309',
        700: '#92400E',
        800: '#78350F',
        900: '#451A03',
        950: '#271006',
      },
    },
    fontFamily: {
      sans:  '"IBM Plex Sans", "Inter", system-ui, sans-serif',
      serif: '"Newsreader", Georgia, serif',
      mono:  '"JetBrains Mono", ui-monospace, monospace',
    },
  },

  shortcuts: {
    // ── Ribbon ──
    'intel-ribbon': 'sticky top-0 z-40 grid grid-cols-[auto_1fr_auto] items-center gap-6 bg-[#0C0A09] text-[#E7E2D4] px-6 h-8 font-mono text-[11px] tracking-wider border-b border-[#0C0A09]',
    'ribbon-brand': 'flex items-center gap-2.5 font-bold whitespace-nowrap',
    'ribbon-dot': 'w-2 h-2 rounded-full bg-accent shadow-[0_0_0_2px_rgba(217,119,6,0.25)]',
    'ribbon-ticker': 'flex gap-6 overflow-hidden text-[#A7A08C]',
    'ribbon-meta': 'flex gap-4 text-[#A7A08C] whitespace-nowrap',

    // ── Nav ──
    'intel-nav': 'sticky top-[31px] z-39 grid grid-cols-[auto_1fr_auto] items-center gap-6 bg-paper border-b border-rule px-6 py-3.5 -mt-px shadow-[0_-2px_0_#0C0A09]',
    'intel-logo': 'font-serif text-[22px] font-bold tracking-tight flex items-baseline gap-2',
    'intel-logo-tag': 'font-mono text-[10px] font-medium px-1.5 py-0.75 bg-accent text-white rounded-sm tracking-widest relative top-[-4px]',
    'intel-tab': 'px-3 py-2 text-ink-3 rounded-sm font-mono text-[11px] font-medium tracking-widest uppercase hover:bg-paper-2 hover:text-ink transition-colors',
    'intel-tab-active': 'text-ink bg-paper-2',

    // ── Cards ──
    'intel-card': 'bg-panel border border-rule',
    'intel-card-hd': 'px-[22px] py-3 border-b border-rule flex justify-between items-center',
    'intel-card-bd': 'p-[22px]',

    // ── Sections ──
    'intel-sect': 'mt-10 first:mt-0',
    'intel-sect-head': 'flex items-center gap-4 pb-2.5 border-b border-ink mb-4',
    'sect-num': 'font-mono text-[10px] font-semibold tracking-widest text-ink-3',
    'sect-title': 'font-serif text-lg font-semibold tracking-tight m-0',
    'sect-tag': 'ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-wider uppercase text-ink-3 whitespace-nowrap',

    // ── Stats ──
    'stat-grid': 'grid border border-rule bg-panel',
    'stat-cell': 'px-5 py-[18px] border-r border-rule last:border-r-0',
    'stat-label': 'font-mono text-[10px] font-semibold tracking-widest uppercase text-ink-3 mb-2',
    'stat-value': 'font-serif text-[28px] font-semibold tracking-tight text-ink flex items-baseline gap-1.5 leading-none',
    'stat-unit': 'font-mono text-[11px] font-medium text-ink-3 tracking-normal',

    // ── Text patterns ──
    'text-label': 'font-mono text-[10px] font-semibold tracking-widest uppercase text-ink-3',
    'text-kicker': 'font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-ink-3 mb-3',

    // ── Breadcrumb ──
    'intel-breadcrumb': 'flex items-center gap-2.5 py-4 font-mono text-[11px] text-ink-3 tracking-wider flex-wrap',

    // ── Chips ──
    'intel-chip': 'font-mono text-[10.5px] px-[7px] py-[3px] border border-rule bg-paper text-ink-2 hover:bg-accent-tint hover:text-accent-ink transition-colors',

    // ── Detail row ──
    'detail-row': 'flex justify-between items-center py-2.5 border-b border-rule-soft last:border-b-0 font-mono text-[11px]',

    // ── Buttons ──
    'btn-nav': 'inline-flex items-center gap-1.5 px-[11px] py-[7px] font-mono text-[11px] font-semibold tracking-wider uppercase border border-rule rounded-sm bg-panel hover:bg-paper-2 transition-colors',
    'btn-intel': 'inline-flex items-center justify-center gap-2 font-medium rounded-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed',

    // ── Meters ──
    'meter-h': 'h-1 bg-paper-2 overflow-hidden',
    'meter-fill': 'h-full bg-accent transition-[width] duration-300',

    // ── Sep dot ──
    'sep-dot': 'w-[3px] h-[3px] bg-ink-4 rounded-full shrink-0',

    // ── Wrap ──
    'intel-wrap': 'max-w-[1440px] mx-auto px-6 pb-20',
    'intel-wrap-std': 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
  },
})
