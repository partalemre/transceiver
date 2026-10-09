import { expect, test } from 'claude-code/testing'
import { hasSecret } from '../hooks/scan'

test('keys are caught, plain code is not', () => {
  expect(hasSecret('const k = "AKIAIOSFODNN7EXAMPLE"')).toBe(true)
  expect(hasSecret('ghp_' + 'a'.repeat(36))).toBe(true)
  expect(hasSecret('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true)
  expect(hasSecret('await storage.write(key, session.accessToken)')).toBe(false)
})

test('generic secret assignments are caught, placeholders are not', () => {
  expect(hasSecret('API_TOKEN = "q8Zr2Lm4Xv9Tb7Nc5Kd1"')).toBe(true)
  expect(hasSecret('API_TOKEN = process.env.API_TOKEN')).toBe(false)
})
