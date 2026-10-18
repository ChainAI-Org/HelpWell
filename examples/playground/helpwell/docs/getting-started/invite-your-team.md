---
title: Invite your team and set roles
description: The four Ridgeline roles, what each one can see, and how to move somebody between them.
order: 2
---

# Invite your team and set roles

Go to **Settings → People → Invite**. Paste email addresses one per line, pick a
role for the batch, and send. Invitations expire after 14 days and can be resent
from the same screen.

## The four roles

| Role | Can file expenses | Can approve | Can export | Can change settings |
| --- | --- | --- | --- | --- |
| **Member** | Own only | No | No | No |
| **Manager** | Own only | Direct reports | No | No |
| **Finance** | Own only | Everyone | Yes | Categories and policies |
| **Admin** | Own only | Everyone | Yes | Everything, including billing |

Nobody can approve their own expense, including Admins. If an Admin files
something over the policy limit it goes to the workspace's designated backup
approver, set at **Settings → Approvals → Backup approver**.

## Reporting lines

A Manager only sees the people listed under them at **Settings → People →
Reporting line**. Change somebody's manager and any expense *already waiting*
stays with the old approver — moving approvals mid-flight is the single most
common way for something to get lost. Reject and refile if it genuinely needs to
move.

## Deactivating somebody

Deactivating a person keeps their history and stops them signing in. Their
pending expenses do not disappear; they move to their manager, who can approve,
reject, or reassign them. You cannot delete a person who has expenses in a
closed period, because that would change a number finance has already exported.

## Seats and billing

Members, Managers, Finance and Admins all count as one seat. Deactivated people
do not. Seat count is measured at the end of each billing period, so adding
somebody mid-month is prorated. See
[Plans, seats and invoices](/help/admin-and-billing/plans-and-invoices).

## If an invitation never arrives

Ninety per cent of the time it is a mail filter. Ask the person to search for
`ridgeline.app` including spam, then:

1. Check **Settings → People** — an invitation that was accepted already shows
   as **Active**, and people often forget they clicked it.
2. Resend from the row's overflow menu. This mints a new link and invalidates
   the old one.
3. If your domain uses strict DMARC, allow-list `mail.ridgeline.app`.

If your workspace uses SAML, invitations behave differently: see
[Single sign-on with SAML](/help/admin-and-billing/single-sign-on).
