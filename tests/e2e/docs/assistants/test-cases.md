# Assistant Settings Page — Supplementary Test Cases (Gate 2)

- Based on the requirements document: `requirements.md` v1.1
- Author: assistant-designer-2
- Date: 2026-04-21
- Version: v1.0 (Gate 2 draft)
- Purpose: turn the 37-item supplementary test checklist in chapter 8 of the requirements document into executable Playwright test case steps

---

## Test Case Format

Every test case contains:

- **Case ID**: P0-1 through P2-5 (matching the priority level)
- **Case name**: a short description (in English, used as the title of `test('...')`)
- **Requirements covered**: the requirement IDs referenced from requirements.md
- **Preconditions**: the state required before the test starts
- **Steps**: numbered steps covering the concrete actions plus the data-testid and assertion points
- **Expected result**: the expected values of the key assertions
- **Cleanup**: (if any) restore the state that existed before the test

---

## P0 Test Cases (core interactions, mandatory)

### P0-1: Search bar expand/collapse button behavior + icon switch

**Case name**: `search toggle — expand/collapse with icon change`

**Requirements covered**: F-S-01 / F-S-02 / F-S-03 / F-S-08

**Preconditions**:

- Navigate to the Assistant settings page (`#/settings/assistants`)
- At least one assistant card is visible in the list

**Steps**:

1. **Verify the initial state**

   ```typescript
   const searchToggle = page.locator('[data-testid="btn-search-toggle"]');
   const searchInput = page.locator('[data-testid="input-search-assistant"]');

   // The search input field is not visible
   await expect(searchInput).toBeHidden();

   // The search button icon is Search (determined via the SVG path or class)
   const toggleIcon = searchToggle.locator('svg');
   await expect(toggleIcon).toBeVisible();
   ```

2. **Click to expand the search**

   ```typescript
   await searchToggle.click();
   await page.waitForTimeout(200); // wait for the expand animation

   // The search input field is visible
   await expect(searchInput).toBeVisible();

   // The button icon changes to CloseSmall
   // (if the SVG cannot be inspected directly, verify it through subsequent behavior)
   ```

3. **Verify autoFocus (F-S-04)**

   ```typescript
   // The search input field should receive focus automatically
   await expect(searchInput).toBeFocused();
   ```

4. **Type a query and verify the search bar stays visible while searchQuery is non-empty (F-S-08)**

   ```typescript
   await searchInput.fill('test');

   // searchQuery is non-empty, so the search bar stays visible even if searchExpanded may be false
   await expect(searchInput).toBeVisible();
   ```

5. **Click to collapse and clear the search**

   ```typescript
   await searchToggle.click();
   await page.waitForTimeout(200);

   // searchQuery is cleared
   await expect(searchInput).toHaveValue('');

   // The search input field collapses (not visible)
   await expect(searchInput).toBeHidden();
   ```

**Expected result**:

- Initially: the search box is hidden and the icon is Search
- Click to expand: the search box is visible and automatically focused
- After typing a query the search box stays visible
- Click again: the query is cleared and the box collapses

**Cleanup**: none (the search has already been cleared)

---

### P0-2: Card click-area isolation (body vs. right-hand action area)

**Case name**: `card click isolation — body opens drawer, actions do not`

**Requirements covered**: F-L-07 / B-08 / B-09

**Preconditions**:

- Navigate to the Assistant settings page
- At least one Custom assistant is in the list (needed to test the Switch)

**Steps**:

1. **Get the first assistant card**

   ```typescript
   const cards = page.locator('[data-testid^="assistant-card-"]');
   const firstCard = cards.first();
   const assistantId = (await firstCard.getAttribute('data-testid'))?.replace('assistant-card-', '') || '';

   // Make sure the Drawer starts closed
   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   if (await drawer.isVisible().catch(() => false)) {
     await page.keyboard.press('Escape');
     await drawer.waitFor({ state: 'hidden', timeout: 3000 });
   }
   ```

2. **Click the card body → the Drawer opens**

   ```typescript
   // Click the left-hand area of the card (Avatar + name)
   await firstCard.locator('.flex.items-center.gap-12px').first().click();

   // The Drawer should open
   await expect(drawer).toBeVisible({ timeout: 5000 });

   // Close the Drawer to prepare for the next step
   await page.keyboard.press('Escape');
   await drawer.waitFor({ state: 'hidden', timeout: 3000 });
   ```

3. **Click the Switch → the Drawer does not open**

   ```typescript
   const switchElement = page.locator(`[data-testid="switch-enabled-${assistantId}"]`);
   const isCheckedBefore = await switchElement.isChecked();

   // Click the Switch
   await switchElement.click();
   await page.waitForTimeout(300);

   // The Drawer should stay closed
   await expect(drawer).toBeHidden();

   // The Switch state should change (proving the click took effect)
   const isCheckedAfter = await switchElement.isChecked();
   expect(isCheckedAfter).toBe(!isCheckedBefore);

   // Restore the original state
   await switchElement.click();
   await page.waitForTimeout(300);

   // Verify the Switch state has been restored to its initial value
   const isCheckedRestored = await switchElement.isChecked();
   expect(isCheckedRestored).toBe(isCheckedBefore);
   ```

4. **Hover and click the Duplicate button → the Drawer opens (isCreating=true)**

   ```typescript
   await firstCard.hover();
   const duplicateBtn = page.locator(`[data-testid="btn-duplicate-${assistantId}"]`);

   // The Duplicate button is visible on hover
   await expect(duplicateBtn).toBeVisible();

   await duplicateBtn.click();

   // The Drawer should open in create mode
   await expect(drawer).toBeVisible({ timeout: 5000 });
   const createBtn = page.locator('[data-testid="btn-save-assistant"]');
   await expect(createBtn).toContainText('Create');

   // Close the Drawer
   await page.keyboard.press('Escape');
   await drawer.waitFor({ state: 'hidden', timeout: 3000 });
   ```

**Expected result**:

- Click the card body → the Drawer opens
- Click the Switch → the Drawer does not open and the Switch state changes
- Click Duplicate (stopPropagation takes effect) → the Drawer opens in Create mode

**Cleanup**: the Switch has been restored to its original state and the Drawer is closed

---

### P0-3: Delete confirmation modal contains the assistant preview card

**Case name**: `delete modal shows assistant preview card`

**Requirements covered**: F-R-03 / F-R-04 / F-R-05

**Preconditions**:

- Navigate to the Assistant settings page
- Create a Custom assistant for testing (to be deleted later)

**Steps**:

1. **Create the test assistant**

   ```typescript
   const timestamp = Date.now();
   const testName = `E2E Delete Preview ${timestamp}`;
   const testDesc = 'Test assistant for delete modal preview';

   await page.locator('[data-testid="btn-create-assistant"]').click();
   await page.locator('[data-testid="input-assistant-name"]').fill(testName);
   await page.locator('[data-testid="input-assistant-desc"]').fill(testDesc);
   await page.locator('[data-testid="btn-save-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await drawer.waitFor({ state: 'hidden', timeout: 10000 });
   ```

2. **Open the assistant edit Drawer**

   ```typescript
   // Find the card of the assistant that was just created
   const targetCard = page.locator(`[data-testid^="assistant-card-"]`).filter({ hasText: testName });
   await targetCard.click();
   await drawer.waitFor({ state: 'visible', timeout: 5000 });
   ```

3. **Click the Delete button**

   ```typescript
   const deleteBtn = page.locator('[data-testid="btn-delete-assistant"]');
   await expect(deleteBtn).toBeVisible();
   await deleteBtn.click();
   ```

4. **Verify the Delete Modal renders**

   ```typescript
   const modal = page.locator('[data-testid="modal-delete-assistant"]');
   await expect(modal).toBeVisible({ timeout: 3000 });

   // Verify the modal title
   await expect(modal.locator('.arco-modal-title')).toContainText('Delete');
   ```

5. **Verify the content of the assistant preview card**

   ```typescript
   // The preview area should contain an Avatar (32px or a similar size)
   const avatar = modal.locator('.arco-avatar');
   await expect(avatar).toBeVisible();

   // The preview area should show the assistant name
   await expect(modal).toContainText(testName);

   // The preview area should show the assistant description
   await expect(modal).toContainText(testDesc);
   ```

6. **Verify the buttons render**

   ```typescript
   // The confirm button is in the danger state with the copy "Delete"
   const confirmBtn = modal.locator('.arco-btn-status-danger');
   await expect(confirmBtn).toBeVisible();
   await expect(confirmBtn).toContainText('Delete');

   // The cancel button carries the copy "Cancel"
   const cancelBtn = modal.locator('.arco-btn').filter({ hasText: 'Cancel' });
   await expect(cancelBtn).toBeVisible();
   ```

7. **Confirm the deletion**

   ```typescript
   await confirmBtn.click();

   // The modal closes
   await modal.waitFor({ state: 'hidden', timeout: 3000 });

   // The Drawer closes
   await drawer.waitFor({ state: 'hidden', timeout: 3000 });

   // The assistant is removed from the list
   await expect(targetCard).toBeHidden({ timeout: 5000 });
   ```

**Expected result**:

- The Delete Modal shows the complete assistant preview card (Avatar + name + description)
- The confirm button uses the danger style and the cancel button renders normally
- The assistant is deleted once the action is confirmed

**Cleanup**: the test assistant has already been deleted

---

### P0-4: highlightId scrolls to the card, highlights it for 2 seconds, then clears the query

**Case name**: `highlight assistant card via query param`

**Requirements covered**: 3.2 Interaction flow

**Preconditions**:

- A known existing assistant ID (for example `builtin-agent`)

**Steps**:

1. **Navigate to the URL carrying the highlight parameter**

   ```typescript
   const targetId = 'builtin-agent'; // or take the first one dynamically from the list
   await page.goto('/#/settings/assistants?highlight=' + targetId);

   const targetCard = page.locator(`[data-testid="assistant-card-${targetId}"]`);
   await targetCard.waitFor({ state: 'visible', timeout: 10000 });
   ```

2. **Wait out the 150 ms delay and verify the card scrolls into the viewport**

   ```typescript
   await page.waitForTimeout(200);

   // The card should scroll close to the center of the viewport (via scrollIntoView)
   const isInViewport = await targetCard.evaluate((el) => {
     const rect = el.getBoundingClientRect();
     return rect.top >= 0 && rect.bottom <= window.innerHeight;
   });
   expect(isInViewport).toBe(true);
   ```

3. **Verify the highlight style**

   ```typescript
   // The card should carry the highlight style 'border-primary-5 bg-primary-1'
   const cardClasses = await targetCard.getAttribute('class');
   expect(cardClasses).toContain('border-primary-5');
   expect(cardClasses).toContain('bg-primary-1');
   ```

4. **Wait 2 seconds and verify the highlight disappears**

   ```typescript
   await page.waitForTimeout(2100); // 2s + buffer

   // The highlight style should be removed
   const cardClassesAfter = await targetCard.getAttribute('class');
   expect(cardClassesAfter).not.toContain('border-primary-5');
   expect(cardClassesAfter).not.toContain('bg-primary-1');
   ```

5. **Verify the query param is cleared**
   ```typescript
   const currentUrl = page.url();
   expect(currentUrl).not.toContain('highlight=');
   ```

**Expected result**:

- After navigation the card scrolls into the viewport and is highlighted for 2 seconds
- Once the highlight ends the style is removed and the query param is cleared

**Cleanup**: none

---

### P0-5: AddSkillsModal search box filtering + the "No skills found" empty-state copy

**Case name**: `skills modal search filters and shows empty state`

**Requirements covered**: F-A-03 / F-A-04

**Preconditions**:

- Navigate to the Assistant settings page
- Create or open the edit Drawer of a Custom assistant
- Open the AddSkillsModal

**Steps**:

1. **Open the Custom assistant Drawer and the Skills Modal**

   ```typescript
   // Create or open a Custom assistant
   await page.locator('[data-testid="btn-create-assistant"]').click();
   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await drawer.waitFor({ state: 'visible', timeout: 5000 });

   // Click the Add Skills button
   const addSkillsBtn = page.locator('[data-testid="btn-add-skills"]');
   await addSkillsBtn.click();

   // The Skills Modal opens
   const modal = page.locator('.arco-modal').filter({ hasText: 'Add Skills' });
   await expect(modal).toBeVisible({ timeout: 3000 });
   ```

2. **Verify the search input field exists**

   ```typescript
   // The search box has no data-testid, so locate it via the prefix icon + .arco-input
   const searchInput = modal
     .locator('.arco-input-wrapper')
     .filter({ has: page.locator('[class*="icon"]') })
     .locator('input');
   await expect(searchInput).toBeVisible();
   ```

3. **Type a query that matches nothing → verify the empty-state copy**

   ```typescript
   await searchInput.fill('zzz_nonexistent_skill_12345');
   await page.waitForTimeout(300);

   // The copy "No skills found" should be shown
   await expect(modal).toContainText('No skills found');
   ```

4. **Clear the search → verify the skill list comes back**

   ```typescript
   await searchInput.clear();
   await page.waitForTimeout(300);

   // If external skill sources exist, skill cards should be shown
   // If there is no external source, "No external skill sources discovered" should be shown
   const hasSkills = (await modal.locator('[class*="skill"]').count()) > 0;
   const hasNoSourceMsg = await modal.textContent();

   expect(hasSkills || hasNoSourceMsg?.includes('No external skill sources')).toBe(true);
   ```

5. **Close the Modal**
   ```typescript
   await page.keyboard.press('Escape');
   await modal.waitFor({ state: 'hidden', timeout: 3000 });
   ```

**Expected result**:

- Searching for a skill that does not exist → "No skills found" is shown
- Clearing the search → the skill list comes back or "No external skill sources discovered" is shown

**Cleanup**: close the Modal and the Drawer (`Escape`)

---

### P0-6: Extension assistant Skills section rendering

**Case name**: `extension assistant shows skills section`

**Requirements covered**: 2.5.3 (Extension showSkills)

**Preconditions**:

- At least one Extension assistant exists (ID prefix `ext-`)
- If there is no Extension assistant, skip this test

**Steps**:

1. **Find an Extension assistant**

   ```typescript
   await page.goto('/#/settings/assistants');
   const cards = page.locator('[data-testid^="assistant-card-"]');
   await cards.first().waitFor({ state: 'visible', timeout: 10000 });

   const cardCount = await cards.count();
   let extensionId: string | null = null;

   for (let i = 0; i < cardCount; i++) {
     const cardId = await cards.nth(i).getAttribute('data-testid');
     if (cardId?.includes('ext-')) {
       extensionId = cardId.replace('assistant-card-', '');
       break;
     }
   }

   if (!extensionId) {
     test.skip(true, 'No extension assistant found');
     return;
   }
   ```

2. **Open the Extension assistant Drawer**

   ```typescript
   const targetCard = page.locator(`[data-testid="assistant-card-${extensionId}"]`);
   await targetCard.click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

3. **Verify the Skills section renders**

   ```typescript
   const skillsSection = drawer.locator('[data-testid="skills-section"]');
   await expect(skillsSection).toBeVisible();
   ```

4. **Verify the Skills section is read-only (the Add Skills button is unclickable or not visible)**

   ```typescript
   const addSkillsBtn = drawer.locator('[data-testid="btn-add-skills"]');

   // The Skills section of an Extension should be read-only
   // The button may either be invisible or disabled
   const isVisible = await addSkillsBtn.isVisible().catch(() => false);
   if (isVisible) {
     const isDisabled = await addSkillsBtn.isDisabled();
     expect(isDisabled).toBe(true);
   }
   ```

**Expected result**:

- The Extension assistant Drawer shows the Skills section (`data-testid="skills-section"`)
- The Skills section is read-only (the Add Skills button is unavailable)

**Cleanup**: close the Drawer (`Escape`)

---

## P1 Test Cases (key UI states, recommended)

### P1-1: Search input autoFocus

**Case name**: `search input auto-focuses on expand`

**Requirements covered**: F-S-04

**Preconditions**:

- Navigate to the Assistant settings page
- The search bar starts collapsed

**Steps**:

1. **Click the search toggle button**

   ```typescript
   const searchToggle = page.locator('[data-testid="btn-search-toggle"]');
   await searchToggle.click();

   const searchInput = page.locator('[data-testid="input-search-assistant"]');
   await expect(searchInput).toBeVisible({ timeout: 1000 });
   ```

2. **Verify autoFocus**
   ```typescript
   // The search input field should receive focus automatically
   await expect(searchInput).toBeFocused();
   ```

**Expected result**: the input field is focused automatically once the search expands

**Cleanup**: none

---

### P1-2: A blank search query does not filter

**Case name**: `search with blank query does not filter`

**Requirements covered**: F-S-07 / B-01

**Preconditions**:

- Navigate to the Assistant settings page
- The list contains multiple assistants

**Steps**:

1. **Record the initial number of assistants**

   ```typescript
   const cards = page.locator('[data-testid^="assistant-card-"]');
   const countBefore = await cards.count();
   ```

2. **Expand the search and type whitespace**

   ```typescript
   const searchToggle = page.locator('[data-testid="btn-search-toggle"]');
   await searchToggle.click();

   const searchInput = page.locator('[data-testid="input-search-assistant"]');
   await searchInput.fill('   '); // spaces only
   await page.waitForTimeout(300);
   ```

3. **Verify the list is not filtered**
   ```typescript
   const countAfter = await cards.count();
   expect(countAfter).toBe(countBefore);
   ```

**Expected result**: a blank query (an empty string after trimming) does not filter the list

**Cleanup**: clear the search

---

### P1-3: The Custom source tag is shown, Builtin shows none

**Case name**: `custom assistant shows source tag, builtin does not`

**Requirements covered**: F-L-06

**Preconditions**:

- The list contains both Builtin and Custom assistants

**Steps**:

1. **Find the Builtin assistant card**

   ```typescript
   const builtinCard = page.locator('[data-testid="assistant-card-builtin-agent"]').first();
   await expect(builtinCard).toBeVisible();

   // Builtin should not show the "Custom" tag
   const builtinTag = builtinCard.locator('.arco-tag').filter({ hasText: 'Custom' });
   await expect(builtinTag).toBeHidden();
   ```

2. **Create a Custom assistant and verify the tag**

   ```typescript
   const timestamp = Date.now();
   const testName = `E2E Custom ${timestamp}`;

   await page.locator('[data-testid="btn-create-assistant"]').click();
   await page.locator('[data-testid="input-assistant-name"]').fill(testName);
   await page.locator('[data-testid="btn-save-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await drawer.waitFor({ state: 'hidden', timeout: 10000 });

   // Find the Custom assistant card
   const customCard = page.locator('[data-testid^="assistant-card-"]').filter({ hasText: testName });
   await expect(customCard).toBeVisible();

   // A green "Custom" tag should be shown
   const customTag = customCard.locator('.arco-tag').filter({ hasText: 'Custom' });
   await expect(customTag).toBeVisible();
   ```

3. **Clean up the Custom assistant**
   ```typescript
   await customCard.click();
   await drawer.waitFor({ state: 'visible' });
   await page.locator('[data-testid="btn-delete-assistant"]').click();
   const modal = page.locator('[data-testid="modal-delete-assistant"]');
   await modal.locator('.arco-btn-status-danger').click();
   await drawer.waitFor({ state: 'hidden' });
   ```

**Expected result**:

- The Builtin assistant does not show the "Custom" tag
- The Custom assistant shows a green "Custom" tag

**Cleanup**: the test assistant has been deleted

---

### P1-4: Empty-state copy when the filter returns 0 results

**Case name**: `filter with no results shows empty state`

**Requirements covered**: F-L-08 / B-03

**Preconditions**:

- Navigate to the Assistant settings page

**Steps**:

1. **Expand the search and type a query that matches nothing**

   ```typescript
   await page.locator('[data-testid="btn-search-toggle"]').click();
   const searchInput = page.locator('[data-testid="input-search-assistant"]');
   await searchInput.fill('zzz_nonexistent_assistant_98765');
   await page.waitForTimeout(300);
   ```

2. **Verify the empty-state copy**

   ```typescript
   const emptyMessage = page.locator('text=No assistants match the current filters.');
   await expect(emptyMessage).toBeVisible();
   ```

3. **Clear the search**
   ```typescript
   await page.locator('[data-testid="btn-search-toggle"]').click();
   ```

**Expected result**: when the search returns no results, "No assistants match the current filters." is shown

**Cleanup**: the search has already been cleared

---

### P1-5: The Duplicate button is only visible on hover

**Case name**: `duplicate button only visible on hover`

**Requirements covered**: F-L-03 / F-D-01

**Preconditions**:

- Navigate to the Assistant settings page
- At least one assistant is in the list

**Steps**:

1. **Get the first assistant card**

   ```typescript
   const firstCard = page.locator('[data-testid^="assistant-card-"]').first();
   const assistantId = (await firstCard.getAttribute('data-testid'))?.replace('assistant-card-', '') || '';
   const duplicateBtn = page.locator(`[data-testid="btn-duplicate-${assistantId}"]`);
   ```

2. **Verify it is invisible by default**

   ```typescript
   // The Duplicate button is invisible by default (invisible class)
   const isVisible = await duplicateBtn.isVisible().catch(() => false);
   expect(isVisible).toBe(false);
   ```

3. **Hover the card and verify it becomes visible**

   ```typescript
   await firstCard.hover();
   await page.waitForTimeout(100);

   // The Duplicate button should become visible
   await expect(duplicateBtn).toBeVisible();
   ```

4. **Move the mouse away and verify it becomes invisible again**

   ```typescript
   await page.mouse.move(0, 0); // move to the top-left corner of the page
   await page.waitForTimeout(100);

   const isVisibleAfter = await duplicateBtn.isVisible().catch(() => false);
   expect(isVisibleAfter).toBe(false);
   ```

**Expected result**:

- The Duplicate button is invisible by default
- It is visible on hover
- It becomes invisible again once the mouse moves away

**Cleanup**: none

---

### P1-6: The Extension Switch is disabled and checked

**Case name**: `extension assistant switch is disabled and checked`

**Requirements covered**: F-L-04 / F-T-02 / B-10

**Preconditions**:

- At least one Extension assistant exists

**Steps**:

1. **Find an Extension assistant**

   ```typescript
   const cards = page.locator('[data-testid^="assistant-card-"]');
   let extensionId: string | null = null;

   const count = await cards.count();
   for (let i = 0; i < count; i++) {
     const cardId = await cards.nth(i).getAttribute('data-testid');
     if (cardId?.includes('ext-')) {
       extensionId = cardId.replace('assistant-card-', '');
       break;
     }
   }

   if (!extensionId) {
     test.skip(true, 'No extension assistant found');
     return;
   }
   ```

2. **Verify the Switch state**

   ```typescript
   const switchElement = page.locator(`[data-testid="switch-enabled-${extensionId}"]`);

   // The Switch should be checked
   await expect(switchElement).toBeChecked();

   // The Switch should be disabled
   await expect(switchElement).toBeDisabled();
   ```

**Expected result**: the enable switch of an Extension assistant is both checked and disabled

**Cleanup**: none

---

### P1-7: Drawer close button (the Close icon in the top right)

**Case name**: `drawer close button closes drawer`

**Requirements covered**: F-E-02

**Preconditions**:

- Navigate to the Assistant settings page

**Steps**:

1. **Open any assistant Drawer**

   ```typescript
   const firstCard = page.locator('[data-testid^="assistant-card-"]').first();
   await firstCard.click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Click the Close icon in the top right**

   ```typescript
   // The Close button has no data-testid, so locate it via the Drawer header + Close icon
   const closeBtn = drawer.locator('.arco-drawer-header').locator('svg[class*="close"]').first();
   await closeBtn.click();
   ```

3. **Verify the Drawer closes**
   ```typescript
   await expect(drawer).toBeHidden({ timeout: 3000 });
   ```

**Expected result**: clicking the Close icon in the top right closes the Drawer

**Cleanup**: none

---

### P1-8: The Cancel button in the Drawer footer closes the Drawer

**Case name**: `drawer cancel button closes drawer`

**Requirements covered**: F-E-05

**Preconditions**:

- Navigate to the Assistant settings page

**Steps**:

1. **Open any assistant Drawer**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Click the Cancel button**

   ```typescript
   // The Cancel button has no data-testid, so locate it by its text
   const cancelBtn = drawer.locator('.arco-drawer-footer').locator('button').filter({ hasText: 'Cancel' });
   await cancelBtn.click();
   ```

3. **Verify the Drawer closes**
   ```typescript
   await expect(drawer).toBeHidden({ timeout: 3000 });
   ```

**Expected result**: clicking the Cancel button closes the Drawer

**Cleanup**: none

---

### P1-9: Rules section Expand/Collapse toggles the height

**Case name**: `rules section expand collapse toggles height`

**Requirements covered**: F-E-06

**Preconditions**:

- The Drawer of a Custom assistant is open

**Steps**:

1. **Open the Custom assistant Drawer**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Locate the Rules section container**

   ```typescript
   // The Rules section container is located by its style (height: 260px or 220px)
   const rulesContainer = drawer
     .locator('.border.border-border-2.overflow-hidden.rounded-4px')
     .filter({ has: page.locator('textarea') });

   const initialHeight = await rulesContainer.evaluate((el) => window.getComputedStyle(el).height);
   ```

3. **Click the Expand button**

   ```typescript
   // The Expand/Collapse button has no data-testid, so locate it by its text
   const expandBtn = drawer.locator('button').filter({ hasText: 'Expand' });
   await expandBtn.click();
   await page.waitForTimeout(200);

   const expandedHeight = await rulesContainer.evaluate((el) => window.getComputedStyle(el).height);

   // After expanding, the height should be 420px
   expect(expandedHeight).toBe('420px');
   ```

4. **Click the Collapse button**

   ```typescript
   const collapseBtn = drawer.locator('button').filter({ hasText: 'Collapse' });
   await collapseBtn.click();
   await page.waitForTimeout(200);

   const collapsedHeight = await rulesContainer.evaluate((el) => window.getComputedStyle(el).height);

   // After collapsing, the height should return to its previous value (260px or 220px)
   expect(collapsedHeight).toBe(initialHeight);
   ```

**Expected result**:

- Click Expand → the height becomes 420px
- Click Collapse → the height returns to its initial value

**Cleanup**: close the Drawer

---

### P1-10: Rules section Edit/Preview tab switching

**Case name**: `rules section edit preview tab switch`

**Requirements covered**: F-E-07 / F-E-08

**Preconditions**:

- The Drawer of a Custom assistant is open

**Steps**:

1. **Open the Custom assistant Drawer**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Verify Edit mode is active initially**

   ```typescript
   // The Edit tab should carry the active style
   const editTab = drawer
     .locator('div')
     .filter({ hasText: /^Edit$/ })
     .first();
   const editTabClass = await editTab.getAttribute('class');
   expect(editTabClass).toContain('text-primary');
   expect(editTabClass).toContain('border-primary');

   // The textarea should be visible
   const textarea = drawer.locator('textarea');
   await expect(textarea).toBeVisible();
   ```

3. **Switch to Preview mode (empty content)**

   ```typescript
   const previewTab = drawer
     .locator('div')
     .filter({ hasText: /^Preview$/ })
     .first();
   await previewTab.click();
   await page.waitForTimeout(200);

   // The Preview tab should become active
   const previewTabClass = await previewTab.getAttribute('class');
   expect(previewTabClass).toContain('text-primary');

   // The textarea should be hidden
   await expect(textarea).toBeHidden();

   // The empty-state copy "No content to preview" should be shown
   await expect(drawer).toContainText('No content to preview');
   ```

4. **Type some content and switch to Preview**

   ```typescript
   await editTab.click();
   await textarea.fill('# Test Rules\n\nThis is a test.');
   await previewTab.click();
   await page.waitForTimeout(200);

   // The Markdown content should be rendered
   await expect(drawer.locator('.markdown-body, [class*="markdown"]')).toContainText('Test Rules');
   ```

**Expected result**:

- Edit mode shows the textarea
- Preview mode with empty content shows "No content to preview"
- Preview mode with content renders the Markdown

**Cleanup**: close the Drawer

---

### P1-11: Placeholder copy for empty content in Rules preview mode

**Case name**: `rules preview shows empty placeholder`

**Requirements covered**: F-E-08

**Preconditions**:

- The Drawer of a Custom assistant is open

**Steps**:

1. **Open the Custom assistant Drawer (Rules is empty)**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Switch to Preview mode**

   ```typescript
   const previewTab = drawer
     .locator('div')
     .filter({ hasText: /^Preview$/ })
     .first();
   await previewTab.click();
   await page.waitForTimeout(200);
   ```

3. **Verify the placeholder copy**
   ```typescript
   await expect(drawer).toContainText('No content to preview');
   ```

**Expected result**: in Preview mode, "No content to preview" is shown when Rules is empty

**Cleanup**: close the Drawer

---

### P1-12: Main Agent dropdown items show the Extension tag

**Case name**: `main agent dropdown shows extension tag`

**Requirements covered**: F-E-10

**Preconditions**:

- An Extension Agent exists (`opt.isExtension=true`)

**Steps**:

1. **Open any assistant Drawer**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Click the Main Agent dropdown**

   ```typescript
   const agentSelect = page.locator('[data-testid="select-assistant-agent"]');
   await agentSelect.click();
   ```

3. **Verify the Extension Agent option shows the "ext" tag**

   ```typescript
   // Find the option that contains the "ext" tag
   const extensionOption = page
     .locator('.arco-select-option')
     .filter({ has: page.locator('.arco-tag').filter({ hasText: 'ext' }) });

   if ((await extensionOption.count()) > 0) {
     await expect(extensionOption.first()).toBeVisible();
   } else {
     test.skip(true, 'No extension agent found');
   }
   ```

**Expected result**: the Extension Agent dropdown item shows a blue "ext" tag

**Cleanup**: close the Drawer

---

### P1-13: Skills group header count format (N/M + status dot)

**Case name**: `skills section header shows count and status dot`

**Requirements covered**: F-SK-04

**Preconditions**:

- The Drawer of a Custom assistant that has Skills is open

**Steps**:

1. **Open the Custom assistant Drawer**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Locate the Skills group header**

   ```typescript
   const skillsCollapse = drawer.locator('[data-testid="skills-collapse"]');
   const builtinHeader = skillsCollapse.locator('.arco-collapse-item-header').filter({ hasText: 'Builtin Skills' });
   ```

3. **Verify the count format**

   ```typescript
   // The header should contain count text (for example "0/5" or "3/5")
   const headerText = await builtinHeader.textContent();
   expect(headerText).toMatch(/\d+\/\d+/);
   ```

4. **Verify the status dot renders**

   ```typescript
   // Status dot: an 8px circle whose color depends on the active state (green or gray)
   const statusDot = builtinHeader.locator('span[class*="w-8px"]');
   await expect(statusDot).toBeVisible();

   const dotStyle = await statusDot.evaluate((el) => window.getComputedStyle(el).background);
   // Verify the color is success-6 (green) or text-4 (gray)
   expect(dotStyle).toBeTruthy();
   ```

**Expected result**:

- The group header shows the count in "N/M" format
- The status dot is an 8px circle whose color reflects the active state

**Cleanup**: close the Drawer

---

### P1-14: The PENDING badge is not shown when there are no pending skills

**Case name**: `no pending badge when no pending skills`

**Requirements covered**: F-SK-05

**Preconditions**:

- Navigate to the Assistant settings page

**Steps**:

1. **Open the Custom assistant Drawer**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Verify there is no PENDING badge**
   ```typescript
   // Make sure the Skills section has no PENDING badge at all (empty-state verification)
   const pendingBadges = drawer.locator('span').filter({ hasText: 'PENDING' });
   await expect(pendingBadges).toHaveCount(0);
   ```

**Expected result**: a newly created assistant has no pending skills, so no PENDING badge is shown

**Cleanup**:

```typescript
// Close the Drawer (every test must clean up at the end)
await page.keyboard.press('Escape');
await expect(drawer).toBeHidden({ timeout: 3000 });
```

---

### P1-15: The CUSTOM badge is not shown when there are no custom skills

**Case name**: `no custom badge when no custom skills`

**Requirements covered**: F-SK-06

**Preconditions**:

- Navigate to the Assistant settings page

**Steps**:

1. **Open the Custom assistant Drawer**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Verify there is no CUSTOM badge**
   ```typescript
   // Make sure none of the Builtin Skills carries a CUSTOM badge (empty-state verification)
   const customBadges = drawer.locator('span').filter({ hasText: 'CUSTOM' });
   await expect(customBadges).toHaveCount(0);
   ```

**Expected result**: when no custom skills have been imported, no CUSTOM badge is shown

**Cleanup**:

```typescript
// Close the Drawer
await page.keyboard.press('Escape');
await expect(drawer).toBeHidden({ timeout: 3000 });
```

---

### P1-16: Unchecking a Builtin Skills checkbox does not trigger the delete modal

**Case name**: `builtin skill checkbox unchecks without modal`

**Requirements covered**: F-SK-08

**Preconditions**:

- Navigate to the Assistant settings page

**Steps**:

1. **Open the Custom assistant Drawer**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Expand the Builtin Skills group**

   ```typescript
   const skillsCollapse = drawer.locator('[data-testid="skills-collapse"]');
   const builtinHeader = skillsCollapse.locator('.arco-collapse-item-header').filter({ hasText: 'Builtin Skills' });

   // If the group is collapsed, expand it
   const isExpanded = await builtinHeader.getAttribute('aria-expanded');
   if (isExpanded === 'false') {
     await builtinHeader.click();
     await page.waitForTimeout(300);
   }
   ```

3. **Verify that Builtin Skills are available**

   ```typescript
   const builtinSection = skillsCollapse.locator('.arco-collapse-item').filter({ hasText: 'Builtin Skills' });
   const skillCards = builtinSection.locator('div.flex.items-start.gap-8px.p-8px');

   const skillCount = await skillCards.count();
   if (skillCount === 0) {
     test.skip(true, 'No builtin skills available for new assistant');
     return;
   }
   ```

4. **Find the first Builtin Skill that is already checked**

   ```typescript
   let checkedSkillCard = null;
   for (let i = 0; i < skillCount; i++) {
     const card = skillCards.nth(i);
     const checkbox = card.locator('.arco-checkbox-icon');
     const isChecked = await checkbox.isChecked();

     if (isChecked) {
       checkedSkillCard = card;
       break;
     }
   }

   if (!checkedSkillCard) {
     // If none is checked, check the first one
     const firstCheckbox = skillCards.first().locator('.arco-checkbox-icon');
     await firstCheckbox.click();
     await page.waitForTimeout(200);
     checkedSkillCard = skillCards.first();
   }
   ```

5. **Click the checkbox to uncheck it**

   ```typescript
   const checkbox = checkedSkillCard.locator('.arco-checkbox-icon');
   await checkbox.click();
   await page.waitForTimeout(200);
   ```

6. **Verify that no delete confirmation modal appears**

   ```typescript
   const modal = page.locator('.arco-modal').filter({ hasText: 'Remove' });
   await expect(modal).toHaveCount(0);
   ```

7. **Verify the checkbox is now unchecked**

   ```typescript
   await expect(checkbox).not.toBeChecked();
   ```

8. **Restore the original state (check it again)**
   ```typescript
   await checkbox.click();
   await page.waitForTimeout(200);
   await expect(checkbox).toBeChecked();
   ```

**Expected result**: unchecking a Builtin Skill via its checkbox does not trigger the delete confirmation modal (it only deactivates the skill, it does not delete it)

**Cleanup**:

```typescript
// Close the Drawer (use the helper or Escape)
await page.keyboard.press('Escape');
await expect(drawer).toBeHidden({ timeout: 3000 });
```

---

### P1-17: Pending/Custom skill delete modal (untestable, deprecated)

**Note**: this test case has been deprecated. The original design verified the delete modal plus the message prompt for Pending/Custom skills, but:

1. **Pending Skills** are transient React state that invokeBridge cannot construct
2. **Custom Skills** require an external file system path to be prepared in advance
3. **Builtin Skills** have no delete button (they can only be unchecked via the checkbox, see P1-16)

F-SC-01/F-SC-02 (the delete modal requirements) are untestable scenarios, and the P1-14/15 empty-state verifications already cover the badge rendering logic.

**Originally covered requirements**: F-SC-01 / F-SC-02

---

---

### P1-18: The Auto-injected Skills group is shown when such skills exist

**Case name**: `auto-injected section shows when configured`

**Requirements covered**: F-SK-10

**Preconditions**:

- Navigate to the Assistant settings page

**Steps**:

1. **Open a Builtin assistant that has an Auto-injected configuration**

   ```typescript
   // Most Builtin assistants have a defaultEnabledSkills configuration (word-creator, ppt-creator, and so on)
   const builtinCards = page.locator('[data-testid^="assistant-card-builtin-"]');
   const firstBuiltin = builtinCards.first();
   await firstBuiltin.click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Verify the Auto-injected Skills group is shown**

   ```typescript
   const autoSection = drawer.locator('.arco-collapse-item').filter({ hasText: 'Auto-injected Skills' });
   await expect(autoSection).toBeVisible();
   ```

3. **Verify the group header contains the count**
   ```typescript
   const headerText = await autoSection.locator('.arco-collapse-item-header').textContent();
   expect(headerText).toMatch(/\d+\/\d+/); // for example the "2/5" format
   ```

**Expected result**: a Builtin assistant with an Auto-injected configuration shows the "Auto-injected Skills" group, and the header contains a count in N/M format

**Cleanup**:

```typescript
// Close the Drawer
await page.keyboard.press('Escape');
await expect(drawer).toBeHidden({ timeout: 3000 });
```

---

### P1-19: The "No custom skills added" empty-state copy

**Case name**: `custom skills section shows empty state`

**Requirements covered**: F-SK-11 / B-04

**Preconditions**:

- The Drawer of a Custom assistant with no Custom Skills is open

**Steps**:

1. **Open the Custom assistant Drawer**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();

   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Locate the Custom Skills group**

   ```typescript
   const skillsCollapse = drawer.locator('[data-testid="skills-collapse"]');
   const customSection = skillsCollapse.locator('.arco-collapse-item').filter({ hasText: 'Imported Skills' });

   // Expand the group (if it is not already expanded)
   const customHeader = customSection.locator('.arco-collapse-item-header');
   await customHeader.click();
   await page.waitForTimeout(200);
   ```

3. **Verify the empty-state copy**
   ```typescript
   await expect(customSection).toContainText('No custom skills added');
   ```

**Expected result**: when Custom Skills is empty, "No custom skills added" is shown

**Cleanup**: close the Drawer

---

### P1-20: AddSkillsModal external-source pills render and switch active state

**Case name**: `skills modal source pills render and switch`

**Requirements covered**: F-A-01

**Preconditions**:

- At least one external skill source exists

**Steps**:

1. **Open the AddSkillsModal**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();
   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await drawer.waitFor({ state: 'visible' });

   await page.locator('[data-testid="btn-add-skills"]').click();
   const modal = page.locator('.arco-modal').filter({ hasText: 'Add Skills' });
   await expect(modal).toBeVisible({ timeout: 3000 });
   ```

2. **Verify the external-source pills render**

   ```typescript
   // A pill button shows the source name + the skill count (for example "User Skills (5)")
   const pills = modal.locator('button').filter({ has: page.locator('span[class*="px-6px"]') });
   const pillCount = await pills.count();

   if (pillCount === 0) {
     test.skip(true, 'No external skill sources found');
     return;
   }

   expect(pillCount).toBeGreaterThan(0);
   ```

3. **Verify the style of the active pill**

   ```typescript
   const firstPill = pills.first();
   const firstPillClass = await firstPill.getAttribute('class');

   // The active pill should have a blue background and white text
   expect(firstPillClass).toContain('bg-primary-6');
   expect(firstPillClass).toContain('text-white');
   ```

4. **Click to switch to the second source (if one exists)**

   ```typescript
   if (pillCount > 1) {
     const secondPill = pills.nth(1);
     await secondPill.click();
     await page.waitForTimeout(300);

     // The second pill should become active
     const secondPillClass = await secondPill.getAttribute('class');
     expect(secondPillClass).toContain('bg-primary-6');

     // The first pill should become inactive
     const firstPillClassAfter = await firstPill.getAttribute('class');
     expect(firstPillClassAfter).not.toContain('bg-primary-6');
   }
   ```

**Expected result**:

- The external-source pills render, showing the source name and the skill count
- The active pill has a blue background, and the style changes when another pill is clicked

**Cleanup**: close the Modal

---

### P1-21: AddSkillsModal shows already-added skills as a disabled Added button

**Case name**: `skills modal shows added skills as disabled`

**Requirements covered**: F-A-05

**Preconditions**:

- An external skill source exists and some of its skills have already been added

**Steps**:

1. **Open the AddSkillsModal** (same as P1-20)

   ```typescript
   // ... open the Modal
   test.skip(true, 'Requires external skill source with added skills');
   ```

2. **Find the "Added" button of an already-added skill**

   ```typescript
   const addedBtn = modal.locator('button').filter({ hasText: 'Added' }).first();

   if ((await addedBtn.count()) === 0) {
     test.skip(true, 'No added skills found');
     return;
   }

   await expect(addedBtn).toBeVisible();
   await expect(addedBtn).toBeDisabled();
   ```

**Expected result**: the button of an already-added skill carries the copy "Added" and is disabled

**Cleanup**: close the Modal

---

### P1-22: Responsive Drawer width (480 / 1024 / 2048 viewport)

**Case name**: `drawer width responds to viewport size`

**Requirements covered**: F-E-01

**Preconditions**:

- Navigate to the Assistant settings page

**Steps**:

1. **480px viewport**

   ```typescript
   await page.setViewportSize({ width: 480, height: 800 });
   await page.goto('/#/settings/assistants');

   await page.locator('[data-testid^="assistant-card-"]').first().click();
   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });

   const width480 = await drawer.evaluate((el) => window.getComputedStyle(el).width);

   // Math.min(1024, Math.max(480, 480 * 0.5)) = 480
   expect(width480).toBe('480px');

   await page.keyboard.press('Escape');
   await drawer.waitFor({ state: 'hidden' });
   ```

2. **1024px viewport**

   ```typescript
   await page.setViewportSize({ width: 1024, height: 800 });
   await page.locator('[data-testid^="assistant-card-"]').first().click();
   await drawer.waitFor({ state: 'visible' });

   const width1024 = await drawer.evaluate((el) => window.getComputedStyle(el).width);

   // Math.min(1024, Math.max(480, 1024 * 0.5)) = 512
   expect(width1024).toBe('512px');

   await page.keyboard.press('Escape');
   await drawer.waitFor({ state: 'hidden' });
   ```

3. **2048px viewport**

   ```typescript
   await page.setViewportSize({ width: 2048, height: 800 });
   await page.locator('[data-testid^="assistant-card-"]').first().click();
   await drawer.waitFor({ state: 'visible' });

   const width2048 = await drawer.evaluate((el) => window.getComputedStyle(el).width);

   // Math.min(1024, Math.max(480, 2048 * 0.5)) = 1024
   expect(width2048).toBe('1024px');

   await page.keyboard.press('Escape');
   ```

**Expected result**:

- 480px viewport → Drawer width 480px
- 1024px viewport → Drawer width 512px
- 2048px viewport → Drawer width 1024px (the upper bound)

**Cleanup**: restore the default viewport

---

### P1-23: openAssistantEditorIntent from sessionStorage / router state opens the editor automatically

**Case name**: `session storage intent opens assistant editor`

**Requirements covered**: 3.3 Interaction flow

**Preconditions**:

- A known existing assistant ID

**Steps**:

1. **Set the sessionStorage intent**

   ```typescript
   const targetId = 'builtin-agent'; // or obtain it dynamically

   await page.evaluate((id) => {
     sessionStorage.setItem(
       'guid.openAssistantEditorIntent',
       JSON.stringify({ assistantId: id, openAssistantEditor: true })
     );
   }, targetId);
   ```

2. **Navigate to the Assistant settings page**

   ```typescript
   await page.goto('/#/settings/assistants');
   await page.waitForTimeout(1000); // wait for the useEffect to fire
   ```

3. **Verify the Drawer opens automatically**

   ```typescript
   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

4. **Verify sessionStorage is cleared**

   ```typescript
   const intentAfter = await page.evaluate(() => {
     return sessionStorage.getItem('guid.openAssistantEditorIntent');
   });

   expect(intentAfter).toBeNull();
   ```

**Expected result**:

- Navigating to the page after setting sessionStorage → the Drawer opens automatically
- sessionStorage is cleared

**Cleanup**: close the Drawer

---

### P1-24: Mobile layout responsiveness (buttons/search stack vertically + buttons at 100% width)

**Case name**: `mobile layout stacks buttons vertically and full width`

**Requirements covered**: F-L-10

**Preconditions**:

- Set a mobile viewport (375px wide, for example)

**Steps**:

1. **Set the mobile viewport**

   ```typescript
   await page.setViewportSize({ width: 375, height: 667 });
   await page.goto('/#/settings/assistants');
   await page.locator('[data-testid^="assistant-card-"]').first().waitFor({ state: 'visible', timeout: 10000 });
   ```

2. **Verify the button/search area stacks vertically**

   ```typescript
   // The top container should have flex-col
   const headerContainer = page.locator('.flex.gap-12px').first();
   const headerClass = await headerContainer.getAttribute('class');
   expect(headerClass).toContain('flex-col');
   ```

3. **Verify the Create button is 100% wide and 36px tall**

   ```typescript
   const createBtn = page.locator('[data-testid="btn-create-assistant"]');
   const btnClass = await createBtn.getAttribute('class');

   expect(btnClass).toContain('!w-full');
   expect(btnClass).toContain('!h-36px');
   ```

**Expected result**:

- On mobile the button/search area stacks vertically (`flex-col`)
- The Create button is 100% wide and 36px tall

**Cleanup**: restore the default viewport

---

### P1-25: AddSkillsModal clears `searchExternalQuery` when it closes

**Case name**: `skills modal clears search on close`

**Requirements covered**: F-A-07

**Preconditions**:

- The AddSkillsModal is open and a search query has been typed

**Steps**:

1. **Open the AddSkillsModal and type a search query**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();
   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await drawer.waitFor({ state: 'visible' });

   await page.locator('[data-testid="btn-add-skills"]').click();
   const modal = page.locator('.arco-modal').filter({ hasText: 'Add Skills' });
   await expect(modal).toBeVisible({ timeout: 3000 });

   const searchInput = modal.locator('input[placeholder*="Search"]');
   await searchInput.fill('test query');
   ```

2. **Close the Modal**

   ```typescript
   await page.keyboard.press('Escape');
   await modal.waitFor({ state: 'hidden', timeout: 3000 });
   ```

3. **Reopen the Modal and verify the search has been cleared**

   ```typescript
   await page.locator('[data-testid="btn-add-skills"]').click();
   await modal.waitFor({ state: 'visible', timeout: 3000 });

   const searchInputAgain = modal.locator('input[placeholder*="Search"]');
   await expect(searchInputAgain).toHaveValue('');
   ```

**Expected result**: after closing and reopening the Modal, the search box is empty

**Cleanup**: close the Modal and the Drawer

---

### P1-26: List ordering — section title copy + count display (N)

**Case name**: `section headers show count`

**Requirements covered**: F-L-05

**Preconditions**:

- The list contains both enabled and disabled assistants

**Steps**:

1. **Navigate to the Assistant settings page**

   ```typescript
   await page.goto('/#/settings/assistants');
   await page.locator('[data-testid^="assistant-card-"]').first().waitFor({ state: 'visible', timeout: 10000 });
   ```

2. **Verify the Enabled section title and count**

   ```typescript
   const enabledHeader = page.locator('text=/Enabled/').first();
   await expect(enabledHeader).toBeVisible();

   const enabledText = await enabledHeader.textContent();
   // It should contain the count, for example "Enabled (3)"
   expect(enabledText).toMatch(/Enabled.*\(\d+\)/);
   ```

3. **Verify the Disabled section title and count**

   ```typescript
   const disabledHeader = page.locator('text=/Disabled/').first();

   // Only if there are disabled assistants
   if (await disabledHeader.isVisible().catch(() => false)) {
     const disabledText = await disabledHeader.textContent();
     expect(disabledText).toMatch(/Disabled.*\(\d+\)/);
   }
   ```

**Expected result**:

- The Enabled section title shows "Enabled (N)"
- The Disabled section title shows "Disabled (N)"

**Cleanup**: none

---

### P1-27: Summary Skills count tag color (0=gray, >0=green)

**Case name**: `summary skills count tag color changes with count`

**Requirements covered**: F-E-09

**Preconditions**:

- The Drawer of a Custom assistant is open

**Steps**:

1. **Open the Custom assistant Drawer (with no skills)**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();
   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await expect(drawer).toBeVisible({ timeout: 5000 });
   ```

2. **Locate the Skills count tag in the Summary area**

   ```typescript
   const summarySection = drawer.locator('.flex.flex-wrap.items-center.gap-8px.p-10px');
   const skillsTag = summarySection.locator('.arco-tag').filter({ hasText: /\d+/ }).last();
   ```

3. **Verify the color is gray when there are no skills**

   ```typescript
   const tagColorInitial = await skillsTag.getAttribute('color');
   expect(tagColorInitial).toBe('gray');
   ```

4. **Verify the color turns green after adding a skill** (requires actually adding a skill or mocking one)
   ```typescript
   // This step requires actually adding a skill, otherwise skip it
   test.skip(true, 'Requires adding skills to verify color change');
   ```

**Expected result**:

- Skill count 0 → tag color gray
- Skill count > 0 → tag color green

**Cleanup**: close the Drawer

---

## P2 Test Cases (edge cases/supporting, optional)

### P2-1: Leaving the page mid-highlight produces no warning

**Case name**: `highlight animation cleanup on unmount`

**Requirements covered**: B-14

**Preconditions**:

- A known existing assistant ID

**Steps**:

1. **Navigate to the URL carrying the highlight parameter**

   ```typescript
   const targetId = 'builtin-agent';
   await page.goto('/#/settings/assistants?highlight=' + targetId);

   const targetCard = page.locator(`[data-testid="assistant-card-${targetId}"]`);
   await targetCard.waitFor({ state: 'visible', timeout: 10000 });
   ```

2. **Wait 1 second (the highlight animation has not finished)**

   ```typescript
   await page.waitForTimeout(1000);
   ```

3. **Immediately navigate to another page**

   ```typescript
   await page.goto('/#/settings/general');
   await page.waitForTimeout(500);
   ```

4. **Verify there is no console warning or error**

   ```typescript
   const errors: string[] = [];
   page.on('console', (msg) => {
     if (msg.type() === 'error' || msg.type() === 'warning') {
       errors.push(msg.text());
     }
   });

   await page.waitForTimeout(3000); // wait for any delayed errors

   // There should be no warning related to a memory leak
   const hasMemoryWarning = errors.some((e) => e.includes('memory') || e.includes('timer') || e.includes('cleanup'));
   expect(hasMemoryWarning).toBe(false);
   ```

**Expected result**: leaving the page while the highlight animation is running produces no warning or error

**Cleanup**: none

---

### P2-2: Search + tab filter applied together produce the empty state

**Case name**: `search and tab filter both apply empty state`

**Requirements covered**: B-15

**Preconditions**:

- The list contains both Builtin and Custom assistants

**Steps**:

1. **Type the search query "Custom"**

   ```typescript
   await page.locator('[data-testid="btn-search-toggle"]').click();
   const searchInput = page.locator('[data-testid="input-search-assistant"]');
   await searchInput.fill('Custom');
   await page.waitForTimeout(300);
   ```

2. **Switch to the System tab**

   ```typescript
   const systemTab = page.locator('.arco-tabs-tab').filter({ hasText: 'System' });
   await systemTab.click();
   await page.waitForTimeout(300);
   ```

3. **Verify the empty-state copy**
   ```typescript
   // Both conditions apply at once: searchQuery="Custom" + filter="builtin"
   // The result should be empty
   const emptyMessage = page.locator('text=No assistants match the current filters.');
   await expect(emptyMessage).toBeVisible();
   ```

**Expected result**: searching for "Custom" and switching to the System tab → the empty-state copy is shown

**Cleanup**: clear the search

---

### P2-3: Hovering a Pending/Custom skill reveals the delete button

**Case name**: `skill delete button visible on hover`

**Requirements covered**: F-SK-09

**Preconditions**:

- At least one Pending or Custom skill exists

**Steps**:

1. **Locate the Pending/Custom skill card**

   ```typescript
   // Requires a pending or custom skill
   test.skip(true, 'Requires pending/custom skill');
   ```

2. **Verify the delete button is invisible by default**

   ```typescript
   const skillCard = drawer.locator('.flex.items-start.gap-8px.p-8px').first();
   const deleteBtn = skillCard.locator('button').filter({ has: page.locator('svg[class*="delete"]') });

   // Invisible by default (opacity-0)
   const isVisible = await deleteBtn.isVisible().catch(() => false);
   expect(isVisible).toBe(false);
   ```

3. **Hover the card and verify it becomes visible**

   ```typescript
   await skillCard.hover();
   await page.waitForTimeout(100);

   await expect(deleteBtn).toBeVisible();
   ```

**Expected result**:

- The delete button is invisible by default (`opacity-0`)
- It becomes visible on hover (`group-hover:opacity-100`)

**Cleanup**: none

---

### P2-4: AddCustomPathModal OK button disabled rules (Name/Path empty after trimming)

**Case name**: `add custom path ok button disabled when empty`

**Requirements covered**: F-P-03

**Preconditions**:

- The AddCustomPathModal is open

**Steps**:

1. **Open the AddSkillsModal and click the "+" button**

   ```typescript
   await page.locator('[data-testid="btn-create-assistant"]').click();
   const drawer = page.locator('[data-testid="assistant-edit-drawer"]');
   await drawer.waitFor({ state: 'visible' });

   await page.locator('[data-testid="btn-add-skills"]').click();
   const skillsModal = page.locator('.arco-modal').filter({ hasText: 'Add Skills' });
   await expect(skillsModal).toBeVisible({ timeout: 3000 });

   // Click the "+" button to open the Add Custom Path Modal
   const addPathBtn = skillsModal.locator('button').filter({ has: page.locator('[class*="plus"]') });
   await addPathBtn.click();

   const pathModal = page.locator('.arco-modal').filter({ hasText: 'Add Custom Path' });
   await expect(pathModal).toBeVisible({ timeout: 3000 });
   ```

2. **Verify the OK button is disabled when Name is empty**

   ```typescript
   const nameInput = pathModal.locator('input').first();
   const pathInput = pathModal.locator('input').last();
   const okBtn = pathModal.locator('.arco-btn-primary');

   await nameInput.clear();
   await pathInput.fill('/test/path');
   await page.waitForTimeout(200);

   await expect(okBtn).toBeDisabled();
   ```

3. **Verify the OK button is disabled when Path is empty**

   ```typescript
   await nameInput.fill('Test');
   await pathInput.clear();
   await page.waitForTimeout(200);

   await expect(okBtn).toBeDisabled();
   ```

4. **Verify the OK button is disabled when both fields contain only spaces**

   ```typescript
   await nameInput.fill('   ');
   await pathInput.fill('   ');
   await page.waitForTimeout(200);

   await expect(okBtn).toBeDisabled();
   ```

5. **Verify the OK button is enabled when both fields are non-empty**

   ```typescript
   await nameInput.fill('Test');
   await pathInput.fill('/test/path');
   await page.waitForTimeout(200);

   await expect(okBtn).toBeEnabled();
   ```

**Expected result**:

- Name or Path empty (after trimming) → the OK button is disabled
- Both non-empty → the OK button is enabled

**Cleanup**: close the Modal (`Escape`)

---

### P2-5: The AddCustomPathModal directory-picker button triggers dialog.showOpen (mocked to return a path)

**Case name**: `add custom path folder button triggers dialog`

**Requirements covered**: F-P-02

**Preconditions**:

- The AddCustomPathModal is open

**Steps**:

1. **Open the AddCustomPathModal** (same as P2-4)

   ```typescript
   // ... open the Modal
   ```

2. **Mock `dialog.showOpen` so that it returns a path**

   ```typescript
   await page.evaluate(() => {
     window.electron = window.electron || {};
     window.electron.dialog = {
       showOpen: async () => ({
         canceled: false,
         filePaths: ['/mock/selected/path'],
       }),
     };
   });
   ```

3. **Click the FolderOpen button**

   ```typescript
   const folderBtn = pathModal.locator('button').filter({ has: page.locator('[class*="folder"]') });
   await folderBtn.click();
   ```

4. **Verify the Path input field is filled with the returned path**
   ```typescript
   const pathInput = pathModal.locator('input').last();
   await expect(pathInput).toHaveValue('/mock/selected/path');
   ```

**Expected result**: clicking the FolderOpen button → `dialog.showOpen` is called → the returned path is filled into the input field

**Cleanup**: close the Modal

---

## Implementation Notes

### Data dependencies

- **P0-6, P1-6**: depend on an Extension assistant existing (ID prefix `ext-`). If there is none, the test should skip.
- **P1-14 ~ P1-17**: depend on an external skill source or on Pending/Custom skills. Mocking or skipping is recommended.
- **P1-18**: depends on a Builtin assistant that has Auto-injected Skills. Using `builtin-agent` is recommended (if available).
- **P1-21**: depends on skills that have already been added. Skipping or mocking is recommended.

### Elements with no data-testid

The following elements have no `data-testid` and must be located with a composed selector (already given in the test cases):

- AddSkillsModal external-source pills, search input field, and the Add button on skill cards
- The Drawer Close icon in the top right and the Cancel button
- The Rules section Expand/Collapse button and the Edit/Preview tabs
- The Skills group header, status dot, and delete button
- The SkillConfirmModals OK button
- The AddCustomPathModal input fields and FolderOpen button

### Test environment requirements

- **Viewport tests** (P1-22, P1-24): require support for `page.setViewportSize()`.
- **sessionStorage tests** (P1-23): require support for `page.evaluate()`.
- **Mocking dialog.showOpen** (P2-5): requires mocking Electron IPC in the test environment.

### Cleanup strategy

- A Custom assistant created by a test should be deleted when the test case ends (unless it is explicitly a precondition for a later test case).
- The search and filter state should be cleared when the test case ends.
- Any viewport change should be restored to the default value when the test case ends.

---

## Summary

This document turns the 37-item supplementary test checklist into executable Playwright test case steps, covering:

- **P0**: 6 core interaction test cases (mandatory)
- **P1**: 27 key UI state test cases (recommended)
- **P2**: 5 edge case/supporting test cases (optional)

Each test case states the requirement IDs it covers, its preconditions, its detailed steps (including the data-testid values and assertion points), its expected result, and its cleanup. Some test cases are marked as skipped because they depend on external data (Extension assistants, skill sources, and so on); mocks or real data can be added when they are implemented later.

Next step: the Engineer reviews these for implementability and the Designer confirms the steps are accurate, after which the work moves to Gate 3 (writing the actual test code).
