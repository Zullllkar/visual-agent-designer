/**
 * Chat 页面/元素/素材引用解析
 * --------------------------------------------------------------
 * 解析 Comment Mode 注入的前缀，供 Orchestrator 精确路由。
 *
 * @author：wangjunhua
 */

export function parsePageReference(raw: string): {
  pageId?: string;
  pageName?: string;
  nodeId?: string;
  nodeLabel?: string;
  assetId?: string;
  assetName?: string;
  cleanText: string;
} {
  const asset = raw.match(/^【引用素材:\s*([^#】]+)#([\w-]+)】\s*/);
  if (asset) {
    return {
      assetName: asset[1].trim(),
      assetId: asset[2].trim(),
      cleanText: raw.slice(asset[0].length).trim(),
    };
  }
  const element = raw.match(
    /^【引用元素:\s*([^#】]+)#([\w-]+)\/([^#】]+)#([\w-]+)】\s*/
  );
  if (element) {
    return {
      pageName: element[1].trim(),
      pageId: element[2].trim(),
      nodeLabel: element[3].trim(),
      nodeId: element[4].trim(),
      cleanText: raw.slice(element[0].length).trim(),
    };
  }
  const m = raw.match(/^【引用页面:\s*([^#】]+)#([\w-]+)】\s*/);
  if (!m) return { cleanText: raw };
  return {
    pageName: m[1].trim(),
    pageId: m[2].trim(),
    cleanText: raw.slice(m[0].length).trim(),
  };
}
