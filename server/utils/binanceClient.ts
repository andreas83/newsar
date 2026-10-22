/**
 * Binance Client Utility
 *
 * Thin wrapper around CCXT for Binance spot trading.
 * Defaults to testnet (sandbox mode) unless BINANCE_LIVE_TRADING=true.
 */
import ccxt from 'ccxt'

let client: InstanceType<typeof ccxt.binance> | null = null
let clientEnv: string | null = null // track which env the client was created for

export function isLiveEnvironment(): boolean {
  return process.env.BINANCE_LIVE_TRADING === 'true'
}

export function getEnvironmentLabel(): string {
  return isLiveEnvironment() ? 'LIVE' : 'TESTNET'
}

export function getBinanceClient(): InstanceType<typeof ccxt.binance> {
  const currentEnv = isLiveEnvironment() ? 'live' : 'testnet'

  // Re-create client if env toggle changed between runs
  if (client && clientEnv === currentEnv) return client

  const apiKey = process.env.BINANCE_API_KEY || ''
  const apiSecret = process.env.BINANCE_API_SECRET || ''

  client = new ccxt.binance({
    apiKey,
    secret: apiSecret,
    enableRateLimit: true,
    options: {
      defaultType: 'spot',
    },
  })

  if (!isLiveEnvironment()) {
    client.setSandboxMode(true)
  }

  clientEnv = currentEnv
  return client
}

export const TRADING_PAIR = 'BTC/USDC'
