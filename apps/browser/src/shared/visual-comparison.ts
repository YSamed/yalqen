import type { AgentChatImage, TabId } from './types.js';

export const MAX_VISUAL_COMPARISON_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_VISUAL_COMPARISON_EDGE = 1600;

export type VisualComparisonStage = 'before' | 'after';

export interface VisualComparisonViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface VisualComparisonFrame {
  tabId: TabId;
  url: string;
  title: string;
  viewport: VisualComparisonViewport;
  capturedAt: number;
  dataUrl: string;
}

export interface VisualComparisonPreview {
  before: VisualComparisonFrame;
  after: VisualComparisonFrame | null;
}

export interface VisualComparisonReview {
  tabId: TabId;
  text: string;
  // The order is meaningful: before, then after.
  images: AgentChatImage[];
}

export interface VisualComparisonApi {
  getVisualComparison(): Promise<VisualComparisonPreview | null>;
  captureVisualComparison(stage: VisualComparisonStage, tabId: TabId): Promise<VisualComparisonPreview>;
  clearVisualComparison(): Promise<void>;
  getVisualComparisonReview(): Promise<VisualComparisonReview | null>;
}

export type VisualComparisonErrorCode =
  'unavailable' | 'scope' | 'navigation' | 'viewport' | 'baseline' | 'capture' | 'too-large' | 'busy' | 'stale';
