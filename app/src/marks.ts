// The mark and the color of a verdict. The review and the headers of the
// gate log share them.

import type { Verdict } from './gates/contracts.ts'

export const MARKS: Record<Verdict, [string, string]> = {
  pending: ['…', 'text-gray-400'],
  passed: ['✓', 'text-green-700'],
  flagged: ['⚠', 'text-amber-700'],
  failed: ['✕', 'text-light-coral-700'],
}
