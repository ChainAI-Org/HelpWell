/**
 * Drawing on a screenshot before it is taken (SS-04, SS-05).
 *
 * Annotations are data in the capture config, anchored to CSS selectors
 * rather than pixels, so they survive a re-capture: when the button moves,
 * the box moves with it. Steps number themselves in the order they are
 * listed unless given a number, so moving one renumbers the rest.
 *
 * They are drawn by injecting an overlay into the page itself just before
 * the shot, in light and dark alike, which means the browser does the layout
 * and the image needs no post-processing. A target that matches nothing, or
 * matches something with no size, is skipped and reported, never drawn
 * somewhere else.
 */

export type AnnotationType = 'rect' | 'ellipse' | 'arrow' | 'step' | 'label' | 'spotlight' | 'blur';

export const ANNOTATION_TYPES: readonly AnnotationType[] = [
  'rect',
  'ellipse',
  'arrow',
  'step',
  'label',
  'spotlight',
  'blur',
];

export type Direction = 'up' | 'down' | 'left' | 'right';

/** One thing to draw, as it is written under `annotate` in the config. */
export interface Annotation {
  type: AnnotationType;
  /** CSS selector for what it points at. The first match is used. */
  target: string;
  /** A label's text; for an arrow, a caption at its tail. */
  text?: string;
  /** A hex colour. Defaults to the widget accent. */
  color?: string;
  /** A step marker's number. Defaults to its place among the steps. */
  step?: number;
  /**
   * An arrow: the way it points, at the target. `down` (the default) sits
   * above the target pointing down at it. A label: the side of the target it
   * sits on, `bottom` by default.
   */
  direction?: Direction;
  /** Nudge it, in CSS pixels. */
  offset?: { x?: number; y?: number };
  /** Space between the target and a box, ellipse, spotlight or blur. */
  padding?: number;
  /** An arrow's length in CSS pixels. 72 by default. */
  length?: number;
}

/** What `drawAnnotations` is handed: everything resolved, nothing left to default. */
export interface DrawnAnnotation extends Annotation {
  color: string;
  /** Set on a global blur rule: a page without that field is not a problem. */
  optional?: boolean;
}

export interface AnnotationPayload {
  items: DrawnAnnotation[];
  scheme: 'light' | 'dark';
}

export interface MissedAnnotation {
  index: number;
  type: AnnotationType;
  target: string;
  reason: 'not-found' | 'not-visible' | 'bad-selector';
  optional: boolean;
}

export interface AnnotationOutcome {
  drawn: number;
  missing: MissedAnnotation[];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

/**
 * The `annotate` list from the config, with anything malformed reported
 * rather than silently drawn wrong. Returns what is usable and what is not.
 */
export function readAnnotations(raw: unknown): { items: Annotation[]; problems: string[] } {
  const items: Annotation[] = [];
  const problems: string[] = [];
  if (raw === undefined) return { items, problems };
  if (!Array.isArray(raw)) return { items, problems: ['annotate must be a list'] };

  raw.forEach((entry, i) => {
    const where = `annotate[${i}]`;
    if (!entry || typeof entry !== 'object') {
      problems.push(`${where} is not an object`);
      return;
    }
    const item = entry as Record<string, unknown>;
    const type = item.type;
    if (typeof type !== 'string' || !(ANNOTATION_TYPES as readonly string[]).includes(type)) {
      problems.push(`${where} has no known type (use ${ANNOTATION_TYPES.join(', ')})`);
      return;
    }
    if (typeof item.target !== 'string' || !item.target.trim()) {
      problems.push(`${where} (${type}) needs a target selector`);
      return;
    }
    if (type === 'label' && (typeof item.text !== 'string' || !item.text.trim())) {
      problems.push(`${where} (label) needs text`);
      return;
    }

    const annotation: Annotation = { type: type as AnnotationType, target: item.target.trim() };
    if (typeof item.text === 'string' && item.text.trim()) annotation.text = item.text.trim();
    if (typeof item.color === 'string') {
      if (HEX.test(item.color.trim())) annotation.color = item.color.trim();
      else
        problems.push(
          `${where} colour ${JSON.stringify(item.color)} is not a hex colour; using the default`,
        );
    }
    if (typeof item.step === 'number' && Number.isInteger(item.step) && item.step > 0) {
      annotation.step = item.step;
    }
    if (typeof item.direction === 'string') {
      const direction = normaliseDirection(item.direction);
      if (direction) annotation.direction = direction;
      else problems.push(`${where} direction must be up, down, left or right`);
    }
    if (item.offset && typeof item.offset === 'object') {
      const offset = item.offset as Record<string, unknown>;
      annotation.offset = {
        x: finite(offset.x) ?? 0,
        y: finite(offset.y) ?? 0,
      };
    }
    const padding = finite(item.padding);
    if (padding !== null) annotation.padding = Math.max(0, Math.min(80, padding));
    const length = finite(item.length);
    if (length !== null) annotation.length = Math.max(16, Math.min(400, length));
    items.push(annotation);
  });

  return { items, problems };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `top` and `bottom` read naturally for a label; they mean `up` and `down`. */
function normaliseDirection(value: string): Direction | null {
  const lower = value.toLowerCase();
  if (lower === 'top') return 'up';
  if (lower === 'bottom') return 'down';
  return (DIRECTIONS as readonly string[]).includes(lower) ? (lower as Direction) : null;
}

/**
 * Fill in colours and step numbers. Steps without a number count up in the
 * order they are listed; one with a number keeps it.
 */
export function prepareAnnotations(
  items: Annotation[],
  options: { accent: string; blur?: string[] },
): DrawnAnnotation[] {
  const accent = HEX.test(options.accent) ? options.accent : '#7A3BEB';
  let steps = 0;
  const own = items.map((item): DrawnAnnotation => {
    const drawn: DrawnAnnotation = { ...item, color: item.color ?? accent };
    if (item.type === 'step') {
      steps++;
      drawn.step = item.step ?? steps;
    }
    return drawn;
  });
  // Blur rules for every shot go first, so an annotation is never blurred.
  const blurs = (options.blur ?? []).map(
    (target): DrawnAnnotation => ({ type: 'blur', target, color: accent, optional: true }),
  );
  return [...blurs, ...own];
}

/**
 * Runs inside the page, through Playwright's `page.evaluate`, so it must be
 * entirely self-contained: no imports, nothing from this module's scope,
 * nothing a bundler would add a helper for. The tests run it through
 * `toString()` to prove that.
 */
export function drawAnnotations(payload: AnnotationPayload): AnnotationOutcome {
  const OVERLAY = 'helpwell-annotations';
  const SVG = 'http://www.w3.org/2000/svg';
  document.getElementById(OVERLAY)?.remove();

  const doc = document.documentElement;
  const body = document.body;
  const width = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0, window.innerWidth);
  const height = Math.max(doc.scrollHeight, body ? body.scrollHeight : 0, window.innerHeight);
  const dark = payload.scheme === 'dark';

  const root = document.createElement('div');
  root.id = OVERLAY;
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;pointer-events:none;z-index:2147483647;margin:0;padding:0;border:0;`;

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible');
  root.appendChild(svg);

  const shape = (name: string, attributes: Record<string, string | number>): Element => {
    const node = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    svg.appendChild(node);
    return node;
  };

  const box = (css: string): HTMLDivElement => {
    const node = document.createElement('div');
    node.style.cssText = `position:absolute;box-sizing:border-box;${css}`;
    root.appendChild(node);
    return node;
  };

  const font =
    'font:600 14px/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;';
  const holes: { x: number; y: number; w: number; h: number }[] = [];
  const missing: MissedAnnotation[] = [];
  let drawn = 0;

  payload.items.forEach((item, index) => {
    const miss = (reason: MissedAnnotation['reason']) =>
      missing.push({
        index,
        type: item.type,
        target: item.target,
        reason,
        optional: !!item.optional,
      });

    let element: Element | null = null;
    try {
      element = document.querySelector(item.target);
    } catch {
      miss('bad-selector');
      return;
    }
    if (!element) {
      miss('not-found');
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      miss('not-visible');
      return;
    }

    const dx = item.offset?.x ?? 0;
    const dy = item.offset?.y ?? 0;
    const x = rect.left + window.scrollX + dx;
    const y = rect.top + window.scrollY + dy;
    const w = rect.width;
    const h = rect.height;
    const pad = item.padding ?? (item.type === 'blur' ? 2 : 6);
    const color = item.color;

    if (item.type === 'rect') {
      shape('rect', {
        x: x - pad,
        y: y - pad,
        width: w + pad * 2,
        height: h + pad * 2,
        rx: 10,
        fill: 'none',
        stroke: color,
        'stroke-width': 3,
      });
    } else if (item.type === 'ellipse') {
      shape('ellipse', {
        cx: x + w / 2,
        cy: y + h / 2,
        rx: w / 2 + pad * 1.6,
        ry: h / 2 + pad * 1.6,
        fill: 'none',
        stroke: color,
        'stroke-width': 3,
      });
    } else if (item.type === 'spotlight') {
      holes.push({ x: x - pad, y: y - pad, w: w + pad * 2, h: h + pad * 2 });
    } else if (item.type === 'blur') {
      box(
        `left:${x - pad}px;top:${y - pad}px;width:${w + pad * 2}px;height:${h + pad * 2}px;border-radius:6px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);background:${dark ? 'rgba(30,30,34,.45)' : 'rgba(240,240,244,.45)'};`,
      );
    } else if (item.type === 'step') {
      const marker = box(
        `left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:${color};color:#fff;${font}box-shadow:0 0 0 3px ${dark ? '#151517' : '#fff'},0 2px 8px rgba(0,0,0,.25);`,
      );
      marker.textContent = String(item.step ?? index + 1);
    } else if (item.type === 'label') {
      const side = item.direction ?? 'down';
      const gap = 10;
      const place =
        side === 'up'
          ? `left:${x + w / 2}px;top:${y - gap}px;transform:translate(-50%,-100%);`
          : side === 'left'
            ? `left:${x - gap}px;top:${y + h / 2}px;transform:translate(-100%,-50%);`
            : side === 'right'
              ? `left:${x + w + gap}px;top:${y + h / 2}px;transform:translateY(-50%);`
              : `left:${x + w / 2}px;top:${y + h + gap}px;transform:translateX(-50%);`;
      const label = box(
        `${place}max-width:280px;padding:6px 10px;border-radius:8px;background:${color};color:#fff;${font}white-space:normal;box-shadow:0 2px 10px rgba(0,0,0,.2);`,
      );
      label.textContent = item.text ?? '';
    } else if (item.type === 'arrow') {
      const direction = item.direction ?? 'down';
      const length = item.length ?? 72;
      const cx = x + w / 2;
      const cy = y + h / 2;
      // The tip stops just short of the target, on the side the arrow comes from.
      const tip =
        direction === 'down'
          ? { x: cx, y: y - 6 }
          : direction === 'up'
            ? { x: cx, y: y + h + 6 }
            : direction === 'left'
              ? { x: x + w + 6, y: cy }
              : { x: x - 6, y: cy };
      const unit =
        direction === 'down'
          ? { x: 0, y: -1 }
          : direction === 'up'
            ? { x: 0, y: 1 }
            : direction === 'left'
              ? { x: 1, y: 0 }
              : { x: -1, y: 0 };
      const tail = { x: tip.x + unit.x * length, y: tip.y + unit.y * length };
      // A gentle curve reads as hand-drawn; a ruler-straight line reads as UI.
      const bend = { x: -unit.y * length * 0.22, y: unit.x * length * 0.22 };
      const control = {
        x: (tip.x + tail.x) / 2 + bend.x,
        y: (tip.y + tail.y) / 2 + bend.y,
      };
      shape('path', {
        d: `M${tail.x} ${tail.y} Q${control.x} ${control.y} ${tip.x} ${tip.y}`,
        fill: 'none',
        stroke: color,
        'stroke-width': 4,
        'stroke-linecap': 'round',
      });
      // The head follows the curve's last direction, control point to tip.
      const angle = Math.atan2(tip.y - control.y, tip.x - control.x);
      const size = 14;
      const left = {
        x: tip.x - size * Math.cos(angle - Math.PI / 6),
        y: tip.y - size * Math.sin(angle - Math.PI / 6),
      };
      const right = {
        x: tip.x - size * Math.cos(angle + Math.PI / 6),
        y: tip.y - size * Math.sin(angle + Math.PI / 6),
      };
      shape('path', {
        d: `M${left.x} ${left.y} L${tip.x} ${tip.y} L${right.x} ${right.y} Z`,
        fill: color,
        stroke: color,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
      });
      if (item.text) {
        const caption = box(
          `left:${tail.x}px;top:${tail.y}px;transform:translate(${unit.x > 0 ? '0' : unit.x < 0 ? '-100%' : '-50%'},${unit.y > 0 ? '0' : unit.y < 0 ? '-100%' : '-50%'});max-width:240px;padding:5px 9px;border-radius:8px;background:${color};color:#fff;${font}`,
        );
        caption.textContent = item.text;
      }
    }
    drawn++;
  });

  if (holes.length > 0) {
    // One path over the whole page with a hole per target, filled even-odd,
    // so everything but the targets is dimmed.
    const rounded = (hole: { x: number; y: number; w: number; h: number }) => {
      const r = Math.min(10, hole.w / 2, hole.h / 2);
      return `M${hole.x + r} ${hole.y}H${hole.x + hole.w - r}Q${hole.x + hole.w} ${hole.y} ${hole.x + hole.w} ${hole.y + r}V${hole.y + hole.h - r}Q${hole.x + hole.w} ${hole.y + hole.h} ${hole.x + hole.w - r} ${hole.y + hole.h}H${hole.x + r}Q${hole.x} ${hole.y + hole.h} ${hole.x} ${hole.y + hole.h - r}V${hole.y + r}Q${hole.x} ${hole.y} ${hole.x + r} ${hole.y}Z`;
    };
    const dim = document.createElementNS(SVG, 'path');
    dim.setAttribute('d', `M0 0H${width}V${height}H0Z${holes.map(rounded).join('')}`);
    dim.setAttribute('fill', dark ? 'rgba(0,0,0,.62)' : 'rgba(23,20,37,.5)');
    dim.setAttribute('fill-rule', 'evenodd');
    dim.setAttribute('data-kind', 'spotlight');
    // Under every other shape, so a box around the spotlit target stays bright.
    svg.insertBefore(dim, svg.firstChild);
  }

  // The root element, not <body>: a positioned body would offset every shape
  // by its margin.
  doc.appendChild(root);
  return { drawn, missing };
}
