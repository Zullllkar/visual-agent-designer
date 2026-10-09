import * as Tldraw from "tldraw";

/** Runtime helper exported by the editor bundle but omitted from tldraw's root d.ts. */
export const createShapeId = (Tldraw as { createShapeId?: (id?: string) => unknown }).createShapeId as (id?: string) => any;

/** Compatibility types for custom shapes. Runtime validation remains in each ShapeUtil. */
export type RecordProps<T> = Record<string, any>;
export type TLBaseShape<Type extends string, Props extends object> = any;
