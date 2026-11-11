---
name: reading-tracker-quality
description: "Use when debugging, auditing, testing, or shipping the Reading Tracker app. Covers root-cause-first debugging, Playwright E2E checks, dead-code cleanup, and atomic Git commits."
argument-hint: "[bug, journey, or release task]"
user-invocable: true
---

# Reading Tracker Quality Workflow

## Use when

- Investigating an unexpected frontend or API behavior.
- Adding or maintaining Playwright end-to-end coverage.
- Auditing dead code before cleanup.
- Preparing a tested, focused Git commit.

## Procedure

1. Restate the observed behavior, expected behavior, actual behavior, relevant code, and attempts already made.
2. Inspect the smallest relevant surface before editing. Rank three to five likely root causes by probability and cite evidence.
3. Confirm or eliminate each cause with one targeted check, log line, or focused test. Do not shotgun-edit.
4. For UI changes, identify critical user journeys and failure states before writing tests.
5. Use resilient role-based or `data-testid` selectors. Add a `data-testid` only when semantic selectors are not stable.
6. Keep E2E data isolated with request interception or a dedicated test database. Never depend on shared production data.
7. Run `npm run test:e2e:ci` for CI-style validation. Keep trace, screenshot, and video capture enabled on failure.
8. For dead-code cleanup, audit first and list candidates with evidence and risk. Do not remove anything until the user approves the candidate list.
9. Keep commits atomic. Use a Conventional Commit type and an imperative subject under 60 characters, followed by a body explaining why and any trade-off.

## Constraints

- Preserve existing behavior unless the task explicitly changes it.
- Do not hide backend, network, or validation errors.
- Do not put secrets in frontend files, tests, or commits.
- Do not commit `node_modules`, `.env`, or generated Playwright artifacts.
- When no Git repository exists, report that fact before creating one.
