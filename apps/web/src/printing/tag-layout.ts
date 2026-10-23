import { z } from 'zod';
export const layoutElements = ['store', 'name', 'price', 'details', 'barcode'] as const;
export type LayoutElementId = (typeof layoutElements)[number];
const element = z.object({
  x: z.number().int().min(0).max(480),
  y: z.number().int().min(0).max(480),
  width: z.number().int().min(24).max(480),
  height: z.number().int().min(16).max(480),
  fontSize: z.number().int().min(12).max(64),
  align: z.enum(['left', 'center', 'right']),
  visible: z.boolean(),
});
export const labelLayoutSchema = z
  .object({
    version: z.literal(1),
    orientation: z.enum(['portrait', 'landscape']),
    elements: z.object({
      store: element,
      name: element,
      price: element,
      details: element,
      barcode: element,
    }),
  })
  .refine((layout) => {
    const size = layoutSize(layout.orientation);
    return (
      layout.elements.barcode.visible &&
      layoutElements.every((id) => {
        const e = layout.elements[id];
        return e.x + e.width <= size.width && e.y + e.height <= size.height;
      })
    );
  });
export type LabelLayout = z.infer<typeof labelLayoutSchema>;
export type LayoutElement = LabelLayout['elements'][LayoutElementId];
export function layoutSize(orientation: 'portrait' | 'landscape') {
  return orientation === 'portrait' ? { width: 400, height: 480 } : { width: 480, height: 400 };
}
export function defaultLabelLayout(
  orientation: LabelLayout['orientation'] = 'portrait',
): LabelLayout {
  const base = (
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
  ): LayoutElement => ({ x, y, width, height, fontSize, align: 'center', visible: true });
  return {
    version: 1,
    orientation,
    elements:
      orientation === 'portrait'
        ? {
            store: base(16, 8, 368, 30, 18),
            name: base(16, 44, 368, 90, 25),
            price: base(16, 144, 368, 64, 45),
            details: base(16, 216, 368, 104, 18),
            barcode: base(16, 336, 368, 128, 18),
          }
        : {
            store: base(16, 8, 448, 30, 18),
            name: base(16, 42, 448, 62, 25),
            price: base(16, 110, 448, 62, 45),
            details: base(16, 178, 448, 92, 18),
            barcode: base(16, 276, 448, 108, 18),
          },
  };
}
export function fitLayoutElement(
  value: LayoutElement,
  orientation: LabelLayout['orientation'],
): LayoutElement {
  const size = layoutSize(orientation);
  const width = Math.max(24, Math.min(size.width, Math.round(value.width)));
  const height = Math.max(16, Math.min(size.height, Math.round(value.height)));
  return {
    ...value,
    width,
    height,
    x: Math.max(0, Math.min(size.width - width, Math.round(value.x))),
    y: Math.max(0, Math.min(size.height - height, Math.round(value.y))),
  };
}
export function rotateLayout(
  layout: LabelLayout,
  orientation: LabelLayout['orientation'],
): LabelLayout {
  const from = layoutSize(layout.orientation),
    to = layoutSize(orientation);
  return {
    ...layout,
    orientation,
    elements: Object.fromEntries(
      layoutElements.map((id) => {
        const e = layout.elements[id];
        return [
          id,
          fitLayoutElement(
            {
              ...e,
              x: (e.x * to.width) / from.width,
              y: (e.y * to.height) / from.height,
              width: (e.width * to.width) / from.width,
              height: (e.height * to.height) / from.height,
            },
            orientation,
          ),
        ];
      }),
    ) as LabelLayout['elements'],
  };
}
export function overlappingLayout(layout: LabelLayout) {
  return layoutElements.some((id, i) =>
    layoutElements.slice(i + 1).some((other) => {
      const a = layout.elements[id],
        b = layout.elements[other];
      return (
        a.visible &&
        b.visible &&
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      );
    }),
  );
}
export function labelLayoutStorageKey(store: string, device: string) {
  return `eliza:tag-layout:${store}:${device}`;
}
