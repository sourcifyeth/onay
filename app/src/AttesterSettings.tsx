// The clear-signing section of the settings: the auditors whose
// attestations the user trusts.

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  attesterStore,
  AUDITORS_URL,
  fetchProfile,
  isAddress,
  saveAttesters,
  withAttester,
  type Profile,
} from './clear-signing/attesters.ts'
import { ExternalLink } from './ExternalLink.tsx'
import { ThirdPartyIcon } from './Icons.tsx'
import { errorText } from './gates/gate.ts'
import type { Hex } from './messages.ts'

// The profiles looked up in this session.
const profiles = new Map<Hex, Promise<Profile | null>>()

function useProfile(address: Hex): { profile: Profile | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ profile: Profile | null; error: string | null; loading: boolean }>({
    profile: null,
    error: null,
    loading: true,
  })
  useEffect(() => {
    let current = true
    let lookup = profiles.get(address)
    if (!lookup) {
      lookup = fetchProfile(address, fetch)
      profiles.set(address, lookup)
    }
    lookup
      .then((profile) => current && setState({ profile, error: null, loading: false }))
      .catch((error: unknown) => {
        profiles.delete(address)
        if (current) setState({ profile: null, error: errorText(error), loading: false })
      })
    return () => {
      current = false
    }
  }, [address])
  return state
}

function AttesterRow({ address, onRemove }: { address: Hex; onRemove: () => void }) {
  const { profile, error, loading } = useProfile(address)
  let about
  if (loading) about = <span className="text-gray-400">looking up the profile…</span>
  else if (error) about = <span className="text-amber-700">profile not read · {error}</span>
  else if (profile) {
    about = (
      <span className="inline-flex items-center gap-1.5 text-gray-700">
        <ThirdPartyIcon className="h-3.5 w-3.5 shrink-0" title="From the registry on GitHub, not checked here" />
        <span>
          {profile.name}
          {profile.organization && <span className="text-gray-500"> · {profile.organization}</span>}
          <span className="text-gray-400"> · as the registry says</span>
        </span>
      </span>
    )
  } else about = <span className="text-amber-700">no profile in the registry</span>
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="font-mono text-[13px] break-all text-gray-800">{address}</p>
        <p className="text-xs">{about}</p>
      </div>
      <button onClick={onRemove} className="shrink-0 font-mono text-xs text-gray-400 hover:text-light-coral-700">
        remove
      </button>
    </div>
  )
}

export function AttesterSettings() {
  const attesters = useSyncExternalStore(attesterStore.subscribe, attesterStore.getSnapshot)
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()
  const taken = isAddress(trimmed) && attesters.includes(trimmed.toLowerCase() as Hex)
  const valid = withAttester(attesters, draft) !== null

  const add = () => {
    const next = withAttester(attesters, draft)
    if (!next) return
    saveAttesters(next)
    setDraft('')
  }

  return (
    <>
      <h3 className="flex items-center gap-1.5 pt-4 font-mono text-xs tracking-widest text-cerulean-blue-600 uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-cerulean-blue-500" />
        Clear Signing
      </h3>
      <p className="text-xs leading-relaxed text-gray-500">
        An ERC-7730 descriptor explains a transaction in plain words. Anyone can submit one to the registry, so Onay
        counts a descriptor as reviewed only after an auditor you trust attested it (ERC-8176). Each auditor signs with
        an Ethereum address. Add the addresses of the auditors you trust. The{' '}
        <ExternalLink href={AUDITORS_URL} className="text-cerulean-blue-600 hover:underline">
          auditors directory of the registry ↗
        </ExternalLink>{' '}
        lists them with their profiles.
      </p>
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="pb-1 font-medium text-gray-800">Trusted auditors</p>
        {attesters.length === 0 ? (
          <p className="rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No auditor is trusted. A descriptor from the registry shows as a preview with a warning, since no one has
            checked it for you.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {attesters.map((address) => (
              <AttesterRow
                key={address}
                address={address}
                onRemove={() => saveAttesters(attesters.filter((other) => other !== address))}
              />
            ))}
          </div>
        )}
        <div className="flex items-end gap-3 pt-3">
          <label className="block min-w-0 flex-1">
            <span className="font-mono text-xs text-gray-500">attester address</span>
            <input
              value={draft}
              placeholder="0x…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && add()}
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 font-mono text-xs text-gray-800 placeholder:text-gray-400 focus:border-cerulean-blue-400 focus:outline-none"
            />
          </label>
          <button
            onClick={add}
            disabled={!valid}
            className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {taken && <p className="pt-2 text-xs text-light-coral-700">This address is in the list already.</p>}
        {trimmed !== '' && !isAddress(trimmed) && (
          <p className="pt-2 text-xs text-light-coral-700">An attester address is 20 bytes in hex, with 0x in front.</p>
        )}
      </section>
    </>
  )
}
