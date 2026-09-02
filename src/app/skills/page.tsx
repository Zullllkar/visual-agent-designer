import type { Metadata } from "next";
import { SkillManager } from "@/components/skills/skill-manager";

export const metadata: Metadata = {
  title: "Skill · Vibeboard",
};

export default function SkillsPage() {
  return <SkillManager />;
}
