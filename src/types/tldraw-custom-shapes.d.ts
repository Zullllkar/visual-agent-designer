/** Tldraw 5 custom shape registry. Tldraw derives TLShape from this map. */
import "@tldraw/tlschema";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "asset-link": {
      w: number; h: number; fromAssetId: string; toAssetId: string; toNoteId: string;
      label: string; x1: number; y1: number; x2: number; y2: number;
    };
    "canvas-page": { w: number; h: number; pageId: string; projectId: string; serializedPage: string };
    "family-board": { w: number; h: number; rootAssetId: string; memberAssetIds: string; label: string; projectId?: string };
    "flow-arrow": { w: number; h: number; flowId: string; fromPageId: string; toPageId: string; label: string };
    "handoff-card": { w: number; h: number; projectId: string };
    "image-asset": { w: number; h: number; assetId: string; projectId: string; promptSnippet: string; status: string };
    "reference-card": { w: number; h: number; referenceId: string; projectId: string; label: string; source: string };
    "spec-card": { w: number; h: number; projectId: string };
    "text-note": { w: number; h: number; noteId: string; projectId: string };
  }
}
