import type { WebContents } from 'electron';
import type { AgentChatImage } from '../../shared/types.js';
import type { VisualComparisonViewport } from '../../shared/visual-comparison.js';
import { MAX_VISUAL_COMPARISON_EDGE, MAX_VISUAL_COMPARISON_IMAGE_BYTES } from '../../shared/visual-comparison.js';
import { VisualComparisonError } from './visual-comparison.js';

// Only the active, visible page is captured. CSS dimensions stay in the metadata even when
// the image is reduced for the preview and the agent's image input.
export async function captureVisualPage(contents: WebContents): Promise<{
  viewport: VisualComparisonViewport;
  image: AgentChatImage;
  capturedAt: number;
}> {
  const measure = async (): Promise<VisualComparisonViewport> => {
    const metrics = (await contents.debugger.sendCommand('Page.getLayoutMetrics')) as {
      cssLayoutViewport: { clientWidth: number; clientHeight: number };
      layoutViewport: { clientWidth: number };
    };
    const { clientWidth: width, clientHeight: height } = metrics.cssLayoutViewport;
    if (width <= 0 || height <= 0) throw new VisualComparisonError('capture');
    return { width, height, deviceScaleFactor: metrics.layoutViewport.clientWidth / width };
  };
  const viewport = await measure();
  const capturedAt = Date.now();
  const original = await contents.capturePage();
  const current = await measure();
  if (
    viewport.width !== current.width ||
    viewport.height !== current.height ||
    viewport.deviceScaleFactor !== current.deviceScaleFactor
  )
    throw new VisualComparisonError('viewport');
  if (original.isEmpty()) throw new VisualComparisonError('capture');
  const size = original.getSize();
  const scale = Math.min(1, MAX_VISUAL_COMPARISON_EDGE / Math.max(size.width, size.height));
  const resized = original.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  });
  let jpeg = resized.toJPEG(85);
  for (const quality of [70, 55, 40]) {
    if (jpeg.length <= MAX_VISUAL_COMPARISON_IMAGE_BYTES) break;
    jpeg = resized.toJPEG(quality);
  }
  if (jpeg.length > MAX_VISUAL_COMPARISON_IMAGE_BYTES) throw new VisualComparisonError('too-large');
  const thumbnailScale = Math.min(1, 160 / Math.max(size.width, size.height));
  const thumbnail = original.resize({
    width: Math.max(1, Math.round(size.width * thumbnailScale)),
    height: Math.max(1, Math.round(size.height * thumbnailScale)),
  });
  return {
    viewport,
    capturedAt,
    image: {
      mediaType: 'image/jpeg',
      data: jpeg.toString('base64'),
      thumbnail: `data:image/jpeg;base64,${thumbnail.toJPEG(70).toString('base64')}`,
    },
  };
}
