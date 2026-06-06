import { config } from 'dotenv'
config()

import { getDatabase, closeDatabase } from '../database/db.js'
import { stockWatchlist } from '../database/schema.js'

const INITIAL_TICKERS = [
  // ═══ Technology ═══
  { ticker: 'AAPL', companyName: 'Apple Inc', sector: 'Technology' },
  { ticker: 'MSFT', companyName: 'Microsoft Corporation', sector: 'Technology' },
  { ticker: 'GOOGL', companyName: 'Alphabet Inc', sector: 'Technology' },
  { ticker: 'AMZN', companyName: 'Amazon.com Inc', sector: 'Technology' },
  { ticker: 'META', companyName: 'Meta Platforms Inc', sector: 'Technology' },
  { ticker: 'NVDA', companyName: 'NVIDIA Corporation', sector: 'Technology' },
  { ticker: 'TSLA', companyName: 'Tesla Inc', sector: 'Technology' },
  { ticker: 'NFLX', companyName: 'Netflix Inc', sector: 'Technology' },
  { ticker: 'CRM', companyName: 'Salesforce Inc', sector: 'Technology' },
  { ticker: 'ORCL', companyName: 'Oracle Corporation', sector: 'Technology' },
  { ticker: 'INTC', companyName: 'Intel Corporation', sector: 'Technology' },
  { ticker: 'AMD', companyName: 'Advanced Micro Devices Inc', sector: 'Technology' },
  { ticker: 'IBM', companyName: 'International Business Machines', sector: 'Technology' },
  { ticker: 'ADBE', companyName: 'Adobe Inc', sector: 'Technology' },
  { ticker: 'CSCO', companyName: 'Cisco Systems Inc', sector: 'Technology' },
  { ticker: 'AVGO', companyName: 'Broadcom Inc', sector: 'Technology' },
  { ticker: 'TXN', companyName: 'Texas Instruments Inc', sector: 'Technology' },
  { ticker: 'QCOM', companyName: 'Qualcomm Inc', sector: 'Technology' },
  { ticker: 'NOW', companyName: 'ServiceNow Inc', sector: 'Technology' },
  { ticker: 'PANW', companyName: 'Palo Alto Networks Inc', sector: 'Technology' },
  { ticker: 'SHOP', companyName: 'Shopify Inc', sector: 'Technology' },
  { ticker: 'UBER', companyName: 'Uber Technologies Inc', sector: 'Technology' },
  { ticker: 'SQ', companyName: 'Block Inc', sector: 'Technology' },
  { ticker: 'SNAP', companyName: 'Snap Inc', sector: 'Technology' },
  { ticker: 'PLTR', companyName: 'Palantir Technologies Inc', sector: 'Technology' },
  { ticker: 'MU', companyName: 'Micron Technology Inc', sector: 'Technology' },
  { ticker: 'AMAT', companyName: 'Applied Materials Inc', sector: 'Technology' },
  { ticker: 'LRCX', companyName: 'Lam Research Corporation', sector: 'Technology' },
  { ticker: 'KLAC', companyName: 'KLA Corporation', sector: 'Technology' },
  { ticker: 'ARM', companyName: 'Arm Holdings PLC', sector: 'Technology' },
  { ticker: 'SMCI', companyName: 'Super Micro Computer Inc', sector: 'Technology' },
  { ticker: 'DELL', companyName: 'Dell Technologies Inc', sector: 'Technology' },
  { ticker: 'HPQ', companyName: 'HP Inc', sector: 'Technology' },

  // ═══ Finance ═══
  { ticker: 'JPM', companyName: 'JPMorgan Chase & Co', sector: 'Finance' },
  { ticker: 'BAC', companyName: 'Bank of America Corporation', sector: 'Finance' },
  { ticker: 'GS', companyName: 'Goldman Sachs Group Inc', sector: 'Finance' },
  { ticker: 'MS', companyName: 'Morgan Stanley', sector: 'Finance' },
  { ticker: 'WFC', companyName: 'Wells Fargo & Company', sector: 'Finance' },
  { ticker: 'V', companyName: 'Visa Inc', sector: 'Finance' },
  { ticker: 'MA', companyName: 'Mastercard Inc', sector: 'Finance' },
  { ticker: 'BRK.B', companyName: 'Berkshire Hathaway Inc', sector: 'Finance' },
  { ticker: 'C', companyName: 'Citigroup Inc', sector: 'Finance' },
  { ticker: 'SCHW', companyName: 'Charles Schwab Corporation', sector: 'Finance' },
  { ticker: 'BLK', companyName: 'BlackRock Inc', sector: 'Finance' },
  { ticker: 'AXP', companyName: 'American Express Company', sector: 'Finance' },
  { ticker: 'PYPL', companyName: 'PayPal Holdings Inc', sector: 'Finance' },
  { ticker: 'USB', companyName: 'U.S. Bancorp', sector: 'Finance' },
  { ticker: 'PNC', companyName: 'PNC Financial Services Group', sector: 'Finance' },
  { ticker: 'COF', companyName: 'Capital One Financial Corporation', sector: 'Finance' },

  // ═══ Healthcare / Pharma ═══
  { ticker: 'JNJ', companyName: 'Johnson & Johnson', sector: 'Healthcare' },
  { ticker: 'UNH', companyName: 'UnitedHealth Group Inc', sector: 'Healthcare' },
  { ticker: 'PFE', companyName: 'Pfizer Inc', sector: 'Healthcare' },
  { ticker: 'ABBV', companyName: 'AbbVie Inc', sector: 'Healthcare' },
  { ticker: 'MRK', companyName: 'Merck & Co Inc', sector: 'Healthcare' },
  { ticker: 'LLY', companyName: 'Eli Lilly and Company', sector: 'Healthcare' },
  { ticker: 'TMO', companyName: 'Thermo Fisher Scientific Inc', sector: 'Healthcare' },
  { ticker: 'ABT', companyName: 'Abbott Laboratories', sector: 'Healthcare' },
  { ticker: 'BMY', companyName: 'Bristol-Myers Squibb Company', sector: 'Healthcare' },
  { ticker: 'AMGN', companyName: 'Amgen Inc', sector: 'Healthcare' },
  { ticker: 'GILD', companyName: 'Gilead Sciences Inc', sector: 'Healthcare' },
  { ticker: 'MDT', companyName: 'Medtronic PLC', sector: 'Healthcare' },
  { ticker: 'MRNA', companyName: 'Moderna Inc', sector: 'Healthcare' },
  { ticker: 'CVS', companyName: 'CVS Health Corporation', sector: 'Healthcare' },
  { ticker: 'CI', companyName: 'Cigna Group', sector: 'Healthcare' },
  { ticker: 'ISRG', companyName: 'Intuitive Surgical Inc', sector: 'Healthcare' },
  { ticker: 'REGN', companyName: 'Regeneron Pharmaceuticals Inc', sector: 'Healthcare' },
  { ticker: 'VRTX', companyName: 'Vertex Pharmaceuticals Inc', sector: 'Healthcare' },

  // ═══ Defense / Aerospace ═══
  { ticker: 'LMT', companyName: 'Lockheed Martin Corporation', sector: 'Defense' },
  { ticker: 'RTX', companyName: 'RTX Corporation', sector: 'Defense' },
  { ticker: 'BA', companyName: 'Boeing Company', sector: 'Defense' },
  { ticker: 'NOC', companyName: 'Northrop Grumman Corporation', sector: 'Defense' },
  { ticker: 'GD', companyName: 'General Dynamics Corporation', sector: 'Defense' },
  { ticker: 'LHX', companyName: 'L3Harris Technologies Inc', sector: 'Defense' },
  { ticker: 'HII', companyName: 'Huntington Ingalls Industries Inc', sector: 'Defense' },
  { ticker: 'TXT', companyName: 'Textron Inc', sector: 'Defense' },

  // ═══ Energy ═══
  { ticker: 'XOM', companyName: 'Exxon Mobil Corporation', sector: 'Energy' },
  { ticker: 'CVX', companyName: 'Chevron Corporation', sector: 'Energy' },
  { ticker: 'COP', companyName: 'ConocoPhillips', sector: 'Energy' },
  { ticker: 'SLB', companyName: 'Schlumberger NV', sector: 'Energy' },
  { ticker: 'EOG', companyName: 'EOG Resources Inc', sector: 'Energy' },
  { ticker: 'PXD', companyName: 'Pioneer Natural Resources', sector: 'Energy' },
  { ticker: 'OXY', companyName: 'Occidental Petroleum Corporation', sector: 'Energy' },
  { ticker: 'VLO', companyName: 'Valero Energy Corporation', sector: 'Energy' },
  { ticker: 'PSX', companyName: 'Phillips 66', sector: 'Energy' },
  { ticker: 'HAL', companyName: 'Halliburton Company', sector: 'Energy' },
  { ticker: 'DVN', companyName: 'Devon Energy Corporation', sector: 'Energy' },
  { ticker: 'FANG', companyName: 'Diamondback Energy Inc', sector: 'Energy' },

  // ═══ Consumer ═══
  { ticker: 'WMT', companyName: 'Walmart Inc', sector: 'Consumer' },
  { ticker: 'PG', companyName: 'Procter & Gamble Company', sector: 'Consumer' },
  { ticker: 'KO', companyName: 'Coca-Cola Company', sector: 'Consumer' },
  { ticker: 'PEP', companyName: 'PepsiCo Inc', sector: 'Consumer' },
  { ticker: 'MCD', companyName: "McDonald's Corporation", sector: 'Consumer' },
  { ticker: 'NKE', companyName: 'Nike Inc', sector: 'Consumer' },
  { ticker: 'DIS', companyName: 'Walt Disney Company', sector: 'Consumer' },
  { ticker: 'COST', companyName: 'Costco Wholesale Corporation', sector: 'Consumer' },
  { ticker: 'HD', companyName: 'Home Depot Inc', sector: 'Consumer' },
  { ticker: 'LOW', companyName: "Lowe's Companies Inc", sector: 'Consumer' },
  { ticker: 'SBUX', companyName: 'Starbucks Corporation', sector: 'Consumer' },
  { ticker: 'TGT', companyName: 'Target Corporation', sector: 'Consumer' },
  { ticker: 'CMG', companyName: 'Chipotle Mexican Grill Inc', sector: 'Consumer' },
  { ticker: 'ABNB', companyName: 'Airbnb Inc', sector: 'Consumer' },
  { ticker: 'BKNG', companyName: 'Booking Holdings Inc', sector: 'Consumer' },
  { ticker: 'MAR', companyName: 'Marriott International Inc', sector: 'Consumer' },
  { ticker: 'YUM', companyName: 'Yum! Brands Inc', sector: 'Consumer' },
  { ticker: 'EL', companyName: 'Estee Lauder Companies Inc', sector: 'Consumer' },
  { ticker: 'CL', companyName: 'Colgate-Palmolive Company', sector: 'Consumer' },
  { ticker: 'KMB', companyName: 'Kimberly-Clark Corporation', sector: 'Consumer' },
  { ticker: 'KHC', companyName: 'Kraft Heinz Company', sector: 'Consumer' },
  { ticker: 'MDLZ', companyName: 'Mondelez International Inc', sector: 'Consumer' },

  // ═══ Industrial ═══
  { ticker: 'GE', companyName: 'GE Aerospace', sector: 'Industrial' },
  { ticker: 'CAT', companyName: 'Caterpillar Inc', sector: 'Industrial' },
  { ticker: 'HON', companyName: 'Honeywell International Inc', sector: 'Industrial' },
  { ticker: 'UPS', companyName: 'United Parcel Service Inc', sector: 'Industrial' },
  { ticker: 'DE', companyName: 'Deere & Company', sector: 'Industrial' },
  { ticker: 'MMM', companyName: '3M Company', sector: 'Industrial' },
  { ticker: 'FDX', companyName: 'FedEx Corporation', sector: 'Industrial' },
  { ticker: 'EMR', companyName: 'Emerson Electric Co', sector: 'Industrial' },
  { ticker: 'ITW', companyName: 'Illinois Tool Works Inc', sector: 'Industrial' },
  { ticker: 'ETN', companyName: 'Eaton Corporation PLC', sector: 'Industrial' },

  // ═══ Telecom / Media ═══
  { ticker: 'T', companyName: 'AT&T Inc', sector: 'Telecom' },
  { ticker: 'VZ', companyName: 'Verizon Communications Inc', sector: 'Telecom' },
  { ticker: 'TMUS', companyName: 'T-Mobile US Inc', sector: 'Telecom' },
  { ticker: 'CMCSA', companyName: 'Comcast Corporation', sector: 'Telecom' },
  { ticker: 'WBD', companyName: 'Warner Bros Discovery Inc', sector: 'Telecom' },
  { ticker: 'PARA', companyName: 'Paramount Global', sector: 'Telecom' },
  { ticker: 'FOX', companyName: 'Fox Corporation', sector: 'Telecom' },
  { ticker: 'NWSA', companyName: 'News Corp', sector: 'Telecom' },

  // ═══ Real Estate ═══
  { ticker: 'AMT', companyName: 'American Tower Corporation', sector: 'Real Estate' },
  { ticker: 'PLD', companyName: 'Prologis Inc', sector: 'Real Estate' },
  { ticker: 'CCI', companyName: 'Crown Castle Inc', sector: 'Real Estate' },
  { ticker: 'SPG', companyName: 'Simon Property Group Inc', sector: 'Real Estate' },

  // ═══ Utilities ═══
  { ticker: 'NEE', companyName: 'NextEra Energy Inc', sector: 'Utilities' },
  { ticker: 'DUK', companyName: 'Duke Energy Corporation', sector: 'Utilities' },
  { ticker: 'SO', companyName: 'Southern Company', sector: 'Utilities' },

  // ═══ Materials / Mining ═══
  { ticker: 'LIN', companyName: 'Linde PLC', sector: 'Materials' },
  { ticker: 'APD', companyName: 'Air Products and Chemicals Inc', sector: 'Materials' },
  { ticker: 'FCX', companyName: 'Freeport-McMoRan Inc', sector: 'Materials' },
  { ticker: 'NEM', companyName: 'Newmont Corporation', sector: 'Materials' },
  { ticker: 'NUE', companyName: 'Nucor Corporation', sector: 'Materials' },
  { ticker: 'DOW', companyName: 'Dow Inc', sector: 'Materials' },

  // ═══ Automotive ═══
  { ticker: 'GM', companyName: 'General Motors Company', sector: 'Automotive' },
  { ticker: 'F', companyName: 'Ford Motor Company', sector: 'Automotive' },
  { ticker: 'RIVN', companyName: 'Rivian Automotive Inc', sector: 'Automotive' },
  { ticker: 'LCID', companyName: 'Lucid Group Inc', sector: 'Automotive' },

  // ═══ Crypto / Fintech ═══
  { ticker: 'COIN', companyName: 'Coinbase Global Inc', sector: 'Fintech' },
  { ticker: 'HOOD', companyName: 'Robinhood Markets Inc', sector: 'Fintech' },
  { ticker: 'SOFI', companyName: 'SoFi Technologies Inc', sector: 'Fintech' },
  { ticker: 'MSTR', companyName: 'MicroStrategy Inc', sector: 'Fintech' },

  // ═══ AI / Robotics ═══
  { ticker: 'AI', companyName: 'C3.ai Inc', sector: 'AI' },
  { ticker: 'PATH', companyName: 'UiPath Inc', sector: 'AI' },
  { ticker: 'BBAI', companyName: 'BigBear.ai Holdings Inc', sector: 'AI' },
  { ticker: 'SOUN', companyName: 'SoundHound AI Inc', sector: 'AI' },

  // ═══ Semiconductor Equipment ═══
  { ticker: 'ASML', companyName: 'ASML Holding NV', sector: 'Semiconductors' },
  { ticker: 'TSM', companyName: 'Taiwan Semiconductor Manufacturing', sector: 'Semiconductors' },
  { ticker: 'MRVL', companyName: 'Marvell Technology Inc', sector: 'Semiconductors' },
  { ticker: 'ON', companyName: 'ON Semiconductor Corporation', sector: 'Semiconductors' },

  // ═══ Chinese ADRs (geopolitically relevant) ═══
  { ticker: 'BABA', companyName: 'Alibaba Group Holding', sector: 'China ADR' },
  { ticker: 'PDD', companyName: 'PDD Holdings Inc', sector: 'China ADR' },
  { ticker: 'JD', companyName: 'JD.com Inc', sector: 'China ADR' },
  { ticker: 'BIDU', companyName: 'Baidu Inc', sector: 'China ADR' },
  { ticker: 'NIO', companyName: 'NIO Inc', sector: 'China ADR' },
  { ticker: 'LI', companyName: 'Li Auto Inc', sector: 'China ADR' },
  { ticker: 'XPEV', companyName: 'XPeng Inc', sector: 'China ADR' },

  // ═══ European ADRs (geopolitically relevant) ═══
  { ticker: 'SAP', companyName: 'SAP SE', sector: 'Europe ADR' },
  { ticker: 'SHEL', companyName: 'Shell PLC', sector: 'Europe ADR' },
  { ticker: 'BP', companyName: 'BP PLC', sector: 'Europe ADR' },
  { ticker: 'TTE', companyName: 'TotalEnergies SE', sector: 'Europe ADR' },
  { ticker: 'NVO', companyName: 'Novo Nordisk A/S', sector: 'Europe ADR' },
  { ticker: 'AZN', companyName: 'AstraZeneca PLC', sector: 'Europe ADR' },
  { ticker: 'UL', companyName: 'Unilever PLC', sector: 'Europe ADR' },
  { ticker: 'SPOT', companyName: 'Spotify Technology SA', sector: 'Europe ADR' },

  // ═══ Index ETFs ═══
  { ticker: 'SPY', companyName: 'SPDR S&P 500 ETF Trust', sector: 'Index' },
  { ticker: 'QQQ', companyName: 'Invesco QQQ Trust', sector: 'Index' },
  { ticker: 'DIA', companyName: 'SPDR Dow Jones Industrial Average ETF', sector: 'Index' },
  { ticker: 'IWM', companyName: 'iShares Russell 2000 ETF', sector: 'Index' },
  { ticker: 'VTI', companyName: 'Vanguard Total Stock Market ETF', sector: 'Index' },
  { ticker: 'EFA', companyName: 'iShares MSCI EAFE ETF', sector: 'Index' },
  { ticker: 'EEM', companyName: 'iShares MSCI Emerging Markets ETF', sector: 'Index' },
  { ticker: 'GLD', companyName: 'SPDR Gold Shares', sector: 'Commodities' },
  { ticker: 'SLV', companyName: 'iShares Silver Trust', sector: 'Commodities' },
  { ticker: 'USO', companyName: 'United States Oil Fund', sector: 'Commodities' },
  { ticker: 'TLT', companyName: 'iShares 20+ Year Treasury Bond ETF', sector: 'Bonds' },
  { ticker: 'HYG', companyName: 'iShares iBoxx High Yield Corporate Bond ETF', sector: 'Bonds' },
  { ticker: 'VIX', companyName: 'CBOE Volatility Index', sector: 'Volatility' },
]

async function main() {
  console.log('=== Stock Watchlist Seeder ===\n')
  const db = getDatabase()

  let inserted = 0
  let skipped = 0

  for (const entry of INITIAL_TICKERS) {
    try {
      await db.insert(stockWatchlist).values({
        ticker: entry.ticker,
        companyName: entry.companyName,
        sector: entry.sector,
        exchange: 'US',
        isActive: true,
      }).onConflictDoNothing()
      inserted++
    } catch (error) {
      skipped++
    }
  }

  console.log(`Inserted: ${inserted}, Skipped (duplicates): ${skipped}`)
  console.log(`Total tickers in seed: ${INITIAL_TICKERS.length}`)

  await closeDatabase()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
