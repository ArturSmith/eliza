export type Box = { left: number; top: number; width: number; height: number };
export function placeTourCard(
  target: Box,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
) {
  const gap = 16,
    margin = 12;
  const clamp = (value: number, max: number) =>
    Math.max(margin, Math.min(value, Math.max(margin, max)));
  const centered = target.left + (target.width - card.width) / 2;
  const bottom = target.top + target.height;
  let left = centered,
    top: number;
  if (bottom + gap + card.height <= viewport.height - margin) top = bottom + gap;
  else if (target.top - gap - card.height >= margin) top = target.top - gap - card.height;
  else if (target.left + target.width + gap + card.width <= viewport.width - margin) {
    left = target.left + target.width + gap;
    top = target.top;
  } else if (target.left - gap - card.width >= margin) {
    left = target.left - gap - card.width;
    top = target.top;
  } else {
    left = (viewport.width - card.width) / 2;
    top = viewport.height - card.height - margin;
  }
  return {
    left: clamp(left, viewport.width - card.width - margin),
    top: clamp(top, viewport.height - card.height - margin),
  };
}
