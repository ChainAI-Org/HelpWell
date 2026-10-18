---
title: Connect a company card
description: Link a card feed so transactions arrive automatically, and what to do while the first sync backfills.
order: 3
appliesTo: Team and Business plans
---

# Connect a company card

A card feed means people stop typing amounts. The transaction arrives on its
own; all anybody has to do is photograph the receipt and pick a category.

Go to **Settings → Cards → Connect a card**.

## What we ask your bank for

Read-only transaction history. Ridgeline cannot move money, cannot change a
card's limit, and never sees the full card number — the feed carries the last
four digits and nothing more. If your bank's consent screen offers payment
initiation as well, decline it; we do not use it.

## The first sync

The first sync backfills **90 days** and usually finishes within an hour, though
a few banks trickle it out over a day. Until it finishes:

- New transactions may appear out of order. They settle into date order once the
  backfill completes.
- Duplicates are possible in the first hour and are cleaned up automatically.
  Do not delete them by hand — deleting a transaction the feed later re-sends
  creates a real duplicate that has to be merged.

## Assigning cards to people

A transaction is useless until Ridgeline knows whose it is. On **Settings →
Cards**, each card row has an **Assigned to** field. Assign it and every past and
future transaction on that card lands in that person's **Unmatched** tab.

Shared cards — an office card, a subscriptions card — should be assigned to
whoever reconciles them, usually somebody with the Finance role.

## Supported feeds

| Feed | How it connects | Backfill |
| --- | --- | --- |
| Visa and Mastercard commercial | Direct network feed | 90 days |
| Amex Business | Direct feed, needs the account owner to approve | 90 days |
| Most major banks | Open banking consent, re-authorised every 90 days | 90 days |
| Anything else | CSV import at **Settings → Cards → Import** | Whatever is in the file |

Open banking consent expires. Ridgeline emails the connector 10 days before, and
the Cards screen shows an amber **Re-authorise** badge. A lapsed consent does not
lose history, it just stops adding to it.

## When transactions stop arriving

1. Check **Settings → Cards** for a **Re-authorise** badge — this is the cause
   most of the time.
2. Check the card has not been reissued. A reissued card is a new card to the
   network, so it needs connecting again.
3. Check the assignment. Transactions for an unassigned card are held in
   **Settings → Cards → Unassigned**, not lost.

Related: [Attach and match receipts](/help/expenses/attach-and-match-receipts).
