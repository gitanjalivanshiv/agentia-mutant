/** Minimal unified line diff (LCS). Metadata files are small, so O(n·m) is fine. */

export interface DiffStats {
  added: number
  removed: number
}

type Op = {kind: ' ' | '-' | '+'; line: string; a: number; b: number}

function ops(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({length: n + 1}, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({kind: ' ', line: a[i++] as string, a: i, b: ++j})
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({kind: '-', line: a[i++] as string, a: i, b: j})
    else out.push({kind: '+', line: b[j++] as string, a: i, b: j})
  }
  while (i < n) out.push({kind: '-', line: a[i++] as string, a: i, b: j})
  while (j < m) out.push({kind: '+', line: b[j++] as string, a: i, b: j})
  return slide(out)
}

/** How well a block of lines reads as a removed/added unit: opens with a tag, closes with one. */
function blockScore(lines: string[]): number {
  const first = (lines[0] ?? '').trim()
  const last = (lines[lines.length - 1] ?? '').trim()
  return (
    (first.startsWith('<') && !first.startsWith('</') ? 2 : 0) +
    (last.startsWith('</') || last.endsWith('/>') ? 2 : 0)
  )
}

/**
 * Like git's diff heuristics: a run of pure deletions (or additions) next to identical context
 * can be shifted without changing meaning (the line text sequence stays the same; only which
 * lines are marked changed moves). Shift each run to where it reads as a whole XML block.
 */
function slide(list: Op[]): Op[] {
  const kinds = list.map((o) => o.kind)
  const lines = list.map((o) => o.line)
  let k = 0
  while (k < kinds.length) {
    const kind = kinds[k]
    if (kind === ' ') {
      k++
      continue
    }
    let end = k
    while (end < kinds.length && kinds[end] === kind) end++
    const len = end - k
    let best = k
    let bestScore = blockScore(lines.slice(k, end))
    for (let s = k; s > 0 && kinds[s - 1] === ' ' && lines[s - 1] === lines[s - 1 + len];) {
      s--
      const score = blockScore(lines.slice(s, s + len))
      if (score > bestScore) [best, bestScore] = [s, score]
    }
    for (let d = k; d + len < kinds.length && kinds[d + len] === ' ' && lines[d] === lines[d + len];) {
      d++
      const score = blockScore(lines.slice(d, d + len))
      if (score > bestScore) [best, bestScore] = [d, score]
    }
    for (let x = k; x < end; x++) kinds[x] = ' '
    for (let x = best; x < best + len; x++) kinds[x] = kind as Op['kind']
    k = Math.max(end, best + len)
  }
  // Renumber a/b line positions for hunk headers.
  let a = 0
  let b = 0
  return kinds.map((kind, idx) => {
    if (kind !== '+') a++
    if (kind !== '-') b++
    return {kind, line: lines[idx] as string, a, b}
  })
}

export function diffStats(before: string, after: string): DiffStats {
  const all = ops(before.split('\n'), after.split('\n'))
  return {added: all.filter((o) => o.kind === '+').length, removed: all.filter((o) => o.kind === '-').length}
}

/** Unified diff with `context` lines around each change. */
export function unifiedDiff(before: string, after: string, file = 'file', context = 3): string {
  const all = ops(before.split('\n'), after.split('\n'))
  const changed = all.map((o, idx) => (o.kind === ' ' ? -1 : idx)).filter((i) => i >= 0)
  if (changed.length === 0) return ''
  const hunks: [number, number][] = []
  for (const idx of changed) {
    const lo = Math.max(0, idx - context)
    const hi = Math.min(all.length - 1, idx + context)
    const last = hunks[hunks.length - 1]
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi)
    else hunks.push([lo, hi])
  }
  const lines = [`--- a/${file}`, `+++ b/${file}`]
  for (const [lo, hi] of hunks) {
    const slice = all.slice(lo, hi + 1)
    const aStart = slice.find((o) => o.kind !== '+')?.a ?? 0
    const bStart = slice.find((o) => o.kind !== '-')?.b ?? 0
    const aLen = slice.filter((o) => o.kind !== '+').length
    const bLen = slice.filter((o) => o.kind !== '-').length
    lines.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`)
    for (const o of slice) lines.push(`${o.kind}${o.line}`)
  }
  return lines.join('\n') + '\n'
}
