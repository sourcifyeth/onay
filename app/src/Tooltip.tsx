import type { ReactNode } from 'react'

// A tooltip on any content. It opens above the content on hover or on
// keyboard focus. `hint` draws a dotted line under the content, to say
// that a tooltip is there.
export function Tooltip({ tip, hint = true, children }: { tip: ReactNode; hint?: boolean; children: ReactNode }) {
  const line = hint ? ' underline decoration-gray-300 decoration-dotted underline-offset-4' : ''
  return (
    <span className="group/tip relative inline-block">
      <span tabIndex={0} className={`cursor-help outline-none${line}`}>
        {children}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-1.5 w-max max-w-[22rem] rounded-md bg-gray-800 px-2.5 py-1.5 text-left font-sans text-[11px] leading-relaxed font-normal break-words whitespace-normal text-white opacity-0 shadow-lg transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100"
      >
        {tip}
      </span>
    </span>
  )
}
