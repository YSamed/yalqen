import { nativeImage } from 'electron';
import type { AgentChatImage } from '../../shared/types.js';
import type { ResponsiveScanViewport } from '../../shared/responsive-scan.js';
import { MAX_VISUAL_COMPARISON_EDGE, MAX_VISUAL_COMPARISON_IMAGE_BYTES } from '../../shared/visual-comparison.js';

interface CaptureContents {
  debugger: { sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown> };
}

// CDP captures the emulated viewport even when it is larger than the native WebContentsView.
export async function captureResponsiveScreenshot(
  contents: CaptureContents,
  viewport: ResponsiveScanViewport,
): Promise<AgentChatImage> {
  const result = (await contents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 85,
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: 1 },
  })) as { data?: unknown };
  if (typeof result.data !== 'string' || result.data.length > 16 * 1024 * 1024)
    throw new Error('responsive-scan:capture');
  const original = nativeImage.createFromBuffer(Buffer.from(result.data, 'base64'));
  if (original.isEmpty()) throw new Error('responsive-scan:capture');
  const size = original.getSize();
  if (size.width !== viewport.width || size.height !== viewport.height) throw new Error('responsive-scan:viewport');
  const scale = Math.min(1, MAX_VISUAL_COMPARISON_EDGE / Math.max(size.width, size.height));
  const resized = original.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) });
  let jpeg = resized.toJPEG(85);
  for (const quality of [70, 55, 40]) {
    if (jpeg.length <= MAX_VISUAL_COMPARISON_IMAGE_BYTES) break;
    jpeg = resized.toJPEG(quality);
  }
  if (jpeg.length > MAX_VISUAL_COMPARISON_IMAGE_BYTES) throw new Error('responsive-scan:capture');
  const thumbnailScale = Math.min(1, 160 / Math.max(size.width, size.height));
  const thumbnail = original.resize({
    width: Math.max(1, Math.round(size.width * thumbnailScale)),
    height: Math.max(1, Math.round(size.height * thumbnailScale)),
  });
  return {
    mediaType: 'image/jpeg',
    data: jpeg.toString('base64'),
    thumbnail: `data:image/jpeg;base64,${thumbnail.toJPEG(70).toString('base64')}`,
  };
}
