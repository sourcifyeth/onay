// A link that opens in the browser of the desktop. The webview has no
// window for a link, so the app opens it.

import { invoke } from '@tauri-apps/api/core'
import type { ReactNode } from 'react'
import type { OpenUrlArgs } from './messages.ts'

export function ExternalLink({
  href,
  className,
  title,
  children,
}: {
  href: string
  className?: string
  title?: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      title={title}
      className={className}
      onClick={(event) => {
        event.preventDefault()
        invoke('open_url', { url: href } satisfies OpenUrlArgs).catch((error: unknown) => {
          console.error(`cannot open ${href}:`, error)
        })
      }}
    >
      {children}
    </a>
  )
}
