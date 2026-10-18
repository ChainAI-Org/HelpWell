/**
 * The Draggable placement, the way a visitor uses it: the launcher starts in
 * the bottom-right corner, goes wherever it is dragged, opens toward the
 * middle of the screen from there, and is still there on the next page load.
 */

import { expect, test } from '../fixtures';

test('a visitor drags the launcher, and it stays where they put it', async ({
  settings,
  widget,
}) => {
  await settings.patch({ widget: { position: 'draggable' } });
  const page = widget.page;
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('helpwell:launcher-spot'));
  await page.reload();

  await expect(widget.host).toHaveAttribute('data-position', 'bottom-right');
  await expect(widget.launcher).toHaveAttribute('data-draggable', 'true');
  const viewport = page.viewportSize()!;
  const start = (await widget.launcher.boundingBox())!;
  expect(start.x + start.width).toBeGreaterThan(viewport.width - 100);
  expect(start.y + start.height).toBeGreaterThan(viewport.height - 100);

  // Drag it up toward the top-left of the screen. Touch screens drag the same way.
  const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const to = { x: 80, y: 120 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();

  await expect(widget.host).toHaveAttribute('data-position', 'top-left');
  // Letting go is not a click: the panel stays closed.
  await expect(widget.panel).toHaveAttribute('data-open', 'false');
  const moved = (await widget.launcher.boundingBox())!;
  expect(Math.abs(moved.x + moved.width / 2 - to.x)).toBeLessThan(4);
  expect(Math.abs(moved.y + moved.height / 2 - to.y)).toBeLessThan(4);

  // The next page load puts it back where they left it.
  await page.reload();
  await expect(widget.host).toHaveAttribute('data-position', 'top-left');
  const again = (await widget.launcher.boundingBox())!;
  expect(Math.abs(again.x - moved.x)).toBeLessThan(2);
  expect(Math.abs(again.y - moved.y)).toBeLessThan(2);

  // A click still opens it, and the panel opens onto the screen, not off it.
  await widget.open();
  const panel = (await widget.panel.boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height + 1);
});
