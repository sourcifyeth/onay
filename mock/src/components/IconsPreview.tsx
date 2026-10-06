import type { ComponentType } from 'react'
import { LocallyVerifiedIcon, ThirdPartyIcon } from './Icons'

const sizes = [
  { px: 12, cls: 'h-3 w-3' },
  { px: 14, cls: 'h-3.5 w-3.5' },
  { px: 16, cls: 'h-4 w-4' },
  { px: 20, cls: 'h-5 w-5' },
  { px: 24, cls: 'h-6 w-6' },
  { px: 32, cls: 'h-8 w-8' },
  { px: 48, cls: 'h-12 w-12' },
]

const icons: {
  name: string
  meaning: string
  label: string
  Icon: ComponentType<{ className?: string; title?: string }>
  badge: string
}[] = [
  {
    name: 'LocallyVerifiedIcon',
    meaning: 'Checked on this machine: nothing taken on trust.',
    label: 'Locally verified',
    Icon: LocallyVerifiedIcon,
    badge: 'bg-green-50 text-green-700',
  },
  {
    name: 'ThirdPartyIcon',
    meaning: 'Served by a third-party service and not checked locally.',
    label: 'From a third party',
    Icon: ThirdPartyIcon,
    badge: 'bg-yellow-50 text-yellow-800',
  },
]

/** debug-only page to judge the icons at every size and on the surfaces the mock uses */
export function IconsPreview() {
  return (
    <div className="animate-fade-up flex flex-col gap-4">
      {icons.map(({ name, meaning, label, Icon, badge }) => (
        <section key={name} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="font-mono text-sm text-gray-900">{name}</p>
          <p className="pt-0.5 text-sm text-gray-500">{meaning}</p>

          {(['bg-white', 'bg-gray-50', 'bg-gray-900'] as const).map((bg) => (
            <div key={bg} className={`mt-3 flex items-end gap-5 rounded-lg border border-gray-200 px-4 py-3 ${bg}`}>
              {sizes.map(({ px, cls }) => (
                <div key={px} className="flex flex-col items-center gap-1.5">
                  <Icon className={cls} title={label} />
                  <span className="font-mono text-[10px] text-gray-400">{px}</span>
                </div>
              ))}
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-4 pt-4">
            <span className="flex items-center gap-1.5 text-sm text-gray-700">
              <Icon />
              {label}
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-600">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </span>
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
              <Icon className="h-3.5 w-3.5" />
              {label}
            </span>
          </div>
        </section>
      ))}
    </div>
  )
}
