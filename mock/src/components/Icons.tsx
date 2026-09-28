import { useId, type ReactNode } from 'react'

interface IconProps {
  /** size (and layout) classes; defaults to 16px */
  className?: string
  /** accessible name; without one the icon is decorative and hidden from screen readers */
  title?: string
}

/**
 * A solid 24×24 shape with a symbol cut out of it. The cut-out is a mask, so whatever is behind
 * the icon shows through on any background. Solid shapes and thick cut-outs keep the icons
 * readable down to 14px. The color is part of the meaning, so it is fixed per icon.
 */
function CutoutIcon({
  className = 'h-4 w-4',
  title,
  fillClass,
  shape,
  cutout,
}: IconProps & { fillClass: string; shape: ReactNode; cutout: ReactNode }) {
  const maskId = useId()
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        {cutout}
      </mask>
      <g className={fillClass} mask={`url(#${maskId})`}>
        {shape}
      </g>
    </svg>
  )
}

/** a laptop with a tick on the screen: checked on this machine, nothing taken on trust */
export function LocallyVerifiedIcon(props: IconProps) {
  return (
    <CutoutIcon
      {...props}
      fillClass="fill-green-600"
      shape={
        <>
          <rect x="3.5" y="4" width="17" height="12" rx="1.5" />
          <rect x="1" y="17.5" width="22" height="2.5" rx="1.25" />
        </>
      }
      cutout={
        <path
          d="M7.75 9.75 10.75 12.75 16.25 7.25"
          fill="none"
          stroke="black"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      }
    />
  )
}

/** a cloud with an exclamation mark: data served by a third party and not checked locally */
export function ThirdPartyIcon(props: IconProps) {
  return (
    <CutoutIcon
      {...props}
      fillClass="fill-yellow-500"
      shape={<path d="M6 19A4.5 4.5 0 1 1 7.01 10.12A5.5 5.5 0 1 1 17.97 11.03A4 4 0 1 1 18.5 19Z" />}
      cutout={
        <>
          <path d="M12 8v3" stroke="black" strokeWidth="3" strokeLinecap="round" />
          <circle cx="12" cy="16" r="1.5" fill="black" />
        </>
      }
    />
  )
}
