import { IdeShell } from "@/components/ide/ide-shell";

/**
 * 项目工作台（Open Design 三栏 IDE）
 * --------------------------------------------------------------
 * Next 16: params 是 Promise，必须 await。
 * 项目数据存在浏览器 store / IndexedDB，工作台主体在客户端。
 */
export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IdeShell projectId={id} />;
}
