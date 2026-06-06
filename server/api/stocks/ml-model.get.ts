/**
 * ML Model Status API
 *
 * Routes:
 *   GET /api/stocks/ml-model?action=status    — Model version, training date, feature count
 *   GET /api/stocks/ml-model?action=metrics   — Walk-forward metrics (accuracy, AUC, etc.)
 *   GET /api/stocks/ml-model?action=features  — Feature importance ranking
 */

import { readFileSync, existsSync } from 'fs'
import path from 'path'

// Use the known project root (PM2 cwd is set in ecosystem.config.cjs)
const projectRoot = '/var/www/newsar.codejungle.org'
const modelsDir = path.join(projectRoot, 'ml', 'models')
const reportsDir = path.join(projectRoot, 'ml', 'reports')

function readJsonFile(filePath: string): any | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (e: any) {
    console.error(`[ml-model] Failed to read ${filePath}:`, e?.message)
    return null
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const action = (query.action as string) || 'status'

  const metadata = readJsonFile(path.join(modelsDir, 'model_metadata.json'))
  const featureColumns = readJsonFile(path.join(modelsDir, 'feature_columns.json'))

  if (action === 'status') {
    const modelFiles = ['xgb_5d_classifier.joblib', 'xgb_5d_regressor.joblib',
                        'xgb_4w_classifier.joblib', 'logreg_baseline.joblib']

    const availableModels = modelFiles.filter(f =>
      existsSync(path.join(modelsDir, f))
    )

    return {
      hasModels: availableModels.length > 0,
      availableModels,
      trainingDate: metadata?.training_date || null,
      totalSamples: metadata?.total_samples || null,
      totalFeatures: metadata?.total_features || null,
      nFolds: metadata?.n_folds || null,
      featureCount: featureColumns?.total_features || null,
    }
  }

  if (action === 'metrics') {
    if (!metadata) return { error: 'No model metadata found. Run ml:train first.' }

    const report = readJsonFile(path.join(reportsDir, 'evaluation_report.json'))

    const models: Record<string, any> = {}
    for (const [name, info] of Object.entries(metadata.models || {})) {
      const modelInfo = info as any
      models[name] = {
        avgMetrics: modelInfo.avg_metrics,
        foldCount: modelInfo.fold_metrics?.length || 0,
        perFold: modelInfo.fold_metrics,
      }
    }

    return {
      trainingDate: metadata.training_date,
      totalSamples: metadata.total_samples,
      nFolds: metadata.n_folds,
      models,
      heuristicBaseline: report?.heuristic_baseline || null,
      randomBaseline: report?.random_baseline || null,
    }
  }

  if (action === 'features') {
    if (!metadata) return { error: 'No model metadata found. Run ml:train first.' }

    const featureImportance: Record<string, any[]> = {}

    for (const [name, info] of Object.entries(metadata.models || {})) {
      const modelInfo = info as any
      if (modelInfo.feature_importance) {
        const sorted = Object.entries(modelInfo.feature_importance)
          .map(([feat, imp]) => ({ feature: feat, importance: imp as number }))
          .sort((a, b) => b.importance - a.importance)

        featureImportance[name] = sorted
      }
    }

    return {
      featureColumns: featureColumns?.feature_columns || [],
      totalFeatures: featureColumns?.total_features || 0,
      featureImportance,
    }
  }

  return { error: `Unknown action: ${action}` }
})
