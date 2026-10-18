/**
 * Media in answers and articles: what the widget adds to the renderer's
 * output, and what it must never let through. Hostile input is the point of
 * half of these, because agent answers are generated text and a human reply
 * comes from somewhere else again.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  openLightbox,
  renderRich,
  safeMediaUrl,
  trustMediaOrigin,
  wistiaPlayer,
} from '../src/media.js';

afterEach(() => {
  document.body.textContent = '';
});

/** Render into a live element, the way the views do. */
function render(source: string, inlineVideo = false): HTMLElement {
  const el = document.createElement('div');
  el.appendChild(renderRich(source, { inlineVideo }));
  document.body.appendChild(el);
  return el;
}

/** Every URL the markup would make the browser fetch on its own. */
function fetches(el: HTMLElement): string[] {
  return [...el.querySelectorAll('img, iframe, script, video, source, object, embed, link')].map(
    (node) =>
      node.getAttribute('src') ?? node.getAttribute('href') ?? node.getAttribute('data') ?? '',
  );
}

describe('sanitising', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="https://evil.example"></iframe>',
    '<svg onload=alert(1)><circle/></svg>',
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click](\u0001javascript:alert(1))',
    '![x](javascript:alert(1))',
    '![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)',
    '![a" onerror="alert(1)](https://cdn.example/a.png)',
    '![a](https://cdn.example/a.png" onerror="alert(1))',
    '<a href="javascript:alert(1)">x</a>',
    '<style>*{display:none}</style>',
    '![v](javascript:alert(1).mp4)',
    '```\n<script>alert(1)</script>\n```',
  ];

  for (const input of hostile) {
    it(`renders ${JSON.stringify(input)} inert`, () => {
      const el = render(input);
      expect(el.querySelector('script, iframe, svg[onload], style, object, embed')).toBeNull();
      for (const node of el.querySelectorAll('*')) {
        for (const attribute of node.attributes) {
          expect(attribute.name.startsWith('on'), `${node.tagName} ${attribute.name}`).toBe(false);
          expect(attribute.value.toLowerCase()).not.toMatch(/^\s*(javascript|data|vbscript):/);
        }
      }
    });
  }

  it('keeps an image from anywhere but https, or this page, from loading at all', () => {
    const el = render(
      '![a](http://tracker.example/pixel.gif) ![b](ftp://x/y.png) ![c](https://cdn.example/ok.png)',
    );
    expect(fetches(el)).toEqual(['https://cdn.example/ok.png']);
    // The words stay where the picture would have been.
    expect(el.textContent).toContain('a');
    expect(safeMediaUrl('/api/helpwell/screenshots/a.png')).toBe('/api/helpwell/screenshots/a.png');
    expect(safeMediaUrl('//evil.example/a.png')).toBeNull();
    expect(safeMediaUrl('https://ok.example/a b.png')).toBeNull();
  });

  it('takes plain http from the widget’s own API, and from no other host', () => {
    // The API's images arrive as absolute URLs; a dev API is plain http.
    const shot = 'http://api.dev.example:3000/api/helpwell/screenshots/a.png';
    expect(safeMediaUrl(shot)).toBeNull();
    trustMediaOrigin('http://api.dev.example:3000/api/helpwell');
    expect(safeMediaUrl(shot)).toBe(shot);
    expect(safeMediaUrl('http://api.dev.example:3001/a.png')).toBeNull();
    expect(safeMediaUrl('http://tracker.example/pixel.gif')).toBeNull();
    trustMediaOrigin('javascript:alert(1)');
    expect(safeMediaUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('numbered steps', () => {
  it('keeps one ordered list with each screenshot inside its step', () => {
    const el = render(
      '1. Click on your Profile\n\n![](https://cdn.example/a.jpg)\n\n2. Click on **Add Status**:\n\n![](https://cdn.example/b.jpg)\n\n3. Type in your status',
    );
    expect(el.querySelectorAll('ol')).toHaveLength(1);
    const steps = [...el.querySelectorAll('ol > li')];
    expect(steps).toHaveLength(3);
    expect(steps[0]?.querySelector('img')).not.toBeNull();
    expect(steps[1]?.querySelector('img')).not.toBeNull();
    expect(steps[2]?.querySelector('img')).toBeNull();
  });

  it('keeps the start number', () => {
    expect(render('5. Five\n6. Six').querySelector('ol')?.getAttribute('start')).toBe('5');
  });
});

describe('images', () => {
  it('load lazily, always say what they are, and GIFs are images too', () => {
    const el = render(
      '![Billing page](https://cdn.example/billing.png)\n\n![](https://cdn.example/anim.gif)',
    );
    const [first, second] = [...el.querySelectorAll('img')];
    expect(first?.getAttribute('loading')).toBe('lazy');
    expect(first?.getAttribute('alt')).toBe('Billing page');
    expect(second?.getAttribute('alt')).toBe('Image');
    expect(second?.getAttribute('src')).toBe('https://cdn.example/anim.gif');
  });

  it('open in a lightbox that Escape closes without closing the panel', () => {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.appendChild(renderRich('![Invoices](https://cdn.example/invoices.png)'));
    document.body.appendChild(panel);

    let reachedDocument = false;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reachedDocument = true;
    };
    document.addEventListener('keydown', onKey);
    try {
      const zoom = panel.querySelector<HTMLButtonElement>('.media-zoom')!;
      expect(zoom.getAttribute('aria-label')).toBe('Enlarge image: Invoices');
      zoom.click();
      const box = panel.querySelector('.lightbox');
      expect(box?.getAttribute('role')).toBe('dialog');
      expect(box?.querySelector('img')?.getAttribute('src')).toBe(
        'https://cdn.example/invoices.png',
      );
      box!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(panel.querySelector('.lightbox')).toBeNull();
      expect(reachedDocument).toBe(false);
    } finally {
      document.removeEventListener('keydown', onKey);
    }
  });

  it('opens from anywhere and puts focus back where it came from', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const box = openLightbox(trigger, 'https://cdn.example/a.png', 'A');
    expect(document.activeElement).toBe(box.querySelector('.lightbox__close'));
    box.click();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('video', () => {
  it('keeps YouTube, Vimeo and Loom as links by default, with nothing framed', () => {
    const el = render(
      '![Setup](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n\n![Tour](https://vimeo.com/123456)\n\n![Walkthrough](https://www.loom.com/share/0123456789abcdef0123456789abcdef)',
    );
    expect(el.querySelectorAll('p.hc-video-link a')).toHaveLength(3);
    expect(fetches(el)).toEqual([]);
  });

  it('plays inline only after a click, from YouTube’s no-cookie domain', () => {
    const el = render('![Setup](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90)', true);
    // Before the click: no iframe, no image, nothing from the provider.
    expect(fetches(el)).toEqual([]);
    const play = el.querySelector<HTMLButtonElement>('.hw-video__play')!;
    expect(play.getAttribute('aria-label')).toBe('Play video: Setup');
    play.click();
    const src = el.querySelector('iframe')?.getAttribute('src') ?? '';
    expect(new URL(src).origin).toBe('https://www.youtube-nocookie.com');
    expect(src).toContain('/embed/dQw4w9WgXcQ');
    expect(src).toContain('start=90');
    expect(src).toContain('autoplay=1');
  });

  it('knows Wistia, and never lets its URL load as an image', () => {
    const card = render('![Demo](https://acme.wistia.com/medias/abcde12345)');
    expect(fetches(card)).toEqual([]);
    expect(card.querySelector('p.hc-video-link a')?.getAttribute('href')).toBe(
      'https://fast.wistia.net/embed/iframe/abcde12345',
    );
    expect(card.textContent).toContain('Wistia');

    const inline = render('![Demo](https://fast.wistia.net/embed/iframe/abcde12345)', true);
    expect(fetches(inline)).toEqual([]);
    inline.querySelector<HTMLButtonElement>('.hw-video__play')!.click();
    expect(inline.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://fast.wistia.net/embed/iframe/abcde12345?autoPlay=true',
    );
  });

  it('builds the player from the id alone', () => {
    expect(wistiaPlayer('https://acme.wistia.com/medias/abcde12345?x="><script>')).toEqual({
      provider: 'wistia',
      src: 'https://fast.wistia.net/embed/iframe/abcde12345',
      url: 'https://fast.wistia.net/embed/iframe/abcde12345',
    });
    expect(wistiaPlayer('https://acme.wistia.com/medias/short')).toBeNull();
    expect(wistiaPlayer('http://acme.wistia.com/medias/abcde12345')).toBeNull();
    expect(wistiaPlayer('https://wistia.com.evil.example/medias/abcde12345')).toBeNull();
  });

  it('plays a video file in place, with no autoplay', () => {
    const el = render('![Clip](https://cdn.example/clip.mp4)');
    const video = el.querySelector('video');
    expect(video?.getAttribute('src')).toBe('https://cdn.example/clip.mp4');
    expect(video?.hasAttribute('autoplay')).toBe(false);
    expect(video?.getAttribute('preload')).toBe('metadata');
  });
});
