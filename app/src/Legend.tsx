import { LocallyVerifiedIcon, ThirdPartyIcon } from './Icons.tsx'

const ICON = 'mr-1 inline-block h-3.5 w-3.5 align-[-2px]'

// The legend of the trust marks, at the bottom of the window on every
// page, like the legend of a map.
export function Legend() {
  return (
    <footer className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex flex-wrap items-baseline justify-end gap-x-5 gap-y-1 border-t border-gray-200 bg-white/95 px-6 py-2 text-xs text-gray-500 backdrop-blur">
      <span>
        <LocallyVerifiedIcon className={ICON} />
        verified locally
      </span>
      <span>
        <ThirdPartyIcon className={ICON} />
        third-party data, not verified locally
      </span>
    </footer>
  )
}
