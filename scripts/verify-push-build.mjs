import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const output = resolve(process.argv[2] || 'dist')
const source = readFileSync('public/push-sw.js')
const revision = createHash('sha256').update(source).digest('hex').slice(0, 12)
const sw = readFileSync(resolve(output, 'sw.js'), 'utf8')
if (!sw.includes(`importScripts("push-sw.js?v=${revision}")`))
  throw new Error(
    'Production worker must import the current versioned push handler.',
  )
if (!source.equals(readFileSync(resolve(output, 'push-sw.js'))))
  throw new Error('Published push handler differs from source.')
console.log('Production push worker wiring verified.')
