---
title: Submit an expense
description: File a single expense or a batch, what each field is for, and how to fix one after it has been sent.
order: 1
---

# Submit an expense

The fastest route is the receipt: photograph it, and Ridgeline fills in the
amount, date and merchant for you. Everything below is what happens around that.

## From the web app

1. Click **New expense** on the dashboard, or press <kbd>N</kbd>.
2. Drop in the receipt. Give it a second — the amount, date and merchant appear
   on their own.
3. Pick a **category**. This is the only field Ridgeline cannot guess reliably,
   and it is the field your accountant actually cares about.
4. Add a **note** if the category is not self-explanatory. "Client lunch —
   Northwind renewal" saves your approver a message.
5. **Submit**, or **Save as draft** if you are waiting on something.

## From your phone

Open the app, tap the camera, take the photo. The expense is created as a draft
immediately and finishes processing in the background, so you can photograph a
stack of receipts at an airport and sort them out later.

## The fields

| Field | Required | Notes |
| --- | --- | --- |
| Amount | Yes | In the currency on the receipt. Conversion happens at approval using the rate on the transaction date. |
| Date | Yes | The date on the receipt, not the date you filed it. |
| Category | Yes | From your workspace's list. Finance edits it at **Settings → Categories**. |
| Merchant | No | Filled from the receipt. Used for duplicate detection. |
| Note | No | Required by policy for some categories — the form tells you when. |
| Attendees | Only for meals | Who was there. Some tax regimes require it and Ridgeline will ask. |
| Project | No | Only appears if your workspace uses projects. |

## Submitting several at once

Select rows on the dashboard with the checkboxes and click **Submit selected**.
They travel as one report, so your approver sees a single item rather than nine.
A report is approved or rejected as a whole — if one line is wrong, the whole
report comes back.

## Changing an expense after you submit it

While it is **Pending** you can edit it, and editing resets the approval so your
approver sees the new version. Once it is **Approved** you cannot edit it: ask
your approver to reject it, which moves it back to Draft with the reason
attached. See [Fix a rejected expense](/help/approvals/fix-a-rejected-expense).

Once a period is **closed**, nothing in it can change. Finance reopens a period
at **Settings → Periods**, and reopening is logged.

## Duplicates

Ridgeline flags an expense as a possible duplicate when the amount, date and
merchant all match something already filed. It does not block you — two identical
coffees on the same day is a real thing that happens. Dismiss the flag and
carry on, or delete the copy.
