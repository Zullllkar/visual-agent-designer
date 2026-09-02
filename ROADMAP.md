# Roadmap

This document outlines planned features and milestones. It is a living document — priorities may shift based on user feedback.

## Legend

- ✅ Done
- 🚧 In Progress
- 📋 Planned
- 💡 Exploring

---

## v0.1.0 — Foundation (Current)

- ✅ ChatCanvas workspace (tldraw 5)
- ✅ Multi-agent pipeline (Brief → Architect → Design Direction → Layout → Content → Image Plan → Image Execute → Critic)
- ✅ Local-first persistence (`.vad/projects/`)
- ✅ In-app provider configuration (LLM + image generation)
- ✅ Handoff export (PNG + prompts + design tokens + Brief context)
- ✅ Optional daemon for disk I/O isolation
- ✅ Bilingual UI (Chinese / English)
- ✅ Theme toggle (light / dark)

## v0.2.0 — Pipeline Enhancements

- 📋 Image iteration: regenerate individual assets without re-running the full pipeline
- 📋 Pipeline checkpointing: resume from any agent step
- 📋 Custom agent definitions: user-defined agents in the pipeline
- 📋 Batch image generation: parallel execution for multiple pages/screens
- 📋 Pipeline history: diff between runs, revert to previous states

## v0.3.0 — Provider Ecosystem

- 📋 ComfyUI integration for local image generation
- 📋 Stable Diffusion (Automatic1111 / SD WebUI) provider
- 📋 Azure OpenAI provider support
- 📋 Google Gemini / Imagen provider support
- 📋 Provider health checks and fallback routing

## v0.4.0 — Canvas & Collaboration

- 📋 Asset library: reusable components across projects
- 📋 Canvas templates: pre-built layouts for common app types
- 📋 Export to Figma (via plugin or JSON)
- 📋 SVG export for vector assets
- 📋 Multi-page canvas support

## v0.5.0 — Handoff & Integration

- 📋 Cursor-specific handoff format (`.cursorrules` + context)
- 📋 Claude Code handoff format (`CLAUDE.md` + assets)
- 📋 Codex handoff format
- 📋 Design token export (CSS variables, Tailwind config, SCSS)
- 📋 Component spec generation (React prop types, Storybook stories)

## v0.6.0 — Developer Experience

- 📋 CLI tool: `vad create`, `vad export`, `vad pipeline run`
- 📋 VS Code extension: browse and insert assets from Vibeboard
- 📋 Watch mode: auto-export handoff on pipeline completion
- 📋 Project templates: SaaS landing, mobile app, dashboard, portfolio

## Future — Exploring

- 💡 Real-time collaboration (CRDT-based canvas sync)
- 💡 Agent marketplace: share and download agent configurations
- 💡 Fine-tuned image models for specific design styles
- 💡 Voice-driven brief input
- 💡 Plugin system for custom pipeline stages

---

## Milestone Tracking

Milestones are tracked via [GitHub Milestones](https://github.com/Zullllkar/vibeboard/milestones). Each PR should reference the milestone it belongs to.

## Feedback

Have a feature request or want to prioritize something? Open a [Discussion](https://github.com/Zullllkar/vibeboard/discussions) or vote on existing ones.
