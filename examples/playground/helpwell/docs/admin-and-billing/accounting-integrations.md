---
title: Accounting integrations
description: Export approved expenses to Xero, QuickBooks Online or NetSuite, map your chart of accounts, and fix a failed export.
order: 2
---

# Accounting integrations

Ridgeline does not replace your ledger. It assembles a clean, approved batch and
pushes it into the system you already keep the books in.

Connect at **Settings → Integrations**.

## What gets exported

Only **Approved** expenses, and only ones in a period you have chosen to export.
Draft, Pending and Rejected expenses never leave Ridgeline.

| System | What Ridgeline creates | Receipts attached |
| --- | --- | --- |
| Xero | A bill per person per period, or a bank transaction per card expense | Yes |
| QuickBooks Online | An expense or a bill, depending on payment method | Yes |
| NetSuite | An Expense Report record | Yes |
| CSV | Whatever your columns say | No — exported as a zip alongside |

## Mapping your chart of accounts

After connecting, **Settings → Integrations → Mapping** lists every Ridgeline
category next to a dropdown of your accounts. Nothing exports until every
category used in the period has a mapping, which is why the first export is
usually the slow one.

Tax rates map separately, on the same screen. If you leave a tax rate unmapped,
Ridgeline sends the line with your accounting system's default, which is very
often wrong — map them.

## Running an export

1. **Reports → Export**, pick the period.
2. Review the summary: totals by person, by category, and anything unmapped.
3. **Export**. It runs in the background and emails you when it finishes.
4. Expenses move to **Exported** and lock.

Re-running an export for a period that has already been exported does not create
duplicates. Ridgeline stores the remote id of everything it created and updates
rather than re-posts. Deleting a bill in your accounting system and re-exporting
does re-create it.

## When an export fails

The export report lists each failed line with the message from the accounting
system. The usual causes:

- **The period is locked in your accounting system.** Ridgeline cannot post into
  a closed accounting period; unlock it there and re-run.
- **A contact does not exist.** Xero and QuickBooks need a supplier or employee
  record. Ridgeline creates one when it is allowed to; if creation is turned off
  in your mapping settings, create it by hand.
- **A category has no mapping.** Map it and re-run — only the failed lines are
  retried.

Partially failed exports leave the successful lines in **Exported** and the
failed ones in **Approved**, so re-running is always safe.

## Disconnecting

Disconnecting stops future exports and leaves everything already exported alone.
Reconnecting to a *different* accounting file clears the stored remote ids,
because they mean nothing in the new file. Ridgeline warns you before it does.

Related: [Plans, seats and invoices](/help/admin-and-billing/plans-and-invoices).
