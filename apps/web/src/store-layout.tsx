import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { Copy, RotateCw, Trash2, Undo2, Redo2, Save, Plus } from 'lucide-react';
import {
  validPlacement,
  storeLayoutSchema,
  type LayoutObject,
  type StoreLayout,
} from '@eliza/contracts';
import { api, useSession } from './api';
import { t, useLanguage } from './i18n';
import { Button } from './components/ui/button';
import { ErrorMessage, Field } from './forms';
import { StoreLayoutScene } from './store-layout-scene';
import './store-layout.css';

type Saved = { layout: StoreLayout; version: number };
function DimensionInput({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type="number"
      step="0.25"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (draft.trim() && Number.isFinite(Number(draft))) onCommit(Number(draft));
        setDraft(String(value));
      }}
    />
  );
}
const catalog: {
  kind: LayoutObject['kind'];
  name: string;
  width: number;
  depth: number;
  height: number;
  icon: string;
}[] = [
  { kind: 'wall_shelf', name: 'Wall shelving', width: 2, depth: 0.5, height: 2, icon: '▤' },
  { kind: 'gondola', name: 'Island shelving', width: 3, depth: 1, height: 1.6, icon: '▥' },
  { kind: 'wall_fridge', name: 'Wall refrigerator', width: 2, depth: 0.75, height: 2, icon: '❄' },
  { kind: 'freezer', name: 'Chest freezer', width: 1.5, depth: 1, height: 0.9, icon: '▣' },
  { kind: 'checkout', name: 'Checkout counter', width: 1.5, depth: 1, height: 0.9, icon: '▰' },
  { kind: 'produce', name: 'Fruit and vegetables', width: 2, depth: 1.5, height: 0.8, icon: '◉' },
  { kind: 'bakery', name: 'Bakery display', width: 1.5, depth: 0.75, height: 1.5, icon: '▱' },
  { kind: 'display', name: 'Display stand', width: 1, depth: 1, height: 1, icon: '◇' },
  { kind: 'custom', name: 'Other equipment', width: 1, depth: 1, height: 1, icon: '□' },
];

export function StoreLayoutPage() {
  useLanguage();
  const session = useSession().data!;
  const allowed = session.user.permissions.includes('settings.manage');
  const q = useQuery({
    queryKey: ['store-layout', session.store.id],
    queryFn: () => api<Saved>('/store-layout'),
    enabled: allowed,
  });
  if (!allowed) return <p>{t('Access denied')}</p>;
  if (q.isPending) return <p>{t('Loading…')}</p>;
  if (!q.data) return <ErrorMessage error={q.error} />;
  return <LayoutEditor key={session.store.id} saved={q.data} />;
}

function LayoutEditor({ saved }: { saved: Saved }) {
  const session = useSession().data!;
  const cache = useQueryClient();
  const [layout, setLayout] = useState(saved.layout);
  const [baseline, setBaseline] = useState(saved);
  const [past, setPast] = useState<StoreLayout[]>([]),
    [future, setFuture] = useState<StoreLayout[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [top, setTop] = useState(false),
    [angle, setAngle] = useState(0),
    [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = JSON.stringify(layout) !== JSON.stringify(baseline.layout);
  const item = layout.objects.find((o) => o.id === selected);
  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm(t('Leave without saving the store layout?')),
    enableBeforeUnload: dirty,
  });
  const change = (next: StoreLayout) => {
    if (mutation.isPending) return;
    if (!storeLayoutSchema.safeParse(next).success) {
      setMessage(t('Equipment must fit inside the store without overlapping.'));
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(layout)) return;
    setPast((p) => [...p.slice(-49), layout]);
    setFuture([]);
    setLayout(next);
    setMessage('');
    setNotice('');
  };
  const updateItem = (update: Partial<LayoutObject>) => {
    if (!item) return;
    change({
      ...layout,
      objects: layout.objects.map((o) => (o.id === item.id ? { ...o, ...update } : o)),
    });
  };
  const add = (
    template: Omit<LayoutObject, 'id' | 'x' | 'y' | 'rotation'>,
    rotation: LayoutObject['rotation'] = 0,
  ) => {
    const object: LayoutObject = { ...template, id: crypto.randomUUID(), x: 0, y: 0, rotation };
    for (let y = 0; y <= layout.length; y += 0.25)
      for (let x = 0; x <= layout.width; x += 0.25) {
        object.x = x;
        object.y = y;
        if (validPlacement(layout, object)) {
          change({ ...layout, objects: [...layout.objects, object] });
          setSelected(object.id);
          return;
        }
      }
    setMessage(t('No free space for this equipment. Move equipment or increase the room size.'));
  };
  const mutation = useMutation({
    mutationFn: (snapshot: StoreLayout) =>
      api<Saved>('/store-layout', {
        layout: snapshot,
        version: baseline.version,
      }),
    onSuccess: (result) => {
      setBaseline(result);
      cache.setQueryData(['store-layout', session.store.id], result);
      setNotice(t('Store layout saved.'));
      setMessage('');
    },
  });
  return (
    <div className="store-layout-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('STORE PLANNING')}</div>
          <h1>{t('Store layout')}</h1>
          <p className="muted">
            {t('Build your store: set its size, add equipment and drag it into place.')}
          </p>
        </div>
        <Button onClick={() => mutation.mutate(layout)} disabled={!dirty || mutation.isPending}>
          <Save size={16} />
          {mutation.isPending ? t('Saving…') : t('Save layout')}
        </Button>
      </div>
      <ErrorMessage error={mutation.error} />
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <fieldset className="store-layout-editor" disabled={mutation.isPending}>
        <aside className="panel store-layout-catalog">
          <h2>{t('Equipment')}</h2>
          <p className="muted">{t('Choose equipment to place it in the first free space.')}</p>
          <div className="store-layout-catalog-list">
            {catalog.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                onClick={() =>
                  add({
                    kind: entry.kind,
                    name: t(entry.name),
                    width: entry.width,
                    depth: entry.depth,
                    height: entry.height,
                  })
                }
              >
                <span className="store-layout-catalog-icon" aria-hidden="true">
                  {entry.icon}
                </span>
                <span>
                  <strong>{t(entry.name)}</strong>
                  <small>
                    {entry.width} × {entry.depth} {t('m')}
                  </small>
                </span>
                <Plus size={14} />
              </button>
            ))}
          </div>
        </aside>
        <section className="panel store-layout-canvas-panel">
          <div className="store-layout-toolbar">
            <div className="store-layout-view-tabs">
              <Button size="sm" variant={top ? 'outline' : 'default'} onClick={() => setTop(false)}>
                {t('3D view')}
              </Button>
              <Button size="sm" variant={top ? 'default' : 'outline'} onClick={() => setTop(true)}>
                {t('Floor plan')}
              </Button>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('Undo')}
              disabled={!past.length}
              onClick={() => {
                setFuture((f) => [layout, ...f]);
                setLayout(past[past.length - 1]!);
                setPast((p) => p.slice(0, -1));
                setMessage('');
              }}
            >
              <Undo2 size={16} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('Redo')}
              disabled={!future.length}
              onClick={() => {
                setPast((p) => [...p, layout]);
                setLayout(future[0]!);
                setFuture((f) => f.slice(1));
                setMessage('');
              }}
            >
              <Redo2 size={16} />
            </Button>
            <Button
              size="icon"
              variant="outline"
              aria-label={t('Rotate view')}
              disabled={top}
              onClick={() => setAngle((a) => (a + 90) % 360)}
            >
              <RotateCw size={16} />
            </Button>
            <label className="store-layout-zoom">
              {t('Zoom')}
              <input
                aria-label={t('Zoom')}
                type="range"
                min="0.6"
                max="1.8"
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
          </div>
          <StoreLayoutScene
            layout={layout}
            selected={selected}
            onSelect={setSelected}
            top={top}
            angle={angle}
            zoom={zoom}
            onMove={(id, x, y) =>
              change({
                ...layout,
                objects: layout.objects.map((o) => (o.id === id ? { ...o, x, y } : o)),
              })
            }
          />
          <div className="store-layout-canvas-footer">
            <span>
              {layout.width} × {layout.length} {t('m')} · {layout.width * layout.length} {t('m²')} ·{' '}
              {layout.objects.length} {t('objects')}
            </span>
            <span>
              {dirty ? t('Unsaved changes') : t('Saved')} · {t('Grid: 25 cm')}
            </span>
          </div>
          <p className="muted store-layout-hint">
            {t(
              'Drag equipment to move it. Select an object to change its size or position. The floor grid shows 1 metre squares.',
            )}
          </p>
        </section>
        <aside className="panel store-layout-inspector">
          <h2>{t('Room dimensions')}</h2>
          <div className="store-layout-fields">
            <Field label={t('Store width (m)')}>
              <DimensionInput
                value={layout.width}
                min={2}
                max={100}
                onCommit={(width) => change({ ...layout, width })}
              />
            </Field>
            <Field label={t('Store length (m)')}>
              <DimensionInput
                value={layout.length}
                min={2}
                max={100}
                onCommit={(length) => change({ ...layout, length })}
              />
            </Field>
          </div>
          <h2>{t('Selected equipment')}</h2>
          {!item ? (
            <p className="muted">{t('Select equipment in the store to edit it.')}</p>
          ) : (
            <div className="store-layout-fields" key={item.id}>
              <Field label={t('Name')}>
                <input
                  maxLength={80}
                  value={item.name}
                  onChange={(e) => updateItem({ name: e.target.value })}
                />
              </Field>
              {(['width', 'depth', 'height', 'x', 'y'] as const).map((key) => (
                <Field
                  key={key}
                  label={t(
                    {
                      width: 'Width (m)',
                      depth: 'Depth (m)',
                      height: 'Height (m)',
                      x: 'Position X (m)',
                      y: 'Position Y (m)',
                    }[key],
                  )}
                >
                  <DimensionInput
                    min={key === 'x' || key === 'y' ? 0 : key === 'height' ? 0.2 : 0.25}
                    max={key === 'height' ? 6 : key === 'x' || key === 'y' ? 100 : 20}
                    value={item[key]}
                    onCommit={(value) => updateItem({ [key]: value })}
                  />
                </Field>
              ))}
              <p className="muted">
                {t('Rotation')}: {item.rotation}°
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  updateItem({ rotation: ((item.rotation + 90) % 360) as LayoutObject['rotation'] })
                }
              >
                <RotateCw size={16} />
                {t('Rotate 90°')}
              </Button>
              <Button
                variant="outline"
                onClick={() => add({ ...item, name: item.name }, item.rotation)}
              >
                <Copy size={16} />
                {t('Duplicate')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  change({ ...layout, objects: layout.objects.filter((o) => o.id !== item.id) });
                  setSelected(null);
                }}
              >
                <Trash2 size={16} />
                {t('Remove equipment')}
              </Button>
            </div>
          )}
          <h2>{t('Objects in store')}</h2>
          <div className="store-layout-object-list">
            {layout.objects.map((o) => (
              <button
                type="button"
                key={o.id}
                aria-pressed={selected === o.id}
                onClick={() => setSelected(o.id)}
              >
                {o.name}
              </button>
            ))}
          </div>
        </aside>
      </fieldset>
    </div>
  );
}
