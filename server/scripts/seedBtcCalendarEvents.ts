import { getDatabase } from '../database/db.js'
import { sql } from 'drizzle-orm'

interface CalendarEvent {
  eventDate: string
  eventType: string
  name: string
  expectedImpact: 'high' | 'medium' | 'low'
}

function generateEvents(): CalendarEvent[] {
  const events: CalendarEvent[] = []

  // FOMC meetings 2024-2027 (approximate dates, 8 per year)
  const fomcDates = [
    // 2024
    '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12',
    '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
    // 2025
    '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
    '2025-07-30', '2025-09-17', '2025-11-05', '2025-12-17',
    // 2026
    '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
    '2026-07-29', '2026-09-16', '2026-11-04', '2026-12-16',
    // 2027
    '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-16',
    '2027-07-28', '2027-09-15', '2027-11-03', '2027-12-15',
  ]
  for (const d of fomcDates) {
    events.push({ eventDate: d, eventType: 'fomc', name: 'FOMC Meeting', expectedImpact: 'high' })
  }

  // US Holidays (market closed — affects crypto differently)
  const holidays: Array<[string, string]> = [
    // 2024
    ['2024-01-01', 'New Year'], ['2024-01-15', 'MLK Day'], ['2024-02-19', 'Presidents Day'],
    ['2024-05-27', 'Memorial Day'], ['2024-07-04', 'Independence Day'], ['2024-09-02', 'Labor Day'],
    ['2024-11-28', 'Thanksgiving'], ['2024-12-25', 'Christmas'],
    // 2025
    ['2025-01-01', 'New Year'], ['2025-01-20', 'MLK Day'], ['2025-02-17', 'Presidents Day'],
    ['2025-05-26', 'Memorial Day'], ['2025-07-04', 'Independence Day'], ['2025-09-01', 'Labor Day'],
    ['2025-11-27', 'Thanksgiving'], ['2025-12-25', 'Christmas'],
    // 2026
    ['2026-01-01', 'New Year'], ['2026-01-19', 'MLK Day'], ['2026-02-16', 'Presidents Day'],
    ['2026-05-25', 'Memorial Day'], ['2026-07-03', 'Independence Day (observed)'], ['2026-09-07', 'Labor Day'],
    ['2026-11-26', 'Thanksgiving'], ['2026-12-25', 'Christmas'],
    // 2027
    ['2027-01-01', 'New Year'], ['2027-01-18', 'MLK Day'], ['2027-02-15', 'Presidents Day'],
    ['2027-05-31', 'Memorial Day'], ['2027-07-05', 'Independence Day (observed)'], ['2027-09-06', 'Labor Day'],
    ['2027-11-25', 'Thanksgiving'], ['2027-12-24', 'Christmas (observed)'],
  ]
  for (const [d, name] of holidays) {
    events.push({ eventDate: d, eventType: 'us_holiday', name, expectedImpact: 'low' })
  }

  // Tax deadlines (quarterly estimated + annual)
  const taxDates = [
    '2024-04-15', '2024-06-17', '2024-09-16', '2025-01-15',
    '2025-04-15', '2025-06-16', '2025-09-15', '2026-01-15',
    '2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15',
    '2027-04-15', '2027-06-15', '2027-09-15',
  ]
  for (const d of taxDates) {
    events.push({ eventDate: d, eventType: 'tax_deadline', name: 'Tax Payment Deadline', expectedImpact: 'medium' })
  }

  // BTC halvings
  events.push({ eventDate: '2024-04-20', eventType: 'btc_halving', name: 'Bitcoin Halving (4th)', expectedImpact: 'high' })
  events.push({ eventDate: '2028-04-15', eventType: 'btc_halving', name: 'Bitcoin Halving (5th, est.)', expectedImpact: 'high' })

  // Options expiry (last Friday of each month, 2024-2027) — generate programmatically
  for (let year = 2024; year <= 2027; year++) {
    for (let month = 0; month < 12; month++) {
      // Last Friday: go to last day, walk back to Friday
      const lastDay = new Date(year, month + 1, 0)
      while (lastDay.getDay() !== 5) lastDay.setDate(lastDay.getDate() - 1)
      const dateStr = lastDay.toISOString().split('T')[0]
      const isQuarterly = [2, 5, 8, 11].includes(month) // Mar, Jun, Sep, Dec
      events.push({
        eventDate: dateStr,
        eventType: 'options_expiry',
        name: isQuarterly ? 'Quarterly Options Expiry' : 'Monthly Options Expiry',
        expectedImpact: isQuarterly ? 'high' : 'medium',
      })
    }
  }

  // CPI releases (~13th of each month)
  const cpiDates2024 = ['2024-01-11', '2024-02-13', '2024-03-12', '2024-04-10', '2024-05-15', '2024-06-12',
    '2024-07-11', '2024-08-14', '2024-09-11', '2024-10-10', '2024-11-13', '2024-12-11']
  const cpiDates2025 = ['2025-01-15', '2025-02-12', '2025-03-12', '2025-04-10', '2025-05-13', '2025-06-11',
    '2025-07-15', '2025-08-12', '2025-09-10', '2025-10-14', '2025-11-12', '2025-12-10']
  // 2026-2027: approximate ~13th of month
  for (let year = 2026; year <= 2027; year++) {
    for (let month = 1; month <= 12; month++) {
      const d = `${year}-${String(month).padStart(2, '0')}-13`
      events.push({ eventDate: d, eventType: 'cpi_release', name: 'CPI Release', expectedImpact: 'high' })
    }
  }
  for (const d of [...cpiDates2024, ...cpiDates2025]) {
    events.push({ eventDate: d, eventType: 'cpi_release', name: 'CPI Release', expectedImpact: 'high' })
  }

  // Elections
  events.push({ eventDate: '2024-11-05', eventType: 'election', name: 'US Presidential Election', expectedImpact: 'high' })
  events.push({ eventDate: '2026-11-03', eventType: 'election', name: 'US Midterm Elections', expectedImpact: 'medium' })
  events.push({ eventDate: '2028-11-07', eventType: 'election', name: 'US Presidential Election', expectedImpact: 'high' })

  return events
}

async function main() {
  console.log('[seedBtcCalendarEvents] Seeding calendar events...')
  const db = getDatabase()

  const events = generateEvents()
  let inserted = 0, skipped = 0

  for (const evt of events) {
    try {
      await db.execute(sql`
        INSERT INTO btc_calendar_events (event_date, event_type, name, expected_impact)
        VALUES (${evt.eventDate}::date, ${evt.eventType}, ${evt.name}, ${evt.expectedImpact})
        ON CONFLICT DO NOTHING
      `)
      inserted++
    } catch {
      skipped++
    }
  }

  console.log(`[seedBtcCalendarEvents] Done: ${inserted} inserted, ${skipped} skipped`)
  console.log(`  FOMC: ${events.filter(e => e.eventType === 'fomc').length}`)
  console.log(`  Holidays: ${events.filter(e => e.eventType === 'us_holiday').length}`)
  console.log(`  Tax: ${events.filter(e => e.eventType === 'tax_deadline').length}`)
  console.log(`  Halvings: ${events.filter(e => e.eventType === 'btc_halving').length}`)
  console.log(`  Options expiry: ${events.filter(e => e.eventType === 'options_expiry').length}`)
  console.log(`  CPI: ${events.filter(e => e.eventType === 'cpi_release').length}`)
  console.log(`  Elections: ${events.filter(e => e.eventType === 'election').length}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
