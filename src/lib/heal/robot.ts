/**
 * Robot Framework helpers for `mutant heal`: build the grounded prompt, extract and vet the AI's
 * test case, and merge approved tests into the existing suite file.
 */

export interface SurvivorForHealing {
  id: string
  description: string
  shouldCheck: string
  diff: string
}

/** The prompt is grounded in the breakage, its diff and the real suite (so the AI reuses its keywords). */
export function buildHealPrompt(m: SurvivorForHealing, suite: string): string {
  return `You are writing a Copado Robotic Testing (Robot Framework with QWeb and QForce) test.

A mutation test deployed this configuration breakage to a Salesforce sandbox and the existing test suite did NOT notice it:

Breakage: ${m.description}
A good test should check: ${m.shouldCheck}

Metadata diff of the breakage:
${m.diff.trimEnd()}

Existing suite (reuse its keywords such as Login; do not repeat its Settings, Variables or Keywords):
${suite.trimEnd()}

Write exactly ONE new test case that PASSES on the correct configuration and FAILS when the breakage above is deployed. Use a unique record name so earlier runs cannot interfere. Reply with only a robot code block containing a *** Test Cases *** section with that one test case. If it needs a new helper keyword, add a *** Keywords *** section with only the new keyword.`
}

export interface ProposedTest {
  /** Body of the *** Test Cases *** section (test cases only). */
  testCases: string
  /** Body of a *** Keywords *** section, if the AI added helper keywords. */
  keywords?: string
  testNames: string[]
  keywordNames: string[]
}

export class ProposalError extends Error {}

/** Keywords and libraries that have no business in a UI regression test proposed by an AI. */
const FORBIDDEN = [
  /\bRun Process\b/i,
  /\bStart Process\b/i,
  /\bLibrary\s+(OperatingSystem|Process|Dialogs|Telnet|SSHLibrary)\b/i,
  /\bEvaluate\b.*\b(os|subprocess|sys|shutil|socket|__import__)\b/i,
  /\b(Remove|Delete)\s+(File|Directory|Records?)\b/i,
  /\bDelete Record\b/i,
]

function sections(robot: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /^\*{3}\s*([A-Za-z ]+?)\s*\*{3}[^\n]*$/gm
  const marks: {name: string; start: number; bodyStart: number}[] = []
  for (let m = re.exec(robot); m; m = re.exec(robot)) {
    marks.push({name: m[1]!.toLowerCase(), start: m.index, bodyStart: m.index + m[0].length})
  }
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1]!.start : robot.length
    out.set(mk.name.replace(/s$/, ''), robot.slice(mk.bodyStart, end).replace(/^\n/, '').trimEnd())
  })
  return out
}

/** Names defined in a section body: lines that start in column 0 (not comments). */
function names(body: string | undefined): string[] {
  return (body ?? '')
    .split('\n')
    .filter((l) => l.trim() && !/^[\s#]/.test(l) && !l.startsWith('...'))
    .map((l) => l.split(/\s{2,}|\t/)[0]!.trim())
}

/**
 * Extracts the proposed test from the AI's reply: the (last) closed ```robot block, or the raw
 * text when it is a bare robot snippet. Rejects incomplete replies and forbidden keywords.
 */
export function extractProposal(content: string): ProposedTest {
  const blocks = [...content.matchAll(/```(?:robot|robotframework)?[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]!)
  const robot = blocks.length
    ? blocks[blocks.length - 1]!
    : content.includes('*** Test Cases ***')
      ? content
      : ''
  if (!robot.trim()) throw new ProposalError('The AI reply contains no complete robot code block.')
  const forbidden = FORBIDDEN.find((re) => re.test(robot))
  if (forbidden) throw new ProposalError(`The proposed test uses a forbidden keyword (${forbidden.source}).`)
  const s = sections(robot)
  const testCases = s.get('test case')
  if (!testCases) throw new ProposalError('The proposed test has no *** Test Cases *** section.')
  const testNames = names(testCases)
  if (testNames.length === 0) throw new ProposalError('The *** Test Cases *** section defines no test.')
  const keywords = s.get('keyword')
  return {testCases, ...(keywords ? {keywords} : {}), testNames, keywordNames: names(keywords)}
}

/** Renders one proposal as a reviewable .robot snippet (the file the user edits before --apply). */
export function proposalFile(p: ProposedTest, header: string[]): string {
  const lines = header.map((h) => `# ${h}`)
  lines.push('', '*** Test Cases ***', p.testCases)
  if (p.keywords) lines.push('', '*** Keywords ***', p.keywords)
  return lines.join('\n') + '\n'
}

/**
 * Appends approved test cases to the suite's *** Test Cases *** section and new helper keywords to
 * *** Keywords ***. Existing content is untouched. Test names that already exist get a suffix;
 * keywords the suite already defines are not duplicated.
 */
export function mergeIntoSuite(suite: string, proposals: ProposedTest[]): {suite: string; added: string[]} {
  const existing = sections(suite)
  const takenTests = new Set(names(existing.get('test case')).map((n) => n.toLowerCase()))
  const takenKeywords = new Set(names(existing.get('keyword')).map((n) => n.toLowerCase()))
  const newTests: string[] = []
  const newKeywords: string[] = []
  const added: string[] = []
  for (const p of proposals) {
    let body = p.testCases
    for (const name of p.testNames) {
      let unique = name
      for (let i = 2; takenTests.has(unique.toLowerCase()); i++) unique = `${name} (${i})`
      if (unique !== name) body = body.replace(new RegExp(`^${escapeRe(name)}(?=\\s*$)`, 'm'), unique)
      takenTests.add(unique.toLowerCase())
      added.push(unique)
    }
    newTests.push(body)
    if (p.keywords) {
      for (const block of splitDefinitions(p.keywords)) {
        const kw = names(block)[0]
        if (kw && !takenKeywords.has(kw.toLowerCase())) {
          takenKeywords.add(kw.toLowerCase())
          newKeywords.push(block)
        }
      }
    }
  }
  let out = suite.trimEnd() + '\n'
  out = insertIntoSection(out, 'Test Cases', newTests)
  if (newKeywords.length) out = insertIntoSection(out, 'Keywords', newKeywords)
  return {suite: out, added}
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Splits a section body into definition blocks (a name line plus its indented body). */
function splitDefinitions(body: string): string[] {
  const blocks: string[] = []
  for (const line of body.split('\n')) {
    if (line.trim() && !/^[\s#]/.test(line) && !line.startsWith('...')) blocks.push(line)
    else if (blocks.length) blocks[blocks.length - 1] += '\n' + line
  }
  return blocks.map((b) => b.trimEnd())
}

function insertIntoSection(suite: string, section: string, blocks: string[]): string {
  if (!blocks.length) return suite
  const header = new RegExp(`^\\*{3}\\s*${section}\\s*\\*{3}[^\\n]*$`, 'm')
  const m = header.exec(suite)
  const text = blocks.map((b) => b.trimEnd()).join('\n\n')
  if (!m) return `${suite.trimEnd()}\n\n*** ${section} ***\n${text}\n`
  const next = /^\*{3}[^\n]*\*{3}[^\n]*$/m
  const rest = suite.slice(m.index + m[0].length)
  const n = next.exec(rest)
  const end = n ? m.index + m[0].length + n.index : suite.length
  const before = suite.slice(0, end).trimEnd()
  const after = suite.slice(end)
  return `${before}\n\n${text}\n${after ? `\n${after}` : ''}`
}
