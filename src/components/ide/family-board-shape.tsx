"use client";
import { createShapeId, type RecordProps, type TLBaseShape } from "@/lib/tldraw-compat";

/**
 * 家族底板：把主图 + 派生素材收进一块浅底，降低全画布散点感。
 */

import { useLayoutEffect } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  useEditor,
  useValue,
  type Editor,
  type Geometry2d,
} from "tldraw";
import { familyBoardRect, type PlacedRect } from "@/lib/canvas/board-layout";
import { familyBoardShapeProps } from "@/lib/canvas/family-board-props";
import {
  applyFamilyDrag,
  beginFamilyDrag,
  collectMemberImageShapeIds,
  endFamilyDrag,
  isFamilyDragActive,
  parseFamilyMemberIds,
} from "@/lib/canvas/family-drag";
import { FamilyTitleEditor } from "./family-title-editor";

export type FamilyBoardShape = TLBaseShape<
  "family-board",
  {
    w: number;
    h: number;
    rootAssetId: string;
    memberAssetIds: string;
    label: string;
    projectId?: string;
  }
>;

export function familyBoardShapeId(rootAssetId: string) {
  return createShapeId(`family-board:${rootAssetId}`);
}

export function makeFamilyBoardShape(input: {
  rootAssetId: string;
  memberAssetIds: string[];
  label: string;
  bounds: PlacedRect;
  projectId?: string;
}) {
  return {
    id: familyBoardShapeId(input.rootAssetId),
    type: "family-board" as const,
    x: input.bounds.x,
    y: input.bounds.y,
    isLocked: false,
    props: {
      w: input.bounds.w,
      h: input.bounds.h,
      rootAssetId: input.rootAssetId,
      memberAssetIds: input.memberAssetIds.join(","),
      label: input.label,
      projectId: input.projectId ?? "",
    },
  };
}

export function collectImageAssetBoxes(
  editor: Editor
): Map<string, PlacedRect> {
  const boxes = new Map<string, PlacedRect>();
  for (const shape of editor.getCurrentPageShapes()) {
    if ((shape.type as string) !== "image-asset") continue;
    const props = shape as unknown as {
      props: { assetId: string; w: number; h: number };
    };
    boxes.set(props.props.assetId, {
      x: shape.x,
      y: shape.y,
      w: props.props.w,
      h: props.props.h,
    });
  }
  return boxes;
}

export function familyBoardFromMembers(
  editor: Editor,
  memberAssetIds: string[]
): PlacedRect | null {
  const boxes = collectImageAssetBoxes(editor);
  const rects = memberAssetIds
    .map((id) => boxes.get(id))
    .filter((rect): rect is PlacedRect => Boolean(rect));
  return familyBoardRect(rects);
}

export class FamilyBoardShapeUtil extends ShapeUtil<FamilyBoardShape> {
  static type = "family-board" as any;

  static props: RecordProps<FamilyBoardShape> = familyBoardShapeProps;

  getDefaultProps(): FamilyBoardShape["props"] {
    return {
      w: 320,
      h: 220,
      rootAssetId: "",
      memberAssetIds: "",
      label: "",
      projectId: "",
    };
  }

  getGeometry(shape: FamilyBoardShape): Geometry2d {
    return new Rectangle2d({
      width: Math.max(1, shape.props.w),
      height: Math.max(1, shape.props.h),
      isFilled: true,
    });
  }

  canResize = () => false;
  hideRotateHandle = () => true;
  canBind = () => false;
  canDuplicate = () => false;
  canSnap = () => false;
  hideSelectionBoundsBg = () => true;
  hideSelectionBoundsFg = () => true;

  onTranslateStart = (shape: FamilyBoardShape) => {
    beginFamilyDrag(
      this.editor,
      shape.id,
      parseFamilyMemberIds(shape.props.memberAssetIds)
    );
  };

  onTranslate = (
    initial: FamilyBoardShape,
    current: FamilyBoardShape
  ) => {
    applyFamilyDrag(
      this.editor,
      current.id,
      current.x - initial.x,
      current.y - initial.y
    );
  };

  onTranslateEnd = (
    _initial: FamilyBoardShape,
    current: FamilyBoardShape
  ) => {
    endFamilyDrag(current.id);
  };

  component(shape: FamilyBoardShape) {
    return <FamilyBoardShapeView shape={shape} />;
  }

  getIndicatorPath = (shape: FamilyBoardShape): Path2D | undefined => {
    if (typeof Path2D === "undefined") return undefined;
    const r = 20;
    const w = Math.max(1, shape.props.w);
    const h = Math.max(1, shape.props.h);
    const p = new Path2D();
    p.moveTo(r, 0);
    p.lineTo(Math.max(r, w - r), 0);
    p.quadraticCurveTo(w, 0, w, r);
    p.lineTo(w, Math.max(r, h - r));
    p.quadraticCurveTo(w, h, Math.max(r, w - r), h);
    p.lineTo(r, h);
    p.quadraticCurveTo(0, h, 0, Math.max(r, h - r));
    p.lineTo(0, r);
    p.quadraticCurveTo(0, 0, r, 0);
    p.closePath();
    return p;
  };
}

function parseMemberIds(value: string): string[] {
  return parseFamilyMemberIds(value);
}

function FamilyBoardShapeView({ shape }: { shape: FamilyBoardShape }) {
  const editor = useEditor();
  const memberIds = parseMemberIds(shape.props.memberAssetIds);
  const live = useValue(
    `family-board-follow:${shape.props.rootAssetId}`,
    () => familyBoardFromMembers(editor, memberIds),
    [editor, shape.props.memberAssetIds]
  );
  const highlighted = useValue(
    `family-board-hi:${shape.props.rootAssetId}`,
    () => isFamilyHighlighted(editor, memberIds),
    [editor, shape.props.memberAssetIds]
  );
  const boardSelected = useValue(
    `family-board-sel:${shape.props.rootAssetId}`,
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );

  useLayoutEffect(() => {
    if (!boardSelected) return;
    const selected = editor.getSelectedShapeIds();
    if (selected.length > 1) {
      editor.setSelectedShapes(selected.filter((id) => id !== shape.id));
      return;
    }
    const memberShapeIds = collectMemberImageShapeIds(editor, memberIds);
    if (memberShapeIds.length === 0) return;
    editor.setSelectedShapes(memberShapeIds as any);
  }, [boardSelected, editor, memberIds, shape.id]);

  useLayoutEffect(() => {
    if (!live || isFamilyDragActive()) return;
    if (
      Math.abs(shape.x - live.x) < 0.5 &&
      Math.abs(shape.y - live.y) < 0.5 &&
      Math.abs(shape.props.w - live.w) < 0.5 &&
      Math.abs(shape.props.h - live.h) < 0.5
    ) {
      return;
    }
    editor.updateShapes([
      {
        id: shape.id,
        type: "family-board" as any,
        x: live.x,
        y: live.y,
        props: {
          w: live.w,
          h: live.h,
          rootAssetId: shape.props.rootAssetId,
          memberAssetIds: shape.props.memberAssetIds,
          label: shape.props.label,
          projectId: shape.props.projectId,
        },
      },
    ]);
  }, [editor, live, shape]);

  const w = live?.w ?? shape.props.w;
  const h = live?.h ?? shape.props.h;
  const drawDx = live ? live.x - shape.x : 0;
  const drawDy = live ? live.y - shape.y : 0;

  return (
    <HTMLContainer
      id={shape.id}
      className={
        "vad-family-board" + (highlighted ? " vad-family-board--on" : "")
      }
      style={{
        width: Math.max(48, w),
        height: Math.max(48, h),
        pointerEvents: "none",
        overflow: "visible",
        borderRadius: 20,
        transform:
          drawDx || drawDy
            ? `translate(${drawDx}px, ${drawDy}px)`
            : undefined,
      }}
    >
      <FamilyTitleEditor
        rootAssetId={shape.props.rootAssetId}
        projectId={resolveBoardProjectId(editor, shape, memberIds)}
        derivedCount={Math.max(0, memberIds.length - 1)}
        boardShapeId={shape.id}
        boardLabel={shape.props.label}
      />
    </HTMLContainer>
  );
}

function resolveBoardProjectId(
  editor: Editor,
  shape: FamilyBoardShape,
  memberIds: string[]
): string {
  if (shape.props.projectId) return shape.props.projectId;
  for (const item of editor.getCurrentPageShapes()) {
    if ((item.type as string) !== "image-asset") continue;
    const props = (
      item as unknown as { props: { assetId: string; projectId: string } }
    ).props;
    if (memberIds.includes(props.assetId) && props.projectId) {
      return props.projectId;
    }
  }
  return "";
}

export function isFamilyHighlighted(
  editor: Editor,
  memberAssetIds: string[]
): boolean {
  const members = new Set(memberAssetIds);
  for (const id of editor.getSelectedShapeIds()) {
    const shape = editor.getShape(id);
    if (!shape) continue;
    const type = shape.type as string;
    if (type === "family-board") {
      const ids = parseFamilyMemberIds(
        (shape as unknown as { props: { memberAssetIds: string } }).props
          .memberAssetIds
      );
      if (ids.some((assetId) => members.has(assetId))) return true;
      continue;
    }
    if (type !== "image-asset") continue;
    const assetId = (shape as unknown as { props: { assetId: string } }).props
      .assetId;
    if (members.has(assetId)) return true;
  }
  return false;
}
