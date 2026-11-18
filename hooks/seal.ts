// End-to-end sealing (age-style): every room write is sealed on this computer to the keys of the room's members,
// so the repo, the artifact and anyone who reads either hold only ciphertext. Each computer makes its own X25519
// key once and keeps the secret half in its own store; the public half rides on its head in each room (identity.ts).
// A sealed doc carries a fresh content key, wrapped once per member key: NaCl secretbox for the body, box for wraps.
import type { Host } from './host'
import nacl from './nacl/nacl-fast.js'

export type Envelope = { n: string; from: string; c: string; k: Record<string, string> }
type Keyring = { publicKey: Uint8Array; secretKey: Uint8Array }

const KEY_STORE = 'tx.seal.key'
const KEY_BYTES = 32
const NONCE_BYTES = 24
const KEY_B64 = /^[A-Za-z0-9+/]{43}=$/
// A wrap is found by the first characters of the key it is for, so a doc names no whole key twice.
const KID_CHARS = 11
const CHUNK = 0x8000

let mine: Keyring | null = null
const shared = new Map<string, Uint8Array>()
const audiences = new Map<string, string[]>()

export const isKey = (x: unknown): x is string => typeof x === 'string' && KEY_B64.test(x)
const kidOf = (key: string) => key.slice(0, KID_CHARS)

function toB64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += CHUNK) text += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(text)
}

function fromB64(text: string): Uint8Array {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function setKeyring(keys: Keyring | null): void {
  mine = keys
  shared.clear()
}

export const newKeyring = (): Keyring => nacl.box.keyPair()

// Made once per computer and kept: losing it loses only what was sealed to it.
export async function loadKeyring(host: Pick<Host, 'storeGet' | 'storeSet'>): Promise<void> {
  const stored = await host.storeGet(KEY_STORE)
  if (typeof stored === 'string' && fromB64(stored).length === KEY_BYTES) return setKeyring(nacl.box.keyPair.fromSecretKey(fromB64(stored)))
  const made = newKeyring()
  await host.storeSet(KEY_STORE, toB64(made.secretKey))
  setKeyring(made)
}

// A seal asked for before the stored key is loaded gets a key of the moment: never clear text.
function keyring(): Keyring {
  mine ??= newKeyring()
  return mine
}

export const ownKey = (): string => toB64(keyring().publicKey)

// The member keys a mailbox's writes are sealed to, set by every poll of its room (sync.ts).
export const setAudience = (url: string, keys: readonly string[]): void => { audiences.set(url, keys.filter(isKey)) }
export const audienceOf = (url: string): string[] => audiences.get(url) ?? []

function sharedWith(key: string): Uint8Array {
  const held = shared.get(key)
  if (held !== undefined) return held
  const made = nacl.box.before(fromB64(key), keyring().secretKey)
  shared.set(key, made)
  return made
}

export function seal(value: unknown, to: readonly string[]): Envelope {
  const content = nacl.randomBytes(KEY_BYTES)
  const nonce = nacl.randomBytes(NONCE_BYTES)
  const body = nacl.secretbox(new TextEncoder().encode(JSON.stringify(value)), nonce, content)
  const k: Record<string, string> = {}
  // Always to this computer too: its author reads its own lines back, and compacts them.
  for (const key of new Set([ownKey(), ...to.filter(isKey)])) k[kidOf(key)] = toB64(nacl.secretbox(content, nonce, sharedWith(key)))
  return { n: toB64(nonce), from: ownKey(), c: toB64(body), k }
}

const isEnvelope = (x: unknown): x is Envelope => {
  const e = x as Partial<Envelope> | null
  return typeof e === 'object' && e !== null && typeof e.n === 'string' && isKey(e.from) && typeof e.c === 'string'
    && typeof e.k === 'object' && e.k !== null
}

// What was sealed, or null: not sealed to this computer, or not a seal at all. Never throws on what a room holds.
export function open(x: unknown): unknown {
  if (!isEnvelope(x)) return null
  const wrap = x.k[kidOf(ownKey())]
  if (typeof wrap !== 'string') return null
  try {
    const nonce = fromB64(x.n)
    const content = nacl.secretbox.open(fromB64(wrap), nonce, sharedWith(x.from))
    const body = content === null ? null : nacl.secretbox.open(fromB64(x.c), nonce, content)
    return body === null ? null : JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
  }
}
