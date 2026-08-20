# Skills Hub E2E Implementation Mapping

This document records how the 29 test cases defined in `test-cases.md` map onto the actual E2E implementation files.

**Generated**: 2026-04-21
**Implementation directory**: `tests/e2e/features/settings/skills/`
**Document version**: test-cases.md v1.3

---

## Statistics Overview

| Category                   | Documented | Implemented | Status          |
| -------------------------- | ---------- | ----------- | --------------- |
| P0 Core interactions       | 8          | 8           | ✅ 100%         |
| P1 Functional verification | 15         | 15          | ✅ 100%         |
| P2 Edge cases              | 5          | 5           | ✅ 100%         |
| P3 Performance tests       | 1          | 1           | ✅ 100%         |
| **Total**                  | **29**     | **29**      | ✅ 100% (29/29) |

**Total screenshots**: 126 `takeScreenshot()` calls
**Average screenshots per test**: 4.3

---

## P0 Core Interactions (8/8 implemented)

| Case ID | Case Title                                      | Implementation File                                          | Line | Test Function Name                                                                | Pass | Screenshots |
| ------- | ----------------------------------------------- | ------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------- | ---- | ----------- |
| TC-S-01 | Render the My Skills list (baseline scenario)   | tests/e2e/features/settings/skills/core-ui.e2e.ts            | 68   | `test('TC-S-01: should render My Skills section with builtin and custom skills')` | ✅   | 3           |
| TC-S-02 | Search skills (matching scenario)               | tests/e2e/features/settings/skills/search.e2e.ts             | 41   | `test('TC-S-02: should filter My Skills list by search keyword')`                 | ✅   | 3           |
| TC-S-05 | Delete a custom skill (success scenario)        | tests/e2e/features/settings/skills/core-ui.e2e.ts            | 136  | `test('TC-S-05: should delete custom skill via UI with confirmation modal')`      | ✅   | 5           |
| TC-S-08 | Render the external skills list (single source) | tests/e2e/features/settings/skills/core-ui.e2e.ts            | 264  | `test('TC-S-08: should render external skills section with custom source')`       | ✅   | 4           |
| TC-S-09 | Switch external sources by tab (multi-source)   | tests/e2e/features/settings/skills/refresh-empty-tabs.e2e.ts | 137  | `test('TC-S-09: should switch tabs and show correct external skills')`            | ✅   | 4           |
| TC-S-10 | Import a single external skill (success)        | tests/e2e/features/settings/skills/core-ui.e2e.ts            | 322  | `test('TC-S-10: should import external skill via UI click')`                      | ✅   | 5           |
| TC-S-16 | Add a custom external path (success)            | tests/e2e/features/settings/skills/core-ui.e2e.ts            | 386  | `test('TC-S-16: should add custom external path via UI')`                         | ✅   | 7           |
| TC-S-19 | Export a skill to an external source (success)  | tests/e2e/features/settings/skills/core-ui.e2e.ts            | 473  | `test('TC-S-19: should export skill to external source via UI')`                  | ✅   | 5           |

**Subtotal**: 8 tests, 36 screenshots

---

## P1 Functional Verification (15/15 implemented)

| Case ID | Case Title                                     | Implementation File                                          | Line | Test Function Name                                                                      | Pass | Screenshots |
| ------- | ---------------------------------------------- | ------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------- | ---- | ----------- |
| TC-S-03 | Search skills (no-match scenario)              | tests/e2e/features/settings/skills/search.e2e.ts             | 112  | `test('TC-S-03: should show empty state when search has no match')`                     | ✅   | 3           |
| TC-S-04 | Refresh the skills list                        | tests/e2e/features/settings/skills/refresh-empty-tabs.e2e.ts | 39   | `test('TC-S-04: should refresh My Skills list and show newly added skill')`             | ✅   | 4           |
| TC-S-06 | Delete a builtin skill (no delete button)      | tests/e2e/features/settings/skills/core-ui.e2e.ts            | 219  | `test('TC-S-06: should not show delete button for builtin skills')`                     | ✅   | 3           |
| TC-S-07 | Empty state display (no skills)                | tests/e2e/features/settings/skills/refresh-empty-tabs.e2e.ts | 104  | `test('TC-S-07: should show empty state when no skills exist')`                         | ✅   | 3           |
| TC-S-11 | Batch import external skills (partial success) | tests/e2e/features/settings/skills/batch-import.e2e.ts       | 36   | `test('TC-S-11: should batch import external skills and skip already existing ones')`   | ✅   | 5           |
| TC-S-12 | Search external skills (matching scenario)     | tests/e2e/features/settings/skills/search.e2e.ts             | 152  | `test('TC-S-12: should filter external skills list by search keyword')`                 | ✅   | 3           |
| TC-S-13 | Search external skills (no-match scenario)     | tests/e2e/features/settings/skills/search.e2e.ts             | 206  | `test('TC-S-13: should show empty state when external search has no match')`            | ✅   | 3           |
| TC-S-14 | Refresh the external skills list               | tests/e2e/features/settings/skills/path-export.e2e.ts        | 45   | `test('TC-S-14: should refresh external skills and show newly added skill')`            | ✅   | 4           |
| TC-S-17 | Add a custom path (duplicate path scenario)    | tests/e2e/features/settings/skills/path-export.e2e.ts        | 109  | `test('TC-S-17: should show error when adding duplicate custom path')`                  | ✅   | 5           |
| TC-S-18 | Add a custom path (required-field validation)  | tests/e2e/features/settings/skills/path-export.e2e.ts        | 169  | `test('TC-S-18: should disable Confirm button when required fields are empty')`         | ✅   | 7           |
| TC-S-20 | Export a skill (target already exists)         | tests/e2e/features/settings/skills/path-export.e2e.ts        | 228  | `test('TC-S-20: should show error when exporting to target with existing skill')`       | ✅   | 5           |
| TC-S-22 | Highlight a skill via URL parameter (success)  | tests/e2e/features/settings/skills/url-highlight.e2e.ts      | 30   | `test('TC-S-22: should highlight skill and scroll to it when URL has highlight param')` | ✅   | 6           |
| TC-S-27 | Render the Extension Skills board              | tests/e2e/features/settings/skills/boards-rendering.e2e.ts   | 26   | `test('TC-S-27: should render Extension Skills board with correct structure')`          | ✅   | 4           |
| TC-S-28 | Render the Auto-injected Skills board          | tests/e2e/features/settings/skills/boards-rendering.e2e.ts   | 60   | `test('TC-S-28: should render Auto-injected Skills board with correct structure')`      | ✅   | 4           |
| TC-S-29 | Import a skill from a folder (mocked scenario) | tests/e2e/features/settings/skills/manual-import.e2e.ts      | 29   | `test('TC-S-29: should import skill from folder via mocked dialog')`                    | ✅   | 6           |

**Subtotal**: 15 tests, 65 screenshots

---

## P2 Edge Cases (5/5 implemented)

| Case ID | Case Title                                            | Implementation File                                     | Line | Test Function Name                                                                                 | Pass | Screenshots |
| ------- | ----------------------------------------------------- | ------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- | ---- | ----------- |
| TC-S-15 | Empty external source state (no external skills)      | tests/e2e/features/settings/skills/edge-cases.e2e.ts    | 56   | `test('TC-S-15: should not show custom external source tabs when no custom paths exist')`          | ✅   | 4           |
| TC-S-21 | Export a skill (no external sources available)        | tests/e2e/features/settings/skills/edge-cases.e2e.ts    | 100  | `test('TC-S-21: should show export button but only builtin targets when no custom sources exist')` | ✅   | 4           |
| TC-S-23 | Highlight a skill via URL parameter (skill not found) | tests/e2e/features/settings/skills/edge-cases.e2e.ts    | 151  | `test('TC-S-23: should not crash when URL highlight param references non-existent skill')`         | ✅   | 4           |
| TC-S-24 | Skill names containing special characters (import)    | tests/e2e/features/settings/skills/special-cases.e2e.ts | 34   | `test('TC-S-24: should handle skills with special characters in names')`                           | ✅   | 4           |
| TC-S-26 | Concurrent operations (rapid repeated refresh)        | tests/e2e/features/settings/skills/special-cases.e2e.ts | 150  | `test('TC-S-26: should handle rapid refresh clicks without crashing')`                             | ✅   | 6           |

**Subtotal**: 5 tests, 22 screenshots

---

## P3 Performance Tests (1/1 implemented)

| Case ID | Case Title                                  | Implementation File                                     | Line | Test Function Name                                                              | Pass | Screenshots |
| ------- | ------------------------------------------- | ------------------------------------------------------- | ---- | ------------------------------------------------------------------------------- | ---- | ----------- |
| TC-S-25 | Rendering a large skills list (performance) | tests/e2e/features/settings/skills/special-cases.e2e.ts | 88   | `test('TC-S-25: should handle rendering 20 skills without performance issues')` | ✅   | 3           |

**Subtotal**: 1 test, 3 screenshots

---

## Screenshot Count Analysis

### Grouped by Priority

| Priority  | Tests  | Total Screenshots | Average Screenshots |
| --------- | ------ | ----------------- | ------------------- |
| P0        | 8      | 36                | 4.5                 |
| P1        | 15     | 65                | 4.3                 |
| P2        | 5      | 22                | 4.4                 |
| P3        | 1      | 3                 | 3.0                 |
| **Total** | **29** | **126**           | **4.3**             |

### Grouped by File

| File Name                 | Tests  | Total Screenshots |
| ------------------------- | ------ | ----------------- |
| core-ui.e2e.ts            | 7      | 32                |
| path-export.e2e.ts        | 4      | 21                |
| special-cases.e2e.ts      | 3      | 13                |
| edge-cases.e2e.ts         | 3      | 12                |
| search.e2e.ts             | 4      | 12                |
| refresh-empty-tabs.e2e.ts | 3      | 11                |
| boards-rendering.e2e.ts   | 2      | 8                 |
| url-highlight.e2e.ts      | 1      | 6                 |
| manual-import.e2e.ts      | 1      | 6                 |
| batch-import.e2e.ts       | 1      | 5                 |
| **Total**                 | **29** | **126**           |

---

## Implementation File Notes

### Core UI tests (core-ui.e2e.ts, 32 screenshots)

Contains the 7 test cases covering the P0 backbone functionality:

- Rendering the My Skills list (TC-S-01)
- Deleting a custom skill (TC-S-05)
- Verifying the delete button on builtin skills (TC-S-06)
- Rendering the external skills list (TC-S-08)
- Importing a single external skill (TC-S-10)
- Adding a custom external path (TC-S-16)
- Exporting a skill to an external source (TC-S-19)

### Search tests (search.e2e.ts, 12 screenshots)

Contains the 4 search-related test cases:

- Searching My Skills (match and no-match) (TC-S-02, TC-S-03)
- Searching external skills (match and no-match) (TC-S-12, TC-S-13)

### Path and export tests (path-export.e2e.ts, 21 screenshots)

Contains the 4 test cases for path management and export:

- Refreshing the external skills list (TC-S-14)
- Adding a custom path (duplicate scenario and required-field validation) (TC-S-17, TC-S-18)
- Exporting a skill (target already exists) (TC-S-20)

### Refresh and empty-state tests (refresh-empty-tabs.e2e.ts, 11 screenshots)

Contains the 3 test cases for refresh and empty states:

- Refreshing the My Skills list (TC-S-04)
- Empty state display (TC-S-07)
- Switching external sources by tab (TC-S-09)

### Special scenario tests (special-cases.e2e.ts, 13 screenshots)

Contains the 3 test cases for special scenarios:

- Skill names with special characters (TC-S-24)
- Rendering a large skills list (TC-S-25)
- Rapid concurrent refreshes (TC-S-26)

### Edge case tests (edge-cases.e2e.ts, 12 screenshots)

Contains the 3 test cases for boundary scenarios:

- Empty external source state (TC-S-15)
- Exporting when no external source exists (TC-S-21)
- URL highlight for a skill that does not exist (TC-S-23)

### Board rendering tests (boards-rendering.e2e.ts, 8 screenshots)

Contains the 2 board rendering test cases:

- Extension Skills board (TC-S-27, 4 screenshots)
- Auto-injected Skills board (TC-S-28, 4 screenshots)

### Batch import tests (batch-import.e2e.ts, 5 screenshots)

Contains the 1 batch import test case:

- Batch importing external skills (partial success) (TC-S-11)

### URL highlight tests (url-highlight.e2e.ts, 6 screenshots)

Contains the 1 URL highlight test case:

- Highlighting a skill via URL parameter (success scenario) (TC-S-22)

### Manual import tests (manual-import.e2e.ts, 6 screenshots)

Contains the 1 manual import test case:

- Importing a skill from a folder (mocked scenario) (TC-S-29)

---

## Test Quality Metrics

### Screenshot coverage

- **Every test includes screenshots**: 29/29 (100%)
- **Meets the "at least 3 screenshots" rule**: 29/29 (100%)

### Test case completeness

- **P0 core functionality coverage**: 8/8 (100%)
- **P1 functional verification coverage**: 15/15 (100%)
- **P2 edge case coverage**: 5/5 (100%)
- **P3 performance test coverage**: 1/1 (100%)

### Balance of the implementation split

- **Largest file (core-ui.e2e.ts)**: 7 tests, 24.1%
- **Smallest files (manual-import.e2e.ts and others)**: 1 test, 3.4%
- **Average tests per file**: 2.9 tests

---

## Maintenance Notes

### When to update this document

1. A new test case is added to `test-cases.md`
2. A test case ID or title changes
3. A test case priority is adjusted
4. The test file structure is refactored (files split or merged)

### Update procedure

1. Run `grep -c "^\s*await takeScreenshot" <file>` to recount the screenshots
2. Update the numbers in the statistics overview
3. Update the corresponding rows in the mapping tables
4. Verify that the group subtotals add up to the overall total
5. Commit the change and state the reason for the update

---

**Last updated**: 2026-04-21
**Maintainer**: skills-designer-2
