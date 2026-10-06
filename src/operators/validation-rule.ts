import {child, childText, rawText, replaceText} from '../lib/xml.js'
import {article, objectName, type Operator, quoted, shortName} from './types.js'

function ruleFacts(ctx: Parameters<Operator['sites']>[0]) {
  const {xml, root, component} = ctx
  return {
    name: shortName(component.apiName),
    object: objectName(component.apiName) ?? 'the object',
    active: childText(xml, root, 'active') === 'true',
    formula: childText(xml, root, 'errorConditionFormula'),
    message: childText(xml, root, 'errorMessage'),
  }
}

export const VR_DEACTIVATE: Operator = {
  id: 'VR_DEACTIVATE',
  metadataType: 'ValidationRule',
  summary: 'Switch an active validation rule off (active true → false).',
  sites(ctx) {
    const f = ruleFacts(ctx)
    const active = child(ctx.root, 'active')
    if (!active || !f.active) return []
    return [
      {
        key: 'active',
        description: `Validation rule \`${f.name}\` on ${f.object} switched off`,
        shouldCheck: `Saving ${article(f.object)} that breaks \`${f.name}\`${f.formula ? ` (${f.formula})` : ''} is rejected${f.message ? ` with ${quoted(f.message)}` : ''}.`,
        edits: [replaceText(active, 'false')],
      },
    ]
  },
}

export const VR_NEGATE: Operator = {
  id: 'VR_NEGATE',
  metadataType: 'ValidationRule',
  summary: 'Invert an active validation rule: wrap its error condition in NOT( … ).',
  sites(ctx) {
    const f = ruleFacts(ctx)
    const formula = child(ctx.root, 'errorConditionFormula')
    if (!formula || !f.active || !f.formula) return []
    const raw = rawText(ctx.xml, formula)
    const lead = raw.match(/^\s*/)?.[0] ?? ''
    const trail = raw.match(/\s*$/)?.[0] ?? ''
    return [
      {
        key: 'formula',
        description: `Validation rule \`${f.name}\` on ${f.object} inverted: it now blocks valid records and lets invalid ones through`,
        shouldCheck: `A valid ${f.object} saves without error, and one that breaks \`${f.name}\` (${f.formula}) is rejected.`,
        edits: [replaceText(formula, `${lead}NOT( ${raw.trim()} )${trail}`)],
      },
    ]
  },
}
