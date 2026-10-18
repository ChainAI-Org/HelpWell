---
title: Mileage and per diem
description: Claim a journey by distance, set your workspace rates, and use per diem allowances instead of itemised meals.
order: 3
---

# Mileage and per diem

Two kinds of expense have no receipt by design. Ridgeline treats both as
calculated amounts rather than scanned ones.

## Claiming mileage

1. **New expense → Mileage**.
2. Enter the start and end addresses. The distance is calculated on the road
   route, not as the crow flies, and you can drag the route if you took a
   different one.
3. Tick **Return journey** to double it.
4. The amount is distance times your workspace's rate for the vehicle type.

You cannot edit the amount directly. If it is wrong, the distance or the rate is
wrong, and one of those is the thing to fix.

## Rates

Finance sets rates at **Settings → Mileage**. A rate has a vehicle type, an
amount per unit, and an effective date. Ridgeline applies whichever rate was in
force on the **date of travel**, so changing a rate never rewrites history.

Tiered rates are supported: many tax regimes pay a higher rate for the first
N units in a tax year and a lower one after. Ridgeline tracks each person's
running total and switches rates automatically at the threshold.

## Per diem

A per diem replaces itemised meal claims with a flat daily allowance. Turn it on
at **Settings → Per diem**, then set allowances by destination.

Filing one: **New expense → Per diem**, pick the trip dates and destination.
Ridgeline calculates the total, applying part-day rules for the first and last
day where your allowance table defines them.

Two rules catch people out:

- A day with a per diem cannot also carry an itemised meal expense. Ridgeline
  blocks it at submission rather than at approval, so you find out immediately.
- Provided meals reduce the allowance. If a conference fed you lunch, tick
  **Lunch provided** on that day and the day's amount drops by the configured
  percentage.

## Tax treatment

Mileage and per diem within published statutory rates are usually not taxable;
above them the excess usually is. Ridgeline tags the excess separately in the
export so payroll can treat it correctly. What counts as statutory depends on
where you are — set it at **Settings → Tax regime**, and take actual advice from
your accountant rather than from this page.
