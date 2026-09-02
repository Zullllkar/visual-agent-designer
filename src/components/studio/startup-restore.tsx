"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  decideStartupTarget,
  hasStartupApplied,
  markStartupApplied,
  readLastProjectId,
  readStartupPreference,
} from "@/lib/studio/startup";

export function StartupRestore() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    const target = decideStartupTarget({
      preference: readStartupPreference(),
      lastProjectId: readLastProjectId(),
      alreadyApplied: hasStartupApplied(),
      currentPath: pathname,
    });
    markStartupApplied();
    if (target) router.replace(target);
  }, [pathname, router]);

  return null;
}
