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
    Login              ${login_url}    ${username}    ${password}
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
