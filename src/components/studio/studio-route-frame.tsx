"use client";

import { usePathname } from "next/navigation";
import { StudioFrame, type StudioSection } from "./studio-frame";

const STUDIO_SECTIONS: Record<string, StudioSection> = {
  "/": "home",
  "/projects": "projects",
  "/skills": "skills",
};

export function StudioRouteFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = STUDIO_SECTIONS[pathname];
  if (!active) return children;
  return <StudioFrame active={active}>{children}</StudioFrame>;
}
