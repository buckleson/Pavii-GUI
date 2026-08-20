# Assistant Settings Page Requirements (reverse-engineered from the source)

- Module path: `src/renderer/pages/settings/AssistantSettings/`
- Author: assistant-analyst-2
- Date: 2026-04-21
- Version: v1.1 (finalised at Gate 1, dual-reviewed)
- Review status: ✅ Engineer review passed (2026-04-21 14:50) + ✅ Designer review passed (2026-04-21 15:00) + ✅ 8 suggestions applied (2026-04-21 15:10)
- Purpose: provide the requirements baseline for the "supplementary E2E tests" effort. This document is reverse-engineered from the source; the behaviour of the existing `tests/e2e/specs/assistant-settings-*.e2e.ts` tests is not treated as a source of requirements (the specs are only used to tally "scenarios already covered").

---

## 1. Page overview and purpose

The Assistant settings page ("this page" below) is a sub-page of the settings centre used to manage every AI assistant in the app. Assistants fall into three categories by origin:

- **Builtin**: shipped via `ASSISTANT_PRESETS` (`assistantUtils.ts:1`), with the ID prefix `builtin-`.
- **Extension**: contributed by loaded extensions (`normalizeExtensionAssistants`, `assistantUtils.ts:72`), with the ID prefix `ext-`.
- **Custom**: created by the user.

The page lets users create their own assistants, edit an assistant's name, description, avatar, main agent, rules and skills, and enable, disable, duplicate or delete assistants.

Main UI components (referenced from `index.tsx`):

- `AssistantListPanel` (list view plus search/filter plus the create button)
- `AssistantEditDrawer` (the edit drawer that slides in from the right)
- `DeleteAssistantModal` (delete confirmation modal)
- `AddSkillsModal` (modal for adding skills from an external source)
- `AddCustomPathModal` (modal for adding a custom path to the skill library)
- `SkillConfirmModals` (confirmation modals for deleting a pending skill and for removing a custom skill from the current assistant)

---

## 2. Feature inventory (mapped to the source)

### 2.1 List rendering

| #      | Requirement                                                                                                                                             | Source reference                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| F-L-01 | The list renders every assistant as a card containing the avatar, name, description, source tag, enable switch, edit button and duplicate button.       | `AssistantListPanel.tsx:117-178`                       |
| F-L-02 | The avatar supports three renderings: emoji, image URL and the builtin icon (Robot).                                                                    | `AssistantAvatar.tsx:23-34`, `assistantUtils.ts:34-48` |
| F-L-03 | The "Duplicate" button on a card is only visible on hover (`invisible group-hover:visible`).                                                            | `AssistantListPanel.tsx:148`                           |
| F-L-04 | The enable switch on an extension assistant is **always on and disabled**.                                                                              | `AssistantListPanel.tsx:159-161`                       |
| F-L-05 | The list is rendered as two separate sections, "Enabled" and "Disabled", each with a section heading and a count.                                       | `AssistantListPanel.tsx:180-192, 279-283`              |
| F-L-06 | Custom assistant cards show a green "Custom" tag in the top right; builtin and extension cards do not.                                                  | `AssistantListPanel.tsx:98-114`                        |
| F-L-07 | Clicking the card body (anywhere outside the right-hand action area) opens the edit drawer.                                                             | `AssistantListPanel.tsx:126-129`                       |
| F-L-08 | When the filter matches nothing, the placeholder copy "No assistants match the current filters." is shown.                                              | `AssistantListPanel.tsx:284-290`                       |
| F-L-09 | The list is ordered by the preset order in `ASSISTANT_PRESETS` (for the preset portion).                                                                | `assistantUtils.ts:53-67`                              |
| F-L-10 | Responsive mobile layout: the button and search area stack vertically (`flex-col`), and the Create button is 100% wide and 36px tall (32px on desktop). | `AssistantListPanel.tsx:50-51, 200-217`                |

### 2.2 Search

| #      | Requirement                                                                                                                                | Source reference                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| F-S-01 | A search toggle button sits at the top (`data-testid="btn-search-toggle"`); clicking it expands the search input.                          | `AssistantListPanel.tsx:230-250` |
| F-S-02 | The toggle icon is Search when collapsed and CloseSmall when expanded.                                                                     | `AssistantListPanel.tsx:235-241` |
| F-S-03 | Clicking the toggle again while expanded clears `searchQuery` and collapses the search bar.                                                | `AssistantListPanel.tsx:242-249` |
| F-S-04 | The search input takes focus automatically when expanded (`autoFocus`).                                                                    | `AssistantListPanel.tsx:256`     |
| F-S-05 | The search input supports `allowClear` (a clear icon appears on the right while typing).                                                   | `AssistantListPanel.tsx:255`     |
| F-S-06 | Search scope: assistant name (including the i18n variant) and description (including the i18n variant), case-insensitive, substring match. | `assistantUtils.ts:126-144`      |
| F-S-07 | An empty query does not filter (once normalised to an empty string, filtering is skipped entirely).                                        | `assistantUtils.ts:134-135`      |
| F-S-08 | While `searchQuery` is non-empty (more than 0 characters), the search bar stays visible even when `searchExpanded=false`.                  | `AssistantListPanel.tsx:194`     |

### 2.3 Filter tabs

| #      | Requirement                                                                                        | Source reference                 |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------------- |
| F-F-01 | Three tabs are provided: All, System (builtin) and Custom; the default is `all`.                   | `AssistantListPanel.tsx:92-96`   |
| F-F-02 | The `builtin` tab filters on "not custom", so both builtin and extension assistants are included.  | `assistantUtils.ts:152-153`      |
| F-F-03 | The `custom` tab shows only assistants whose source is custom.                                     | `assistantUtils.ts:154-155`      |
| F-F-04 | Switching tabs refreshes the list immediately, with no confirmation button.                        | `AssistantListPanel.tsx:267-276` |
| F-F-05 | `filterAssistants` applies `searchQuery` first and then the filter; the two are combined with AND. | `assistantUtils.ts:134-161`      |

### 2.4 Creating an assistant

| #      | Requirement                                                                                                                                    | Source reference                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| F-C-01 | A "Create Assistant" button sits in the top right of the page (`data-testid="btn-create-assistant"`).                                          | `AssistantListPanel.tsx:207-216`  |
| F-C-02 | Clicking it opens `AssistantEditDrawer` with `isCreating=true`, and the drawer title reads "Create Assistant".                                 | `AssistantEditDrawer.tsx:181-183` |
| F-C-03 | In create mode the footer button label is "Create" (`isCreating ? 'Create' : 'Save'`).                                                         | `AssistantEditDrawer.tsx:217-219` |
| F-C-04 | When the create drawer initialises, the Rules editor takes focus automatically (in `edit` mode, the textarea is focused after a 100 ms delay). | `AssistantEditDrawer.tsx:107-115` |
| F-C-05 | Create mode does not show a "Delete" button (it only appears for existing assistants that are neither builtin nor extension).                  | `AssistantEditDrawer.tsx:229-239` |

### 2.5 Editing an assistant (drawer fields)

#### 2.5.1 Permission rules (from the table comment at `index.tsx:4-20`)

| Field                | Builtin                                             | Extension       | Custom                                    |
| -------------------- | --------------------------------------------------- | --------------- | ----------------------------------------- |
| Save button          | yes (shown and clickable)                           | no (not shown)  | yes                                       |
| Name input           | disabled                                            | disabled        | editable                                  |
| Description input    | disabled                                            | disabled        | editable                                  |
| Avatar (EmojiPicker) | not replaceable (avatar rendered directly)          | not replaceable | click to open the EmojiPicker and replace |
| Main Agent selector  | changeable                                          | not changeable  | changeable                                |
| Rules (prompt)       | read-only (rendered directly as a Markdown preview) | read-only       | editable, with an Edit/Preview toggle     |
| Delete button        | not shown                                           | not shown       | shown                                     |

> **Known discrepancy (actual source behaviour vs. the intent of the permission table)**:
>
> The Name input at `AssistantEditDrawer.tsx:280` uses `disabled={activeAssistant?.isBuiltin}` — an extension assistant has `isBuiltin=false`, so at the source level the extension Name input is in fact **enabled**, contradicting the "Extension Name = no" row in the `index.tsx` permission table.
>
> **E2E testing principle**: treat the actual source behaviour as authoritative, assert that the extension Name input is **not disabled**, and record the discrepancy in `discussion-log.md`. Designer and Engineer need to decide whether this is a bug or whether the permission table should be updated.

#### 2.5.2 Drawer layout and interaction

| #      | Requirement                                                                                                                                                  | Source reference                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| F-E-01 | The drawer slides in from the right with `placement='right'`, and its width responds to the window width: `Math.min(1024, Math.max(480, width * 0.5))`.      | `AssistantEditDrawer.tsx:117-128, 199-200` |
| F-E-02 | A custom close button (the `Close` icon) sits in the top right; clicking it closes the drawer.                                                               | `AssistantEditDrawer.tsx:185-194`          |
| F-E-03 | The drawer carries `data-testid="assistant-edit-drawer"`.                                                                                                    | `AssistantEditDrawer.tsx:243`              |
| F-E-04 | The drawer sliding in from the right never covers the Cancel/Save buttons.                                                                                   | `AssistantEditDrawer.tsx:209-241`          |
| F-E-05 | The drawer footer holds three buttons: the primary Save/Create button, the secondary Cancel button, and the destructive Delete button (shown conditionally). | `AssistantEditDrawer.tsx:209-241`          |
| F-E-06 | An "Expand/Collapse" button at the top of the Rules section toggles the content height (`420px` vs. `260/220px`).                                            | `AssistantEditDrawer.tsx:170-174, 351-355` |
| F-E-07 | For custom assistants, the Rules section offers a tab-style "Edit / Preview" selector.                                                                       | `AssistantEditDrawer.tsx:361-376`          |
| F-E-08 | When the content is empty in Rules preview mode, "No content to preview" is displayed.                                                                       | `AssistantEditDrawer.tsx:397-404`          |
| F-E-09 | The summary card at the bottom shows the currently selected Main Agent tag plus a skills count tag.                                                          | `AssistantEditDrawer.tsx:329-343`          |
| F-E-10 | Main Agent dropdown items render `opt.name` plus an `Extension` tag marker when `opt.isExtension=true`.                                                      | `AssistantEditDrawer.tsx:308-326`          |

#### 2.5.3 The Skills section (rendered only when `showSkills=true`)

The `showSkills` logic (`AssistantEditDrawer.tsx:131-134`):

1. `isCreating=true` → show it.
2. A builtin assistant is selected and `hasBuiltinSkills(id)` → show it.
3. A custom assistant is selected (`!isBuiltin`) → show it.

**Extension assistant behaviour**: an extension has `isBuiltin=false` and therefore satisfies condition 3 (`!activeAssistant.isBuiltin`), so the **Skills section is shown**, but the `isExtensionAssistant(activeAssistant)` check makes its fields read-only.

| #       | Requirement                                                                                                                                                              | Source reference                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| F-SK-01 | An "Add Skills" button sits at the top of the Skills section; clicking it opens `AddSkillsModal`.                                                                        | `AssistantEditDrawer.tsx:416-425`                            |
| F-SK-02 | The Skills section contains a `Collapse`, with the `custom-skills` group expanded by default.                                                                            | `AssistantEditDrawer.tsx:428`                                |
| F-SK-03 | The groups are: Custom/Imported (pending plus already-imported custom skills), Builtin, Extension (shown only when present) and Auto-injected (shown only when present). | `AssistantEditDrawer.tsx:430-702`                            |
| F-SK-04 | Each group header shows an "active/total" count on the right plus a status dot (green when active, gray when none).                                                      | `AssistantEditDrawer.tsx:438-451, 550-562, 604-617, 661-670` |
| F-SK-05 | Pending skill cards carry an orange `PENDING` badge.                                                                                                                     | `AssistantEditDrawer.tsx:473-476`                            |
| F-SK-06 | Custom (already imported) skill cards carry an orange `CUSTOM` badge.                                                                                                    | `AssistantEditDrawer.tsx:513-517`                            |
| F-SK-07 | Extension skill cards carry a blue `EXTENSION` badge.                                                                                                                    | `AssistantEditDrawer.tsx:636-639`                            |
| F-SK-08 | Auto-injected skill cards carry a green `AUTO` badge.                                                                                                                    | `AssistantEditDrawer.tsx:689-692`                            |
| F-SK-09 | Hovering a pending or custom skill card reveals a delete button on the right; clicking it opens the corresponding confirmation modal.                                    | `AssistantEditDrawer.tsx:482-491, 522-531`                   |
| F-SK-10 | The checked state of an auto-injected skill is stored in `disabledBuiltinSkills` (inverted logic: checked = enabled = absent from the disabled list).                    | `AssistantEditDrawer.tsx:677-685`                            |
| F-SK-11 | Empty-state copy: when both pending and custom are empty → "No custom skills added"; when builtin is empty → "No builtin skills available".                              | `AssistantEditDrawer.tsx:534-538, 589-592`                   |

### 2.6 Duplicating an assistant

| #      | Requirement                                                                                                                                                                                            | Source reference                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| F-D-01 | Hovering a list card reveals a "Duplicate" text button, `data-testid="btn-duplicate-<id>"`.                                                                                                            | `AssistantListPanel.tsx:146-155` |
| F-D-02 | Clicking Duplicate calls `editor.handleDuplicate` (handled by the `useAssistantEditor` hook), after which the drawer opens with `isCreating=true` and its fields pre-filled from the source assistant. | `index.tsx:149-150`              |

### 2.7 Enable/disable

| #      | Requirement                                                                                | Source reference                 |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------- |
| F-T-01 | The switch on the right of a card (`data-testid="switch-enabled-<id>"`) toggles `enabled`. | `AssistantListPanel.tsx:156-164` |
| F-T-02 | The extension switch is permanently `disabled` with `checked=true`.                        | `AssistantListPanel.tsx:159-160` |
| F-T-03 | After toggling, the card is regrouped between the "Enabled" and "Disabled" sections.       | `assistantUtils.ts:167-170`      |

### 2.8 Deleting

| #      | Requirement                                                                                                       | Source reference                 |
| ------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| F-R-01 | The Delete button in the drawer footer is visible only for custom assistants (see the permission table in 2.5.1). | `AssistantEditDrawer.tsx:229`    |
| F-R-02 | Clicking Delete opens `DeleteAssistantModal`.                                                                     | `DeleteAssistantModal.tsx:28-57` |
| F-R-03 | The modal contains the confirmation copy plus an assistant card preview (avatar, name, description).              | `DeleteAssistantModal.tsx:42-55` |
| F-R-04 | The confirm button uses the `danger` status with the label "Delete"; the cancel button is labelled "Cancel".      | `DeleteAssistantModal.tsx:33-37` |
| F-R-05 | The modal carries `data-testid="modal-delete-assistant"`.                                                         | `DeleteAssistantModal.tsx:35`    |

### 2.9 AddSkillsModal (browsing external skill sources)

| #      | Requirement                                                                                                                                                              | Source reference             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| F-A-01 | Every external skill source (from `externalSources`) is listed at the top as a pill button showing the source name and its skill count.                                  | `AddSkillsModal.tsx:74-95`   |
| F-A-02 | Action area on the right: a Refresh button (which uses `animate-spin` while loading) and a "+" button that opens the "Add Custom Path" modal.                            | `AddSkillsModal.tsx:96-112`  |
| F-A-03 | The search input filters the skills of the currently active source.                                                                                                      | `AddSkillsModal.tsx:116-123` |
| F-A-04 | Empty-state copy for the skill list, by state: loading → "Loading..."; no sources → "No external skill sources discovered"; search returned nothing → "No skills found". | `AddSkillsModal.tsx:127-187` |
| F-A-05 | Each skill card has an Add button on the right; once the skill has been added the button label becomes "Added" and it is disabled.                                       | `AddSkillsModal.tsx:152-172` |
| F-A-06 | Clicking Add calls `handleAddFoundSkills`, which adds the skill to pending.                                                                                              | `AddSkillsModal.tsx:166-167` |
| F-A-07 | The search box is cleared when the modal closes (the `onCancel` callback at `index.tsx:203-207`).                                                                        | `index.tsx:203-207`          |

### 2.10 AddCustomPathModal

| #      | Requirement                                                                                                            | Source reference               |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| F-P-01 | Two inputs: Name and Skill Directory Path.                                                                             | `AddCustomPathModal.tsx:45-89` |
| F-P-02 | A "FolderOpen" button sits to the right of the path input; clicking it triggers `dialog.showOpen` to pick a directory. | `AddCustomPathModal.tsx:70-83` |
| F-P-03 | The confirm button is disabled when either Name or Path is empty after trimming.                                       | `AddCustomPathModal.tsx:39`    |

### 2.11 SkillConfirmModals

| #       | Requirement                                                                                                                                                                                            | Source reference                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| F-SC-01 | The "delete pending skill" confirmation modal removes the skill only from pending/customSkills/selectedSkills and shows the message "Skill removed from pending list".                                 | `SkillConfirmModals.tsx:50-81`  |
| F-SC-02 | The "remove custom skill from assistant" confirmation modal removes the skill only from the current assistant's customSkills/selectedSkills and shows the message "Skill removed from this assistant". | `SkillConfirmModals.tsx:84-116` |
| F-SC-03 | The OK button in both modals uses the danger status.                                                                                                                                                   | `SkillConfirmModals.tsx:54, 88` |

---

## 3. Interaction flows (critical paths)

### 3.1 Creating a custom assistant (the typical end-to-end flow)

1. The user clicks `btn-create-assistant` at the top of the page.
2. The drawer opens with `isCreating=true` and empty fields (or a pre-filled default agent).
3. The user fills in name, description, avatar and agent, edits the rules and optionally uses "Add Skills" in the Skills section.
4. The user clicks Save/Create.
5. The backend persists the assistant → the list refreshes → the drawer closes. (Note: creation closes the drawer, but in edit mode Save does not close it automatically — see specs/crud test L249.)

### 3.2 Opening a specific assistant via the route (`?highlight=id` plus scroll-to-highlight)

1. The page is entered with a `?highlight=<id>` query parameter.
2. A `useEffect` waits until the assistants have loaded and the DOM refs are populated, then scrolls to the matching card.
3. It adds the `border-primary-5 bg-primary-1` highlight for 2 seconds.
4. It calls `onHighlightConsumed`, which clears the query parameter.

> Source: `AssistantListPanel.tsx:66-81`, `index.tsx:53-58`

### 3.3 Auto-opening the editor from navigation state

There are two paths by which the page can be navigated to with the editor opening automatically:

- React Router `location.state = { openAssistantId, openAssistantEditor: true }`
- `sessionStorage['guid.openAssistantEditorIntent'] = JSON({assistantId, openAssistantEditor: true})`

Once the page reads the intent it calls `editor.handleEdit(target)` and clears the intent with `sessionStorage.removeItem` (`index.tsx:105-137`).

### 3.4 The Skills → Pending → Imported state flow

1. The user selects an external skill in `AddSkillsModal` and clicks Add.
2. The skill is added to `pendingSkills` and shows the PENDING badge.
3. The user clicks Save → the backend imports it → the pending entry migrates to customSkillItems and shows the CUSTOM badge.

---

## 4. Data model and persistence

- `AssistantListItem = AcpBackendConfig & { _source, _extensionName, _kind }` (`types.ts:35-39`)
- `SkillInfo`: name / description / location / isCustom / source
- `PendingSkill`: path / name / description
- `BuiltinAutoSkill`: name / description
- Data is fetched through the `useAssistantList`, `useAssistantEditor` and `useAssistantSkills` hooks, which persist through the IPC bridge underneath (the exact bridge key needs to be confirmed by the Engineer).
- `ASSISTANT_PRESETS`: sourced from `@/common/config/presets/assistantPresets`; it defines the builtin ordering and the preset skills.

---

## 5. Edge cases and error handling

| #    | Scenario                                                                                              | Expected                                                                                                                                                                      | Source reference                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| B-01 | The search input contains only whitespace.                                                            | `trim().toLowerCase()` → empty string → no filtering.                                                                                                                         | `assistantUtils.ts:132`                                                                          |
| B-02 | Saving a new assistant with an empty name.                                                            | The drawer does not close (`handleSave` is expected to validate; the details are controlled by the hook, and in the UI the Name label carries a red `*` marking it required). | `AssistantEditDrawer.tsx:248-249`                                                                |
| B-03 | The filter returns 0 results.                                                                         | "No assistants match the current filters." is shown.                                                                                                                          | `AssistantListPanel.tsx:284-290`                                                                 |
| B-04 | Both pending and custom are empty.                                                                    | The Custom group shows the empty state "No custom skills added".                                                                                                              | `AssistantEditDrawer.tsx:534-538`                                                                |
| B-05 | The builtin preset has no skills.                                                                     | The Builtin group shows the empty state "No builtin skills available".                                                                                                        | `AssistantEditDrawer.tsx:589-592`                                                                |
| B-06 | The avatar is a non-image string (for example plain text).                                            | `resolveAvatarImageSrc` returns undefined → falls back to the emoji or the Robot icon.                                                                                        | `assistantUtils.ts:34-48`, `AssistantAvatar.tsx:25-32`                                           |
| B-07 | The avatar resolves to `aion-asset://`, `file://`, `data:`, `http(s):` or a `.svg/png/...` extension. | Recognised as an image and a usable src is returned.                                                                                                                          | `assistantUtils.ts:46`                                                                           |
| B-08 | Clicking the Duplicate button, where the card body's onClick is intercepted by stopPropagation.       | The card body's onClick is not fired.                                                                                                                                         | `AssistantListPanel.tsx:143-145`                                                                 |
| B-09 | Clicking the switch must not fire the card body's onClick.                                            | Same as above (they share the same stopPropagation container).                                                                                                                | `AssistantListPanel.tsx:143-145`                                                                 |
| B-10 | The enabled switch of an extension assistant.                                                         | Always `checked=true` and `disabled`.                                                                                                                                         | `AssistantListPanel.tsx:159-161`                                                                 |
| B-11 | JSON parsing of the navigation intent fails.                                                          | console.error is logged and the page does not crash.                                                                                                                          | `index.tsx:119-121`                                                                              |
| B-12 | highlightId points at an id that does not exist.                                                      | `find` returns undefined → silently skipped (no scroll, no highlight).                                                                                                        | `AssistantListPanel.tsx:68-70`                                                                   |
| B-13 | The delete modal is open while `activeAssistant=null`.                                                | The assistant preview row is not rendered (`activeAssistant && ...`).                                                                                                         | `DeleteAssistantModal.tsx:47`                                                                    |
| B-14 | The component unmounts partway through the highlight animation.                                       | The `useEffect` cleanup clears the timer, avoiding a warning.                                                                                                                 | `AssistantListPanel.tsx:66-81` (a 2-second `setTimeout` plus `return () => clearTimeout(timer)`) |
| B-15 | Search and tab filter apply at the same time and produce no results.                                  | The two conditions are combined with AND, which users may mistake for a bug.                                                                                                  | `assistantUtils.ts:134-161` (`filterAssistants` applies searchQuery first, then the filter)      |

---

## 6. Internationalisation and theming

- All text goes through `useTranslation()` (`react-i18next`); the default fallback is the English defaultValue.
- `nameI18n`, `descriptionI18n`, `contextI18n` and `promptsI18n` look up the localised variant by `localeKey` (`filterAssistants` also uses localeKey as the search key).
- List buttons and inputs use Arco Design components (`@arco-design/web-react`).
- Icons come uniformly from `@icon-park/react`.

---

## 7. Scenarios already covered (from `tests/e2e/specs/assistant-settings-*.e2e.ts`)

### 7.1 `assistant-settings-crud.e2e.ts` (15 cases)

| ID   | Test name                                                 | Requirements covered                    |
| ---- | --------------------------------------------------------- | --------------------------------------- |
| C-01 | page loads with assistant list                            | F-L-01 (basic rendering)                |
| C-02 | search filter — by name                                   | F-S-06 (search filtering)               |
| C-03 | search filter — clear restores full list                  | F-S-03 (clearing the search)            |
| C-04 | tab filter — System / Custom                              | F-F-01 / F-F-02 / F-F-03                |
| C-05 | create custom assistant — full flow                       | F-C-01 / F-C-02 / F-C-03 / flow 3.1     |
| C-06 | create assistant — name required validation               | B-02 (required-name validation)         |
| C-07 | edit custom assistant — change name                       | F-E-01 (editing the name)               |
| C-08 | edit custom assistant — switch Main Agent                 | F-E-10 (switching agent)                |
| C-09 | duplicate assistant                                       | F-D-01 / F-D-02                         |
| C-10 | delete custom assistant                                   | F-R-01 / F-R-02                         |
| C-11 | enable / disable toggle                                   | F-T-01 / F-T-03                         |
| C-12 | disabled builtin assistant removed from guid page presets | F-T-01 (interaction with the guid page) |
| C-13 | re-enabled assistant visible after toggle back on         | F-T-03 (re-enable)                      |
| C-14 | created assistant persists after page reload              | 4 (persistence)                         |
| C-15 | sort order — enabled section renders before disabled      | F-L-05 (section ordering)               |

### 7.2 `assistant-settings-permissions.e2e.ts` (8 cases)

| ID   | Test name                               | Requirements covered                                                     |
| ---- | --------------------------------------- | ------------------------------------------------------------------------ |
| P-01 | builtin — name/desc/avatar read-only    | Permission table 2.5.1 (builtin name/desc disabled)                      |
| P-02 | builtin — Main Agent editable           | Permission table 2.5.1 (builtin agent changeable)                        |
| P-03 | builtin — no delete button              | Permission table 2.5.1 (builtin has no Delete)                           |
| P-04 | builtin — save button enabled           | Permission table 2.5.1 (builtin Save is clickable)                       |
| P-05 | extension — name/desc/save all editable | Permission table 2.5.1 (extension; **in practice Name is not disabled**) |
| P-06 | extension — no delete button            | Permission table 2.5.1 (extension has no Delete)                         |
| P-07 | extension — can duplicate               | F-D-01 (extensions can be duplicated)                                    |
| P-08 | custom — all fields editable            | Permission table 2.5.1 (custom is fully editable)                        |

### 7.3 `assistant-settings-skills.e2e.ts` (10 cases)

| ID   | Test name                                             | Requirements covered                                                                                                  |
| ---- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| S-01 | skill panel shows builtin skills for custom assistant | F-SK-03 (Builtin group)                                                                                               |
| S-02 | skill panel shows auto-injected skills section        | F-SK-03 (Auto-injected group)                                                                                         |
| S-03 | toggle builtin skill selection                        | F-SK-03 (checking a builtin skill)                                                                                    |
| S-04 | disable auto-injected skill and save                  | F-SK-10 (inverted logic)                                                                                              |
| S-05 | add skills button opens modal                         | F-SK-01 / F-A-01                                                                                                      |
| S-06 | skill selection persists after save and reopen        | 4 (persistence)                                                                                                       |
| S-07 | builtin assistant can access skills section           | 2.5.3 (builtin showSkills)                                                                                            |
| S-08 | custom skills collapse renders                        | F-SK-02 (Custom group)                                                                                                |
| S-09 | extension assistant drawer opens without error        | Partially covers 2.5.3 (verifies the extension drawer opens, **but does not assert that the Skills section renders**) |
| S-10 | skills counter shows in summary                       | F-E-09 (summary count)                                                                                                |

---

## 8. Supplementary test scope (requirements not covered by specs/)

**Total**: 38 supplementary test items (P0=6 / P1=27 / P2=5).

The tables below list the requirements this round of **supplementary E2E tests** must cover, each mapped explicitly to a requirement ID from sections 2, 3 and 5 of this document. They are ordered by priority (P0 = core interactions, P1 = key UI states, P2 = edge cases and secondary behaviour).

### P0 (core interactions, mandatory)

| Supplementary case                                                                     | Requirements covered              | Priority | Rationale                                                                                                                                                |
| -------------------------------------------------------------------------------------- | --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search bar expand/collapse button behaviour plus icon swap                             | F-S-01 / F-S-02 / F-S-03 / F-S-08 | P0       | specs C-02/C-03 only test result filtering; the icon change on toggle and the clear-on-collapse behaviour are untested.                                  |
| Card click-target isolation (body vs. right-hand action area)                          | F-L-07 / B-08 / B-09              | P0       | Most specs go through the `openAssistantDrawer` helper, so nothing verifies that clicking the switch or Duplicate on the right does not open the drawer. |
| Delete confirmation modal includes the assistant preview card                          | F-R-03 / F-R-04 / F-R-05          | P0       | specs C-10 confirms deletion straight through a helper and never verifies that the preview area renders the avatar, name and description.                |
| highlightId scrolls to the card and highlights it for 2 seconds, then clears the query | Interaction flow 3.2              | P0       | Not covered.                                                                                                                                             |
| AddSkillsModal search box filters and shows the "No skills found" copy                 | F-A-03 / F-A-04                   | P0       | Not covered (search in AddSkillsModal is the key user feedback in the main "add skills" interaction).                                                    |
| Extension assistant renders the Skills section                                         | 2.5.3 (extension showSkills)      | P0       | S-09 only tests that the drawer opens; it never asserts that `data-testid="skills-section"` is visible.                                                  |

### P1 (key UI states, recommended)

| Supplementary case                                                                                         | Requirements covered   | Priority | Rationale                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Search input autoFocus                                                                                     | F-S-04                 | P1       | Not covered.                                                                                                                                |
| A blank search query does not filter                                                                       | F-S-07 / B-01          | P1       | Not covered.                                                                                                                                |
| Custom source tag is shown, builtin is not                                                                 | F-L-06                 | P1       | The specs only test the filter tabs, not the source tag inside the card.                                                                    |
| Empty-state copy when a filter matches zero results                                                        | F-L-08 / B-03          | P1       | Not covered.                                                                                                                                |
| The Duplicate button is only visible on hover                                                              | F-L-03 / F-D-01        | P1       | specs P-07 only tests that it is visible after hovering, never that it is hidden by default.                                                |
| The extension switch is disabled and checked                                                               | F-L-04 / F-T-02 / B-10 | P1       | Not covered.                                                                                                                                |
| Drawer close button (Close icon, top right)                                                                | F-E-02                 | P1       | The specs mostly use Escape and never test the custom close icon.                                                                           |
| The Cancel button in the drawer footer closes the drawer                                                   | F-E-05                 | P1       | Not covered.                                                                                                                                |
| Expand/Collapse in the Rules section toggles the height                                                    | F-E-06                 | P1       | Not covered.                                                                                                                                |
| Edit/Preview tab switching in the Rules section                                                            | F-E-07 / F-E-08        | P1       | Not covered.                                                                                                                                |
| Placeholder copy for empty content in Rules preview mode                                                   | F-E-08                 | P1       | Not covered.                                                                                                                                |
| Main Agent dropdown items show the Extension tag                                                           | F-E-10                 | P1       | Not covered.                                                                                                                                |
| Skills group header count format (N/M plus status dot)                                                     | F-SK-04                | P1       | Not covered.                                                                                                                                |
| The PENDING badge renders on pending skills                                                                | F-SK-05                | P1       | Not covered.                                                                                                                                |
| The CUSTOM badge renders on custom skills                                                                  | F-SK-06                | P1       | Not covered.                                                                                                                                |
| Clicking delete on a pending skill → SkillConfirm delete modal plus the confirmation message               | F-SC-01                | P1       | Not covered.                                                                                                                                |
| Clicking delete on a custom skill → SkillConfirm remove-from-assistant modal plus the confirmation message | F-SC-02                | P1       | Not covered.                                                                                                                                |
| Persistence of the auto-injected inverted logic: uncheck it, reopen, and it is still unchecked             | F-SK-10                | P1       | S-04 only tests that saving does not crash; it never asserts that `disabledBuiltinSkills` takes effect on the next open.                    |
| Custom empty-state copy "No custom skills added"                                                           | F-SK-11 / B-04         | P1       | Not covered.                                                                                                                                |
| AddSkillsModal renders the external-source pills at the top and switches the active one                    | F-A-01                 | P1       | specs S-05 only opens the modal and presses Escape; the pills are untested.                                                                 |
| AddSkillsModal shows already-added skills as Added and disabled                                            | F-A-05                 | P1       | Not covered.                                                                                                                                |
| Responsive drawer width (480 / 1024 / 2048 viewports)                                                      | F-E-01                 | P1       | Not covered (drawer width differs markedly between viewports, so the `Math.min(1024, Math.max(480, width * 0.5))` formula needs verifying). |
| An `openAssistantEditorIntent` in sessionStorage or router state auto-opens the editor                     | Interaction flow 3.3   | P1       | Not covered (a low-frequency convenience feature whose alternative path is already well covered).                                           |
| Responsive mobile layout check (buttons and search stack vertically, buttons at 100% width)                | F-L-10                 | P1       | Not covered.                                                                                                                                |
| AddSkillsModal clears `searchExternalQuery` on close                                                       | F-A-07                 | P1       | Not covered.                                                                                                                                |
| List ordering — section heading copy plus the (N) count                                                    | F-L-05                 | P1       | specs C-15 only verifies that the sections exist in order; it never asserts the "(N)" number.                                               |
| Summary skills count tag colour (0 = gray, > 0 = green)                                                    | F-E-09                 | P1       | specs S-10 only checks that the drawer text is truthy; it never asserts the count or the colour.                                            |

### P2 (edge cases and secondary behaviour, optional)

| Supplementary case                                                                                    | Requirements covered | Priority | Rationale                                                                                |
| ----------------------------------------------------------------------------------------------------- | -------------------- | -------- | ---------------------------------------------------------------------------------------- |
| Leaving the page mid-highlight-animation produces no warning                                          | B-14                 | P2       | Not covered (verifies that the `useEffect` cleanup clears the timer correctly).          |
| Empty state when search and tab filter apply at the same time                                         | B-15                 | P2       | Not covered (users may mistake this for a bug, so the empty-state copy needs verifying). |
| Hovering a pending/custom skill reveals the delete button                                             | F-SK-09              | P2       | Not covered (a visual detail; the delete behaviour itself already has a P1 test).        |
| AddCustomPathModal OK button disabled rules (either Name or Path empty after trimming)                | F-P-03               | P2       | Not covered.                                                                             |
| The AddCustomPathModal directory-picker button triggers dialog.showOpen (with a mocked returned path) | F-P-02               | P2       | Not covered.                                                                             |

**Next, Gate 2**: the Designer picks cases from the table above and expands them into concrete steps, preconditions, expected results and covered requirement IDs.

---

## 9. Disputed requirements and open questions (for the Designer and Engineer)

1. **2.5.1 contradiction over the extension Name input permission** (Designer and Engineer agree this is a bug)
   - **Design intent** (the index.tsx permission table): the extension Name and Description should be read-only.
   - **Actual source** (`AssistantEditDrawer.tsx:280`): `disabled={activeAssistant?.isBuiltin}`, and an extension has `isBuiltin=false` → the Name input is **not disabled**.
   - **Testing principle**: E2E treats the actual source behaviour as authoritative and asserts that Name is **not disabled**.
   - **Suggested fix (Designer's UX perspective)**:
     - Extension assistants are controlled by an external extension, so a user-edited name may drift from the extension metadata and cause confusion.
     - **Recommended fix**: change it to `disabled={activeAssistant?.isBuiltin || isExtensionAssistant(activeAssistant)}`.
     - **If it is not fixed**: the UI needs a warning along the lines of "your changes may not match the original extension configuration".
   - **Follow-up**: confirm the product requirement before implementing Gate 2, so the test cases do not conflict with the post-fix behaviour.

2. **2.5.3 showSkills behaviour for extension assistants**
   - **Actual source** (`AssistantEditDrawer.tsx:131-134`): `showSkills = isCreating || (hasBuiltinSkills) || (!activeAssistant.isBuiltin)` — an extension has `isBuiltin=false` and therefore satisfies the third branch, so **the Skills section is shown for extensions**.
   - **Permission constraint**: because of the `isExtensionAssistant(activeAssistant)` check, the fields in the extension Skills section are read-only (the Add Skills button and similar controls are not clickable).
   - **What the specs show**: the S-09 test "extension assistant drawer opens without error" passes, which confirms the extension drawer opens normally.
   - **Follow-up**: if extensions should not show the Skills section, the `showSkills` condition needs `&& !isExtensionAssistant(activeAssistant)` added; otherwise the behaviour is now documented as intended.

3. **Whether Save auto-closes the drawer in edit mode**
   - **Spec comment** (crud.e2e.ts L249): `Edit save does not auto-close the drawer`.
   - **Follow-up**: the Engineer needs to re-confirm this behaviour before writing tests, taking the current actual behaviour as authoritative.
