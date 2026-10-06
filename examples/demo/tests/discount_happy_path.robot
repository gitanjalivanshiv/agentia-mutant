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
