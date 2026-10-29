// Genera la versión que se abre con doble clic: Abrir-Portal/index.html
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'Abrir-Portal')
const B = path.join(root, 'browser')
const nm = (p) => path.join(root, 'node_modules', p)

// 1) seed adaptado al navegador (misma lista de datos demo, PDF mínimo en vez de pdfkit/streams)
let seed = fs.readFileSync(path.join(root, 'server/src/seed.ts'), 'utf8')
const imports = seed.split('\n').filter((l) => l.startsWith('import ') && !l.includes('pdfkit'))
let body = seed.split('\n').filter((l) => !l.startsWith('import ')).join('\n')
body = body.replace(/fs\.mkdirSync\(config\.uploadDir[\s\S]*?const size = fs\.statSync\([^\n]*\n/, `const stored = 'demo-plano-fachada.pdf'
const pdfTxt = '%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\\n4 0 obj<</Length 78>>stream\\nBT /F1 20 Tf 60 780 Td (Plano de fachada - Edificio Alameda 45) Tj ET\\nendstream endobj\\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF'
fs.writeFileSync(path.join(config.uploadDir, stored), Buffer.from(pdfTxt))
const size = pdfTxt.length
`).replace(/const force = [^\n]*\n/, 'const force = false\n').replace('export const DEMO_PASSWORD', 'const DEMO_PASSWORD')
fs.writeFileSync(path.join(B, 'seed-browser.ts'), imports.join('\n').replace(/from '\.\//g, "from '../server/src/").replace(/\.js'/g, ".js'") + '\nexport async function runSeed() {\n' + body + '\n}\n')

// 2) backend completo (Hono + SQLite/WASM) en un único script clásico
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'assets'), { recursive: true })
await build({
  entryPoints: [path.join(B, 'entry.js')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, sourcemap: false,
  outfile: path.join(out, 'assets/backend.js'), inject: [path.join(B, 'inject.js')], loader: { '.wasm': 'binary', '.ts': 'ts' },
  define: { 'import.meta.url': '"file:///app/server/src/config.ts"' }, logLevel: 'warning',
  alias: {
    'node:sqlite': path.join(B, 'shim-sqlite.js'), 'node:fs': path.join(B, 'shim-fs.js'), 'node:path': path.join(B, 'shim-path.js'),
    'node:url': path.join(B, 'shim-url.js'), 'node:crypto': path.join(B, 'shim-crypto.js'),
    nodemailer: path.join(B, 'shim-nodemailer.js'), pdfkit: nm('pdfkit/js/pdfkit.browser.mjs'), exceljs: nm('exceljs/dist/exceljs.min.js'),
    'sql.js': nm('sql.js'), fs: path.join(B, 'shim-fs.js'), path: path.join(B, 'shim-path.js'),
  },
  resolveExtensions: ['.ts', '.js', '.mjs', '.json'],
  plugins: [{ name: 'js-to-ts', setup(b) { b.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (a) => {
    if (a.importer.includes('node_modules')) return
    const ts = path.resolve(a.resolveDir, a.path.replace(/\.js$/, '.ts')); if (fs.existsSync(ts)) return { path: ts }
  }) } }],
})

// 3) frontend estático (Nuxt generate, rutas con #)
const r = spawnSync('npx', ['nuxt', 'generate'], { cwd: path.join(root, 'web'), stdio: 'inherit', env: { ...process.env, PORTAL_STATIC: '1' } })
if (r.status) process.exit(r.status)
const pub = path.join(root, 'web/.output/public')
fs.cpSync(pub, out, { recursive: true })
let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '').replace(/<link rel="(manifest|apple-touch-icon)"[^>]*>/g, '')
html = html.replace(/<script type="module"([^>]*)>/g, '<script defer$1>').replace(/ crossorigin(="[^"]*")?/g, '')
html = html.replace('<head>', '<head><script src="./assets/backend.js"></script>')
html = html.replace(/(src|href)="\/(?!\/)/g, '$1="./')
fs.writeFileSync(path.join(out, 'index.html'), html)
for (const f of ['200.html', '404.html']) fs.rmSync(path.join(out, f), { force: true })
console.log('Listo:', out)
