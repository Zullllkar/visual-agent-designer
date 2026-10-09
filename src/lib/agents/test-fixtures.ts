import { createPlaceholderProject } from "@/lib/project/placeholder";
import type { ProjectFile } from "@/lib/project/schema";
import { MockLlmProvider } from "@/lib/providers/llm/mock";
import { MockImageProvider } from "@/lib/providers/image/mock";
import type { ToolContext } from "./tools/types";
import type { ImageAsset } from "@/lib/project/assets-schema";

export function createImageAssetFixture(id: string, overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id,
    prompt: `fixture ${id}`,
    src: `data:image/png;base64,${id}`,
    width: 1024,
    height: 768,
    model: "fixture-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "candidate",
    source: "generated",
    ...overrides,
  };
}

export function createProjectFixture(overrides: Partial<ProjectFile> = {}): ProjectFile {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "fixture-project",
    slug: "fixture-project",
    title: "Fixture Project",
    rawIdea: "A valid visual agent fixture project",
    createdAt: now,
    updatedAt: now,
    pages: [],
    assets: [],
    ...overrides,
  };
}

/** Valid test context using the same project shape and providers as runtime. */
export function createTestToolContext(project: ProjectFile | null = createProjectFixture(createPlaceholderProject("agent-test", "Test visual"))): ToolContext {
  return {
    project,
    userMessage: "Test visual",
    agentCtx: {
      projectId: project?.id ?? "agent-test",
      scratch: {},
      providers: { llm: MockLlmProvider, image: MockImageProvider, visionCritic: false },
    },
    providerConfig: { llm: { kind: "mock" }, image: { kind: "mock" }, allowMockDev: true },
  };
}
