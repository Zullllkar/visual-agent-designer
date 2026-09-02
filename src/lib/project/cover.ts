type CoverAsset = {
  status?: string;
  src?: string;
};

export function projectCoverSrc(project: { assets?: CoverAsset[] }): string | null {
  const asset = (project.assets ?? []).find(
    (item) => item.status !== "discarded" && Boolean(item.src)
  );
  return asset?.src ?? null;
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const delta = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
  return new Date(then).toLocaleDateString("zh-CN");
}
