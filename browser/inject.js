import { Buffer } from 'buffer'
const process = { env: {}, argv: [], exit() {}, cwd: () => '/', platform: 'browser' }
globalThis.Buffer = globalThis.Buffer || Buffer
globalThis.process = globalThis.process || process
export { Buffer, process }
