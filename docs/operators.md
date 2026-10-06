# Mutation operators

Mutant's operators are **pure functions over Source Format XML**: given a component's file, each returns every place it can make *one* realistic breakage. Operators edit the original text by offsets (no parse → re-serialise), so every mutant's diff is exactly the lines that changed. Every mutant is checked to be well-formed XML before it is used.

Each mutant carries:
- a stable ID: `<OPERATOR>:<Type>:<apiName>:<site>`
- a plain-English **description** of the breakage
- **what a good test should check** so the breakage is caught (used by the report and by `mutant heal`)
- a unified **diff**

Operators skip components they don't apply to (the "valid if" guard): an inactive validation rule isn't negated, a field that isn't required isn't made optional, and so on.

## Operators

| ID | Metadata | Mutation | Mutants in demo app |
|---|---|---|---|
| `VR_DEACTIVATE` | ValidationRule | Switch an active validation rule off (active true → false). | 1 |
| `VR_NEGATE` | ValidationRule | Invert an active validation rule: wrap its error condition in NOT( … ). | 1 |
| `FLOW_DECISION_FLIP` | Flow | Flip one decision condition operator (= ↔ ≠, > ↔ ≤, < ↔ ≥). | 1 |
| `FLOW_BOUNDARY` | Flow | Move a numeric threshold in a decision condition by ±1 (off-by-one / boundary bugs). | 2 |
| `FLOW_DROP_ASSIGNMENT` | Flow | Remove one field assignment (assignment item or record-update field); a single-item assignment element is bypassed. | 2 |
| `FIELD_REQUIRED_OFF` | CustomField | Make a required field optional (required true → false). | 0 |
| `PICKLIST_DEFAULT` | CustomField | Remove a picklist default, or move it to the next value. | 0 |
| `CHECKBOX_DEFAULT_FLIP` | CustomField | Flip a checkbox default (false ↔ true). | 1 |
| `PERMSET_FLS_REVOKE` | PermissionSet | Revoke edit access to one field, or read access entirely (field-level security). | 3 |
| `PERMSET_OBJ_REVOKE` | PermissionSet | Revoke create or edit access to one object. | 2 |
| `LAYOUT_FIELD_REMOVE` | Layout | Remove one custom field from a page layout (required fields are left alone). | 2 |
| *(stretch)* `APEX_COND_FLIP` | ApexClass | Flip one comparison operator | not implemented |

### Design notes

- **FLOW_DROP_ASSIGNMENT** removes one item from a multi-item assignment or a multi-field record update. A *single-item* assignment can't be emptied (the flow would not deploy), so the step is **bypassed** instead: connectors that lead to it are rewired to its next step, or removed when it is the last step. The flow still deploys, but the field is never set.
- **FLOW_BOUNDARY** keeps the literal's format (`20.0` → `21.0`, `3` → `4`) and only touches numbers in decision conditions.
- **PERMSET_FLS_REVOKE** revoking *read* also revokes *edit* (Salesforce rejects edit-without-read).
- **PERMSET_OBJ_REVOKE** never revokes read, delete or modify-all.
- **LAYOUT_FIELD_REMOVE** only removes custom fields (`__c`) that are not `Required` on the layout; removing standard or required items tends to produce invalid mutants rather than realistic ones.
- **CHECKBOX_DEFAULT_FLIP** is an addition to the brief's list: checkbox defaults are a common source of silent behaviour changes.
- Profiles are never mutated (they are huge and fail to retrieve); mutate permission sets instead.

## The demo app's 15 mutants

| Operator | Component | Breakage | A test should check |
|---|---|---|---|
| `FLOW_DECISION_FLIP` | Flow `Discount_Approval` | Flow "Discount Approval": decision "Discount Above Threshold" now checks Discount_Percent__c ≤ 20.0 instead of Discount_Percent__c > 20.0 | Records on both sides of the "Discount Above Threshold" condition (Discount_Percent__c > 20.0) take the right path, e.g. one clearly above and one clearly below 20.0. |
| `FLOW_BOUNDARY` | Flow `Discount_Approval` | Flow "Discount Approval": threshold in "Discount Above Threshold" moved from 20.0 to 21.0 | The "Discount Above Threshold" boundary is exact: test Discount_Percent__c at 20.0 and just above it. |
| `FLOW_BOUNDARY` | Flow `Discount_Approval` | Flow "Discount Approval": threshold in "Discount Above Threshold" moved from 20.0 to 19.0 | The "Discount Above Threshold" boundary is exact: test Discount_Percent__c at 20.0 and just below it. |
| `FLOW_DROP_ASSIGNMENT` | Flow `Discount_Approval` | Flow "Discount Approval": step "Flag Approval" is skipped, so Approval_Required__c is never set to true | When the flow reaches "Flag Approval", Approval_Required__c becomes true. |
| `FLOW_DROP_ASSIGNMENT` | Flow `Discount_Approval` | Flow "Discount Approval": step "Clear Approval" is skipped, so Approval_Required__c is never set to false | When the flow reaches "Clear Approval", Approval_Required__c becomes false. |
| `LAYOUT_FIELD_REMOVE` | Layout `Opportunity-Opportunity Layout` | Field Discount_Percent__c removed from page layout "Opportunity-Opportunity Layout" | Discount_Percent__c is visible and editable on the record page for users of "Opportunity-Opportunity Layout". |
| `LAYOUT_FIELD_REMOVE` | Layout `Opportunity-Opportunity Layout` | Field Approval_Required__c removed from page layout "Opportunity-Opportunity Layout" | Approval_Required__c is visible on the record page for users of "Opportunity-Opportunity Layout". |
| `CHECKBOX_DEFAULT_FLIP` | CustomField `Opportunity.Approval_Required__c` | Checkbox "Approval Required" (Opportunity.Approval_Required__c) now defaults to true | A new Opportunity starts with "Approval Required" unchecked. |
| `VR_DEACTIVATE` | ValidationRule `Opportunity.Discount_Max` | Validation rule `Discount_Max` on Opportunity switched off | Saving an Opportunity that breaks `Discount_Max` (Discount_Percent__c > 0.40) is rejected with "Discount cannot exceed 40%". |
| `VR_NEGATE` | ValidationRule `Opportunity.Discount_Max` | Validation rule `Discount_Max` on Opportunity inverted: it now blocks valid records and lets invalid ones through | A valid Opportunity saves without error, and one that breaks `Discount_Max` (Discount_Percent__c > 0.40) is rejected. |
| `PERMSET_FLS_REVOKE` | PermissionSet `Sales_Discounts` | Permission set "Sales Discounts" can no longer see Opportunity.Approval_Required__c | A user with "Sales Discounts" sees Opportunity.Approval_Required__c on the record. |
| `PERMSET_FLS_REVOKE` | PermissionSet `Sales_Discounts` | Permission set "Sales Discounts" can no longer edit Opportunity.Discount_Percent__c | A user with "Sales Discounts" can change Opportunity.Discount_Percent__c and save. |
| `PERMSET_FLS_REVOKE` | PermissionSet `Sales_Discounts` | Permission set "Sales Discounts" can no longer see Opportunity.Discount_Percent__c | A user with "Sales Discounts" sees Opportunity.Discount_Percent__c on the record. |
| `PERMSET_OBJ_REVOKE` | PermissionSet `Sales_Discounts` | Permission set "Sales Discounts" can no longer create Opportunity records | A user with "Sales Discounts" can create an Opportunity. |
| `PERMSET_OBJ_REVOKE` | PermissionSet `Sales_Discounts` | Permission set "Sales Discounts" can no longer edit Opportunity records | A user with "Sales Discounts" can edit an Opportunity. |

## Example diffs

Validation rule switched off:

```diff
--- a/main/default/objects/Opportunity/validationRules/Discount_Max.validationRule-meta.xml
+++ b/main/default/objects/Opportunity/validationRules/Discount_Max.validationRule-meta.xml
@@ -1,7 +1,7 @@
 <?xml version="1.0" encoding="UTF-8"?>
 <ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">
     <fullName>Discount_Max</fullName>
-    <active>true</active>
+    <active>false</active>
     <description>Discounts above 40% are not allowed (Mutant demo app).</description>
     <errorConditionFormula>Discount_Percent__c &gt; 0.40</errorConditionFormula>
     <errorDisplayField>Discount_Percent__c</errorDisplayField>
```

Flow step bypassed:

```diff
--- a/main/default/flows/Discount_Approval.flow-meta.xml
+++ b/main/default/flows/Discount_Approval.flow-meta.xml
@@ -46,9 +46,6 @@
                     <numberValue>20.0</numberValue>
                 </rightValue>
             </conditions>
-            <connector>
-                <targetReference>Flag_Approval</targetReference>
-            </connector>
             <label>Needs Approval</label>
         </rules>
     </decisions>
```

Field removed from the page layout:

```diff
--- a/main/default/layouts/Opportunity-Opportunity Layout.layout-meta.xml
+++ b/main/default/layouts/Opportunity-Opportunity Layout.layout-meta.xml
@@ -46,10 +46,6 @@
                 <behavior>Edit</behavior>
                 <field>Amount</field>
             </layoutItems>
-            <layoutItems>
-                <behavior>Edit</behavior>
-                <field>Discount_Percent__c</field>
-            </layoutItems>
             <layoutItems>
                 <behavior>Readonly</behavior>
                 <field>Approval_Required__c</field>
```
