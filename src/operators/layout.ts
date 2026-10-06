import {childText, removeElement, select} from '../lib/xml.js'
import {type Operator} from './types.js'

export const LAYOUT_FIELD_REMOVE: Operator = {
  id: 'LAYOUT_FIELD_REMOVE',
  metadataType: 'Layout',
  summary: 'Remove one custom field from a page layout (required fields are left alone).',
  sites(ctx) {
    const {xml, root} = ctx
    const layout = ctx.component.apiName
    return select(root, ['layoutSections', 'layoutColumns', 'layoutItems']).flatMap((item) => {
      const field = childText(xml, item, 'field')
      const behavior = childText(xml, item, 'behavior')
      // Standard fields and Required items are often mandatory on a layout; removing them
      // tends to produce invalid mutants rather than realistic ones.
      if (!field || !field.endsWith('__c') || behavior === 'Required') return []
      return [
        {
          key: field,
          description: `Field ${field} removed from page layout "${layout}"`,
          shouldCheck: `${field} is visible${behavior === 'Edit' ? ' and editable' : ''} on the record page for users of "${layout}".`,
          edits: [removeElement(xml, item)],
        },
      ]
    })
  },
}
