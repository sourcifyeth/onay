export function ExtensionStatus({ installed }: { installed: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      {installed ? (
        <>
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <p className="text-sm text-gray-600">
            Extension connected, intercepting transactions from the browser.
          </p>
        </>
      ) : (
        <>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-gray-300" />
          <p className="text-sm text-gray-600">
            Browser extension not detected. Install it to intercept transactions before your wallet
            sees them.
          </p>
          <button
            onClick={() => alert('(mock) would open the extension store page in your browser')}
            className="ml-auto shrink-0 rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-cerulean-blue-600"
          >
            Install extension
          </button>
        </>
      )}
    </div>
  )
}
