import { formatConfig, median, verdict } from './stats'
import type { WorkerRequest, WorkerResponse } from './protocol'

/** Ascending cost. The run stops at the first failure. */
const CONFIGS: ReadonlyArray<{ memoryKiB: number; iterations: number }> = [
  { memoryKiB: 19456, iterations: 2 },
  { memoryKiB: 32768, iterations: 3 },
  { memoryKiB: 65536, iterations: 2 },
  { memoryKiB: 65536, iterations: 3 },
  { memoryKiB: 65536, iterations: 4 },
  { memoryKiB: 98304, iterations: 3 },
  { memoryKiB: 131072, iterations: 3 },
]
const RUNS = 3
const MARKER_KEY = 'kdf-bench-running'
const RESULTS_KEY = 'kdf-bench-results'

interface Row {
  label: string
  runs: number[]
  median: number
  verdict: string
  error?: string
}

const app = document.getElementById('app')
if (!app) throw new Error('Missing #app')

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: results still show on screen */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}

const nav = navigator as Navigator & { deviceMemory?: number }
const deviceInfo = [
  `UA: ${navigator.userAgent}`,
  `Cores: ${navigator.hardwareConcurrency}`,
  `deviceMemory (capped by browser): ${nav.deviceMemory ?? 'n/a'} GB`,
  `Time: ${new Date().toISOString()}`,
].join('\n')

const title = el('h1', 'Argon2id benchmark')
const intro = el(
  'p',
  'Close other apps first. Tap Start and keep this tab in the foreground. It runs 3 times per setting and stops at the first failure.',
)
const startBtn = el('button', 'Start')
const copyBtn = el('button', 'Copy results')
const status = el('p', '')
const infoBox = el('pre', deviceInfo)
const table = el('table')
table.innerHTML =
  '<thead><tr><th>Setting</th><th>Runs (ms)</th><th>Median</th><th>Verdict</th></tr></thead><tbody></tbody>'
const tbody = table.querySelector('tbody') as HTMLTableSectionElement
const report = el('pre')

app.append(title, intro, startBtn, copyBtn, status, infoBox, table, report)

const rows: Row[] = []

function render(): void {
  tbody.replaceChildren(
    ...rows.map((r) => {
      const tr = el('tr')
      const cls = r.error
        ? 'bad'
        : r.verdict === 'ok'
          ? 'ok'
          : r.verdict === 'slow'
            ? 'slow'
            : 'bad'
      const cells = [
        r.label,
        r.error ? `FAILED: ${r.error}` : r.runs.map((n) => Math.round(n)).join(', '),
        r.error ? '-' : `${Math.round(r.median)}`,
        r.error ? 'failed' : r.verdict,
      ]
      cells.forEach((c, i) => {
        const td = el('td', c)
        if (i === 3) td.className = cls
        tr.append(td)
      })
      return tr
    }),
  )
  const text = [
    deviceInfo,
    '',
    ...rows.map((r) =>
      r.error
        ? `${r.label}: FAILED (${r.error})`
        : `${r.label}: runs ${r.runs.map((n) => Math.round(n)).join('/')} ms, median ${Math.round(r.median)} ms, ${r.verdict}`,
    ),
  ].join('\n')
  report.textContent = text
  safeSet(RESULTS_KEY, text)
}

function runConfig(
  worker: Worker,
  memoryKiB: number,
  iterations: number,
): Promise<{ runs: number[]; error?: string }> {
  return new Promise((resolve) => {
    const runs: number[] = []
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'run') {
        runs.push(msg.ms)
        status.textContent = `Running ${formatConfig(memoryKiB, iterations)}: run ${runs.length}/${RUNS}`
      } else if (msg.type === 'done') resolve({ runs })
      else resolve({ runs, error: msg.message })
    }
    worker.onerror = (e) => resolve({ runs, error: e.message || 'worker crashed' })
    const req: WorkerRequest = { memoryKiB, iterations, runs: RUNS }
    worker.postMessage(req)
  })
}

async function start(): Promise<void> {
  startBtn.disabled = true
  rows.length = 0
  render()
  for (const cfg of CONFIGS) {
    const label = formatConfig(cfg.memoryKiB, cfg.iterations)
    safeSet(MARKER_KEY, label)
    // A fresh worker per setting, so memory from the previous one is released.
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const result = await runConfig(worker, cfg.memoryKiB, cfg.iterations)
    worker.terminate()
    if (result.error) {
      rows.push({ label, runs: result.runs, median: NaN, verdict: 'failed', error: result.error })
      render()
      break
    }
    const m = median(result.runs)
    rows.push({ label, runs: result.runs, median: m, verdict: verdict(m) })
    render()
  }
  safeSet(MARKER_KEY, null)
  status.textContent = 'Finished. Tap Copy results and paste them to Claude.'
  startBtn.disabled = false
}

const crashed = safeGet(MARKER_KEY)
const previous = safeGet(RESULTS_KEY)
if (crashed) {
  status.textContent = `The page reloaded or crashed while running: ${crashed}. That setting is too heavy for this phone.`
  safeSet(MARKER_KEY, null)
}
if (previous) report.textContent = `Previous results:\n${previous}`

startBtn.addEventListener('click', () => void start())
copyBtn.addEventListener('click', () => {
  const text = report.textContent ?? ''
  const done = () => {
    status.textContent = 'Copied.'
  }
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => undefined)
  else {
    const range = document.createRange()
    range.selectNodeContents(report)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
    status.textContent = 'Select and copy the text below.'
  }
})
