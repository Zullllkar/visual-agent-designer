import type { ProjectFile } from "@/lib/project/schema";
import { projectWithSelectedAssets } from "./select-assets";
import { isCodingHandoffPack, resolveHandoffPackKind } from "./pack-kind";

export type HandoffPreflightLevel = "ok" | "warning" | "error";

export interface HandoffPreflightCheck {
  id: string;
  label: string;
  detail: string;
  level: HandoffPreflightLevel;
}

export interface HandoffPreflightResult {
  ok: boolean;
  finalAssetCount: number;
  referenceCount: number;
  blockedCount: number;
  warningCount: number;
  checks: HandoffPreflightCheck[];
}

export function buildHandoffPreflight(
  project: ProjectFile,
  options?: {
    selectedAssetIds?: ReadonlyArray<string>;
    selectedReferenceIds?: ReadonlyArray<string>;
  }
): HandoffPreflightResult {
  const hasSelectionOpts =
    options?.selectedAssetIds !== undefined ||
    options?.selectedReferenceIds !== undefined;
  const scoped = hasSelectionOpts
    ? projectWithSelectedAssets(
        project,
        options?.selectedAssetIds ??
          (project.assets ?? [])
            .filter(isFinalHandoffAsset)
            .map((a) => a.id),
        options?.selectedReferenceIds
      )
    : project;
  const assets = scoped.assets ?? [];
  const finalAssets = assets.filter(isFinalHandoffAsset);
  const generatingAssets = (project.assets ?? []).filter(
    (asset) => asset.status === "generating"
  );
  const failedAssets = (project.assets ?? []).filter(
    (asset) => asset.status === "failed" || asset.status === "cancelled"
  );
  const remoteFinalAssets = finalAssets.filter((asset) => isRemoteLike(asset.src));
  const localApiAssets = finalAssets.filter((asset) =>
    asset.src.startsWith("/api/assets/")
  );
  const dataUrlAssets = finalAssets.filter((asset) =>
    asset.src.startsWith("data:image/")
  );
  const pngLikeAssets = finalAssets.filter(
    (asset) =>
      /^data:image\/png[;,]/i.test(asset.src) ||
      /\.png(?:$|\?)/i.test(asset.src) ||
      asset.src.startsWith("/api/assets/")
  );
  const withAnySpec = finalAssets.filter((a) => a.designSpec?.summary);
  const withVisionSpec = finalAssets.filter(
    (a) => a.designSpec?.source === "vision"
  );
  const missingSpec = finalAssets.length - withAnySpec.length;
  const selectedIds = new Set(finalAssets.map((a) => a.id));
  const materializations = Object.entries(project.materializations ?? {})
    .filter(([mockupId]) => selectedIds.size === 0 || selectedIds.has(mockupId))
    .map(([, record]) => record);
  const readyMaterializations = materializations.filter((record) =>
    record.layout.nodes.some(
      (node) =>
        node.rebuildInCode === false &&
        node.status === "ready" &&
        Boolean(node.materialAssetId)
    )
  );
  let mediaReadyCount = 0;
  let mediaTotalCount = 0;
  let codeSlotCount = 0;
  for (const record of materializations) {
    for (const node of record.layout.nodes) {
      if (node.rebuildInCode === true) {
        codeSlotCount += 1;
        continue;
      }
      mediaTotalCount += 1;
      if (node.status === "ready" && node.materialAssetId) mediaReadyCount += 1;
    }
  }

  const pack = resolveHandoffPackKind(project);
  const coding = isCodingHandoffPack(pack);

  const checks: HandoffPreflightCheck[] = [
    {
      id: "final-assets",
      label: "最终视觉素材",
      detail:
        finalAssets.length > 0
          ? `${finalAssets.length} 个已选素材会写入 assets/final/`
          : options?.selectedAssetIds !== undefined
            ? "未勾选任何素材，请至少选择 1 张定稿图"
            : "没有可导出的最终素材，先生成或收藏至少 1 张图",
      level: finalAssets.length > 0 ? "ok" : "error",
    },
    {
      id: "embedded-assets",
      label: "PNG / 图片嵌入",
      detail:
        finalAssets.length === 0
          ? "暂无素材可检查"
          : `${dataUrlAssets.length} 个内联图片，${localApiAssets.length} 个本地资产，${remoteFinalAssets.length} 个远程 URL，${pngLikeAssets.length} 个 PNG 优先资产` +
            (remoteFinalAssets.length > 0
              ? "；远程 URL 可能无法嵌入 zip（会退化为 .url.txt）"
              : ""),
      level:
        finalAssets.length === 0
          ? "warning"
          : remoteFinalAssets.length > 0
            ? "warning"
            : "ok",
    },
    {
      id: "design-specs",
      label: "设计规格",
      detail: coding
        ? finalAssets.length === 0
          ? "暂无素材可检查"
          : missingSpec > 0
            ? `${missingSpec} 张缺规格；${withVisionSpec.length} 张 vision / ${withAnySpec.length} 张已有规格。建议在画布「生成规格」后再交付`
            : withVisionSpec.length === finalAssets.length
              ? `${withVisionSpec.length} 张均有 vision 规格`
              : `${withAnySpec.length} 张有规格（vision ${withVisionSpec.length}），其余将用启发式补全`
        : "本目标导出美术/投放包，不写 UI 设计规格",
      level:
        !coding || finalAssets.length === 0
          ? "ok"
          : missingSpec > 0 || withVisionSpec.length < finalAssets.length
            ? "warning"
            : "ok",
    },
    {
      id: "materials",
      label: coding ? "拆解素材（材料包）" : "拆解素材",
      detail: coding
        ? readyMaterializations.length > 0
          ? `${readyMaterializations.length} 张整图已拆：媒体材料 ${mediaReadyCount}/${mediaTotalCount} 就绪，代码槽 ${codeSlotCount}；写入 assets/materials/ + design/layouts/`
          : materializations.length > 0
            ? `已有布局（媒 ${mediaTotalCount} / 码 ${codeSlotCount}）但材料未就绪；请在审槽确认生成后再导出`
            : "尚未拆解材料。高保真交付建议：满意整图 → 拆解方案 → 确认生成素材 → 再导出"
        : pack === "art-bible"
          ? "美术包不拆解材料，只带 PNG 与用途说明"
          : pack === "media-pack"
            ? "投放包不拆解材料"
            : "风格草稿包不拆解材料",
      level:
        !coding
          ? "ok"
          : readyMaterializations.length > 0
            ? "ok"
            : finalAssets.length > 0
              ? "warning"
              : "ok",
    },
    {
      id: "pending-assets",
      label: "未完成任务",
      detail:
        generatingAssets.length > 0
          ? `${generatingAssets.length} 个占位素材仍在生成中，不会进入交付包`
          : "没有生成中的占位素材",
      level: generatingAssets.length > 0 ? "warning" : "ok",
    },
    {
      id: "failed-assets",
      label: "失败/取消素材",
      detail:
        failedAssets.length > 0
          ? `${failedAssets.length} 个失败或取消素材会被排除`
          : "没有失败或取消素材",
      level: failedAssets.length > 0 ? "warning" : "ok",
    },
    {
      id: "brief",
      label: "项目 Brief",
      detail: project.brief
        ? `${project.brief.productName} / ${project.targetId ?? project.brief.platform}`
        : "缺少结构化 Brief，交付说明会退回使用原始想法",
      level: project.brief ? "ok" : "warning",
    },
    {
      id: "direction",
      label: "设计方向",
      detail: project.designDirection
        ? project.designDirection.summary
        : coding
          ? "缺少设计方向，Coding Agent 对视觉还原的约束会变弱"
          : "缺少设计方向，包里的方向卡说明会变短",
      level: project.designDirection ? "ok" : "warning",
    },
    {
      id: "references",
      label: "参考素材",
      detail:
        (scoped.references?.length ?? 0) > 0
          ? `${scoped.references?.length ?? 0} 个已选参考会写入 assets/references/`
          : options?.selectedReferenceIds !== undefined
            ? "未勾选参考图（可选）"
            : "没有参考素材",
      level: "ok",
    },
    {
      id: "delivery-scope",
      label: "交付范围",
      detail:
        finalAssets.length > 0
          ? coding
            ? `本次包仅含已勾选的 ${finalAssets.length} 张定稿 + ${scoped.references?.length ?? 0} 张参考；Brief 中未配图的界面请勿擅自扩展`
            : pack === "none"
              ? `探索草稿：${finalAssets.length} 张图，不是施工包`
              : `本次包仅含已勾选的 ${finalAssets.length} 张定稿 + ${scoped.references?.length ?? 0} 张参考`
          : "尚未确定交付范围",
      level: finalAssets.length > 0 ? "ok" : "warning",
    },
  ];

  const blockedCount = checks.filter((check) => check.level === "error").length;
  const warningCount = checks.filter((check) => check.level === "warning").length;

  return {
    ok: blockedCount === 0,
    finalAssetCount: finalAssets.length,
    referenceCount: scoped.references?.length ?? 0,
    blockedCount,
    warningCount,
    checks,
  };
}

function isFinalHandoffAsset(
  asset: NonNullable<ProjectFile["assets"]>[number]
): boolean {
  return (
    asset.status !== "discarded" &&
    asset.status !== "failed" &&
    asset.status !== "cancelled" &&
    asset.status !== "generating"
  );
}

function isRemoteLike(src: string): boolean {
  return /^https?:\/\//i.test(src);
}
