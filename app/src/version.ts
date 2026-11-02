// A version as major, minor, and patch numbers.

export type Version = { major: number; minor: number; patch: number }

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}
