type Gallery = { image?: string; images?: string[] };

/** The legacy cover and ordered gallery always agree, including writes from older clients. */
export function normalizeProductGallery(input: Gallery, previous: Gallery = {}) {
  const old = previous.images?.length ? previous.images : previous.image ? [previous.image] : [];
  const images =
    input.images !== undefined
      ? input.images
      : input.image === undefined || input.image === previous.image
        ? old
        : [input.image, ...old.slice(1)].filter((image): image is string => !!image);
  const unique = [...new Set(images)];
  return { image: unique[0] ?? '', images: unique };
}
