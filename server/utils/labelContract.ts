/**
 * Reader for ml/models/label_contract.json.
 *
 * The contract is written by `ml/evaluate.py` from the live track record, not by
 * hand. Its `tradeable` flag answers a narrower question than "does the pipeline
 * run": does this model's probabilities carry information beyond quoting the
 * base rate, measured as Brier skill > 0?
 *
 * The distinction matters because signals and trades have different bars. A
 * model with no demonstrated skill should still publish signals — that is how
 * the track record accumulates and how the question eventually gets answered.
 * It should not be opening positions while it does so.
 */

import { readFileSync, existsSync, statSync } from 'fs'
import path from 'path'

const CONTRACT_PATH = path.join('/var/www/newsar.codejungle.org', 'ml', 'models', 'label_contract.json')

export interface ContractSource {
  tradeable: boolean
  reason: string
  score?: string
  label_expr?: string
  brier_skill?: number | null
  auc?: number | null
  auc_ci_low?: number | null
  auc_ci_high?: number | null
  n?: number
  n_eff?: number
}

export interface LabelContract {
  generated_at: string
  criterion: string
  horizon_days: number
  version?: string
  sources: Record<string, ContractSource>
}

let cached: { contract: LabelContract | null, mtimeMs: number } | null = null

/** Read the contract, re-reading only when the file changes on disk. */
export function readLabelContract(): LabelContract | null {
  if (!existsSync(CONTRACT_PATH)) return null
  try {
    const mtimeMs = statSync(CONTRACT_PATH).mtimeMs
    if (cached && cached.mtimeMs === mtimeMs) return cached.contract
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8')) as LabelContract
    cached = { contract, mtimeMs }
    return contract
  } catch (e: any) {
    console.error('[labelContract] Failed to read contract:', e?.message)
    return null
  }
}

/**
 * Whether a model source is cleared to open positions.
 *
 * Absent or unreadable contract means NOT tradeable. Failing closed is the whole
 * point: a missing evaluation is not evidence of skill, and the default must not
 * be "trade anyway".
 */
export function isTradeable(modelSource: string): { tradeable: boolean, reason: string } {
  const contract = readLabelContract()
  if (!contract) {
    return { tradeable: false, reason: 'no label contract found — run ml:evaluate' }
  }
  const entry = contract.sources?.[modelSource]
  if (!entry) {
    return { tradeable: false, reason: `no contract entry for model source '${modelSource}'` }
  }
  return { tradeable: !!entry.tradeable, reason: entry.reason }
}
