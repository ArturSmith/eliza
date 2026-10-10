import { z } from 'zod';

export const equipmentKinds = [
  'wall_shelf',
  'gondola',
  'wall_fridge',
  'freezer',
  'checkout',
  'produce',
  'bakery',
  'display',
  'custom',
] as const;
export const layoutObjectSchema = z.object({
  id: z.uuid(),
  kind: z.enum(equipmentKinds),
  name: z.string().trim().min(1).max(80),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(0.25).max(20),
  depth: z.number().min(0.25).max(20),
  height: z.number().min(0.2).max(6),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
export type LayoutObject = z.infer<typeof layoutObjectSchema>;
export type StoreLayout = { width: number; length: number; objects: LayoutObject[] };
export function footprint(item: LayoutObject) {
  return {
    x: item.x,
    y: item.y,
    width: item.rotation % 180 ? item.depth : item.width,
    depth: item.rotation % 180 ? item.width : item.depth,
  };
}
export function validPlacement(layout: StoreLayout, item: LayoutObject): boolean {
  const a = footprint(item);
  if (
    a.x < 0 ||
    a.y < 0 ||
    a.x + a.width > layout.width + 0.00001 ||
    a.y + a.depth > layout.length + 0.00001
  )
    return false;
  return !layout.objects.some((other) => {
    if (other.id === item.id) return false;
    const b = footprint(other);
    return (
      a.x < b.x + b.width - 0.00001 &&
      a.x + a.width > b.x + 0.00001 &&
      a.y < b.y + b.depth - 0.00001 &&
      a.y + a.depth > b.y + 0.00001
    );
  });
}
export const storeLayoutSchema = z
  .object({
    width: z.number().min(2).max(100),
    length: z.number().min(2).max(100),
    objects: z.array(layoutObjectSchema).max(300),
  })
  .superRefine((layout, ctx) => {
    const ids = new Set<string>();
    layout.objects.forEach((item, index) => {
      if (ids.has(item.id))
        ctx.addIssue({
          code: 'custom',
          path: ['objects', index, 'id'],
          message: 'Equipment IDs must be unique.',
        });
      ids.add(item.id);
      if (!validPlacement(layout, item))
        ctx.addIssue({
          code: 'custom',
          path: ['objects', index],
          message: 'Equipment must fit inside the store without overlapping.',
        });
    });
  });
