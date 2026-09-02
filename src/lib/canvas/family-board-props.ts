import { T } from "tldraw";

/** 旧 IndexedDB 底板没有 projectId；缺字段必须能通过校验，否则 tldraw 白屏。 */
export const familyBoardShapeProps = {
  w: T.number,
  h: T.number,
  rootAssetId: T.string,
  memberAssetIds: T.string,
  label: T.string,
  projectId: T.string.optional(),
};
