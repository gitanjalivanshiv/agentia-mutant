import {child, childText, replaceText, select, text} from '../lib/xml.js'
import {article, objectName, type MutationSite, type Operator, shortName} from './types.js'

function fieldFacts(ctx: Parameters<Operator['sites']>[0]) {
  return {
    field: shortName(ctx.component.apiName),
    object: objectName(ctx.component.apiName) ?? 'the object',
    label: childText(ctx.xml, ctx.root, 'label') ?? shortName(ctx.component.apiName),
    type: childText(ctx.xml, ctx.root, 'type'),
  }
}

export const FIELD_REQUIRED_OFF: Operator = {
  id: 'FIELD_REQUIRED_OFF',
  metadataType: 'CustomField',
  summary: 'Make a required field optional (required true → false).',
  sites(ctx) {
    const required = child(ctx.root, 'required')
    if (!required || text(ctx.xml, required) !== 'true') return []
    const f = fieldFacts(ctx)
    return [
      {
        key: 'required',
        description: `Field "${f.label}" (${f.object}.${f.field}) is no longer required`,
        shouldCheck: `Saving ${article(f.object)} without "${f.label}" fails with a required-field error.`,
        edits: [replaceText(required, 'false')],
      },
    ]
  },
}

export const PICKLIST_DEFAULT: Operator = {
  id: 'PICKLIST_DEFAULT',
  metadataType: 'CustomField',
  summary: 'Remove a picklist default, or move it to the next value.',
  sites(ctx) {
    const f = fieldFacts(ctx)
    if (f.type !== 'Picklist' && f.type !== 'MultiselectPicklist') return []
    const values = select(ctx.root, ['valueSet', 'valueSetDefinition', 'value'])
    const defaults = values.filter((v) => childText(ctx.xml, v, 'default') === 'true')
    if (defaults.length !== 1) return []
    const current = defaults[0]!
    const currentDefault = child(current, 'default')!
    const currentName = childText(ctx.xml, current, 'fullName') ?? childText(ctx.xml, current, 'label') ?? '?'
    const out: MutationSite[] = [
      {
        key: 'remove',
        description: `Picklist "${f.label}" (${f.object}.${f.field}) loses its default "${currentName}"`,
        shouldCheck: `A new ${f.object} has "${f.label}" = "${currentName}" without anyone choosing it.`,
        edits: [replaceText(currentDefault, 'false')],
      },
    ]
    const idx = values.indexOf(current)
    const next = values[(idx + 1) % values.length]
    const nextDefault = next && next !== current ? child(next, 'default') : undefined
    if (next && nextDefault) {
      const nextName = childText(ctx.xml, next, 'fullName') ?? '?'
      out.push({
        key: 'move',
        description: `Picklist "${f.label}" (${f.object}.${f.field}) now defaults to "${nextName}" instead of "${currentName}"`,
        shouldCheck: `A new ${f.object} has "${f.label}" = "${currentName}" by default.`,
        edits: [replaceText(currentDefault, 'false'), replaceText(nextDefault, 'true')],
      })
    }
    return out
  },
}

export const CHECKBOX_DEFAULT_FLIP: Operator = {
  id: 'CHECKBOX_DEFAULT_FLIP',
  metadataType: 'CustomField',
  summary: 'Flip a checkbox default (false ↔ true).',
  sites(ctx) {
    const f = fieldFacts(ctx)
    const def = child(ctx.root, 'defaultValue')
    const value = text(ctx.xml, def)
    if (f.type !== 'Checkbox' || !def || (value !== 'true' && value !== 'false')) return []
    const flipped = value === 'true' ? 'false' : 'true'
    return [
      {
        key: 'defaultValue',
        description: `Checkbox "${f.label}" (${f.object}.${f.field}) now defaults to ${flipped}`,
        shouldCheck: `A new ${f.object} starts with "${f.label}" ${value === 'true' ? 'checked' : 'unchecked'}.`,
        edits: [replaceText(def, flipped)],
      },
    ]
  },
}
