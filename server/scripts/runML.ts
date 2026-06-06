/**
 * Generic wrapper that spawns Python scripts from ml/ with proper env vars,
 * streams stdout/stderr, and returns exit code.
 *
 * Usage: tsx server/scripts/runML.ts <script_name> [args...]
 *   script_name: features | train | evaluate | predict
 */

import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')
const mlDir = path.join(projectRoot, 'ml')
const venvPython = path.join(mlDir, '.venv', 'bin', 'python')

const scriptName = process.argv[2]
if (!scriptName) {
  console.error('Usage: tsx server/scripts/runML.ts <script> [args...]')
  console.error('  Scripts: features, train, evaluate, predict')
  process.exit(1)
}

const scriptMap: Record<string, string> = {
  features: 'features.py',
  train: 'train.py',
  evaluate: 'evaluate.py',
  predict: 'predict.py',
}

const pyFile = scriptMap[scriptName]
if (!pyFile) {
  console.error(`Unknown script: ${scriptName}. Available: ${Object.keys(scriptMap).join(', ')}`)
  process.exit(1)
}

const scriptPath = path.join(mlDir, pyFile)
const extraArgs = process.argv.slice(3)

// Pass DATABASE_URL and other env vars to the Python process
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://newsar@localhost:5432/newsar',
}

console.log(`[runML] Running ${pyFile} ${extraArgs.join(' ')}`)

const child = spawn(venvPython, [scriptPath, ...extraArgs], {
  cwd: mlDir,
  env,
  stdio: ['inherit', 'pipe', 'pipe'],
})

let stdout = ''

child.stdout.on('data', (data) => {
  const text = data.toString()
  stdout += text
  process.stdout.write(text)
})

child.stderr.on('data', (data) => {
  process.stderr.write(data)
})

child.on('close', (code) => {
  if (code !== 0) {
    console.error(`[runML] ${pyFile} exited with code ${code}`)
  }
  process.exit(code ?? 1)
})

// Export stdout for programmatic use
export function getStdout() { return stdout }
