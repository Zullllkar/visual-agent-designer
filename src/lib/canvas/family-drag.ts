import type { Editor } from "tldraw";

export type FamilyDragOrigin = {
  id: string;
  type: "image-asset" | "family-board";
  x: number;
  y: number;
};

export type FamilyDragUpdate = {
  id: string;
  type: "image-asset" | "family-board";
  x: number;
  y: number;
};

type Session = {
  leaderId: string | null;
  origins: FamilyDragOrigin[];
  applying: boolean;
};

const session: Session = {
  leaderId: null,
  origins: [],
  applying: false,
};

export function parseFamilyMemberIds(value: string): string[] {
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function collectMemberImageShapeIds(
  editor: Editor,
  memberAssetIds: string[]
): string[] {
  const members = new Set(memberAssetIds);
  const ids: string[] = [];
  for (const shape of editor.getCurrentPageShapes()) {
    if ((shape.type as string) !== "image-asset") continue;
    const assetId = (shape as unknown as { props: { assetId: string } }).props
      .assetId;
    if (members.has(assetId)) ids.push(shape.id);
  }
  return ids;
}

export function collectFamilyDragOrigins(
  editor: Editor,
  memberAssetIds: string[]
): FamilyDragOrigin[] {
  if (memberAssetIds.length <= 1) return [];
  const members = new Set(memberAssetIds);
  const origins: FamilyDragOrigin[] = [];
  for (const shape of editor.getCurrentPageShapes()) {
    const type = shape.type as string;
    if (type === "image-asset") {
      const id = (shape as unknown as { props: { assetId: string } }).props
        .assetId;
      if (!members.has(id)) continue;
      origins.push({ id: shape.id, type: "image-asset", x: shape.x, y: shape.y });
      continue;
    }
    if (type === "family-board") {
      const ids = parseFamilyMemberIds(
        (shape as unknown as { props: { memberAssetIds: string } }).props
          .memberAssetIds
      );
      if (!ids.some((id) => members.has(id))) continue;
      origins.push({
        id: shape.id,
        type: "family-board",
        x: shape.x,
        y: shape.y,
      });
    }
  }
  return origins;
}

export function familyDragUpdates(
  origins: FamilyDragOrigin[],
  leaderId: string,
  dx: number,
  dy: number,
  selectedIds: ReadonlySet<string>
): FamilyDragUpdate[] {
  return origins
    .filter((origin) => origin.id !== leaderId && !selectedIds.has(origin.id))
    .map((origin) => ({
      id: origin.id,
      type: origin.type,
      x: origin.x + dx,
      y: origin.y + dy,
    }));
}

export function beginFamilyDrag(
  editor: Editor,
  leaderId: string,
  memberAssetIds: string[]
) {
  session.leaderId = leaderId;
  session.origins = collectFamilyDragOrigins(editor, memberAssetIds);
}

export function applyFamilyDrag(
  editor: Editor,
  leaderId: string,
  dx: number,
  dy: number
) {
  if (session.applying || session.leaderId !== leaderId) return;
  const updates = familyDragUpdates(
    session.origins,
    leaderId,
    dx,
    dy,
    new Set(editor.getSelectedShapeIds())
  );
  if (updates.length === 0) return;
  session.applying = true;
  try {
    editor.updateShapes(updates as any);
  } finally {
    session.applying = false;
  }
}

export function endFamilyDrag(leaderId: string) {
  if (session.leaderId !== leaderId) return;
  session.leaderId = null;
  session.origins = [];
}

export function isFamilyDragActive() {
  return session.leaderId !== null;
}
