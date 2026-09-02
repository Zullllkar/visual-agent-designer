import type { Metadata } from "next";
import { StudioProjectsLibrary } from "@/components/studio/studio-projects-library";

export const metadata: Metadata = {
  title: "项目库 · Vibeboard",
};

export default function ProjectsPage() {
  return <StudioProjectsLibrary />;
}
