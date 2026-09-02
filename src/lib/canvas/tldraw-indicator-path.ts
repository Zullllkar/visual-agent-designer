/**
 * tldraw 5 的选中描边会无条件调用 util.getIndicatorPath。
 * 基类 ShapeUtil 只有已废弃的 indicator()，没有默认 getIndicatorPath，
 * 自定义 / 热更新残留的 util 缺方法时会白屏。
 */
import { ShapeUtil, type TLShape } from "tldraw";

export function fallbackIndicatorPath(shape: {
  props?: { w?: number; h?: number };
}): Path2D | undefined {
  if (typeof Path2D === "undefined") return undefined;
  const props = shape.props ?? {};
  const w = Math.max(1, Number(props.w) || 1);
  const h = Math.max(1, Number(props.h) || 1);
  const path = new Path2D();
  path.rect(0, 0, w, h);
  return path;
}

const proto = ShapeUtil.prototype as ShapeUtil & {
  getIndicatorPath?: (shape: TLShape) => Path2D | undefined;
};

proto.getIndicatorPath = function getIndicatorPath(shape: TLShape) {
  return fallbackIndicatorPath(shape);
};

export function ensureShapeUtilIndicatorPath(Util: {
  prototype: { getIndicatorPath?: unknown };
}) {
  if (typeof Util.prototype.getIndicatorPath !== "function") {
    Util.prototype.getIndicatorPath = function getIndicatorPath(shape: TLShape) {
      return fallbackIndicatorPath(shape);
    };
  }
}

export function guardEditorIndicatorPath(editor: {
  getShapeUtil: (shape: TLShape | string) => { getIndicatorPath?: unknown };
}) {
  const original = editor.getShapeUtil.bind(editor);
  editor.getShapeUtil = ((shape: TLShape | string) => {
    const util = original(shape) as {
      getIndicatorPath?: (s: TLShape) => Path2D | undefined;
    };
    if (util && typeof util.getIndicatorPath !== "function") {
      util.getIndicatorPath = fallbackIndicatorPath;
    }
    return util;
  }) as typeof editor.getShapeUtil;
}
