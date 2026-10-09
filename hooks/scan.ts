import { findSecrets } from './secrets/detect'

// No path on purpose: secret-guard relaxes its scan for test files, and nothing outgoing is relaxed.
export const hasSecret = (text: string): boolean => findSecrets(text).length > 0
