# SkillsHub E2E Test Strategy

**Document version**: v1.0
**Author**: skills-engineer-2
**Date**: 2026-04-21
**Status**: Gate 2 - test strategy

---

## 1. Overview

This document defines the E2E test implementation strategy for the SkillsHubSettings module: environment configuration, test data construction, bridge assertion patterns, the list of `data-testid` attributes to add, alternatives for requirements that cannot be tested directly, and other implementation details.

**Relationship to the other documents**:

- `requirements.md` — describes the functionality, data model, and boundary constraints (gate 1, complete)
- `test-strategy.md` — describes how those features are tested (gate 2, this document)
- `test-cases.md` — the concrete test case design (gate 2, led by the Designer)

---

## 2. E2E Test Environment Configuration

### 2.1 Base configuration

**Already configured automatically by the E2E framework** (`tests/e2e/fixtures.ts`):

- ✅ The Electron app starts as a single instance (`workers: 1`)
- ✅ The user data directory is isolated (`userData: tmpDir`)
- ✅ The SQLite database is independent (`aionui.db`)
- ✅ The extension path points at the examples directory (`AIONUI_EXTENSIONS_PATH=examples/`)

### 2.2 Skills-module-specific configuration

**Paths required**:

```typescript
const skillPaths = await invokeBridge(page, 'fs.getSkillPaths');
// Returns:
// {
//   userSkillsDir: '~/.aionui/skills/',     // My Skills storage directory
//   builtinSkillsDir: 'resources/_builtin/' // Builtin skills directory
// }
```

**Predefined external source paths** (hardcoded in `fsBridge.ts`):

- `~/.claude/skills` — Claude Code CLI
- `~/.gemini/skills` — Gemini CLI
- `~/.copilot/skills` — Copilot CLI
- `/usr/local/share/aion-skills` — system-wide shared path
- **Custom paths**: added dynamically through `fs.addCustomExternalPath`

---

## 3. Test Data Construction Strategy

### 3.1 Data isolation principles

**Naming convention**:

- Every test skill name is prefixed with `E2E-Test-`
- Examples: `E2E-Test-Import-Basic`, `E2E-Test-Special:Char`

**Cleanup strategy**:

```typescript
// Bulk cleanup after the test
const skills = await invokeBridge(page, 'fs.listAvailableSkills');
for (const skill of skills) {
  if (skill.name.startsWith('E2E-Test-')) {
    await invokeBridge(page, 'fs.deleteSkill', { skillName: skill.name });
  }
}
```

### 3.2 Constructing an external skill source

**Option A: create a temporary directory dynamically** (recommended)

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';

// Create the temporary external source
const tempExternal = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-e2e-external-'));

// Create a test skill (a direct skill)
fs.mkdirSync(path.join(tempExternal, 'E2E-Test-External-1'));
fs.writeFileSync(
  path.join(tempExternal, 'E2E-Test-External-1/SKILL.md'),
  `---
name: E2E-Test-External-1
description: "Test external skill for E2E"
---
# Test Skill
This is a test skill.
`
);

// Create a test skill pack (with a nested skills/ directory)
fs.mkdirSync(path.join(tempExternal, 'test-pack/skills'), { recursive: true });
fs.mkdirSync(path.join(tempExternal, 'test-pack/skills/E2E-Test-Pack-Skill-1'));
fs.writeFileSync(
  path.join(tempExternal, 'test-pack/skills/E2E-Test-Pack-Skill-1/SKILL.md'),
  `---
name: E2E-Test-Pack-Skill-1
description: "Test skill from pack"
---
# Pack Skill
`
);

// Register it as a custom external path
await invokeBridge(page, 'fs.addCustomExternalPath', {
  name: 'E2E Test Source',
  path: tempExternal,
});

// Verify that the external source appears
const sources = await invokeBridge(page, 'fs.detectAndCountExternalSkills');
expect(sources.data.some((s) => s.name === 'E2E Test Source')).toBe(true);

// Cleanup (after the test)
await invokeBridge(page, 'fs.removeCustomExternalPath', { path: tempExternal });
fs.rmSync(tempExternal, { recursive: true, force: true });
```

**Option B: pre-seed a fixed test directory** (CI environment)

If the CI environment can pre-seed directories, place the test skills in `~/.claude/skills`:

```bash
mkdir -p ~/.claude/skills/E2E-Test-Preset
echo "---\nname: E2E-Test-Preset\n---\n# Test" > ~/.claude/skills/E2E-Test-Preset/SKILL.md
```

**Recommendation**:

- Local development: option A (temporary directory, cleaned up automatically)
- CI environment: option B (pre-seeded directory, less I/O)

### 3.3 Pre-seeding My Skills data

**Importing a test skill**:

```typescript
// Use the temporary skill path created in 3.2
await invokeBridge(page, 'fs.importSkillWithSymlink', {
  skillPath: path.join(tempExternal, 'E2E-Test-External-1'),
});

// Verify the import succeeded
const mySkills = await invokeBridge(page, 'fs.listAvailableSkills');
expect(mySkills.some((s) => s.name === 'E2E-Test-External-1')).toBe(true);
```

**Pre-seeding several skills**:

```typescript
const testSkills = ['E2E-Test-Skill-1', 'E2E-Test-Skill-2', 'E2E-Test-Special:Char'];
for (const skillName of testSkills) {
  // Create the skill directory and its SKILL.md
  const skillPath = path.join(tempExternal, skillName);
  fs.mkdirSync(skillPath);
  fs.writeFileSync(path.join(skillPath, 'SKILL.md'), `---\nname: ${skillName}\ndescription: "Test skill"\n---\n# Test`);

  // Import it
  await invokeBridge(page, 'fs.importSkillWithSymlink', { skillPath });
}
```

### 3.4 Where Extension Skills data comes from

**Configuration dependency**:

- The E2E framework already sets `AIONUI_EXTENSIONS_PATH=examples/` (`fixtures.ts:112`)

**Check whether any extension in examples/ contributes a skill**:

```bash
# Must be run from the project root
find examples/ -name "skills" -type d
# If the output is empty, the Extension Skills board is not visible in E2E
```

**Handling strategy**:

- **If examples/ contains extension skills**: test the Extension Skills board normally
- **If examples/ contains no extension skills**: the E2E tests skip the Extension Skills board and mark it as "depends on an external extension"

**Creating a test extension (optional)**:
If E2E needs to cover Extension Skills, a test extension can be added under `examples/test-extension/`:

```typescript
// examples/test-extension/manifest.json
{
  "id": "e2e-test-extension",
  "name": "E2E Test Extension",
  "version": "1.0.0",
  "skills": ["skills/e2e-test-skill"]
}

// examples/test-extension/skills/e2e-test-skill/SKILL.md
---
name: E2E-Extension-Skill
description: "Test skill from extension"
---
# Extension Skill
```

### 3.5 Test data cleanup

**When cleanup runs**:

- In the `afterEach` hook of each test case
- Or in the suite's `afterAll` hook (if the data can be shared between tests)

**Full cleanup script**:

```typescript
async function cleanupTestSkills(page: Page) {
  // 1. Clean up My Skills
  const mySkills = await invokeBridge(page, 'fs.listAvailableSkills');
  for (const skill of mySkills) {
    if (skill.name.startsWith('E2E-Test-')) {
      await invokeBridge(page, 'fs.deleteSkill', { skillName: skill.name });
    }
  }

  // 2. Clean up the custom external paths
  const sources = await invokeBridge(page, 'fs.detectAndCountExternalSkills');
  for (const source of sources.data) {
    if (source.name.startsWith('E2E Test')) {
      await invokeBridge(page, 'fs.removeCustomExternalPath', {
        path: source.source,
      });
    }
  }

  // 3. Clean up the temporary file system directory (in the Node.js test code)
  // fs.rmSync(tempExternal, { recursive: true, force: true });
}
```

---

## 4. Bridge Assertion Strategy

### 4.1 The Setup / Assert / Cleanup principle

**From `tests/e2e/README.md`**:

- ✅ **Setup**: build the precondition data through the bridge before the test
- ✅ **Assert**: verify the backend state through the bridge after the operation
- ✅ **Cleanup**: remove the test data through the bridge after the test
- ❌ **Trigger**: operations must be triggered by UI interaction; calling the bridge directly is not a substitute for clicking

### 4.2 Bridge keys used

| Bridge Key                        | Purpose                               | Usage scenario                                                                            |
| --------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `fs.listAvailableSkills`          | Get the My Skills list                | Setup: verify the initial state<br>Assert: verify list changes after import/delete        |
| `fs.listBuiltinAutoSkills`        | Get the auto-injected skills list     | Assert: verify the contents of the Auto Skills board                                      |
| `fs.detectAndCountExternalSkills` | Get the external source list          | Setup: verify the external source exists<br>Assert: verify after adding a custom path     |
| `fs.getSkillPaths`                | Get the skill directory paths         | Setup: confirm the directories exist                                                      |
| `fs.importSkillWithSymlink`       | Import a skill                        | Setup: pre-seed My Skills data<br>❌ not used as a substitute for the UI import operation |
| `fs.deleteSkill`                  | Delete a skill                        | Cleanup: remove test data<br>❌ not used as a substitute for the UI delete operation      |
| `fs.exportSkillWithSymlink`       | Export a skill                        | ❌ not used in E2E (UI-triggered, files are not verified)                                 |
| `fs.addCustomExternalPath`        | Add a custom external path            | Setup: create a test external source dynamically<br>❌ not a substitute for the UI action |
| `fs.removeCustomExternalPath`     | Remove a custom external path         | Cleanup: remove the test external source                                                  |
| `fs.getCustomExternalPaths`       | Get the list of custom external paths | Assert: verify the list contains the new path after it is added                           |

### 4.3 Assertion patterns for typical scenarios

#### Scenario 1: import an external skill

```typescript
// Setup: create the external source (see 3.2)
const tempExternal = createTempExternalSource();
await invokeBridge(page, 'fs.addCustomExternalPath', {
  name: 'E2E Test Source',
  path: tempExternal,
});

// Trigger: click the import button in the UI
await page.locator('[data-testid="btn-import-E2E-Test-External-1"]').click();

// Assert UI: verify the success message
await expect(page.locator('.arco-message-success')).toContainText('Import successful');

// Assert Bridge: verify the backend state
const mySkills = await invokeBridge(page, 'fs.listAvailableSkills');
expect(mySkills.some((s) => s.name === 'E2E-Test-External-1')).toBe(true);

// Cleanup
await invokeBridge(page, 'fs.deleteSkill', { skillName: 'E2E-Test-External-1' });
await invokeBridge(page, 'fs.removeCustomExternalPath', { path: tempExternal });
```

#### Scenario 2: delete a custom skill

```typescript
// Setup: pre-seed one custom skill
await invokeBridge(page, 'fs.importSkillWithSymlink', {
  skillPath: testSkillPath,
});

// Trigger: click the delete button in the UI and confirm the modal
await page.locator('[data-testid="btn-delete-E2E-Test-Skill-1"]').click();
await page.locator('[data-testid="btn-confirm-delete"]').click();

// Assert UI: the card disappears
await expect(page.locator('[data-testid="my-skill-card-E2E-Test-Skill-1"]')).not.toBeVisible();

// Assert Bridge: the list no longer contains the skill
const mySkills = await invokeBridge(page, 'fs.listAvailableSkills');
expect(mySkills.every((s) => s.name !== 'E2E-Test-Skill-1')).toBe(true);
```

#### Scenario 3: search skills

```typescript
// Setup: pre-seed several skills
await setupMultipleSkills(['E2E-Test-Alpha', 'E2E-Test-Beta', 'E2E-Test-Gamma']);

// Trigger: type the search keyword in the UI
await page.locator('[data-testid="input-search-my-skills"]').fill('Beta');

// Assert UI: only the matching card is visible
await expect(page.locator('[data-testid="my-skill-card-E2E-Test-Beta"]')).toBeVisible();
await expect(page.locator('[data-testid="my-skill-card-E2E-Test-Alpha"]')).not.toBeVisible();
await expect(page.locator('[data-testid="my-skill-card-E2E-Test-Gamma"]')).not.toBeVisible();

// ❌ No bridge assertion needed (search only affects the frontend display)
```

#### Scenario 4: add a custom external path

```typescript
// Setup: create a temporary directory
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-e2e-custom-'));

// Trigger: fill in the modal in the UI and confirm
await page.locator('[data-testid="btn-add-custom-source"]').click();
await page.locator('[data-testid="input-custom-path-name"]').fill('My Custom Source');
await page.locator('[data-testid="input-custom-path-value"]').fill(tempDir);
await page.locator('[data-testid="btn-confirm-add-path"]').click();

// Assert UI: the new tab appears
await expect(page.locator('[data-testid="external-source-tab-My-Custom-Source"]')).toBeVisible();

// Assert Bridge: the external source list contains the new path
const sources = await invokeBridge(page, 'fs.detectAndCountExternalSkills');
expect(sources.data.some((s) => s.name === 'My Custom Source')).toBe(true);

// Cleanup
await invokeBridge(page, 'fs.removeCustomExternalPath', { path: tempDir });
fs.rmSync(tempDir, { recursive: true, force: true });
```

#### Scenario 5: export a skill

```typescript
// Setup: pre-seed a skill and an external source
await invokeBridge(page, 'fs.importSkillWithSymlink', { skillPath: testSkillPath });
await invokeBridge(page, 'fs.addCustomExternalPath', {
  name: 'Export Target',
  path: tempExportDir,
});

// Trigger: click the export dropdown in the UI and pick the target source
await page.locator('[data-testid="btn-export-E2E-Test-Skill-1"]').click();
await page.locator('.arco-dropdown-option').filter({ hasText: 'Export Target' }).click();

// Assert UI: success message
await expect(page.locator('.arco-message-success')).toContainText('Export successful');

// Assert UI: the My Skills list still contains the skill (exporting does not remove the source)
await expect(page.locator('[data-testid="my-skill-card-E2E-Test-Skill-1"]')).toBeVisible();

// ❌ The symlink in the target directory is not verified (out of scope for E2E, covered by unit tests)
```

---

## 5. Inventory of data-testid Attributes to Add

### 5.1 Rules for adding them

**Rule** (from `requirements.md` section 7.3):

- Special characters in skill names must be escaped: `normalizeTestId(name) => name.replace(/[:\/\s<>"'|?*]/g, '-')`
- Example: `my:skill/test` → `my-skill-card-my-skill-test`

**Where it is implemented**:

- Add the utility function to `SkillsHubSettings.tsx`:
  ```typescript
  const normalizeTestId = (name: string) => name.replace(/[:\/\s<>"'|?*]/g, '-');
  ```
- Every dynamic testid uses `${normalizeTestId(skill.name)}`

### 5.2 testids to add (by priority)

#### P0 - blocking (must be added, otherwise core elements cannot be located)

**File**: `src/renderer/pages/settings/SkillsHubSettings.tsx`

| testid                                               | Element description                      | Source location (estimated)                     | Example value                       |
| ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| `my-skills-section`                                  | My Skills board container                | line ~580 `<div className="my-skills">`         | -                                   |
| `external-skills-section`                            | Discover external skills board container | line ~240 `<div className="external-skills">`   | -                                   |
| `my-skill-card-${normalizeTestId(skill.name)}`       | My Skills card                           | line ~620 `<div className="skill-card">`        | `my-skill-card-test-skill`          |
| `external-skill-card-${normalizeTestId(skill.name)}` | External skill card                      | line ~340 `<div className="skill-card">`        | `external-skill-card-test-external` |
| `btn-import-${normalizeTestId(skill.name)}`          | Import button (external skill card)      | line ~350 `<Button>Import</Button>`             | `btn-import-test-external`          |
| `btn-delete-${normalizeTestId(skill.name)}`          | Delete button (My Skills card)           | line ~650 `<Button icon={<Delete />}>`          | `btn-delete-test-skill`             |
| `btn-export-${normalizeTestId(skill.name)}`          | Export dropdown trigger                  | line ~640 `<Dropdown>`                          | `btn-export-test-skill`             |
| `btn-import-all`                                     | Import-all button                        | line ~280 `<Button>Import All</Button>`         | -                                   |
| `btn-manual-import`                                  | Import-from-folder button                | line ~590 `<Button>Import from Folder</Button>` | -                                   |

#### P1 - high priority (affects test stability)

| testid                    | Element description            | Source location (estimated)             | Example value |
| ------------------------- | ------------------------------ | --------------------------------------- | ------------- |
| `input-search-my-skills`  | My Skills search box           | line ~595 `<Input.Search>`              | -             |
| `input-search-external`   | External skills search box     | line ~250 `<Input.Search>`              | -             |
| `btn-refresh-my-skills`   | My Skills refresh button       | line ~585 `<Button icon={<Refresh />}>` | -             |
| `btn-refresh-external`    | External skills refresh button | line ~245 `<Button icon={<Refresh />}>` | -             |
| `modal-add-custom-path`   | Add custom path modal          | line ~720 `<Modal wrapClassName={...}>` | -             |
| `input-custom-path-name`  | Custom path name input         | line ~730 `<Input placeholder="Name">`  | -             |
| `input-custom-path-value` | Custom path value input        | line ~740 `<Input placeholder="Path">`  | -             |
| `btn-browse-custom-path`  | Browse button (path picker)    | line ~745 `<Button>Browse</Button>`     | -             |
| `modal-delete-skill`      | Delete confirmation modal      | line ~680 `<Modal wrapClassName={...}>` | -             |
| `btn-confirm-delete`      | Delete confirmation button     | line ~690 `<Button status="danger">`    | -             |

#### P2 - medium priority (improves test readability)

| testid                                                | Element description                  | Source location (estimated)                     | Example value                         |
| ----------------------------------------------------- | ------------------------------------ | ----------------------------------------------- | ------------------------------------- |
| `external-source-tab-${normalizeTestId(source.name)}` | External source tab button           | line ~290 `<Button key={source.source}>`        | `external-source-tab-Claude-Code`     |
| `btn-add-custom-source`                               | Add custom source button (plus icon) | line ~310 `<Button icon={<Plus />}>`            | -                                     |
| `extension-skills-section`                            | Extension skills board container     | line ~440 `<div className="extension-skills">`  | -                                     |
| `extension-skill-card-${normalizeTestId(skill.name)}` | Extension skill card                 | line ~460 `<div className="skill-card">`        | `extension-skill-card-test-extension` |
| `auto-skills-section`                                 | Auto-injected skills board container | line ~500 `<div className="auto-skills">`       | -                                     |
| `auto-skill-card-${normalizeTestId(skill.name)}`      | Auto-injected skill card             | line ~520 `<div className="skill-card">`        | `auto-skill-card-aionui-skills`       |
| `my-skills-empty-state`                               | My Skills empty state container      | line ~585 `<div>No skills found</div>`          | -                                     |
| `external-skills-no-results`                          | External skills "no results" message | line ~380 `<div>No matching skills found</div>` | -                                     |

### 5.3 Implementation guidance

**Step 1: add the utility function** (at the top of the file)

```typescript
// src/renderer/pages/settings/SkillsHubSettings.tsx
const normalizeTestId = (name: string): string => {
  return name.replace(/[:\/\s<>"'|?*]/g, '-');
};
```

**Step 2: add the P0 testids** (about 10 places, the core interactive elements)

- Start with the board containers, the cards, and the action buttons
- Estimated change size: ~20 lines (1-2 lines per testid)

**Step 3: add the P1 testids** (about 10 places: search, refresh, modals)

- Once done, roughly 90% of the test scenarios are covered

**Step 4: add the P2 testids** (optional, about 8 places)

- Improves test readability; not a blocker

---

## 6. Untestable Items and Their Alternatives

### 6.1 File system related

| Requirement                                                   | Reason                             | E2E alternative                                                                                                    | Unit test coverage    |
| ------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------- |
| Verify the skill file contents are correct after import       | E2E does not read the file system  | Bridge assertion: `listAvailableSkills` contains the skill, and `name`/`description` are correct                   | ✅ `fsBridge.test.ts` |
| Verify the symlink was created successfully                   | E2E does not verify symlinks       | Bridge assertion: `listAvailableSkills` returns the skill and its `location` path contains the source path keyword | ✅ `fsBridge.test.ts` |
| Verify that deleting does not affect the source files         | E2E does not access external paths | UI assertion: the card disappears<br>Bridge assertion: the list no longer contains the skill                       | ✅ `fsBridge.test.ts` |
| Verify a symlink is created in the target directory on export | E2E does not read external paths   | UI assertion: success message<br>UI assertion: the My Skills list still contains the skill                         | ✅ `fsBridge.test.ts` |

### 6.2 Native system dialogs

| Requirement                                | Reason                                      | E2E alternative                                                                                                                                                                          | Unit test coverage    |
| ------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Import a skill from a folder (file picker) | `dialog.showOpenDialog` cannot be automated | **Option A**: mock `dialog.showOpenDialog` to return a preset path<br>**Option B**: skip the UI click, build the preconditions through the bridge, and only verify the list after import | ✅ `fsBridge.test.ts` |
| Add a custom path (directory picker)       | `dialog.showOpenDialog` cannot be automated | **Option A**: mock the dialog<br>**Option B**: type the path into the input manually (if the UI supports it)                                                                             | ✅ `fsBridge.test.ts` |

**Mock dialog example** (option A, recommended):

```typescript
// Inject the mock at the start of the test
await electronApp.evaluate(async ({ dialog }, targetPath) => {
  dialog.showOpenDialog = () =>
    Promise.resolve({
      canceled: false,
      filePaths: [targetPath],
    });
}, testSkillPath);

// Then click the Import from Folder button
await page.locator('[data-testid="btn-manual-import"]').click();
```

### 6.3 Performance and timeouts

| Requirement                         | Reason                                           | E2E alternative                                                       | Unit test coverage                                 |
| ----------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------- |
| Export timeout (8 seconds)          | Hard to reproduce reliably                       | Skipped in E2E; only the happy path is tested                         | ✅ `fsBridge.test.ts` mocks it with `Promise.race` |
| Large skill list performance (100+) | Expensive for E2E, and the data is slow to build | Only the 50-skill scenario is tested; 100+ is covered by load testing | ⚠️ Optional: a performance test suite              |
| Search debounce                     | The current UI does not implement debouncing     | Recorded as a known limitation, not tested                            | N/A                                                |

### 6.4 Security and boundaries

| Requirement                   | Reason                                   | E2E alternative                                                                   | Unit test coverage    |
| ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- | --------------------- |
| Path traversal attack defense | Security testing, not functional testing | Skipped in E2E                                                                    | ✅ `fsBridge.test.ts` |
| Circular symlink references   | Low-level file system behavior           | Skipped in E2E                                                                    | ✅ `fsBridge.test.ts` |
| YAML parsing fault tolerance  | Boundary input testing                   | Optional: an E2E test that imports an invalid SKILL.md (verify the error message) | ✅ `fsBridge.test.ts` |

### 6.5 Known UI limitations (from requirements.md section 9)

| Feature                         | Reason                           | E2E test scope                                                  |
| ------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| Skills Market                   | The UI is not implemented at all | ❌ not tested                                                   |
| Removing a custom external path | The UI does not call the bridge  | ❌ not tested (only used by the bridge during cleanup)          |
| Batch import progress feedback  | The UI has no loading state      | ✅ the batch import feature is tested, but not the progress bar |
| Viewing the symlink target      | The UI does not display it       | ❌ not tested                                                   |

---

## 7. Helper Function Design

### 7.1 New file: `tests/e2e/helpers/skillsHubSettings.ts`

Following the structure of `assistantSettings.ts`:

```typescript
import { Page } from '@playwright/test';
import { invokeBridge } from './bridge';
import { navigateTo } from './navigation';

// ============ Navigation ============

export async function goToSkillsHub(page: Page): Promise<void> {
  await navigateTo(page, '#/settings/skills');
  // Wait for the main container to load
  await page.waitForSelector('[data-testid="my-skills-section"]', { timeout: 5000 });
}

// ============ Bridge assertions ============

export async function getMySkills(page: Page): Promise<SkillInfo[]> {
  return invokeBridge(page, 'fs.listAvailableSkills');
}

export async function getExternalSources(page: Page) {
  const result = await invokeBridge(page, 'fs.detectAndCountExternalSkills');
  return result.success ? result.data : [];
}

export async function getAutoSkills(page: Page) {
  return invokeBridge(page, 'fs.listBuiltinAutoSkills');
}

export async function getSkillPaths(page: Page) {
  return invokeBridge(page, 'fs.getSkillPaths');
}

// ============ Data construction ============

export async function importSkillViaBridge(page: Page, skillPath: string) {
  return invokeBridge(page, 'fs.importSkillWithSymlink', { skillPath });
}

export async function deleteSkillViaBridge(page: Page, skillName: string) {
  return invokeBridge(page, 'fs.deleteSkill', { skillName });
}

export async function addCustomExternalPath(page: Page, name: string, path: string) {
  return invokeBridge(page, 'fs.addCustomExternalPath', { name, path });
}

export async function removeCustomExternalPath(page: Page, path: string) {
  return invokeBridge(page, 'fs.removeCustomExternalPath', { path });
}

// ============ UI operations (based on data-testid) ============

export async function searchMySkills(page: Page, query: string): Promise<void> {
  await page.locator('[data-testid="input-search-my-skills"]').fill(query);
  // Wait for the results to update (no debounce, takes effect immediately)
  await page.waitForTimeout(100);
}

export async function searchExternalSkills(page: Page, query: string): Promise<void> {
  await page.locator('[data-testid="input-search-external"]').fill(query);
  await page.waitForTimeout(100);
}

export async function refreshMySkills(page: Page): Promise<void> {
  await page.locator('[data-testid="btn-refresh-my-skills"]').click();
  // Wait for loading to finish (needs to be checked against the real UI implementation)
  await page.waitForTimeout(500);
}

export async function refreshExternalSkills(page: Page): Promise<void> {
  await page.locator('[data-testid="btn-refresh-external"]').click();
  await page.waitForTimeout(500);
}

export async function importSkillViaUI(page: Page, skillName: string): Promise<void> {
  const normalizedName = normalizeTestId(skillName);
  await page.locator(`[data-testid="btn-import-${normalizedName}"]`).click();
  // Wait for the success message
  await page.waitForSelector('.arco-message-success', { timeout: 3000 });
}

export async function deleteSkillViaUI(page: Page, skillName: string): Promise<void> {
  const normalizedName = normalizeTestId(skillName);
  await page.locator(`[data-testid="btn-delete-${normalizedName}"]`).click();
  // Confirm the delete modal
  await page.locator('[data-testid="btn-confirm-delete"]').click();
  // Wait for the success message
  await page.waitForSelector('.arco-message-success', { timeout: 3000 });
}

export async function exportSkillViaUI(page: Page, skillName: string, targetSource: string): Promise<void> {
  const normalizedName = normalizeTestId(skillName);
  // Click the export dropdown trigger
  await page.locator(`[data-testid="btn-export-${normalizedName}"]`).click();
  // Pick the target source
  await page.locator('.arco-dropdown-option').filter({ hasText: targetSource }).click();
  // Wait for the success message
  await page.waitForSelector('.arco-message-success', { timeout: 8000 }); // 8 second timeout
}

export async function importAllSkills(page: Page): Promise<void> {
  await page.locator('[data-testid="btn-import-all"]').click();
  // Wait for the batch import to finish (no progress bar, so wait for the message)
  await page.waitForSelector('.arco-message-success', { timeout: 10000 });
}

export async function addCustomPathViaUI(page: Page, name: string, path: string): Promise<void> {
  // Click the add button
  await page.locator('[data-testid="btn-add-custom-source"]').click();
  // Fill in the modal
  await page.locator('[data-testid="input-custom-path-name"]').fill(name);
  await page.locator('[data-testid="input-custom-path-value"]').fill(path);
  // Confirm
  await page.locator('[data-testid="btn-confirm-add-path"]').click();
  // Wait for the modal to close
  await page.waitForSelector('[data-testid="modal-add-custom-path"]', { state: 'hidden' });
}

// ============ Utility functions ============

function normalizeTestId(name: string): string {
  return name.replace(/[:\/\s<>"'|?*]/g, '-');
}

// ============ Cleanup functions ============

export async function cleanupTestSkills(page: Page): Promise<void> {
  // Remove every skill with the E2E-Test-* prefix
  const skills = await getMySkills(page);
  for (const skill of skills) {
    if (skill.name.startsWith('E2E-Test-')) {
      await deleteSkillViaBridge(page, skill.name);
    }
  }

  // Remove the custom external paths
  const sources = await getExternalSources(page);
  for (const source of sources) {
    if (source.name.startsWith('E2E Test')) {
      await removeCustomExternalPath(page, source.source);
    }
  }
}
```

### 7.2 Update `tests/e2e/helpers/selectors.ts`

```typescript
// Skills Hub
export const MY_SKILLS_SECTION = '[data-testid="my-skills-section"]';
export const EXTERNAL_SKILLS_SECTION = '[data-testid="external-skills-section"]';
export const EXTENSION_SKILLS_SECTION = '[data-testid="extension-skills-section"]';
export const AUTO_SKILLS_SECTION = '[data-testid="auto-skills-section"]';

export function mySkillCard(skillName: string): string {
  const normalized = skillName.replace(/[:\/\s<>"'|?*]/g, '-');
  return `[data-testid="my-skill-card-${normalized}"]`;
}

export function externalSkillCard(skillName: string): string {
  const normalized = skillName.replace(/[:\/\s<>"'|?*]/g, '-');
  return `[data-testid="external-skill-card-${normalized}"]`;
}

export function importButton(skillName: string): string {
  const normalized = skillName.replace(/[:\/\s<>"'|?*]/g, '-');
  return `[data-testid="btn-import-${normalized}"]`;
}

export function deleteButton(skillName: string): string {
  const normalized = skillName.replace(/[:\/\s<>"'|?*]/g, '-');
  return `[data-testid="btn-delete-${normalized}"]`;
}

export function exportButton(skillName: string): string {
  const normalized = skillName.replace(/[:\/\s<>"'|?*]/g, '-');
  return `[data-testid="btn-export-${normalized}"]`;
}
```

### 7.3 Update `tests/e2e/helpers/navigation.ts`

```typescript
// Add to the ROUTES object
export const ROUTES = {
  // ... existing routes
  settings: {
    // ... existing settings pages
    skills: '#/settings/skills',
  },
};
```

---

## 8. E2E Parallel Execution Constraints

### 8.1 Conclusion (from the assistant-engineer-2 investigation)

❌ **The Assistant E2E and Skills E2E suites must run sequentially**

**Reasons**:

- All tests share a single Electron app instance (`workers: 1` is enforced)
- They share the same SQLite database (`aionui.db`)
- Running them in parallel causes write lock conflicts and test data contamination

### 8.2 Impact on the Skills E2E suite

**Authoring phase** (gate 3):

- ✅ The Assistant and Skills test code can be developed in parallel (no dependency between them)

**Execution phase**:

- ❌ Must run sequentially (all `*.e2e.ts` files run serially)
- ✅ For local verification you can use `--grep` to run a single module first:
  ```bash
  bun run test:e2e -- --grep "skills"  # run only the Skills E2E tests
  ```
- ✅ The full suite must be run before committing:
  ```bash
  bun run test:e2e  # runs every E2E test sequentially (Assistant + Skills)
  ```

### 8.3 Test design recommendations

**Data isolation**:

- All Skills E2E data uses the `E2E-Test-*` prefix
- All Assistant E2E data uses the `E2E-Assistant-*` prefix (assumed)
- Do not depend on the other module's test data or on execution order

**Resource cleanup**:

- Every test suite's `afterEach` or `afterAll` must clean up its test data
- Leftover data must not affect later tests (whether Skills or Assistant)

---

## 9. Test File Structure Plan

### 9.1 Splitting principles

Following the Assistant E2E split strategy (`assistant-settings-crud.e2e.ts`, `assistant-settings-permissions.e2e.ts`, `assistant-settings-skills.e2e.ts`):

**Split by feature area** (recommended):

```
tests/e2e/specs/
├── skills-hub-my-skills.e2e.ts           # My Skills board (import/delete/search/export)
├── skills-hub-external-skills.e2e.ts    # External skills board (tab switching/batch import/custom paths)
├── skills-hub-extension-auto.e2e.ts     # Extension skills + auto-injected skills boards
├── skills-hub-edge-cases.e2e.ts         # Edge scenarios (empty state/special characters/large lists)
```

### 9.2 Structure of each file

```typescript
// tests/e2e/specs/skills-hub-my-skills.e2e.ts
import { test, expect } from '@playwright/test';
import { useElectronApp } from '../fixtures';
import {
  goToSkillsHub,
  getMySkills,
  importSkillViaBridge,
  deleteSkillViaUI,
  searchMySkills,
  cleanupTestSkills,
} from '../helpers/skillsHubSettings';

test.describe('SkillsHub - My Skills', () => {
  test.beforeEach(async ({ page }) => {
    await useElectronApp(page);
    await goToSkillsHub(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupTestSkills(page);
  });

  test('should display imported skills', async ({ page }) => {
    // Setup: pre-seed one skill
    await importSkillViaBridge(page, testSkillPath);

    // Assert: the UI shows the skill
    await expect(page.locator('[data-testid="my-skill-card-E2E-Test-Skill-1"]')).toBeVisible();

    // Assert: confirmed through the bridge
    const skills = await getMySkills(page);
    expect(skills.some((s) => s.name === 'E2E-Test-Skill-1')).toBe(true);
  });

  test('should delete custom skill via UI', async ({ page }) => {
    // ... (see 4.3, scenario 2)
  });

  test('should search skills by name', async ({ page }) => {
    // ... (see 4.3, scenario 3)
  });

  // ... more cases
});
```

---

## 10. Gate 3 Implementation Checklist

### 10.1 Source changes (performed by the engineer)

- [ ] Add the `normalizeTestId` utility function to `SkillsHubSettings.tsx`
- [ ] Add the P0 testids (10 places: board containers/cards/action buttons)
- [ ] Add the P1 testids (10 places: search/refresh/modals)
- [ ] (Optional) Add the P2 testids (8 places: tabs/empty states)
- [ ] Verify the testids are correct (inspect them manually in the Elements panel)

### 10.2 Helper functions (performed by the engineer)

- [ ] Create `tests/e2e/helpers/skillsHubSettings.ts`
- [ ] Implement the navigation function (`goToSkillsHub`)
- [ ] Implement the bridge assertion functions (`getMySkills`, `getExternalSources`, etc.)
- [ ] Implement the UI operation functions (`searchMySkills`, `importSkillViaUI`, etc.)
- [ ] Implement the cleanup function (`cleanupTestSkills`)
- [ ] Update `selectors.ts` with the Skills Hub selector constants
- [ ] Update `navigation.ts` with the `settings.skills` route

### 10.3 Test data construction (implemented by the engineer inside the test cases)

- [ ] Create the temporary external source directory (see 3.2)
- [ ] Generate the test SKILL.md files dynamically (direct skill + skill pack)
- [ ] Add the custom external path through the bridge
- [ ] Pre-seed the My Skills data (imported through the bridge)
- [ ] Verify where the Extension Skills data comes from (check `examples/`)

### 10.4 Test case authoring (led by the designer, assisted by the engineer)

- [ ] `skills-hub-my-skills.e2e.ts` (6-8 cases)
- [ ] `skills-hub-external-skills.e2e.ts` (6-8 cases)
- [ ] `skills-hub-extension-auto.e2e.ts` (2-3 cases)
- [ ] `skills-hub-edge-cases.e2e.ts` (4-5 cases)
- [ ] Every case includes Setup/Trigger/Assert/Cleanup

### 10.5 Local verification (performed by the engineer)

- [ ] Run the Skills E2E tests on their own: `bun run test:e2e -- --grep "skills"`
- [ ] Run the complete E2E suite: `bun run test:e2e`
- [ ] Verify there is no conflict when the Skills and Assistant E2E suites run in sequence
- [ ] Check that the test data cleanup is complete (no `E2E-Test-*` leftovers)
- [ ] Capture screenshots to debug any failing cases

### 10.6 CI integration (performed by the team lead or the engineer)

- [ ] Confirm the `workers: 1` configuration takes effect in CI
- [ ] Confirm the Electron app starts correctly in CI
- [ ] Confirm the Skills E2E pass rate in CI is ≥ 95%
- [ ] Monitor the CI logs for test data cleanup behaviour

---

## 11. Summary

### 11.1 Key decisions

1. **Data construction**: create temporary directories dynamically and build data through the bridge, rather than depending on fixed pre-seeded paths
2. **testid naming**: use `normalizeTestId` to escape special characters so the selectors stay stable
3. **Bridge assertions**: Setup/Assert/Cleanup are allowed; triggers must go through UI interaction
4. **File split**: 4 test files split by feature area, each with 4-8 cases
5. **Parallelism constraint**: authoring is parallel, execution is serial (the Electron app is shared with the Assistant E2E suite)

### 11.2 Risks and mitigations

| Risk                                         | Mitigation                                                         |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Incomplete testid coverage                   | Split into P0/P1/P2 priorities; P0 is mandatory                    |
| Leftover test data contaminating other tests | The `E2E-Test-*` prefix plus afterEach cleanup                     |
| The file picker cannot be automated          | Mock `dialog.showOpenDialog` or skip the UI click                  |
| Large list performance testing is expensive  | Only test the 50-skill scenario; 100+ is covered by load testing   |
| Uncertain source of Extension Skills data    | Check `examples/`; if it is empty, skip the Extension Skills board |

### 11.3 Next steps

1. The Designer drafts `test-cases.md` (the concrete test case design)
2. The Analyst and Engineer review `test-cases.md`
3. Once all three agree, gate 3 begins (writing the test code)
4. The Engineer adds the source testids and implements the helper functions
5. The Designer and Engineer write the test cases together
6. Local verification → CI integration → gate 3 complete

---

**Document status**: ✅ first draft complete, awaiting review by skills-analyst-2 and skills-designer-2
