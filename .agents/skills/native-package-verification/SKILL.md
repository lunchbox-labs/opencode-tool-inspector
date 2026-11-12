---
name: native-package-verification
description: Use when verifying changes to TUI behavior, host integration, package exports, or distributed files.
---

Read the root package.json, the affected packages' package.json and tests/package.integration.ts, and the affected tests before selecting checks. Use the committed lockfile and supported Node version; install with npm ci from the repository root when needed. Do not change dependencies, versions, or security exceptions to make checks pass.

Run npm run check for static and unit checks across packages/core, packages/opencode and packages/kilo. Run npm run test:package for exports or distribution changes; it packs core with each host package and installs them together, so inspect the packed file lists and exercise the packed packages rather than relying on source imports. Keep root .agents, .codex, .claude, .opencode and CLAUDE.md contributor files out of the packages, and keep both host packages TUI-only with no root or ./server export.

For TUI or host integration changes, check each host the change can reach. Run npm run test:native with NATIVE_HOST=kilo and KILO_TEST_VERSION set to floor or latest-compatible for the isolated Kilo CLI check, which runs on Linux and Windows x64. OpenCode has no automated native check: load the built plugin from tui.jsonc in a real OpenCode TUI within the range in packages/opencode/tests/opencode.json, using an isolated project and configuration. Do not invoke paid model/API calls, and do not call tools that change files or external state while verifying. Report unavailable hosts or blocked checks rather than replacing native evidence with a mock.

Report commands, exit results, host and version, observed TUI or package evidence, and any skipped or unavailable checks. Distinguish source inference, unit/packed tests and native runtime observations. Keep detailed task evidence on the linked issue, not in committed plan documents.
