import { expect, test } from 'claude-code/testing'
import { newKeyring, open, ownKey, seal, setKeyring } from '../hooks/seal'

const keysOf = () => {
  const ring = newKeyring()
  setKeyring(ring)
  return { ring, key: ownKey() }
}

test('a member opens what was sealed to them; the sender reads it back', async () => {
  const bob = keysOf()
  const alice = keysOf()
  const env = seal({ text: 'merhaba' }, [bob.key])
  expect(open(env)).toEqual({ text: 'merhaba' })
  setKeyring(bob.ring)
  expect(open(env)).toEqual({ text: 'merhaba' })
  setKeyring(alice.ring)
})

test('someone not among the keys opens nothing, and the seal holds no clear text', async () => {
  const bob = keysOf()
  keysOf()
  const env = seal({ text: 'gizli plan' }, [bob.key])
  expect(JSON.stringify(env).includes('gizli')).toBe(false)
  keysOf()
  expect(open(env)).toBe(null)
})

test('a changed byte opens nothing', async () => {
  keysOf()
  const env = seal({ text: 'x' }, [])
  const c = env.c.startsWith('A') ? `B${env.c.slice(1)}` : `A${env.c.slice(1)}`
  expect(open({ ...env, c })).toBe(null)
  expect(open({ nope: 1 })).toBe(null)
  expect(open(null)).toBe(null)
})
