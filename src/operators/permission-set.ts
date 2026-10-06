import {child, children, childText, replaceText} from '../lib/xml.js'
import {article, type MutationSite, type Operator} from './types.js'

export const PERMSET_FLS_REVOKE: Operator = {
  id: 'PERMSET_FLS_REVOKE',
  metadataType: 'PermissionSet',
  summary: 'Revoke edit access to one field, or read access entirely (field-level security).',
  sites(ctx) {
    const {xml, root} = ctx
    const permset = childText(xml, root, 'label') ?? ctx.component.apiName
    const out: MutationSite[] = []
    for (const fp of children(root, 'fieldPermissions')) {
      const field = childText(xml, fp, 'field') ?? '?'
      const editable = child(fp, 'editable')
      const readable = child(fp, 'readable')
      if (editable && childText(xml, fp, 'editable') === 'true') {
        out.push({
          key: `${field}:edit`,
          description: `Permission set "${permset}" can no longer edit ${field}`,
          shouldCheck: `A user with "${permset}" can change ${field} and save.`,
          edits: [replaceText(editable, 'false')],
        })
      }
      if (readable && childText(xml, fp, 'readable') === 'true') {
        const edits = [replaceText(readable, 'false')]
        if (editable && childText(xml, fp, 'editable') === 'true') edits.push(replaceText(editable, 'false'))
        out.push({
          key: `${field}:read`,
          description: `Permission set "${permset}" can no longer see ${field}`,
          shouldCheck: `A user with "${permset}" sees ${field} on the record.`,
          edits,
        })
      }
    }
    return out
  },
}

export const PERMSET_OBJ_REVOKE: Operator = {
  id: 'PERMSET_OBJ_REVOKE',
  metadataType: 'PermissionSet',
  summary: 'Revoke create or edit access to one object.',
  sites(ctx) {
    const {xml, root} = ctx
    const permset = childText(xml, root, 'label') ?? ctx.component.apiName
    const out: MutationSite[] = []
    for (const op of children(root, 'objectPermissions')) {
      const object = childText(xml, op, 'object') ?? '?'
      for (const [flag, verb] of [
        ['allowCreate', 'create'],
        ['allowEdit', 'edit'],
      ] as const) {
        const node = child(op, flag)
        if (!node || childText(xml, op, flag) !== 'true') continue
        out.push({
          key: `${object}:${verb}`,
          description: `Permission set "${permset}" can no longer ${verb} ${object} records`,
          shouldCheck: `A user with "${permset}" can ${verb} ${article(object)}.`,
          edits: [replaceText(node, 'false')],
        })
      }
    }
    return out
  },
}
