// The host of a URL, for a message. A value that is not a URL comes back
// cut to 60 characters, so a long value cannot fill the message.
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 60)
  }
}
