import type { AgentChatImage, TabId } from './types.js';

export const RESPONSIVE_SCAN_VIEWPORTS = [
  { id: 'mobile', width: 390, height: 844 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', width: 1440, height: 900 },
] as const;

export interface ResponsiveScanViewport {
  id: 'mobile' | 'tablet' | 'desktop';
  width: number;
  height: number;
}

export interface ResponsiveScanFinding {
  kind: 'horizontal-overflow' | 'clipped-text' | 'offscreen-control';
  selector: string;
  label: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface ResponsiveScanMeasurements {
  viewport: { width: number; height: number };
  documentWidth: number;
  horizontalOverflow: number;
  findings: ResponsiveScanFinding[];
  truncated: boolean;
}

export type ResponsiveScanErrorCode =
  | 'scope'
  | 'unavailable'
  | 'navigation'
  | 'viewport'
  | 'busy'
  | 'cancelled'
  | 'timeout'
  | 'capture'
  | 'restore'
  | 'stale';

export interface ResponsiveScanFrame {
  viewport: ResponsiveScanViewport;
  capturedAt: number;
  dataUrl: string;
  measurements: ResponsiveScanMeasurements;
}

export interface ResponsiveScanPreview {
  tabId: TabId;
  url: string;
  title: string;
  status: 'running' | 'ready' | 'cancelled' | 'error';
  frames: ResponsiveScanFrame[];
  error: ResponsiveScanErrorCode | null;
}

export interface ResponsiveScanReview {
  tabId: TabId;
  text: string;
  images: AgentChatImage[];
}

export interface ResponsiveScanApi {
  getResponsiveScan(): Promise<ResponsiveScanPreview | null>;
  runResponsiveScan(tabId: TabId): Promise<ResponsiveScanPreview>;
  cancelResponsiveScan(): Promise<void>;
  clearResponsiveScan(): Promise<void>;
  getResponsiveScanReview(): Promise<ResponsiveScanReview | null>;
}
