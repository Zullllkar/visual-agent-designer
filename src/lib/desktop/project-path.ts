/** 从路由解析画布项目 id，供桌面顶栏读标题。 */

export function parseProjectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  if (!match) return null;
  const id = match[1];
  if (id === "new") return null;
  return id;
}

export function desktopTitleForPath(pathname: string): string {
  if (pathname === "/projects" || pathname.startsWith("/projects?")) {
    return "Vibeboard";
  }
  if (pathname.startsWith("/projects/new")) return "Vibeboard";
  if (parseProjectIdFromPath(pathname)) return "画布";
  return "Vibeboard";
}
