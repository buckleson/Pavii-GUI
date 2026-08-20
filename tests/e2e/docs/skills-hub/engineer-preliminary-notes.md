# SkillsHub E2E Engineer Preliminary Notes

**Author**: skills-engineer-2
**Date**: 2026-04-21
**Status**: Preparation phase (gate 1)

---

## 1. Material Already Reviewed

### 1.1 E2E infrastructure

- ✅ `tests/e2e/README.md` — architecture, launch modes, authoring conventions
- ✅ `tests/e2e/fixtures.ts` — Electron startup and singleton management
- ✅ Every module under `tests/e2e/helpers/`:
  - `bridge.ts` — the invokeBridge protocol
  - `navigation.ts` — navigateTo, goToSettings
  - `selectors.ts` — CSS selector constants
  - `conversation.ts` — conversation lifecycle
  - `assertions.ts` — assertion helpers
  - `assistantSettings.ts` — Assistant CRUD helper (the reference template)
  - `extensions.ts` — extension snapshots
  - `screenshots.ts` — manual screenshots

### 1.2 SkillsHubSettings source

- ✅ `src/renderer/pages/settings/SkillsHubSettings.tsx` (765 lines)
- ✅ `src/common/adapter/ipcBridge.ts` — the skill-related bridge keys

---

## 2. Inventory of ipcBridge Skill Endpoints

| Bridge Key                        | Parameters                 | Returns                               | Purpose                                               |
| --------------------------------- | -------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `fs.listAvailableSkills`          | none                       | `SkillInfo[]`                         | List installed skills (My Skills + Extension Skills)  |
| `fs.listBuiltinAutoSkills`        | none                       | `{ name, description }[]`             | List the builtin auto-injected skills                 |
| `fs.detectAndCountExternalSkills` | none                       | `{ success, data: ExternalSource[] }` | Detect external skill sources (Claude Code CLI, etc.) |
| `fs.getSkillPaths`                | none                       | `{ userSkillsDir, builtinSkillsDir }` | Get the skill storage paths                           |
| `fs.importSkillWithSymlink`       | `{ skillPath }`            | `IBridgeResponse<{ skillName }>`      | Import an external skill (via symlink)                |
| `fs.deleteSkill`                  | `{ skillName }`            | `IBridgeResponse`                     | Delete a custom skill                                 |
| `fs.exportSkillWithSymlink`       | `{ skillPath, targetDir }` | `IBridgeResponse`                     | Export a skill to an external directory               |
| `fs.addCustomExternalPath`        | `{ name, path }`           | `IBridgeResponse`                     | Add a custom external skill path                      |

**E2E usage principles** (from the README):

- ✅ **Setup/Assert/Cleanup** — read the initial state, verify backend state, clean up test data
- ❌ **Trigger operations** — operations must be triggered through UI interaction (calling the bridge directly is not a substitute for clicking)

---

## 3. Current State of the UI

### 3.1 Key problem: **the entire page has no data-testid**

SkillsHubSettings.tsx currently has **no** `data-testid` attributes at all, so every element has to be located by:

- CSS class matching (`.bg-base`, `.rd-12px` and other UnoCSS atomic classes, which are unstable)
- Text content matching (i18n keys, with the bilingual problem)
- DOM structure matching (easily broken by layout changes)

### 3.2 Inventory of elements that need a data-testid

#### External Skills area

- `[data-testid="external-skills-section"]` — the whole external skills area
- `[data-testid="btn-refresh-external"]` — refresh button
- `[data-testid="input-search-external"]` — search box
- `[data-testid="external-source-tab-{source}"]` — each source tab button (Claude Code, Custom, etc.)
- `[data-testid="btn-add-custom-source"]` — add custom source button
- `[data-testid="external-skill-card-{skillName}"]` — each external skill card
- `[data-testid="btn-import-{skillName}"]` — import button for a single skill
- `[data-testid="btn-import-all"]` — import-all button

#### My Skills area

- `[data-testid="my-skills-section"]` — the whole My Skills area
- `[data-testid="btn-refresh-my-skills"]` — refresh button
- `[data-testid="input-search-my-skills"]` — search box
- `[data-testid="btn-manual-import"]` — import-from-folder button
- `[data-testid="my-skill-card-{skillName}"]` — each skill card
- `[data-testid="btn-export-{skillName}"]` — export button (Dropdown trigger)
- `[data-testid="btn-delete-{skillName}"]` — delete button (custom skills only)
- `[data-testid="skill-badge-{skillName}"]` — Built-in/Custom badge

#### Extension Skills area

- `[data-testid="extension-skills-section"]` — the whole extension skills area
- `[data-testid="extension-skill-card-{skillName}"]` — each extension skill card

#### Builtin Auto-injected Skills area

- `[data-testid="auto-skills-section"]` — the whole auto-injected skills area
- `[data-testid="auto-skill-card-{skillName}"]` — each auto-injected skill card

#### Modal: Add Custom Path

- `[data-testid="modal-add-custom-path"]` — modal container
- `[data-testid="input-custom-path-name"]` — name input
- `[data-testid="input-custom-path-value"]` — path input
- `[data-testid="btn-browse-custom-path"]` — browse button
- `[data-testid="btn-confirm-add-path"]` — confirm button (modal okButton)
- `[data-testid="btn-cancel-add-path"]` — cancel button (modal cancelButton)

#### Delete confirmation modal

- `[data-testid="modal-delete-skill"]` — modal container (wrapClassName)
- `[data-testid="btn-confirm-delete"]` — confirm delete button

---

## 4. Existing Helper Capabilities and Gaps

### 4.1 Directly reusable

- ✅ `invokeBridge(page, key, data)` — calls all of the bridge endpoints listed above
- ✅ `navigateTo(page, hash)` — requires adding `skills: '#/settings/skills'` to the `ROUTES.settings` object in `navigation.ts`
- ✅ `takeScreenshot(page, name)` — manual screenshots

### 4.2 New helper file needed

Following the structure of `assistantSettings.ts`, create `tests/e2e/helpers/skillsHubSettings.ts`:

**Navigation**

```typescript
export async function goToSkillsHub(page: Page): Promise<void> {
  await navigateTo(page, '#/settings/skills');
}
```

**Assertions**

```typescript
export async function getMySkills(page: Page): Promise<SkillInfo[]> {
  return invokeBridge(page, 'fs.listAvailableSkills');
}

export async function getExternalSources(page: Page): Promise<ExternalSource[]> {
  const result = await invokeBridge(page, 'fs.detectAndCountExternalSkills');
  return result.success ? result.data : [];
}
```

**Operations** (based on data-testid; to be implemented once the source has been updated)

```typescript
export async function searchExternalSkills(page: Page, query: string): Promise<void>;
export async function importSkill(page: Page, skillName: string): Promise<void>;
export async function deleteSkill(page: Page, skillName: string): Promise<void>;
export async function exportSkill(page: Page, skillName: string, targetSource: string): Promise<void>;
// ... and so on
```

### 4.3 Constants to add to selectors.ts

```typescript
// Skills Hub
export function skillCardById(skillName: string): string {
  return `[data-testid="my-skill-card-${skillName}"]`;
}
export const BTN_IMPORT_SKILL = '[data-testid^="btn-import-"]';
export const BTN_DELETE_SKILL = '[data-testid^="btn-delete-"]';
// ... and so on
```

---

## 5. Outstanding E2E Testability Items

### 5.1 Blockers (must be resolved for gate 1)

- ❌ **No data-testid on any interactive element** — elements cannot be located reliably
- ❌ **List items have no unique identifier** — a specific skill cannot be targeted precisely (text matching is at the mercy of i18n)
- ❌ **Modals have no testid** — different modals cannot be told apart (delete vs. add path)

### 5.2 Test data construction plan

**Building the preconditions**:

1. **An external skill source exists** — either preinstall a Claude Code CLI skill directory in the test environment, or add one dynamically through `fs.addCustomExternalPath`
2. **My Skills contains data** — import test skills through `fs.importSkillWithSymlink` before the test and clean them up afterwards with `fs.deleteSkill`
3. **Extension Skills exist** — depends on the E2E `AIONUI_EXTENSIONS_PATH` environment variable pointing at the `examples/` directory

**Data isolation**:

- Every test skill name is prefixed with `E2E-Test-` so they can be deleted in bulk during cleanup
- Custom external paths use a temporary directory (`fs.mkdtempSync`) that is removed after the test

### 5.3 Requirements that cannot be tested directly in E2E, and their alternatives

| Requirement                                  | Reason                             | Alternative                                                                                           |
| -------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Skill file contents are correct after import | E2E does not read the file system  | After importing, verify the metadata with `invokeBridge('fs.readSkillInfo')`                          |
| The symlink was created successfully         | E2E does not verify symlinks       | After importing, query the path through the bridge and check that it contains the source path keyword |
| Deleting does not affect the source files    | E2E does not access external paths | Only verify that the UI entry disappears and that the bridge no longer lists the skill                |
| Export timeout handling                      | The timeout is hard to reproduce   | Cover it in unit tests; E2E only verifies the happy path                                              |

---

## 6. Suggested Input for the Analyst

### 6.1 The requirements document should have a dedicated "test dependencies" chapter

It should contain:

- The full list of data-testid attributes that need to be added (see section 3.2)
- The plan for building the precondition data (see section 5.2)
- The test environment configuration requirements (external skill source path, extension path)

### 6.2 Every requirement needs a "how it is tested" annotation

- **UI interaction**: clicking, typing, asserting DOM visibility
- **Bridge assertion**: call `invokeBridge` after the operation to verify backend state
- **Screenshot verification**: for complex UI states (search results, filtered lists)

### 6.3 Boundary conditions need an explicit test strategy

- Empty list states (no external source, no My Skills)
- Search with no results
- Deleting the last remaining custom skill
- Importing a skill that already exists (conflict handling)
- Cancelling a modal

---

## 7. Review to Run Once the Analyst Reports In

Once notified that the first draft of `requirements.md` is ready, the review will cover:

1. **Completeness** — are all UI areas covered (4 sections + 2 modals)?
2. **Testability** — can every requirement be verified through UI interaction plus bridge assertions?
3. **Data dependencies** — can the preconditions be constructed, and is the cleanup strategy explicit?
4. **testid sufficiency** — check for omissions against section 3.2
5. **Alternatives** — do the untestable items have a bridge assertion or unit test as a fallback?

Review comments are appended to `tests/e2e/docs/skills-hub/discussion-log.md`, with skills-analyst-2 notified via SendMessage.

---

**Status**: ✅ Preparation complete, waiting for the analyst to report that the first draft is in place
