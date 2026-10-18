/**
 * Bucketing for the conversations-over-time chart.
 *
 * The report gives one point per day, which is right for a month and wrong
 * for "all time": a bar per day since 2000 is thousands of bars in a strip
 * 150px tall. Above a size a chart can actually show, days fold into weeks,
 * and above that into months.
 */

export interface ChartPoint {
  label: string;
  value: number;
}

/** More points than this fold into weeks. */
export const WEEKLY_ABOVE = 120;
/** More points than this fold into months. */
export const MONTHLY_ABOVE = 520;

export function bucketSeries(
  points: readonly { day: string; conversations: number }[],
): ChartPoint[] {
  if (points.length > MONTHLY_ABOVE) return fold(points, monthKey);
  if (points.length > WEEKLY_ABOVE) return fold(points, weekKey);
  return points.map((point) => ({ label: point.day, value: point.conversations }));
}

function fold(
  points: readonly { day: string; conversations: number }[],
  key: (day: string) => string,
): ChartPoint[] {
  const buckets = new Map<string, number>();
  for (const point of points) {
    const label = key(point.day);
    buckets.set(label, (buckets.get(label) ?? 0) + point.conversations);
  }
  return [...buckets.entries()].map(([label, value]) => ({ label, value }));
}

/** `YYYY-MM` for the month the day is in. */
function monthKey(day: string): string {
  return day.slice(0, 7);
}

/** The Monday that starts the day's week, as `YYYY-MM-DD`. */
function weekKey(day: string): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - sinceMonday);
  return date.toISOString().slice(0, 10);
}
