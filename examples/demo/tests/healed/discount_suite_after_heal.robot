# The Discount Approval suite AFTER `agentia mutant heal` (run of 2026-10-06).
# The two extra test cases were written by the Copado AI Test agent for the mutants the
# happy-path suite missed; "Edit discount percent on existing opportunity" was then edited
# during human review (edit via the Edit button, verify on the Details tab).
# The demo starts from ../discount_happy_path.robot; this file is for reference.

*** Settings ***
Documentation     Discount Approval demo app: deliberately incomplete suite (happy path only).
...               Mutant measures how many configuration breakages this suite misses.
Library           QWeb
Library           QForce
Suite Setup       Setup Browser
Suite Teardown    End Suite

*** Variables ***
${BROWSER}        chrome
${login_url}      https://test.salesforce.com

*** Test Cases ***
Create opportunity with a small discount
    [Documentation]    A 10% discount saves and does not need approval.
    [Tags]             discount    happy-path
    Login
    LaunchApp          Sales
    ClickText          Opportunities
    ClickText          New
    UseModal           On
    TypeText           *Opportunity Name    Mutant Demo Small Discount
    PickList           *Stage               Prospecting
    TypeText           *Close Date          12/31/2030
    TypeText           Discount Percent     10
    ClickText          Save                 partial_match=False
    UseModal           Off
    VerifyText         Mutant Demo Small Discount

Create opportunity with excessive discount is rejected
    [Documentation]    A 45% discount violates the Discount_Max validation rule and must be
    ...                rejected with "Discount cannot exceed 40%"; the record must not be saved.
    [Tags]             discount    validation-rule    negative
    ${timestamp}=      Get Time    epoch
    ${opp_name}=       Catenate    SEPARATOR=    Mutant Demo Over Discount    ${timestamp}
    Login
    LaunchApp          Sales
    ClickText          Opportunities
    ClickText          New
    UseModal           On
    TypeText           *Opportunity Name    ${opp_name}
    PickList           *Stage               Prospecting
    TypeText           *Close Date          12/31/2030
    TypeText           Discount Percent     45
    ClickText          Save                 partial_match=False
    VerifyText         Discount cannot exceed 40%
    ClickText          Cancel
    UseModal           Off
    VerifyNoText       ${opp_name}

Edit discount percent on existing opportunity
    [Documentation]    A user with the Sales Discounts permission set can edit
    ...                Opportunity.Discount_Percent__c on a saved record and the new
    ...                value is saved. Catches FLS editable=false mutants.
    [Tags]             discount    fls    permission-set
    ${unique_name}=    Get Time    epoch
    ${record_name}=    Set Variable    Mutant FLS Edit ${unique_name}
    Login
    LaunchApp          Sales
    ClickText          Opportunities
    ClickText          New
    UseModal           On
    TypeText           *Opportunity Name    ${record_name}
    PickList           *Stage               Prospecting
    TypeText           *Close Date          12/31/2030
    ClickText          Save                 partial_match=False
    UseModal           Off
    VerifyText         ${record_name}
    ClickText          Edit                 partial_match=False
    UseModal           On
    TypeText           Discount Percent     35
    ClickText          Save                 partial_match=False
    UseModal           Off
    ClickText          Details
    VerifyText         35.00%

*** Keywords ***
Setup Browser
    Open Browser       about:blank    ${BROWSER}
    SetConfig          LineBreak      ${EMPTY}
    SetConfig          DefaultTimeout    20s

Login
    # Works with the classic, username-first and email-first Salesforce login pages.
    GoTo               ${login_url}
    ${email_first}=    IsText         Log In with Username    timeout=5s
    IF    ${email_first}
        ClickText      Log In with Username
    END
    TypeText           Username       ${username}    delay=1
    PressKey           Username       {ENTER}
    TypeSecret         Password       ${password}
    PressKey           Password       {ENTER}
    VerifyNoText       Log In         timeout=30s

End Suite
    Close All Browsers
