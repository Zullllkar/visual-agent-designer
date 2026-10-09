"use client";
import { createShapeId, type RecordProps, type TLBaseShape } from "@/lib/tldraw-compat";

/**
 * 已废弃的画布 shape 兼容层
 * --------------------------------------------------------------
 * spec-card / handoff-card 已从产品中移除，但旧项目的 tldraw
 * IndexedDB 持久化仍可能含有这些类型。若不注册对应 ShapeUtil，
 * 本地同步会在校验阶段抛 ValidationError 并白屏。
 *
 * 这里只做「能加载 + 零 UI」，真正删除由 syncProjectToEditor 完成。
 * @author：wangjunhua
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
} from "tldraw";

type DeprecatedCardShape = TLBaseShape<
  "spec-card" | "handoff-card",
  {
    w: number;
    h: number;
    projectId: string;
  }
>;

const deprecatedProps: RecordProps<DeprecatedCardShape> = {
  w: T.number,
  h: T.number,
  projectId: T.string,
};

function makeDeprecatedUtil(type: "spec-card" | "handoff-card") {
  return class DeprecatedCardShapeUtil extends ShapeUtil<DeprecatedCardShape> {
    static type = type;

    static props = deprecatedProps;

    getDefaultProps(): DeprecatedCardShape["props"] {
      return { w: 1, h: 1, projectId: "" };
    }

    getGeometry(shape: DeprecatedCardShape): Rectangle2d {
      return new Rectangle2d({
        width: Math.max(1, shape.props.w),
        height: Math.max(1, shape.props.h),
        isFilled: true,
      });
    }

    canResize = () => false;
    canEditInReadonly = () => false;
    hideRotateHandle = () => true;
    canBind = () => false;
    hideSelectionBoundsBg = () => true;
    hideSelectionBoundsFg = () => true;

    component() {
      return (
        <HTMLContainer style={{ width: 0, height: 0, overflow: "hidden" }} />
      );
    }

    getIndicatorPath(): Path2D | undefined {
      return undefined;
    }
  };
}

export const SpecCardShapeUtil = makeDeprecatedUtil("spec-card");
export const HandoffCardShapeUtil = makeDeprecatedUtil("handoff-card");

export const DEPRECATED_VAD_SHAPE_TYPES = ["spec-card", "handoff-card"] as const;
