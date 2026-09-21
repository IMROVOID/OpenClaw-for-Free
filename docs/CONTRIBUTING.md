# Contributing to OpenClaw-for-free

Thank you for contributing to OpenClaw-for-free! This document provides guidelines and instructions for setting up your development environment, authoring tests, adhering to coding standards, and submitting pull requests.

## 1. Development Environment Setup

### Prerequisites

- **Node.js**: `>= 22.0.0 LTS` (ESM native)
- **TypeScript**: `7.0.2` or later
- **OpenSSH Client**: `ssh.exe` on Windows (available via Windows Optional Features) or `ssh` on macOS/Linux
- **Package Manager**: `npm` (bundled with Node.js) or `npx`

### Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/IMROVOID/OpenClaw-for-free.git
cd OpenClawDaytonaAssistant

# 2. Install dependencies
npm install

# 3. Verify TypeScript types
npm run typecheck

# 4. Run automated test suite
npm test
```

## 2. Available Scripts Reference

<!-- AUTO-GENERATED: package.json scripts -->
| Script | Command | Purpose |
| :--- | :--- | :--- |
| `start` | `npx tsx src/control-panel/index.ts` | Launch the Unified Modern TUI Control Panel with mouse and auto-detection |
| `start:bot` | `npx tsx src/telegram-bot/index.ts` | Launch the GrammY-based Telegram Bot Assistant |
| `test` | `npx tsx tests/run_all_tests.ts` | Execute the complete 45-module automated test suite |
| `test:all` | `npx tsx tests/run_all_tests.ts` | Alias for executing all test modules |
| `build` | `npx tsx launchers/build.ts` | Build all Single Executable Applications (SEA) via esbuild & postject |
| `build:panel` | `npx tsx launchers/build.ts --panel` | Build only the Control Panel standalone executable (`OpenClaw-Control-Panel.exe`) |
| `typecheck` | `npx tsc --noEmit` | Strict type checking without emitting JavaScript files |
<!-- /AUTO-GENERATED -->

## 3. Testing Procedures

### Running Tests

- **Full Test Suite**:

  ```bash
  npm test
  ```

- **Single Test File**:

  ```bash
  npx tsx tests/test_control_panel_state.ts
  ```

### Test Standards

- **Pattern**: Follow the **Arrange-Act-Assert (AAA)** pattern for all test cases.
- **Independence**: Tests must be hermetic and avoid hard dependencies on live cloud environments or running SSH daemons. Mock remote SSH and API responses using helper mocks.
- **Coverage**: New features or bug fixes must include unit or integration tests in `tests/`, and must be registered in `tests/run_all_tests.ts`.

## 4. Code Standards & Architecture Guidelines

Contributors must strictly respect project governance rules:

### A. Modularity & File Size Ceiling (P1)

- **Hard Limit**: Target **200 lines**, strictly under **300 lines** per file.
- **Single Responsibility**: Every module must have one clearly defined responsibility. If a module grows beyond 200 lines, decompose it into domain subdirectories (e.g. `handlers/`, `services/`, `core/`).
- **No God Files**: Avoid monolithic classes or centralized monster modules.

### B. TypeScript & Type Safety (P3)

- **Zero `any`**: Explicit typing is mandatory. Use `unknown` with type guards if the input type is truly arbitrary.
- **Explicit Export Signatures**: All exported functions, methods, and classes must specify explicit parameter and return types.
- **Async Safety**: Always handle promise rejections and clean up child processes or timers.

### C. Security & Integrity (P0)

- **Zero Committed Secrets**: Never commit API keys, bot tokens, passwords, or private keys.
- **Boundary Validation**: Validate all environment variables and external payloads (API responses, Telegram webhooks) at runtime before consumption.
- **Immutability First**: Favor `readonly`, `const`, and immutable data structures wherever feasible.

### D. Implementation Economy / Ponytail (P2)

- **YAGNI Ladder**:
  1. Can we solve this without new code?
  2. Can we reuse existing codebase utilities?
  3. Can Node.js standard library or native APIs accomplish this?
  4. Can existing dependencies solve this?
  5. Shortest working diff over complex net-new abstractions.

## 5. Pull Request Submission Checklist

Before submitting a pull request, ensure you have completed each of the following:

- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npm test` passes all 45 test modules successfully.
- [ ] Any newly created files follow the `< 200-300 lines` modularity guideline.
- [ ] No API keys, credentials, or sensitive tokens are included in commits or diffs.
- [ ] If adding new environment variables, document them in `.env.example` and `docs/RUNBOOK.md`.
- [ ] Commit messages follow the Conventional Commits specification (e.g., `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`).
