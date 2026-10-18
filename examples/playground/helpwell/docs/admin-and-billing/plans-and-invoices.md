---
title: Plans, seats and invoices
description: How Ridgeline bills, what happens when you add people mid-month, and where to find or change an invoice.
order: 3
---

# Plans, seats and invoices

Ridgeline bills per active seat per month. Everything is at **Settings →
Billing**, which only the Admin role can open.

## The plans

| | Free | Team | Business |
| --- | --- | --- | --- |
| Seats | Up to 3 | Unlimited | Unlimited |
| Expenses and receipts | Yes | Yes | Yes |
| Card feeds | No | Yes | Yes |
| Approval policies | One rule | Unlimited | Unlimited |
| Accounting export | CSV | Xero, QBO, CSV | All, plus NetSuite |
| SAML SSO and SCIM | No | No | Yes |
| Audit log retention | 30 days | 1 year | 7 years |

## Seats and proration

A seat is anybody who can sign in: Member, Manager, Finance or Admin.
Deactivated people do not count and neither do pending invitations.

Add somebody mid-period and you are charged for the remaining days of that
period. Deactivate somebody and the credit appears on the **next** invoice
rather than as a refund. Seat count is measured continuously, so adding and
removing the same person twice in a month is billed twice — this is the most
common surprise on a first invoice.

## Annual billing

Annual is twelve months up front at a discount, with a committed seat count. Go
over the commitment and the extra seats are billed monthly in arrears at the
monthly rate. Go under and the difference is not refunded, so commit to the
number you are confident about rather than the number you are hoping for.

## Invoices

**Settings → Billing → Invoices** holds every invoice as a PDF, going back to the
first one. Each shows the seat count it was calculated from and the days each
seat was active, which is what to check when a total looks wrong.

To change what appears on future invoices — company name, address, VAT or tax
id, a PO number, extra recipients — use **Billing details**. Changes apply to the
next invoice. Ridgeline can reissue the **most recent** invoice with corrected
details; anything older has to stay as it was issued.

## Payment

Card or, on annual plans over a threshold, bank transfer on 30-day terms. A
failed card is retried on days 3, 5 and 7, with an email to every Admin each
time. After the fourth failure the workspace moves to read-only: people can sign
in and look at history, and nothing can be filed, approved or exported. Nothing
is deleted, and paying restores everything immediately.

## Cancelling

**Settings → Billing → Cancel plan** stops renewal at the end of the current
period. Before that date, export everything you want to keep — **Reports →
Export → Full workspace export** produces a zip of every expense as CSV with all
receipts. After cancellation the workspace stays readable for 30 days, then the
data is deleted.
