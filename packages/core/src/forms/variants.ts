/**
 * A/B tests: which variant a visitor sees, and which one is winning.
 *
 * Assignment is a hash of the visitor and the form, so a visitor keeps their
 * variant across page views without anything being stored, and a variant's
 * share of traffic follows its weight. The variant rides in the render token,
 * so a submission is attributed to the variant that was actually drawn.
 *
 * The winner is the variant converting best among the people who saw it,
 * with a two-proportion z-test for how sure that is. It is a note for a
 * person deciding, not an automatic switch: small samples and several
 * variants mean "95% confident" is a guide, and the page says so.
 */

import type { FormDefinition } from './schema.js';

/** FNV-1a: small, fast, and spread well enough to split traffic. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The variant this visitor sees. Always the same one for the same visitor and form. */
export function assignVariant(definition: FormDefinition, formId: string, visitor: string): string {
  const variants = definition.variants.filter((v) => v.weight > 0);
  if (variants.length === 0) return definition.variants[0]?.id ?? 'a';
  const total = variants.reduce((sum, v) => sum + v.weight, 0);
  let point = hash(`${formId}\u0000${visitor}`) % total;
  for (const variant of variants) {
    if (point < variant.weight) return variant.id;
    point -= variant.weight;
  }
  return variants[variants.length - 1]!.id;
}

export interface VariantResult {
  variant: string;
  name: string;
  views: number;
  /** Unique people who saw it, per day. */
  uniques: number;
  submissions: number;
  /** Trusted submissions over unique views; null before anyone saw it. */
  conversionRate: number | null;
}

export interface VariantVerdict {
  /** The best-converting variant so far, or null when there is nothing to compare. */
  leader: string | null;
  /** How much better it converts than the runner-up, as a fraction (0.23 is 23%). */
  lift: number | null;
  /** 1 minus the two-sided p-value of leader against runner-up. */
  confidence: number | null;
  /** 95% or more. */
  significant: boolean;
  /** The sentence the dashboard shows. */
  note: string;
}

/** The fewest people per variant before any call is made. */
const MIN_SAMPLE = 30;

export function compareVariants(results: readonly VariantResult[]): VariantVerdict {
  const ranked = results
    .filter((r) => r.uniques > 0)
    .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0));
  const leader = ranked[0];
  const runnerUp = ranked[1];
  if (!leader || !runnerUp) {
    return {
      leader: leader?.variant ?? null,
      lift: null,
      confidence: null,
      significant: false,
      note: 'Not enough data yet: each variant needs to have been seen.',
    };
  }
  const p1 = leader.submissions / leader.uniques;
  const p2 = runnerUp.submissions / runnerUp.uniques;
  const lift = p2 > 0 ? (p1 - p2) / p2 : null;
  const confidence = zTestConfidence(
    leader.submissions,
    leader.uniques,
    runnerUp.submissions,
    runnerUp.uniques,
  );
  const label = (r: VariantResult) => r.name || r.variant.toUpperCase();
  const small = leader.uniques < MIN_SAMPLE || runnerUp.uniques < MIN_SAMPLE;
  const significant = !small && confidence >= 0.95;
  const by = lift === null ? '' : ` by ${Math.round(lift * 100)}%`;
  let note: string;
  if (p1 === p2) note = 'No difference between the variants yet.';
  else if (small) {
    note = `${label(leader)} is ahead${by}, but fewer than ${MIN_SAMPLE} people have seen each variant, so it is too early to call.`;
  } else if (significant) {
    note = `${label(leader)} converts better than ${label(runnerUp)}${by}, with ${Math.floor(confidence * 100)}% confidence.`;
  } else {
    note = `${label(leader)} is ahead${by}, but the difference could still be chance (${Math.floor(confidence * 100)}% confidence; 95% is the usual bar).`;
  }
  return { leader: leader.variant, lift, confidence, significant, note };
}

/** 1 minus the two-sided p-value of a pooled two-proportion z-test. */
export function zTestConfidence(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  const z = Math.abs(x1 / n1 - x2 / n2) / se;
  return 1 - 2 * (1 - normalCdf(z));
}

/** The standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf =
    1 -
    t *
      (0.254829592 +
        t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
