import type { Locator } from '@playwright/test';

/** Check the rendered label against its control fill, including inherited colors. */
export async function controlContrast(control: Locator): Promise<number> {
  return control.evaluate((element) => {
    const style = getComputedStyle(element);
    const luminance = (color: string) =>
      color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map((channel) => Number(channel) * (color.startsWith('color(srgb ') ? 255 : 1))
        .reduce((sum, value, index) => {
          const n = value / 255;
          return (
            sum +
            (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4) *
              [0.2126, 0.7152, 0.0722][index]!
          );
        }, 0);
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}
