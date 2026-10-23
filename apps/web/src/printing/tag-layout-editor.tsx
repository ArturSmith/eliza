import { useEffect, useCallback, useRef, useState, type PointerEvent } from 'react';
import { t, useLanguage } from '../i18n';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { renderLayoutView, type LabelContent } from './label-image';
import {
  defaultLabelLayout,
  fitLayoutElement,
  labelLayoutSchema,
  layoutElements,
  layoutSize,
  overlappingLayout,
  rotateLayout,
  type LabelLayout,
  type LayoutElement,
  type LayoutElementId,
} from './tag-layout';

export function useStoredLabelLayout(key: string | null) {
  const [saved, setSaved] = useState<{ key: string | null; layout: LabelLayout | null }>({
    key: null,
    layout: null,
  });
  useEffect(() => {
    let layout: LabelLayout | null = null;
    try {
      const parsed = labelLayoutSchema.safeParse(
        JSON.parse(localStorage.getItem(key ?? '') ?? 'null'),
      );
      if (parsed.success) layout = parsed.data;
    } catch {
      /* Ignore invalid or unavailable storage. */
    }
    setSaved({ key, layout });
  }, [key]);
  function save(layout: LabelLayout | null) {
    if (!key) throw new Error(t('Label layout is not ready.'));
    if (layout) localStorage.setItem(key, JSON.stringify(labelLayoutSchema.parse(layout)));
    else localStorage.removeItem(key);
    setSaved({ key, layout });
  }
  return { layout: saved.key === key ? saved.layout : null, save };
}
const names: Record<LayoutElementId, () => string> = {
  store: () => t('Store name'),
  name: () => t('Product name'),
  price: () => t('Price'),
  details: () => t('Label details'),
  barcode: () => t('Barcode'),
};
export function TagLayoutEditor({
  layout,
  onSave,
  preview,
  disabled,
  storeName,
}: {
  layout: LabelLayout | null;
  onSave: (layout: LabelLayout | null) => void;
  preview: LabelContent;
  disabled: boolean;
  storeName: string;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LabelLayout>(() => defaultLabelLayout());
  const [selected, setSelected] = useState<LayoutElementId>('name');
  const [error, setError] = useState('');
  const stage = useRef<HTMLDivElement>(null),
    artwork = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: LayoutElementId;
    pointer: number;
    x: number;
    y: number;
    box: LayoutElement;
  } | null>(null);
  const size = layoutSize(draft.orientation),
    box = draft.elements[selected];
  function update(id: LayoutElementId, patch: Partial<LayoutElement>) {
    setDraft((before) => ({
      ...before,
      elements: {
        ...before.elements,
        [id]: fitLayoutElement({ ...before.elements[id], ...patch }, before.orientation),
      },
    }));
  }
  const mountArtwork = useCallback(
    (node: HTMLDivElement | null) => {
      artwork.current = node;
      if (!node) return;
      try {
        node.replaceChildren(
          renderLayoutView({ ...preview, store: preview.store ?? storeName }, draft),
        );
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : t('Label preview is unavailable.'));
      }
    },
    [draft, preview, storeName],
  );

  function start(event: PointerEvent<HTMLButtonElement>, id: LayoutElementId) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    setSelected(id);
    drag.current = {
      id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      box: draft.elements[id],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const origin = drag.current,
      rect = stage.current?.getBoundingClientRect();
    if (!origin || origin.pointer !== event.pointerId || !rect) return;
    update(origin.id, {
      x: origin.box.x + ((event.clientX - origin.x) * size.width) / rect.width,
      y: origin.box.y + ((event.clientY - origin.y) * size.height) / rect.height,
    });
  }
  function save() {
    try {
      renderLayoutView({ ...preview, store: preview.store ?? storeName }, draft);
      onSave(labelLayoutSchema.parse(draft));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save the label layout.'));
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setDraft(layout ?? defaultLabelLayout());
          setSelected('name');
          setError('');
          setOpen(true);
        }}
      >
        {t('Edit label layout')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Label layout')}
        description={t(
          'Drag objects or set their horizontal and vertical positions in millimetres. This 50 × 60 mm layout is saved on this device.',
        )}
        wide
      >
        <div className="tag-layout-editor">
          <div className="tag-layout-workspace">
            <label>
              {t('Label orientation')}
              <select
                value={draft.orientation}
                onChange={(event) =>
                  setDraft(rotateLayout(draft, event.target.value as LabelLayout['orientation']))
                }
              >
                <option value="portrait">{t('Portrait')}</option>
                <option value="landscape">{t('Landscape')}</option>
              </select>
            </label>
            <div
              className="tag-layout-stage"
              ref={stage}
              style={{ aspectRatio: `${size.width} / ${size.height}` }}
              aria-label={t('Label layout preview')}
            >
              <div className="tag-layout-artwork" ref={mountArtwork} />
              {layoutElements
                .filter((id) => draft.elements[id].visible)
                .map((id) => {
                  const e = draft.elements[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      className={'tag-layout-object' + (selected === id ? ' selected' : '')}
                      aria-label={t('Move {object}', { object: names[id]() })}
                      aria-pressed={selected === id}
                      style={{
                        left: `${(e.x / size.width) * 100}%`,
                        top: `${(e.y / size.height) * 100}%`,
                        width: `${(e.width / size.width) * 100}%`,
                        height: `${(e.height / size.height) * 100}%`,
                      }}
                      onClick={() => setSelected(id)}
                      onPointerDown={(event) => start(event, id)}
                      onPointerMove={move}
                      onPointerUp={() => {
                        drag.current = null;
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                      }}
                      onKeyDown={(event) => {
                        const arrows: Record<string, [number, number]> = {
                          ArrowLeft: [-1, 0],
                          ArrowRight: [1, 0],
                          ArrowUp: [0, -1],
                          ArrowDown: [0, 1],
                        };
                        const direction = arrows[event.key];
                        if (!direction) return;
                        event.preventDefault();
                        const step = event.shiftKey ? 8 : 1;
                        update(id, { x: e.x + direction[0] * step, y: e.y + direction[1] * step });
                      }}
                    >
                      <span>{names[id]()}</span>
                    </button>
                  );
                })}
            </div>
            <p className="muted">
              {t(
                'The paper stays 50 × 60 mm. Landscape content is rotated for printing; barcode bars are not stretched.',
              )}
            </p>
          </div>
          <div className="tag-layout-properties">
            <label>
              {t('Selected object')}
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value as LayoutElementId)}
              >
                {layoutElements.map((id) => (
                  <option key={id} value={id}>
                    {names[id]()}
                  </option>
                ))}
              </select>
            </label>
            <div className="tag-layout-coordinates">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <label key={key}>
                  {key === 'x'
                    ? t('Horizontal position (mm)')
                    : key === 'y'
                      ? t('Vertical position (mm)')
                      : key === 'width'
                        ? t('Object width (mm)')
                        : t('Object height (mm)')}
                  <input
                    type="number"
                    min={key === 'x' || key === 'y' ? 0 : 2}
                    max={key === 'x' || key === 'width' ? size.width / 8 : size.height / 8}
                    step="0.125"
                    value={box[key] / 8}
                    onChange={(event) => {
                      if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber))
                        update(selected, { [key]: event.target.valueAsNumber * 8 });
                    }}
                  />
                </label>
              ))}
            </div>
            {selected !== 'barcode' && (
              <>
                <label>
                  {t('Text size (pt)')}
                  <input
                    type="number"
                    min="4.5"
                    max="22.5"
                    step="0.5"
                    value={Math.round(((box.fontSize * 72) / 203) * 10) / 10}
                    onChange={(event) => {
                      if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber))
                        update(selected, {
                          fontSize: Math.max(
                            12,
                            Math.min(64, Math.round((event.target.valueAsNumber * 203) / 72)),
                          ),
                        });
                    }}
                  />
                </label>
                <label>
                  {t('Text alignment')}
                  <select
                    value={box.align}
                    onChange={(event) =>
                      update(selected, { align: event.target.value as LayoutElement['align'] })
                    }
                  >
                    <option value="left">{t('Left')}</option>
                    <option value="center">{t('Center')}</option>
                    <option value="right">{t('Right')}</option>
                  </select>
                </label>
                <label className="tag-layout-visibility">
                  <input
                    type="checkbox"
                    checked={box.visible}
                    onChange={(event) => update(selected, { visible: event.target.checked })}
                  />
                  {t('Show object')}
                </label>
              </>
            )}
            {selected === 'barcode' && (
              <small className="muted">
                {t(
                  'The barcode stays visible and keeps its original dot width so it remains scannable.',
                )}
              </small>
            )}
            {overlappingLayout(draft) && (
              <p role="status" className="muted">
                {t('Some objects overlap. Check their positions before saving.')}
              </p>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="tag-layout-actions">
              <Button disabled={!!error} onClick={save}>
                {t('Save layout')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDraft(defaultLabelLayout(draft.orientation))}
              >
                {t('Reset positions')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  try {
                    onSave(null);
                    setOpen(false);
                  } catch {
                    setError(t('Could not save the label layout.'));
                  }
                }}
              >
                {t('Use default layouts')}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
