import type {Component} from '../lib/metadata.js'
import type {Edit, XmlNode} from '../lib/xml.js'

/** One place in one component where an operator can make one mutation. */
export interface MutationSite {
  /** Stable within the component, e.g. `Needs_Approval/0` or `Opportunity.Discount_Percent__c:edit`. */
  key: string
  /** Plain-English description of the breakage, shown in plans and reports. */
  description: string
  /** What a good test should verify so this breakage is caught. */
  shouldCheck: string
  /** Text edits that produce the mutant. */
  edits: Edit[]
}

export interface OperatorContext {
  xml: string
  root: XmlNode
  component: Component
}

export interface Operator {
  id: string
  /** Metadata type this operator applies to. */
  metadataType: string
  /** One-line summary for docs and `--help`. */
  summary: string
  /** Every applicable site. Returns [] when the component doesn't qualify (the "valid if" guard). */
  sites(ctx: OperatorContext): MutationSite[]
}

/** `Opportunity.Discount_Max` → `Discount_Max`. */
export function shortName(apiName: string): string {
  return apiName.includes('.') ? (apiName.split('.').pop() as string) : apiName
}

/** `Opportunity.Discount_Max` → `Opportunity`. */
export function objectName(apiName: string): string | undefined {
  return apiName.includes('.') ? apiName.split('.')[0] : undefined
}

/** `a Contact`, `an Opportunity`. */
export function article(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

/** Quotes a sentence without doubling its final full stop. */
export function quoted(sentence: string): string {
  return `"${sentence.replace(/[.\s]+$/, '')}"`
}
