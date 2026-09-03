// Minimal read-only Solidity code view. Hand-rolled, zero dependencies.

interface Token {
  text: string
  cls?: string
}

const PATTERN =
  /(\/\/.*$)|("[^"]*")|\b(function|external|internal|public|private|payable|returns?|require|revert|memory|calldata|storage|if|else|for|while|emit|mapping|struct|event|modifier|virtual|override|view|pure|unchecked|new|delete|ensure|lock)\b|\b(uint\d*|int\d*|address|bytes\d*|bool|string)\b/gm

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  PATTERN.lastIndex = 0
  for (let m = PATTERN.exec(line); m !== null; m = PATTERN.exec(line)) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) })
    if (m[1] !== undefined) tokens.push({ text: m[1], cls: 'text-gray-400 italic' })
    else if (m[2] !== undefined) tokens.push({ text: m[2], cls: 'text-green-700' })
    else if (m[3] !== undefined) tokens.push({ text: m[3], cls: 'text-cerulean-blue-600' })
    else tokens.push({ text: m[4], cls: 'text-light-coral-700' })
    last = m.index + m[0].length
  }
  if (last < line.length) tokens.push({ text: line.slice(last) })
  return tokens
}

export function CodeView({ code }: { code: string }) {
  const lines = code.split('\n')
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 py-3 font-mono text-xs leading-relaxed">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="w-8 select-none pr-3 pl-3 text-right align-top text-gray-300">
                {i + 1}
              </td>
              <td className="whitespace-pre pr-4 text-gray-800">
                {tokenizeLine(line).map((t, j) =>
                  t.cls ? (
                    <span key={j} className={t.cls}>
                      {t.text}
                    </span>
                  ) : (
                    <span key={j}>{t.text}</span>
                  ),
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
