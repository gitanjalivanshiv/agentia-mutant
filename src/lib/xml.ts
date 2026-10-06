import {XMLValidator} from 'fast-xml-parser'

/**
 * A tiny position-aware XML element tree for Salesforce metadata files.
 *
 * Operators edit the original text by offsets instead of parse → re-serialise, so a mutant's
 * diff is exactly the lines that changed (formatting, comments and ordering are untouched).
 * Metadata XML is simple: elements, text, a root xmlns attribute, an XML declaration.
 */
export interface XmlNode {
  name: string
  /** Offset of `<name`. */
  start: number
  /** Offset just after `</name>` (or `/>`). */
  end: number
  /** Offset just after the opening tag's `>`. */
  innerStart: number
  /** Offset of `</name>`. */
  innerEnd: number
  children: XmlNode[]
  parent?: XmlNode
}

const TAG =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^>]*?)?)(\/?)>/g

export function parseXmlTree(xml: string): XmlNode {
  const docRoot: XmlNode = {
    name: '#document',
    start: 0,
    end: xml.length,
    innerStart: 0,
    innerEnd: xml.length,
    children: [],
  }
  const stack: XmlNode[] = [docRoot]
  TAG.lastIndex = 0
  for (let m = TAG.exec(xml); m; m = TAG.exec(xml)) {
    if (!m[2]) continue // comment, declaration or CDATA
    const [, closing, name, , selfClosing] = m
    const top = stack[stack.length - 1] as XmlNode
    if (closing) {
      if (top.name !== name)
        throw new Error(`Malformed XML: </${name}> closes <${top.name}> at offset ${m.index}`)
      top.innerEnd = m.index
      top.end = m.index + m[0].length
      stack.pop()
      continue
    }
    const node: XmlNode = {
      name: name as string,
      start: m.index,
      end: m.index + m[0].length,
      innerStart: m.index + m[0].length,
      innerEnd: m.index + m[0].length,
      children: [],
      parent: top,
    }
    top.children.push(node)
    if (!selfClosing) stack.push(node)
  }
  if (stack.length !== 1)
    throw new Error(`Malformed XML: <${(stack[stack.length - 1] as XmlNode).name}> is never closed`)
  return docRoot
}

/** The metadata root element (e.g. `<Flow>`). */
export function rootElement(doc: XmlNode): XmlNode {
  const r = doc.children[0]
  if (!r) throw new Error('XML has no root element')
  return r
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name)
}

export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name)
}

/** Follows a path of child names, collecting every match (repeated elements fan out). */
export function select(node: XmlNode, path: string[]): XmlNode[] {
  let current = [node]
  for (const name of path) current = current.flatMap((n) => children(n, name))
  return current
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
}

export function decodeXml(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos);/g, (e) => ENTITIES[e] as string)
}

export function encodeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Raw inner text of a leaf element (still XML-encoded). */
export function rawText(xml: string, node: XmlNode): string {
  return xml.slice(node.innerStart, node.innerEnd)
}

/** Decoded, trimmed text of a leaf element. */
export function text(xml: string, node: XmlNode | undefined): string | undefined {
  return node ? decodeXml(rawText(xml, node)).trim() : undefined
}

export function childText(xml: string, node: XmlNode, name: string): string | undefined {
  return text(xml, child(node, name))
}

export interface Edit {
  start: number
  end: number
  replacement: string
}

/** Applies non-overlapping edits (any order). */
export function applyEdits(xml: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  let out = xml
  let floor = Infinity
  for (const e of sorted) {
    if (e.end > floor) throw new Error('Overlapping edits')
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
    floor = e.start
  }
  return out
}

/** Edit that replaces a leaf element's text. */
export function replaceText(node: XmlNode, value: string): Edit {
  return {start: node.innerStart, end: node.innerEnd, replacement: value}
}

/**
 * Edit that deletes an element together with its own line (leading indentation and the
 * newline before it), so the diff is a clean removed block.
 */
export function removeElement(xml: string, node: XmlNode): Edit {
  let start = node.start
  while (start > 0 && (xml[start - 1] === ' ' || xml[start - 1] === '\t')) start--
  if (start > 0 && xml[start - 1] === '\n') start--
  if (start > 0 && xml[start - 1] === '\r') start--
  return {start, end: node.end, replacement: ''}
}

export function isWellFormed(xml: string): boolean {
  return XMLValidator.validate(xml) === true
}
