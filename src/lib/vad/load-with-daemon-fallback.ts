/**
 * Daemon 404/null 不能当成“项目不存在”——本地工作区目录里可能仍有 project.json。
 */
export async function loadWithDaemonFallback<T>(
  daemonFn: () => Promise<T | null>,
  localFn: () => Promise<T | null>,
  daemonEnabled: boolean,
  label: string,
): Promise<T | null> {
  if (!daemonEnabled) return localFn();
  try {
    const fromDaemon = await daemonFn();
    if (fromDaemon != null) return fromDaemon;
  } catch (error) {
    console.warn(`[vad-storage] daemon ${label} failed, fallback local:`, error);
  }
  return localFn();
}

export async function loadListPreferLocalIfEmpty<T>(
  daemonFn: () => Promise<T[]>,
  localFn: () => Promise<T[]>,
  daemonEnabled: boolean,
  label: string,
): Promise<T[]> {
  if (!daemonEnabled) return localFn();
  try {
    const fromDaemon = await daemonFn();
    if (fromDaemon.length > 0) return fromDaemon;
  } catch (error) {
    console.warn(`[vad-storage] daemon ${label} failed, fallback local:`, error);
  }
  return localFn();
}
