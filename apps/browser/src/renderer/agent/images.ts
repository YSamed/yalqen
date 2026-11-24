import type { AgentChatImage } from '../../shared/agent';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;

export function acceptsImage(file: File): boolean {
  return IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES;
}

export async function readImage(file: File): Promise<AgentChatImage> {
  const bitmap = await createImageBitmap(file);
  let thumbnail: string;
  try {
    thumbnail = thumbnailOf(bitmap);
  } finally {
    bitmap.close();
  }
  return { mediaType: file.type as AgentChatImage['mediaType'], data: await base64Of(file), thumbnail };
}

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function thumbnailOf(bitmap: ImageBitmap): string {
  const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}
