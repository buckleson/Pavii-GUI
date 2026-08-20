# Engineer Review: test-cases.md v1.0

**Review date**: 2026-04-21
**Reviewer**: skills-engineer-2
**Document version**: test-cases.md v1.0 (26 cases)

## 1. Review Scope

A review of the test cases drafted by the Designer, from the perspectives of E2E executability, whether the preconditions can be constructed, and whether the observable assertion points are sufficient.

**Review dimensions**:

1. Can the preconditions be constructed with the methods described in test-strategy?
2. Are the testids used in the test steps present in the test-strategy inventory?
3. Does every expected result have a clear observable point (UI or bridge)?
4. Are any new testids required?

---

## 2. Summary of Key Issues

### 2.1 Inconsistent testid naming (P0 blocker)

The testids used in the cases do not match test-strategy § 5.2 and need to be unified:

| Used in the cases                | test-strategy § 5.2       | Affected cases  |
| -------------------------------- | ------------------------- | --------------- |
| `my-skills-search-input`         | `input-search-my-skills`  | TC-S-02, 03     |
| `my-skills-refresh-button`       | `btn-refresh-my-skills`   | TC-S-04         |
| `delete-skill-button-${name}`    | `btn-delete-${name}`      | TC-S-05         |
| `import-skill-button-${name}`    | `btn-import-${name}`      | TC-S-10         |
| `import-all-skills-button`       | `btn-import-all`          | TC-S-11         |
| `export-skill-button-${name}`    | `btn-export-${name}`      | TC-S-19, 20     |
| `external-skills-search-input`   | `input-search-external`   | TC-S-12, 13     |
| `external-skills-refresh-button` | `btn-refresh-external`    | TC-S-14         |
| `add-custom-path-button`         | `btn-add-custom-source`   | TC-S-16, 17, 18 |
| `custom-path-name-input`         | `input-custom-path-name`  | TC-S-16, 17, 18 |
| `custom-path-value-input`        | `input-custom-path-value` | TC-S-16, 17, 18 |

**Scope of impact**: 14 cases

**Recommendation**: the Designer should revise test-cases.md to use the test-strategy testid names consistently (the test-strategy naming is cleaner and follows the `btn-*` / `input-*` / `modal-*` prefix convention)

---

### 2.2 Bridge key confirmation (P1)

TC-S-16 mentions `getCustomExternalPaths`, but test-strategy § 4.2 does not list that bridge key.

**To confirm**:

1. Check whether `fs.getCustomExternalPaths` exists in `src/common/adapter/ipcBridge.ts`
2. If it does, add it to the table in test-strategy § 4.2
3. If it does not, change the case to assert using only `detectAndCountExternalSkills`

---

### 2.3 Missing testid for the modal confirm button (P1)

The testid of the "Confirm" button on the TC-S-05 delete confirmation modal is not stated explicitly in the case.

**Recommendation**:

- Add to the case: click the "Confirm" button (`btn-confirm-delete`)
- test-strategy § 5.2 already lists this testid under P1

---

## 3. Case-by-Case Review

### ✅ TC-S-01: Render the My Skills list

- Preconditions: ✅ constructible
- testid: ✅ complete
- Observable points: ✅ clear

### ⚠️ TC-S-02/03: Search skills

- Preconditions: ✅ constructible
- testid: ⚠️ `my-skills-search-input` must become `input-search-my-skills`
- Observable points: ✅ clear

### ⚠️ TC-S-04: Refresh the skills list

- Preconditions: ✅ constructible
- testid: ⚠️ `my-skills-refresh-button` must become `btn-refresh-my-skills`
- Observable points: ✅ clear

### ⚠️ TC-S-05: Delete a custom skill

- Preconditions: ✅ constructible
- testid: ⚠️ 2 inconsistencies
  1. `delete-skill-button-${name}` → `btn-delete-${name}`
  2. The modal confirm button must be specified as `btn-confirm-delete`
- Observable points: ✅ clear

### ✅ TC-S-06/07: Delete a builtin skill / empty state

- Preconditions: ✅ constructible
- testid: ✅ no new testids
- Observable points: ✅ clear

### ⚠️ TC-S-08/09: Render external skills / tab switching

- Preconditions: ✅ constructible (TC-S-08 already provides the complete code)
- testid: ⚠️ `external-source-tab-${source}` needs to be normalized to `external-source-tab-${normalizeTestId(source.name)}`
- Observable points: ✅ clear

### ⚠️ TC-S-10: Import a single external skill

- Preconditions: ✅ constructible
- testid: ⚠️ `import-skill-button-${name}` → `btn-import-${name}`
- Observable points: ✅ clear

### ⚠️ TC-S-11: Batch import

- Preconditions: ✅ constructible
- testid: ⚠️ `import-all-skills-button` → `btn-import-all`
- Observable points: ✅ clear

### ⚠️ TC-S-12/13: Search external skills

- Preconditions: ✅ constructible
- testid: ⚠️ `external-skills-search-input` → `input-search-external`
- Observable points: ✅ clear

### ⚠️ TC-S-14: Refresh external skills

- Preconditions: ✅ constructible
- testid: ⚠️ `external-skills-refresh-button` → `btn-refresh-external`
- Observable points: ✅ clear

### ✅ TC-S-15: Empty external source state

- Preconditions: ✅ constructible
- testid: ✅ no new testids
- Observable points: ✅ clear

### ⚠️ TC-S-16/17/18: Add a custom path

- Preconditions: ✅ constructible
- testid: ⚠️ 3 inconsistencies
  1. `add-custom-path-button` → `btn-add-custom-source`
  2. `custom-path-name-input` → `input-custom-path-name`
  3. `custom-path-value-input` → `input-custom-path-value`
- Bridge key: ⚠️ the existence of `getCustomExternalPaths` needs to be confirmed
- Observable points: ✅ clear

### ⚠️ TC-S-19/20: Export a skill

- Preconditions: ✅ constructible
- testid: ⚠️ `export-skill-button-${name}` → `btn-export-${name}`
- Observable points: ✅ clear

### ✅ TC-S-21: Export (no external source)

- Preconditions: ✅ constructible
- testid: ✅ no new testids
- Observable points: ✅ clear

### ✅ TC-S-22/23: URL highlight

- Preconditions: ✅ constructible
- testid: ✅ reuses the existing card testids
- Observable points: ✅ clear

### ✅ TC-S-24: Special characters

- Preconditions: ✅ constructible
- testid: ✅ no new testids
- Observable points: ✅ clear

### ⚠️ TC-S-25: Performance scenario

- Preconditions: ✅ constructible
- testid: ✅ no new testids
- Observable points: ⚠️ the performance assertion needs implementation detail
  - Suggested sample code:
    ```typescript
    const startTime = await page.evaluate(() => performance.now());
    // rendering operation...
    const endTime = await page.evaluate(() => performance.now());
    expect(endTime - startTime).toBeLessThan(1000);
    ```

### ✅ TC-S-26: Concurrent operations

- Preconditions: ✅ constructible
- testid: ✅ no new testids
- Observable points: ✅ clear

---

## 4. Overall Assessment

### Strengths

✅ **Constructibility of preconditions**: excellent

- The preconditions of all 26 cases can be built with the methods described in test-strategy
- Cases such as TC-S-08 and TC-S-16 already include the full construction code

✅ **Sufficiency of observable points**: excellent

- Every case has an explicit UI or bridge assertion point
- Mixed-assertion scenarios are covered thoroughly

✅ **Documentation quality**: excellent

- The case structure is clear (preconditions / test steps / expected results / assertion type)
- Known issues and limitations are noted accurately
- Priority definitions are unambiguous

### Needs improvement

⚠️ **Inconsistent testid naming**: 14 cases affected

- The testids used in the cases do not match test-strategy
- The Designer needs to unify the naming

⚠️ **Bridge key needs confirmation**: 1 case

- TC-S-16's `getCustomExternalPaths` needs to be confirmed to exist

⚠️ **Performance assertion detail**: 1 case

- TC-S-25 needs the performance measurement implementation code filled in

---

## 5. Action Items

### Priority 1 (blocks gate 3)

1. **Designer revises test-cases.md**:
   - Unify the testid naming (14 cases, see the table in § 2.1)
   - Add the modal confirm button testid to TC-S-05
   - Bump the revised version to v1.1

2. **Engineer confirms the bridge key**:
   - Check whether `fs.getCustomExternalPaths` exists
   - If it does, add it to test-strategy § 4.2
   - If it does not, notify the Designer to amend TC-S-16

### Priority 2 (optional improvements)

3. **Optional for the Designer**: fill in the implementation detail of the TC-S-25 performance assertion
4. **Optional for the Engineer**: add P2 testids such as `my-skills-empty-state` to test-strategy

---

## 6. Review Conclusion

**Conclusion**: ⚠️ **conditionally approved; needs re-confirmation after the testid naming is revised**

**Path to gate 3 after revision**:

- Once the Designer has unified the testid naming, notify the Engineer for a second confirmation
- Once the Engineer has confirmed the bridge key, update test-strategy
- Once all three parties agree, notify the team lead: gate 2 is complete and gate 3 begins

---

**Review status**: ✅ complete
**Core issue**: inconsistent testid naming (14 cases), pending revision by the Designer
