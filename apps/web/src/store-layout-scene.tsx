import { useRef, useState, type PointerEvent } from 'react';
import { footprint, validPlacement, type LayoutObject, type StoreLayout } from '@eliza/contracts';
import { t } from './i18n';

type Point = [number, number];
export function StoreLayoutScene({
  layout,
  selected,
  onSelect,
  onMove,
  top,
  angle,
  zoom,
}: {
  layout: StoreLayout;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  top: boolean;
  angle: number;
  zoom: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [preview, setPreview] = useState<LayoutObject | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; pointer: number } | null>(null);
  const theta = (angle * Math.PI) / 180,
    c = Math.cos(theta),
    s = Math.sin(theta);
  const project = (x: number, y: number, z = 0): Point => {
    x -= layout.width / 2;
    y -= layout.length / 2;
    if (top) return [x, y];
    const u = c * x - s * y,
      v = s * x + c * y;
    return [((u - v) * Math.sqrt(3)) / 2, (u + v) / 2 - z];
  };
  const pointer = (event: PointerEvent): Point => {
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    if (top) return [p.x + layout.width / 2, p.y + layout.length / 2];
    const u = p.y + p.x / Math.sqrt(3),
      v = p.y - p.x / Math.sqrt(3);
    return [c * u + s * v + layout.width / 2, -s * u + c * v + layout.length / 2];
  };
  const ceiling = Math.max(2.7, ...layout.objects.map((o) => o.height)) + 0.3;
  const corners = [
    project(0, 0, ceiling),
    project(layout.width, 0, ceiling),
    project(0, layout.length, ceiling),
    project(layout.width, layout.length),
    project(0, 0),
    project(layout.width, 0),
    project(0, layout.length),
  ];
  const minX = Math.min(...corners.map((p) => p[0])),
    maxX = Math.max(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1])),
    maxY = Math.max(...corners.map((p) => p[1]));
  const w = (maxX - minX + 3) / zoom,
    h = (maxY - minY + 3) / zoom;
  const polygon = (points: Point[], fill: string, key?: string, stroke = 'var(--layout-edge)') => (
    <polygon
      key={key}
      points={points.map((p) => p.join(',')).join(' ')}
      fill={fill}
      stroke={stroke}
      strokeWidth="0.025"
    />
  );
  const box = (
    x: number,
    y: number,
    width: number,
    depth: number,
    z: number,
    height: number,
    color: string,
    key: string,
  ) => {
    const a = project(x, y, z + height),
      b = project(x + width, y, z + height);
    const d = project(x, y + depth, z + height),
      e = project(x + width, y + depth, z + height);
    return (
      <g key={key}>
        {!top && (
          <>
            {polygon([a, b, project(x + width, y, z), project(x, y, z)], color)}
            {polygon([b, e, project(x + width, y + depth, z), project(x + width, y, z)], color)}
            {polygon([d, e, project(x + width, y + depth, z), project(x, y + depth, z)], color)}
            {polygon([a, d, project(x, y + depth, z), project(x, y, z)], color)}
          </>
        )}
        {polygon([a, b, e, d], color)}
      </g>
    );
  };
  const furniture = (item: LayoutObject) => {
    const f = footprint(item),
      { x, y, width: w, depth: d } = f,
      h = item.height;
    const shelf = ['gondola', 'wall_shelf', 'bakery'].includes(item.kind);
    const color =
      item.kind === 'wall_fridge' || item.kind === 'freezer'
        ? 'var(--layout-cold)'
        : item.kind === 'checkout'
          ? 'var(--layout-checkout)'
          : item.kind === 'produce'
            ? 'var(--layout-wood)'
            : 'var(--layout-fixture)';
    if (top)
      return (
        <>
          {box(x, y, w, d, 0, h, color, 'body')}
          <text
            x={x + w / 2 - layout.width / 2}
            y={y + d / 2 - layout.length / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="0.23"
            fill="var(--layout-label)"
          >
            {item.name.slice(0, 20)}
          </text>
        </>
      );
    if (shelf)
      return (
        <>
          {box(x + w * 0.44, y + d * 0.44, w * 0.12, d * 0.12, 0, h, color, 'post')}
          {[0.12, 0.4, 0.68, 0.96].map((level, i) => (
            <g key={i}>
              {box(x, y, w, d, h * level, 0.06, color, 'shelf')}
              {level < 0.9 &&
                Array.from({ length: 5 }, (_, j) =>
                  box(
                    x + (w * (j + 0.1)) / 5,
                    y + d * 0.1,
                    w * 0.14,
                    d * 0.8,
                    h * level + 0.06,
                    h * 0.16,
                    `var(--layout-product-${(i + j) % 4})`,
                    'product-' + j,
                  ),
                )}
            </g>
          ))}
        </>
      );
    return (
      <>
        {box(x, y, w, d, 0, h, color, 'body')}
        {item.kind === 'produce' &&
          Array.from({ length: 15 }, (_, i) => {
            const p = project(
              x + (w * ((i % 5) + 0.5)) / 5,
              y + (d * (Math.floor(i / 5) + 0.5)) / 3,
              h + 0.08,
            );
            return (
              <ellipse
                key={i}
                cx={p[0]}
                cy={p[1]}
                rx={Math.min(w / 12, 0.16)}
                ry="0.12"
                fill={`var(--layout-product-${i % 4})`}
              />
            );
          })}
        {item.kind === 'checkout' &&
          box(
            x + w * 0.55,
            y + d * 0.2,
            w * 0.25,
            d * 0.4,
            h,
            0.25,
            'var(--layout-screen)',
            'screen',
          )}
        {['wall_fridge', 'freezer'].includes(item.kind) &&
          box(
            x + w * 0.08,
            y + d * 0.08,
            w * 0.84,
            d * 0.84,
            h,
            0.025,
            'var(--layout-glass)',
            'glass',
          )}
      </>
    );
  };
  const sorted = layout.objects
    .map((o) => (o.id === preview?.id ? preview : o))
    .sort((a, b) => {
      const af = footprint(a),
        bf = footprint(b);
      return (
        project(af.x + af.width / 2, af.y + af.depth / 2)[1] -
        project(bf.x + bf.width / 2, bf.y + bf.depth / 2)[1]
      );
    });
  return (
    <svg
      ref={svg}
      className="store-layout-scene"
      viewBox={`${(minX + maxX - w) / 2} ${(minY + maxY - h) / 2} ${w} ${h}`}
      role="img"
      aria-label={t('Interactive store layout')}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const item = layout.objects.find((o) => o.id === drag.current!.id)!;
        const [x, y] = pointer(e);
        const next = {
          ...item,
          x: Math.round((x - drag.current.x) * 4) / 4,
          y: Math.round((y - drag.current.y) * 4) / 4,
        };
        if (validPlacement(layout, next)) setPreview(next);
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        drag.current = null;
        if (preview) onMove(preview.id, preview.x, preview.y);
        setPreview(null);
        if (svg.current?.hasPointerCapture(e.pointerId))
          svg.current.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
    >
      <g onPointerDown={() => onSelect(null)}>
        {polygon(
          [
            project(0, 0),
            project(layout.width, 0),
            project(layout.width, layout.length),
            project(0, layout.length),
          ],
          'var(--layout-floor)',
        )}
        {Array.from({ length: Math.floor(layout.width) + 1 }, (_, i) => (
          <line
            key={'x' + i}
            x1={project(i, 0)[0]}
            y1={project(i, 0)[1]}
            x2={project(i, layout.length)[0]}
            y2={project(i, layout.length)[1]}
            stroke="var(--layout-grid)"
            strokeWidth="0.02"
          />
        ))}
        {Array.from({ length: Math.floor(layout.length) + 1 }, (_, i) => (
          <line
            key={'y' + i}
            x1={project(0, i)[0]}
            y1={project(0, i)[1]}
            x2={project(layout.width, i)[0]}
            y2={project(layout.width, i)[1]}
            stroke="var(--layout-grid)"
            strokeWidth="0.02"
          />
        ))}
        {!top && (
          <>
            {polygon(
              [
                project(0, 0),
                project(layout.width, 0),
                project(layout.width, 0, 2.7),
                project(0, 0, 2.7),
              ],
              'var(--layout-wall)',
            )}
            {polygon(
              [
                project(0, 0),
                project(0, layout.length),
                project(0, layout.length, 2.7),
                project(0, 0, 2.7),
              ],
              'var(--layout-wall)',
            )}
          </>
        )}
      </g>
      {sorted.map((item) => (
        <g
          key={item.id}
          className="store-layout-equipment"
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelect(item.id);
            setPreview(item);
            const [x, y] = pointer(e);
            drag.current = { id: item.id, x: x - item.x, y: y - item.y, pointer: e.pointerId };
            svg.current!.setPointerCapture(e.pointerId);
          }}
        >
          <title>{item.name}</title>
          {furniture(item)}
          {selected === item.id &&
            (() => {
              const f = footprint(item);
              return polygon(
                [
                  project(f.x, f.y, top ? 0 : item.height + 0.1),
                  project(f.x + f.width, f.y, top ? 0 : item.height + 0.1),
                  project(f.x + f.width, f.y + f.depth, top ? 0 : item.height + 0.1),
                  project(f.x, f.y + f.depth, top ? 0 : item.height + 0.1),
                ],
                'none',
                'selected',
                'var(--accent)',
              );
            })()}
        </g>
      ))}
    </svg>
  );
}
