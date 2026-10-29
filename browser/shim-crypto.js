import { Buffer } from 'buffer'
import { scrypt } from '@noble/hashes/scrypt'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha2'
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export function randomBytes(n) {
  const b = Buffer.from(crypto.getRandomValues(new Uint8Array(n)))
  const orig = b.toString.bind(b)
  b.toString = (enc, ...r) => (enc === 'base64url' ? b64url(Buffer.from(b)) : orig(enc, ...r))
  return b
}
const toU8 = (x) => (typeof x === 'string' ? new TextEncoder().encode(x) : new Uint8Array(x))
export function scryptSync(pw, salt, len) { return Buffer.from(scrypt(toU8(pw), toU8(salt), { N: 16384, r: 8, p: 1, dkLen: len })) }
export function timingSafeEqual(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0 }
export function randomUUID() {
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
export function createHmac(_alg, key) {
  const parts = []
  return { update(s) { parts.push(toU8(s)); return this }, digest(enc) {
    const all = Buffer.concat(parts.map((p) => Buffer.from(p))); const out = Buffer.from(hmac(sha256, toU8(key), new Uint8Array(all)))
    return enc ? out.toString(enc) : out } }
}
export default { randomBytes, scryptSync, timingSafeEqual, randomUUID, createHmac }
