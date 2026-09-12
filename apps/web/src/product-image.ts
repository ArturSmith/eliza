/** Normalize photos to small JPEGs, removing source metadata and limiting catalog payloads. */
export async function prepareProductImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    let edge = 480;
    for (let attempt = 0; attempt < 5; attempt++, edge = Math.floor(edge * 0.75)) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare this image.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/jpeg', 0.8);
      if (result.length <= 60000) return result;
    }
    throw new Error('This image is too detailed. Choose a smaller photo.');
  } finally {
    bitmap.close();
  }
}
