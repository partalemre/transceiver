// The part of tweetnacl 1.0.3 (nacl-fast.js beside this file) that seal.ts uses, in upstream's own types.
type BoxKeyPair = { publicKey: Uint8Array; secretKey: Uint8Array }
declare const nacl: {
  randomBytes(n: number): Uint8Array
  secretbox: {
    (msg: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array
    open(box: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null
  }
  box: {
    before(publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array
    keyPair: { (): BoxKeyPair; fromSecretKey(secretKey: Uint8Array): BoxKeyPair }
  }
}
export default nacl
