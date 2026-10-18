---
title: Approval policies and limits
description: Write rules that decide what needs a human, set category limits, and test a policy before you turn it on.
order: 2
appliesTo: Finance and Admin roles
---

# Approval policies and limits

A policy is a rule that looks at an expense and decides one of three things:
approve it automatically, send it to the usual approver, or send it to somebody
more senior.

Policies live at **Settings → Approvals → Policies** and run in order, top to
bottom. The first rule that matches wins, so put the specific ones above the
general ones.

## The pieces of a rule

**When** — any combination of amount, category, project, person, team, merchant,
and whether a receipt is attached.

**Then** — one of:

- **Auto-approve.** Skips a human entirely and lands in Approved.
- **Require approval.** The normal path, to the filer's manager.
- **Require approval from…** A named person or role, for a second signature.
- **Block.** Refuses the submission with a message you write. Use this
  sparingly; a block that people cannot work around becomes a message to
  finance instead, which is worse.

## A policy that works for most teams

1. Anything under 25, with a receipt, in Travel, Meals or Supplies →
   **auto-approve**.
2. Anything over 2,000 → **require approval from Finance**, on top of the
   manager.
3. Anything with no receipt → **require approval**, and flag.
4. Everything else → **require approval**.

That auto-approve line is the one that decides whether people like the product.
A team that has to chase a manager over a 4.10 coffee stops filing coffees, and
then your spend data is wrong.

## Category limits

A limit is a shorthand for "over this, ask someone". Set them at **Settings →
Categories**; each category can carry a per-expense limit, a per-person monthly
limit, or both. Exceeding a limit does not block anything on its own — it raises
a flag and, if a policy says so, adds an approver.

Limits are evaluated in the workspace's base currency using the rate on the
transaction date, so a limit does not shift when the exchange rate does.

## Testing before you turn it on

Every policy has a **Dry run** button. It replays your last 90 days through the
rule and shows what would have changed: how many expenses would have been
auto-approved, how many would have gained an approver, and which ones would have
been blocked. Read the blocked list before you save. It is almost always longer
than you expect.

## Changing a policy

Changes apply to expenses submitted **after** the change. Anything already
pending keeps the approval path it started with, for the same reason that
reporting-line changes do not move live approvals — see
[How approvals work](/help/approvals/how-approvals-work).
