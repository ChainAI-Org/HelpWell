type Point = { x: number; y: number };
type Tool = 'view' | 'pen' | 'arrow' | 'rectangle' | 'text';
interface Mark {
  tool: Exclude<Tool, 'view'>;
  points: Point[];
  color: string;
  width: number;
  text: string;
}

/**
 * Shared image inspection and annotation. The caller supplies its normal upload, so
 * private inbox attachments and public article images keep their own access rules.
 * Keep this function self-contained: the dashboard serves its compiled source as a
 * separate CSP-safe script; a host can import the same function into its own bundle.
 */
export function openImageEditor(input: {
  src: string;
  name: string;
  attach?: (file: File) => Promise<void>;
  toast: (message: string, error?: boolean) => void;
  saveLabel?: string;
  draftHint?: string;
  savedMessage?: string;
  onEdit?: () => void;
  onClose?: () => void;
}): void {
  const e = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
  document.querySelector<HTMLDialogElement>('#ibx-lightbox')?.close();
  const dialog = document.createElement('dialog');
  dialog.id = 'ibx-lightbox';
  dialog.className = 'ibx-lightbox';
  dialog.setAttribute('aria-label', `Image: ${input.name}`);
  const editable = Boolean(input.attach);
  dialog.innerHTML = `<header class="ibx-media-head"><div><strong>${e(input.name)}</strong><span>Original attachment</span></div><a href="${e(input.src)}" download="${e(input.name)}">Download original</a><button type="button" data-media="close" aria-label="Close image">Close</button></header>
    <div class="ibx-media-tools" aria-label="Image tools"><button type="button" data-media="fit">Fit</button><button type="button" data-media="out" aria-label="Zoom out">−</button><output aria-label="Zoom">100%</output><button type="button" data-media="in" aria-label="Zoom in">+</button>${editable ? `<span class="ibx-media-divider"></span><label>Tool <select aria-label="Annotation tool"><option value="view">Pan</option><option value="arrow">Arrow</option><option value="rectangle">Rectangle</option><option value="pen">Pen</option><option value="text">Text</option></select></label><label>Color <input type="color" aria-label="Annotation color" value="#7a3beb"></label><label>Width <select aria-label="Annotation width"><option value="3">Thin</option><option value="5" selected>Medium</option><option value="9">Thick</option></select></label><button type="button" data-media="undo" disabled>Undo</button><button type="button" data-media="redo" disabled>Redo</button>` : ''}</div>
    ${editable ? '<label class="ibx-media-text" hidden>Annotation text <input type="text" maxlength="160" aria-label="Annotation text" placeholder="Type a label, then click the image"></label>' : ''}
    <div class="ibx-media-viewport" tabindex="0" aria-label="Image preview"><div class="ibx-media-stage"><img alt="${e(input.name)}"><canvas hidden aria-label="Annotatable image"></canvas></div></div>
    <footer class="ibx-media-footer"><span role="status">Loading image…</span>${editable ? `<button type="button" class="primary" data-media="save" disabled>${e(input.saveLabel ?? 'Add annotated copy to draft')}</button>` : ''}</footer>`;
  document.body.append(dialog);
  const viewport = dialog.querySelector<HTMLElement>('.ibx-media-viewport')!;
  const image = dialog.querySelector<HTMLImageElement>('img')!;
  const canvas = dialog.querySelector<HTMLCanvasElement>('canvas')!;
  const status = dialog.querySelector<HTMLElement>('[role="status"]')!;
  const button = (name: string) =>
    dialog.querySelector<HTMLButtonElement>(`[data-media="${name}"]`);
  let context: CanvasRenderingContext2D | null = null;
  const marks: Mark[] = [];
  let redo: Mark[] = [];
  let active: Mark | null = null;
  let pan: { x: number; y: number; left: number; top: number } | null = null;
  let pointerId: number | null = null;
  let scale = 1;
  let ready = false;
  let saving = false;
  let failure: string | null = null;
  let closed = false;
  const tool = () =>
    (dialog.querySelector<HTMLSelectElement>('[aria-label="Annotation tool"]')?.value ??
      'view') as Tool;

  function controls() {
    if (button('undo')) button('undo')!.disabled = saving || !marks.length;
    if (button('redo')) button('redo')!.disabled = saving || !redo.length;
    if (button('save')) button('save')!.disabled = saving || !marks.length || !ready;
    status.textContent = saving
      ? 'Uploading annotated copy…'
      : failure
        ? failure
        : !context && ready && editable
          ? 'This image is too large to annotate. You can still zoom and download it.'
          : marks.length
            ? `${marks.length} annotation${marks.length === 1 ? '' : 's'} · Original preserved · Copy stays in your draft`
            : editable
              ? (input.draftHint ??
                'Choose a tool to annotate. Nothing is sent until you send the draft.')
              : 'Use zoom to inspect the attachment.';
  }

  function paint(mark: Mark) {
    const ctx = context!;
    const start = mark.points[0]!;
    const end = mark.points.at(-1)!;
    ctx.strokeStyle = mark.color;
    ctx.fillStyle = mark.color;
    ctx.lineWidth = mark.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (mark.tool === 'text') {
      ctx.font = `600 ${Math.max(16, mark.width * 5)}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(mark.text, start.x, start.y);
    } else if (mark.tool === 'rectangle') {
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else {
      ctx.moveTo(start.x, start.y);
      for (const p of mark.points.slice(1)) ctx.lineTo(p.x, p.y);
      if (mark.points.length === 1) ctx.lineTo(start.x + 0.01, start.y);
      ctx.stroke();
      if (mark.tool === 'arrow') {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const length = mark.width * 5;
        ctx.beginPath();
        ctx.moveTo(
          end.x - length * Math.cos(angle - Math.PI / 6),
          end.y - length * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(end.x, end.y);
        ctx.lineTo(
          end.x - length * Math.cos(angle + Math.PI / 6),
          end.y - length * Math.sin(angle + Math.PI / 6),
        );
        ctx.stroke();
      }
    }
  }

  function draw() {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    for (const mark of marks) paint(mark);
    if (active) paint(active);
  }

  function zoom(next: number) {
    if (!ready) return;
    scale = Math.min(8, Math.max(0.025, next));
    const surface = context ? canvas : image;
    surface.style.width = `${image.naturalWidth * scale}px`;
    surface.style.height = `${image.naturalHeight * scale}px`;
    dialog.querySelector('output')!.textContent = `${Math.round(scale * 100)}%`;
  }
  function fitImage() {
    zoom(
      Math.min(
        1,
        (viewport.clientWidth - 48) / image.naturalWidth,
        (viewport.clientHeight - 48) / image.naturalHeight,
      ),
    );
  }
  function point(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) / scale)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) / scale)),
    };
  }
  function history(action: 'undo' | 'redo') {
    if (saving || active) return;
    if (action === 'undo' && marks.length) redo.push(marks.pop()!);
    if (action === 'redo' && redo.length) marks.push(redo.pop()!);
    draw();
    controls();
  }

  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !ready || saving) return;
    const selectedTool = tool();
    if (selectedTool === 'view' || !context) {
      pan = {
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
    } else {
      if (event.target !== canvas) return;
      const text = dialog
        .querySelector<HTMLInputElement>('[aria-label="Annotation text"]')!
        .value.trim();
      if (selectedTool === 'text' && !text) {
        dialog.querySelector<HTMLInputElement>('[aria-label="Annotation text"]')!.focus();
        return;
      }
      active = {
        tool: selectedTool,
        points: [point(event)],
        text,
        color: dialog.querySelector<HTMLInputElement>('[aria-label="Annotation color"]')!.value,
        width:
          Number(
            dialog.querySelector<HTMLSelectElement>('[aria-label="Annotation width"]')!.value,
          ) / scale,
      };
      draw();
    }
    pointerId = event.pointerId;
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  viewport.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    if (pan) {
      viewport.scrollLeft = pan.left - (event.clientX - pan.x);
      viewport.scrollTop = pan.top - (event.clientY - pan.y);
    } else if (active) {
      const next = point(event);
      if (active.tool === 'pen') active.points.push(next);
      else if (active.tool !== 'text') active.points[1] = next;
      draw();
    }
  });
  function finish(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    if (active && event.type !== 'pointercancel') {
      marks.push(active);
      failure = null;
      input.onEdit?.();
      redo = [];
    }
    active = null;
    pan = null;
    pointerId = null;
    draw();
    controls();
  }
  viewport.addEventListener('pointerup', finish);
  viewport.addEventListener('pointercancel', finish);
  dialog.querySelector('[aria-label="Annotation tool"]')?.addEventListener('change', () => {
    dialog.querySelector<HTMLElement>('.ibx-media-text')!.hidden = tool() !== 'text';
    viewport.classList.toggle('is-drawing', tool() !== 'view');
  });
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && !(event.target as HTMLElement).closest('input')) {
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
        event.preventDefault();
        history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
      }
    }
  });
  dialog.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-media]')?.dataset
      .media;
    if (action === 'close' && !saving) dialog.close();
    else if (action === 'fit') fitImage();
    else if (action === 'in') zoom(scale * 1.3);
    else if (action === 'out') zoom(scale / 1.3);
    else if (action === 'undo' || action === 'redo') history(action);
    else if (action === 'save') void save();
  });
  async function save() {
    if (!ready || !context || !input.attach || saving || !marks.length) return;
    saving = true;
    failure = null;
    controls();
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error('The image could not be exported.')),
          'image/png',
        ),
      );
      if (closed) return;
      const name = `${input.name.replace(/\.[^.]+$/, '').slice(0, 150) || 'screenshot'}-annotated.png`;
      await input.attach(new File([blob], name, { type: 'image/png' }));
      if (!closed) {
        input.toast(input.savedMessage ?? 'Annotated copy added to your draft.');
        dialog.close();
      }
    } catch (error) {
      if (!closed) {
        failure = (error as Error).message || 'The annotated copy could not be added.';
        input.toast(failure, true);
      }
    } finally {
      saving = false;
      if (!closed) controls();
    }
  }
  const onNavigate = () => dialog.close();
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener(
    'close',
    () => {
      closed = true;
      window.removeEventListener('hashchange', onNavigate);
      window.removeEventListener('resize', fitImage);
      dialog.remove();
      canvas.width = canvas.height = 0;
      input.onClose?.();
    },
    { once: true },
  );
  window.addEventListener('hashchange', onNavigate);
  window.addEventListener('resize', fitImage);
  dialog.showModal();
  image.onload = () => {
    if (closed) return;
    // Bound canvas allocation independently of the compressed attachment's byte limit.
    if (
      editable &&
      image.naturalWidth * image.naturalHeight <= 16_000_000 &&
      Math.max(image.naturalWidth, image.naturalHeight) <= 8192
    ) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context = canvas.getContext('2d');
      if (context) {
        canvas.hidden = false;
        image.hidden = true;
        draw();
      }
    }
    ready = true;
    fitImage();
    controls();
  };
  image.onerror = () => {
    status.textContent = 'This image could not be loaded. Close and try again.';
  };
  if (new URL(input.src, location.href).origin !== location.origin) image.crossOrigin = 'anonymous';
  image.src = input.src;
}

/** No user data is embedded in this script; each page supplies it through DOM events. */
export function imageEditorClientScript(): string {
  return `window.HelpWellImageEditor = ${openImageEditor.toString()};`;
}

export const IMAGE_EDITOR_STYLES = `dialog.ibx-lightbox{border:1px solid var(--ib-line,var(--hw-hairline,#e5e2ec))!important;padding:0;background:var(--ib-surface,var(--hw-surface,#fff))!important;color:var(--ib-ink,var(--hw-ink,#191525));width:min(1120px,94vw)!important;max-width:94vw;height:min(820px,92dvh);max-height:92dvh;box-shadow:0 32px 100px #0005;overflow:hidden;border-radius:20px}
dialog.ibx-lightbox[open]{display:flex;flex-direction:column}
.ibx-lightbox::backdrop{background:rgba(10,8,18,.78)}
.ibx-lightbox button,.ibx-lightbox a,.ibx-lightbox select{font:inherit;font-size:12px;border:1px solid var(--ib-line,var(--hw-hairline,#e5e2ec));border-radius:8px;background:var(--ib-raised,var(--hw-control,#f6f4fa));color:var(--ib-ink,var(--hw-ink,#191525));min-height:34px;padding:6px 10px;text-decoration:none;cursor:pointer}
.ibx-lightbox select{appearance:none;-webkit-appearance:none;padding-right:30px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A85A0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-size:11px}
.ibx-lightbox button:disabled{opacity:.45;cursor:default}
.ibx-lightbox button.primary{background:var(--ib-accent,var(--hw-accent,#7436dc));border-color:var(--ib-accent,var(--hw-accent,#7436dc));color:var(--ib-on-accent,var(--hw-on-accent,#fff));font-weight:600}
.ibx-lightbox button:focus-visible,.ibx-lightbox a:focus-visible,.ibx-lightbox input:focus-visible,.ibx-lightbox select:focus-visible{outline:2px solid var(--ib-accent,var(--hw-accent,#7436dc));outline-offset:2px}
.ibx-media-head{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--ib-line,var(--hw-hairline,#e5e2ec));flex-shrink:0}
.ibx-media-head>div{min-width:0;flex:1;display:grid;gap:3px}
.ibx-media-head strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14px}
.ibx-media-head span{font-size:11px;color:var(--ib-muted,var(--hw-muted,#6f697b))}
.ibx-media-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 20px;border-bottom:1px solid var(--ib-line,var(--hw-hairline,#e5e2ec));flex-shrink:0}
.ibx-media-tools label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ib-muted,var(--hw-muted,#6f697b))}
.ibx-media-tools output{font-size:12px;min-width:40px;text-align:center;font-variant-numeric:tabular-nums}
.ibx-media-tools input[type=color]{width:32px;height:32px;border:0;background:transparent;padding:0;cursor:pointer}
.ibx-media-divider{height:24px;border-left:1px solid var(--ib-line,var(--hw-hairline,#e5e2ec));margin:0 4px}
.ibx-media-text{padding:8px 20px;font-size:12px;border-bottom:1px solid var(--ib-line,var(--hw-hairline,#e5e2ec))}
.ibx-media-text input{margin-left:10px;max-width:70%;width:440px;border:1px solid var(--ib-line,var(--hw-hairline,#e5e2ec));border-radius:8px;padding:8px;background:var(--ib-raised,var(--hw-control,#f6f4fa));color:var(--ib-ink,var(--hw-ink,#191525))}
.ibx-media-viewport{flex:1;min-height:100px;overflow:auto;overscroll-behavior:contain;background:var(--ib-inner,var(--hw-inner,#f4f1f8));touch-action:none;cursor:grab}
.ibx-media-viewport.is-drawing{cursor:crosshair}
.ibx-media-stage{min-width:100%;min-height:100%;width:max-content;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.ibx-media-stage img,.ibx-media-stage canvas{flex-shrink:0;max-width:none;max-height:none;box-shadow:0 2px 20px #0002;border-radius:4px;user-select:none}
.ibx-media-stage [hidden],.ibx-lightbox [hidden]{display:none!important}
.ibx-media-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;border-top:1px solid var(--ib-line,var(--hw-hairline,#e5e2ec));flex-shrink:0}
.ibx-media-footer [role=status]{font-size:12px;color:var(--ib-muted,var(--hw-muted,#6f697b));line-height:1.5}
@media(max-width:600px){.ibx-media-head,.ibx-media-tools,.ibx-media-footer{padding:10px;gap:6px}.ibx-media-head a{max-width:90px}.ibx-media-tools label{font-size:0}.ibx-media-footer{flex-direction:column;align-items:stretch}.ibx-media-footer button{width:100%}}`;
