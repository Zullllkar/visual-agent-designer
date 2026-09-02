# Changelog

All notable changes to Vibeboard are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- English-first README with badges, pipeline diagram, and comparison table
- Chinese README (`README.zh.md`) as a separate document
- Contributing guidelines (`CONTRIBUTING.md`)
- Issue templates for bug reports and feature requests
- Pull request template
- Project roadmap (`ROADMAP.md`)
- This changelog

## [0.1.0] - 2025-07-10

### Added

- ChatCanvas workspace built on tldraw 5 infinite canvas
- Multi-agent pipeline: Brief → Architect → Design Direction → Layout → Content → Image Plan → Image Execute → Critic / Repair
- Local-first project persistence to `.vad/projects/`
- In-app LLM and image provider configuration (API keys stored locally)
- Handoff export: PNG assets, prompts, design tokens, and Brief context bundled for coding agents
- Optional daemon process for disk I/O isolation (`pnpm daemon`)
- Bilingual UI with Chinese / English language toggle
- Light / dark theme toggle
- Design system reference pages (`design-systems/landing.html`, `canvas.html`)
- Architecture documentation (`docs/ARCHITECTURE.md`)
- Daemon documentation (`docs/DAEMON.md`)
- Product specification (`PRODUCT.md`)

### Technical

- Next.js 16 with App Router
- React 19 + TypeScript 5
- tldraw 5 for canvas rendering
- Zustand for state management
- Tailwind CSS 4 for styling
- Apache License 2.0
