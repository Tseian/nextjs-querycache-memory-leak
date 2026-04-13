const fs = require('fs')
const path = require('path')
const v8 = require('v8')

const intervalMs = Number(process.env.HEAP_SNAPSHOT_INTERVAL_MS ?? 10000)
if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
  process.stderr.write(`[heap-snapshot] invalid HEAP_SNAPSHOT_INTERVAL_MS: ${process.env.HEAP_SNAPSHOT_INTERVAL_MS}\n`)
  process.exit(1)
}

const outputDir = process.env.HEAP_SNAPSHOT_DIR
  ? path.resolve(process.env.HEAP_SNAPSHOT_DIR)
  : path.resolve(process.cwd(), 'snapshots')

fs.mkdirSync(outputDir, { recursive: true })

let snapshotIndex = 0

function writeSnapshot(tag) {
  snapshotIndex += 1
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `heap-${ts}-idx${String(snapshotIndex).padStart(4, '0')}-pid${process.pid}${tag ? `-${tag}` : ''}.heapsnapshot`
  const filePath = path.join(outputDir, filename)
  const written = v8.writeHeapSnapshot(filePath)
  process.stdout.write(`[heap-snapshot] wrote #${snapshotIndex} ${written}\n`)
}

setTimeout(() => writeSnapshot('startup'), 0)
setInterval(() => writeSnapshot(`t${intervalMs}`), intervalMs).unref()
