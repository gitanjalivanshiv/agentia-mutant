import {
  child,
  children,
  childText,
  type Edit,
  rawText,
  removeElement,
  replaceText,
  select,
  text,
  type XmlNode,
} from '../lib/xml.js'
import {type MutationSite, type Operator, shortName} from './types.js'

/** Operator pairs chosen so each flip is a realistic, single-character-class logic bug. */
const FLIPS: Record<string, string> = {
  EqualTo: 'NotEqualTo',
  NotEqualTo: 'EqualTo',
  GreaterThan: 'LessThanOrEqualTo',
  LessThanOrEqualTo: 'GreaterThan',
  LessThan: 'GreaterThanOrEqualTo',
  GreaterThanOrEqualTo: 'LessThan',
}

const READABLE: Record<string, string> = {
  EqualTo: '=',
  NotEqualTo: '≠',
  GreaterThan: '>',
  LessThanOrEqualTo: '≤',
  LessThan: '<',
  GreaterThanOrEqualTo: '≥',
}

interface Condition {
  decision: string
  rule: string
  index: number
  node: XmlNode
  left: string
  operator: string
  operatorNode: XmlNode
  right: string
  numberNode?: XmlNode
}

function conditions(xml: string, root: XmlNode): Condition[] {
  const out: Condition[] = []
  for (const decision of children(root, 'decisions')) {
    for (const rule of children(decision, 'rules')) {
      children(rule, 'conditions').forEach((cond, index) => {
        const operatorNode = child(cond, 'operator')
        if (!operatorNode) return
        const rightValue = child(cond, 'rightValue')
        const valueNode = rightValue?.children[0]
        out.push({
          decision: childText(xml, decision, 'label') ?? childText(xml, decision, 'name') ?? 'decision',
          rule: childText(xml, rule, 'name') ?? 'rule',
          index,
          node: cond,
          left: humanRef(childText(xml, cond, 'leftValueReference') ?? '?'),
          operator: text(xml, operatorNode) ?? '',
          operatorNode,
          right: valueNode ? (text(xml, valueNode) ?? '') : '',
          numberNode: valueNode?.name === 'numberValue' ? valueNode : undefined,
        })
      })
    }
  }
  return out
}

/** `$Record.Discount_Percent__c` → `Discount_Percent__c`. */
function humanRef(ref: string): string {
  return ref.replace(/^\$Record\./, '')
}

function flowName(ctx: Parameters<Operator['sites']>[0]): string {
  return childText(ctx.xml, ctx.root, 'label') ?? shortName(ctx.component.apiName)
}

export const FLOW_DECISION_FLIP: Operator = {
  id: 'FLOW_DECISION_FLIP',
  metadataType: 'Flow',
  summary: 'Flip one decision condition operator (= ↔ ≠, > ↔ ≤, < ↔ ≥).',
  sites(ctx) {
    const flow = flowName(ctx)
    return conditions(ctx.xml, ctx.root)
      .filter((c) => c.operator in FLIPS)
      .map((c) => {
        const flipped = FLIPS[c.operator] as string
        const sym = (op: string) => READABLE[op] ?? op
        return {
          key: `${c.rule}/${c.index}`,
          description: `Flow "${flow}": decision "${c.decision}" now checks ${c.left} ${sym(flipped)} ${c.right} instead of ${c.left} ${sym(c.operator)} ${c.right}`,
          shouldCheck: `Records on both sides of the "${c.decision}" condition (${c.left} ${sym(c.operator)} ${c.right}) take the right path, e.g. one clearly above and one clearly below ${c.right}.`,
          edits: [replaceText(c.operatorNode, flipped)],
        }
      })
  },
}

/** Keeps the literal's formatting: `20.0` → `21.0`, `20` → `21`. */
function bump(raw: string, delta: number): string {
  const trimmed = raw.trim()
  const decimals = trimmed.includes('.') ? (trimmed.split('.')[1] as string).length : 0
  const value = Number(trimmed) + delta
  return raw.replace(trimmed, value.toFixed(decimals))
}

export const FLOW_BOUNDARY: Operator = {
  id: 'FLOW_BOUNDARY',
  metadataType: 'Flow',
  summary: 'Move a numeric threshold in a decision condition by ±1 (off-by-one / boundary bugs).',
  sites(ctx) {
    const flow = flowName(ctx)
    const out: MutationSite[] = []
    for (const c of conditions(ctx.xml, ctx.root)) {
      if (!c.numberNode) continue
      const raw = rawText(ctx.xml, c.numberNode)
      if (!Number.isFinite(Number(raw.trim()))) continue
      for (const delta of [1, -1]) {
        const next = bump(raw, delta).trim()
        out.push({
          key: `${c.rule}/${c.index}/${delta > 0 ? 'plus' : 'minus'}`,
          description: `Flow "${flow}": threshold in "${c.decision}" moved from ${c.right} to ${next}`,
          shouldCheck: `The "${c.decision}" boundary is exact: test ${c.left} at ${c.right} and just ${delta > 0 ? 'above' : 'below'} it.`,
          edits: [replaceText(c.numberNode, bump(raw, delta))],
        })
      }
    }
    return out
  },
}

/** Rewires every connector that targets `name` to `next` (or removes it when there is no next step). */
function bypass(xml: string, root: XmlNode, name: string, next: string | undefined): Edit[] {
  const edits: Edit[] = []
  const walk = (node: XmlNode) => {
    for (const c of node.children) {
      if (
        (c.name === 'connector' || c.name === 'defaultConnector') &&
        childText(xml, c, 'targetReference') === name
      ) {
        const ref = child(c, 'targetReference') as XmlNode
        // Salesforce requires a decision's default outcome label even without a connector
        // ("Enter a label for the default outcome"), so only the connector is removed.
        edits.push(next ? replaceText(ref, next) : removeElement(xml, c))
      } else walk(c)
    }
  }
  walk(root)
  return edits
}

export const FLOW_DROP_ASSIGNMENT: Operator = {
  id: 'FLOW_DROP_ASSIGNMENT',
  metadataType: 'Flow',
  summary:
    'Remove one field assignment (assignment item or record-update field); a single-item assignment element is bypassed.',
  sites(ctx) {
    const {xml, root} = ctx
    const flow = flowName(ctx)
    const out: MutationSite[] = []
    for (const assignment of children(root, 'assignments')) {
      const name = childText(xml, assignment, 'name') ?? '?'
      const label = childText(xml, assignment, 'label') ?? name
      const items = children(assignment, 'assignmentItems')
      if (items.length > 1) {
        items.forEach((item, i) => {
          const target = humanRef(childText(xml, item, 'assignToReference') ?? '?')
          out.push({
            key: `${name}/${i}`,
            description: `Flow "${flow}": step "${label}" no longer sets ${target}`,
            shouldCheck: `After the "${label}" step runs, ${target} has the expected value.`,
            edits: [removeElement(xml, item)],
          })
        })
      } else if (items.length === 1) {
        const item = items[0] as XmlNode
        const target = humanRef(childText(xml, item, 'assignToReference') ?? '?')
        const value = text(xml, child(item, 'value')?.children[0])
        const next = text(xml, select(assignment, ['connector', 'targetReference'])[0])
        const edits = bypass(xml, root, name, next)
        if (edits.length === 0) continue // unreachable element: dropping it changes nothing
        out.push({
          key: `${name}/bypass`,
          description: `Flow "${flow}": step "${label}" is skipped, so ${target} is never set${value ? ` to ${value}` : ''}`,
          shouldCheck: `When the flow reaches "${label}", ${target} becomes ${value ?? 'the expected value'}.`,
          edits,
        })
      }
    }
    for (const update of children(root, 'recordUpdates')) {
      const name = childText(xml, update, 'name') ?? '?'
      const label = childText(xml, update, 'label') ?? name
      const fields = children(update, 'inputAssignments')
      if (fields.length < 2) continue // removing the only field makes the element invalid
      fields.forEach((field, i) => {
        const target = childText(xml, field, 'field') ?? '?'
        out.push({
          key: `${name}/${i}`,
          description: `Flow "${flow}": record update "${label}" no longer sets ${target}`,
          shouldCheck: `After "${label}" runs, the updated record's ${target} has the expected value.`,
          edits: [removeElement(xml, field)],
        })
      })
    }
    return out
  },
}
