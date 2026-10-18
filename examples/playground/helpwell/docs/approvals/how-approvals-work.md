---
title: How approvals work
description: The path an expense takes from submitted to exported, who sees it at each step, and what the statuses mean.
order: 1
---

# How approvals work

An expense moves through five statuses, and only ever forwards except when it is
rejected.

```text
Draft  ->  Pending  ->  Approved  ->  Exported  ->  Reimbursed
              |
              +--> Rejected  ->  back to Draft
```

| Status | Who has it | What can change |
| --- | --- | --- |
| **Draft** | The person who filed it | Everything |
| **Pending** | The approver | The filer can still edit, which resets the approval |
| **Approved** | Finance | Nothing, except by rejecting it back to Draft |
| **Exported** | Your accounting system | Nothing |
| **Reimbursed** | Closed | Nothing |

## Who approves

The first approver is the filer's manager, from the reporting line at **Settings
→ People**. A policy can add a second approver above a threshold — see
[Approval policies and limits](/help/approvals/approval-policies).

Nobody approves their own expense. If you are somebody's manager and you file
something yourself, it goes to *your* manager, and if you have none it goes to
the workspace's backup approver.

## What an approver sees

The **Approvals** queue, oldest first, with the receipt side by side with the
fields so nothing has to be opened in a second tab. Each row shows any policy
flags: missing receipt, over limit, out of policy category, possible duplicate.
A flag is information, not a block — an approver can approve a flagged expense,
and the flag stays on the record afterwards.

## Approving in bulk

Select rows and **Approve selected**. Ridgeline will not let you bulk-approve
anything carrying a flag; those have to be opened. This is deliberate, and it is
the main reason flagged expenses get looked at.

## Reminders

An expense pending for more than three days emails the approver each morning
until it moves. After seven days it also emails the filer, so you find out that
your manager is on holiday from Ridgeline rather than from payroll.

Change both intervals at **Settings → Approvals → Reminders**, or switch them off
entirely.

## Delegation

**Settings → Profile → Delegate approvals** hands your queue to somebody else for
a date range. Delegated approvals are recorded as "approved by X on behalf of Y",
which is what an auditor needs to see. Delegation does not change reporting
lines, and it ends automatically on the end date.
