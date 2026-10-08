import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderTokenCss } from '../src/theme/css'

const target = fileURLToPath(new URL('../src/theme/tokens.css', import.meta.url))
writeFileSync(target, renderTokenCss())
console.log('Wrote', target)
