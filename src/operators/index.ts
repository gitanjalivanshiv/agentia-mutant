import {CHECKBOX_DEFAULT_FLIP, FIELD_REQUIRED_OFF, PICKLIST_DEFAULT} from './custom-field.js'
import {FLOW_BOUNDARY, FLOW_DECISION_FLIP, FLOW_DROP_ASSIGNMENT} from './flow.js'
import {LAYOUT_FIELD_REMOVE} from './layout.js'
import {PERMSET_FLS_REVOKE, PERMSET_OBJ_REVOKE} from './permission-set.js'
import type {Operator} from './types.js'
import {VR_DEACTIVATE, VR_NEGATE} from './validation-rule.js'

export * from './types.js'

/** Declarative operators (brief §6). Order is the default variety order for the planner. */
export const OPERATORS: readonly Operator[] = [
  VR_DEACTIVATE,
  VR_NEGATE,
  FLOW_DECISION_FLIP,
  FLOW_BOUNDARY,
  FLOW_DROP_ASSIGNMENT,
  FIELD_REQUIRED_OFF,
  PICKLIST_DEFAULT,
  CHECKBOX_DEFAULT_FLIP,
  PERMSET_FLS_REVOKE,
  PERMSET_OBJ_REVOKE,
  LAYOUT_FIELD_REMOVE,
]

export function operatorById(id: string): Operator | undefined {
  return OPERATORS.find((o) => o.id === id)
}

/** Applies config allow/deny lists (empty allow = all). Unknown IDs are reported, not ignored. */
export function selectOperators(
  allow: string[] = [],
  deny: string[] = [],
): {operators: Operator[]; unknown: string[]} {
  const unknown = [...allow, ...deny].filter((id) => !operatorById(id))
  const operators = OPERATORS.filter(
    (o) => (allow.length === 0 || allow.includes(o.id)) && !deny.includes(o.id),
  )
  return {operators, unknown}
}
