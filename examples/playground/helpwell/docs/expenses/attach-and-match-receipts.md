---
title: Attach and match receipts
description: How receipt scanning works, how a receipt gets matched to a card transaction, and how to fix a bad match.
order: 2
---

# Attach and match receipts

A receipt can arrive three ways: dropped onto an expense, forwarded by email, or
photographed in the mobile app. All three end in the same place.

## Forwarding by email

Send the receipt to **receipts@ridgeline.app** from the address you sign in
with. Attachments and receipts in the body of the message both work. You get a
reply within a minute saying what was read and which expense it landed on.

Mail from an address Ridgeline does not recognise is dropped, so forwarding from
a personal account will silently do nothing. Add a second address at **Settings
→ Profile → Verified addresses** if you need to forward from your phone's
default account.

## What scanning reads

Amount, currency, date, merchant, and tax where the receipt states it clearly.
It does not read line items — a hotel folio becomes one expense, not seven, and
if your finance team needs the split you enter it by hand with **Split expense**.

Scanning works best on a flat, fully visible receipt in reasonable light. Long
thermal receipts curl; hold the end down. A photo of a screen works but reads
worse than a forwarded PDF.

## Matching to card transactions

When a card feed is connected, Ridgeline matches receipts to transactions on
amount, date and merchant, with a couple of days of tolerance because merchants
settle late. A confident match happens on its own. Anything less shows in the
**Unmatched** tab with suggestions ranked.

Fix a wrong match from the expense's overflow menu:

- **Unmatch** puts the transaction back in **Unmatched** and leaves the receipt
  where it is.
- **Match to…** lets you pick the right transaction from a search.
- **Mark as cash** tells Ridgeline no transaction is coming. Use this for
  personal cards and actual cash, and the expense becomes reimbursable.

## Missing receipts

Policy decides whether an expense can be approved without one. Where a receipt
is required and genuinely lost, use **Declare missing receipt**: it records a
short statement from you, flags the expense, and lets it continue. Finance can
see every declaration at **Reports → Missing receipts**, which is what an auditor
will ask for.

## Storage and retention

Receipts are stored for the life of the workspace plus your configured retention
period — seven years by default, set at **Settings → Data**. Deleting an expense
deletes its receipt after 30 days in the bin.
