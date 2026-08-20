# Aion CLI (aionrs) E2E Tests - Discussion Log

**Project**: AionUi E2E Coverage
**Sub-group**: chat-aionrs
**Date**: 2026-04-22

---

## Gate 1: Requirements Analysis

### 2026-04-22 first draft complete

**Participant**: chat-aionrs-analyst

**Work completed**:

1. Analyzed the aionrs source (guid entry point, conversation page, process side, permission enums, DB schema).
2. Drafted the first version of `requirements.md`.
3. Identified 8 major uncertainties (model switching, the scope of permission storage, where the binary comes from, and so on).

**Action items**:

- [x] chat-aionrs-designer reviews the requirements and adds test case design suggestions
- [ ] chat-aionrs-engineer reviews the requirements and assesses technical feasibility
- [ ] team-lead resolves the major uncertainties in §8

**Known constraints**:

- aionrs **does not support Google Auth** (filtered out in `useAionrsModelSelection.ts:36-40`).
- The "always allow" permission is currently stored in memory only (it is lost when the process restarts).
- ~~Neither the guid page nor the conversation page has any `data-testid`~~ **Correction** (found by the engineer): the guid page already has attributes such as `data-agent-backend`; the conversation page needs 15+ new testids.

---

### 2026-04-22 designer review complete

**Participant**: chat-aionrs-designer

**Review verdict**: ✅ **No major blockers, ready for Gate 2**

**Review dimensions**:

1. ✅ **Coverage of test dimensions** — folder attachment, file upload, model, permission, and mid-conversation switching are all covered; suggest adding multi-file and multi-folder scenarios.
2. ⚠️ **Convergence of the combination matrix** — the full permutation of 30+ cases needs to converge to 15 cases (P0 5 + P1 7 + P2 3), using orthogonal/pairwise coverage.
3. ⚠️ **More failure paths** — suggest adding protocol errors, empty messages, and process cleanup verification.
4. ✅ **DB assertions are explicit** — the conversations and messages fields are clear; suggest adding assertions for streamed messages, thinking messages, and tool calls.
5. ✅ **The cleanup contract is implementable** — the DB/FS/sessionStorage cleanup plan is sound; add verification that the binary process is cleaned up.
6. ✅ **State transitions are clear** — suggest adding a Mermaid state diagram (as a reference for the Gate 2 case design).
7. ✅ **Testability assessment** — the proposed new testids are reasonable; add testids for the send button, the message list, and attachment cards.

**Key suggestions**:

1. **Additional dimensions** (Gate 2 case design):
   - Folder attachment → 3 levels (none / single / multiple)
   - File upload → 3 levels (none / single / multiple)
   - Mid-conversation model switching → add a "round-trip switch" (to verify state rollback)

2. **Case priorities** (to control the cost of invoking the real binary):
   - P0 (must test): no attachments, single file, single folder + default model + default permission
   - P1 (common): multiple files + multiple folders, model switching, permission switching
   - P2 (edge): oversized files, concurrent conversations, protocol errors

3. **Additional DB assertions** (reference for the Gate 3 implementation):

   ```sql
   -- Verify that the streamed message completed
   SELECT status FROM messages WHERE conversation_id = ? AND position = 'left' AND type = 'text';
   -- Expected: status = 'finish'

   -- Verify the thinking message
   SELECT json_extract(content, '$.duration') FROM messages WHERE type = 'thinking';
   -- Expected: a positive integer (ms)

   -- Verify that the permission mode is persisted
   SELECT json_extract(extra, '$.sessionMode') FROM conversations WHERE id = ?;
   -- Expected: 'default' | 'auto_edit' | 'yolo'
   ```

4. **Cleanup order** (to avoid foreign key conflicts):

   ```typescript
   // 1. Stop the binary process
   await ipcBridge.conversation.stopAgent.invoke(conversationId);

   // 2. Clean up the DB (messages are deleted by cascade)
   await db.exec("DELETE FROM conversations WHERE name LIKE 'E2E-aionrs-%'");

   // 3. Clean up the filesystem
   await fs.rm('/tmp/e2e-aionrs-*', { recursive: true });

   // 4. Clean up sessionStorage
   sessionStorage.clear();
   ```

**Suggestions for the §8 uncertainties**:

| Topic                                                      | designer's suggestion                                     | Test strategy                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Does switching the model require restarting the binary? | Wait for team-lead to verify the capability               | A (runtime switching) verifies the sessionId does not change; B (restart required) verifies the sessionId does change; C (unsupported) degrades the UI |
| 2. Is the "always allow" permission persisted?             | Keep it in memory (option B)                              | Verify that it takes effect within a single conversation and is lost after the app restarts                                                            |
| 3. Switching permission/model during a tool confirmation?  | Switching the permission cancels the pending confirmation | Case: confirmation dialog open → switch to yolo → verify the dialog disappears and the call is auto-approved                                           |
| 4. Where does the binary come from in CI?                  | Skip E2E in CI (option C) plus a local test suite         | `test.beforeAll()` checks for the binary and calls `test.skip('aionrs binary not found')` when it is missing                                           |

**Next steps**:

1. team-lead resolves topics 1 and 4 first (within 1 working day).
2. designer drafts `test-cases.md` (roughly 15 cases, graded P0/P1/P2).
3. engineer reviews the requirements in parallel (from a technical feasibility angle).

---

### 2026-04-22 engineer review complete

**Participant**: chat-aionrs-engineer

**Review verdict**: ✅ **Technically feasible**; requirements document quality ⭐⭐⭐⭐⭐ (5/5)

**Key findings**:

1. **The guid page already has data-testids** (previously misjudged as having none)
   - Existing attributes: `data-agent-pill="true"`, `data-agent-backend="aionrs"`, `data-agent-selected`
   - Location: `AgentPillBar.tsx:79-82`

2. **The conversation page needs 15+ new testids** (otherwise elements cannot be located)
   - **P0 priority** (blocks testing): 5 of them
     ```tsx
     [data-testid="aionrs-sendbox"]
     [data-testid="aionrs-model-selector"]
     [data-testid="agent-mode-selector-aionrs"]
     [data-testid="aionrs-file-upload-input"]
     [data-testid="aionrs-attach-folder-btn"]
     ```
   - **P1 priority** (improves stability): 10 of them
     - The send button, file previews, folder tags, model/permission dropdown items, and so on

3. **DB cleanup needs additional helpers**
   - File location: `tests/e2e/helpers/chatAionrs.ts`
   - Functions: `cleanupE2EAionrsConversations()`, `getAionrsMessages()`, and others

4. **The binary has been verified as usable**
   - Version: aionrs v0.1.12
   - Path: `/Users/zhoukai/.local/bin/aionrs`

**Technical suggestions** (for the §8 uncertainties):

| Topic                                                      | engineer's suggestion                                                          | Implementation strategy                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1. Does switching the model require restarting the binary? | Use an **exploratory E2E test** to record the current behavior                 | Send message A (model M1) → switch to M2 → send message B → query the DB: `messages[B].extra.model === M2 ?` |
| 2. Is the "always allow" permission persisted?             | **In-memory storage does not block E2E**; persistence is a product requirement | Verifying that "always allow" takes effect within a single conversation is enough                            |
| 3. Switching permission/model during a tool confirmation?  | Have E2E **record the current behavior** first (screenshots + logs)            | Trigger the dialog → switch mode → observe the dialog state → hand the decision to team-lead                 |
| 4. Where does the binary come from in CI?                  | **Skip in CI** short term, DevOps configuration long term                      | `test.skip(() => resolveAionrsBinary() === null, 'aionrs binary not found')`                                 |

**Effort estimate**:

- **Gate 2** (case design): 8-12 core cases plus 3-5 edge cases
- **Gate 3** (implementation): ~2000 lines of code, **3-5 days** (assuming the testids have been added)

**Prerequisite work** (blocks Gate 3):

1. **Add 15+ data-testids to the conversation page** (estimated 1-2 hours).
2. **Implement the DB cleanup helper** (estimated 30 minutes).

**Comparison with the designer's suggestions**:

| Dimension                        | designer                                                       | engineer                             | Combined conclusion                  |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| Additional test dimensions       | Folder attachment / file upload → 3 levels (none/single/multi) | Agreed                               | ✅ Adopted (reflected in Gate 2)     |
| Controlling the number of cases  | Converge to 15 cases (orthogonal/pairwise)                     | 8-12 core plus 3-5 edge              | ✅ Consistent (11-17 cases in total) |
| Topic 2 (permission persistence) | Keep it in memory (option B)                                   | In-memory storage does not block E2E | ✅ Consistent                        |
| Topic 4 (CI binary)              | Skip in CI (option C)                                          | Skip short term, DevOps long term    | ✅ Consistent                        |

**Next steps**:

1. The analyst consolidates both reviewers' feedback and notifies team-lead via SendMessage.
2. team-lead resolves topics 1 and 3 (within 1-2 working days).
3. The designer drafts `test-cases.md` (Gate 2).

---

## Open Topics

### Topic 1: Does switching the model require restarting the binary?

**Background**: `AionrsAgent.setConfig(model)` sends a `set_config` command, but the binary's capability has not been verified.

**Options**:

- A) Runtime switching is supported (E2E verifies the switch takes effect on the next message and the sessionId does not change).
- B) The binary must be restarted (E2E verifies the sessionId changes after the switch).
- C) Not currently supported (E2E only tests model selection on the guid page).

**Decision**: [to be filled in by team-lead]

---

### Topic 2: Does the "always allow" permission need to be persisted?

**Background**: it is currently held in `AionrsApprovalStore` (in memory) and is lost when the process restarts.

**Options**:

- A) Persist it to the DB (matching Gemini's behavior).
- B) Keep it in memory (valid for a single conversation).

**engineer's assessment**:

- **Current E2E testability**: ✅ testable (in-memory storage is enough; verify that "always allow" takes effect within a single conversation).
- **Persistence is a product requirement**, not an E2E blocker.

**team-lead decision**: **Option B, in-memory storage**

- **Reasoning**: cross-conversation persistence is a product decision and is out of scope for this round of E2E work.
- **Implementation**: only test that switching the permission takes effect immediately within the same conversation; do not test persistence across conversations or across process restarts.

---

### Topic 3: What happens when the permission/model is switched during a tool confirmation?

**Background**: the current code does not handle this explicitly.

**analyst's suggestion**: cancel the pending confirmation when the permission is switched and require the user to confirm again.

**engineer's suggestion**: have E2E **record the current behavior** first (without presupposing an expectation) and hand the decision to team-lead.

**team-lead decision**: **Not covered in this round of E2E**

- **Reasoning**: the code does not define this behavior, and E2E should not lock in undefined behavior.
- **Handling**: recorded in the discussion log as a future candidate, to be tested once the product side defines the expectation.

---

### Topic 4: Where does the binary come from in CI?

**Background**: E2E depends on the aionrs binary.

**Options**:

- A) Pre-install it in CI (requires DevOps configuration).
- B) Download it dynamically before the tests (requires a URL plus a pinned version).
- C) Skip the aionrs E2E tests (mark them skipped with a reason).

**engineer's suggestion**: implement **local E2E** first and defer the CI strategy.

- **Short term**: skip the aionrs E2E tests in CI (`test.skip(() => resolveAionrsBinary() === null, 'aionrs binary not found')`).
- **Long term**: DevOps configures a pre-installed binary, or it is downloaded dynamically (needs team-lead coordination).

**team-lead decision**: **Option C, skip in CI** (short term)

- **Reasoning**: the long-term CI strategy is deferred and must not block this round of E2E delivery.
- **Implementation**: `test.skip(() => resolveAionrsBinary() === null, 'aionrs binary not found')`

**Implementation plan**:

```typescript
// tests/e2e/setup/aionrs.setup.ts
export async function checkAionrsBinary(): Promise<boolean> {
  try {
    const binary = await ipcBridge.fs.findAionrsBinary.invoke();
    return binary !== null;
  } catch {
    return false;
  }
}

// tests/e2e/specs/chat-aionrs/*.spec.ts
test.beforeAll(async () => {
  const hasBinary = await checkAionrsBinary();
  if (!hasBinary) {
    test.skip('aionrs binary not found, skipping E2E tests');
  }
});
```

---

## Gate 2: Test Case Design

### 2026-04-22 case design complete

**Participant**: chat-aionrs-designer

**Work completed**:

1. Produced `test-cases.md` (15 cases) based on the decisions on the 4 topics.
2. Case grading: 5 P0 cases (baseline paths) + 7 P1 cases (regular combinations) + 3 P2 cases (edge verification).
3. Each case includes: ID / preconditions / dimension combination / steps / DB assertions / cleanup obligations / screenshot count.

**Key design decisions**:

1. **Unified permission naming**: use `auto_edit` as reported by the aionrs runtime capabilities, to avoid confusion with Gemini's `autoEdit`.
2. **Model selection fallback**: if the model selector on the guid page is not enabled for TC-A-04, switch the model on the conversation page instead (see TC-A-07).
3. **Convergence of the combination matrix**: 30+ original cases → 15 cases, prioritizing single dimensions plus representative combinations.
4. **Simplified failure scenarios**: the P2 cases cover only the binary check, the large file limit, and a non-existent path (concurrent conversations are deferred).

**Case matrix**:

| Priority | Folder attachment | File upload     | Model          | Permission             | Mid-conversation action | Cases |
| -------- | ----------------- | --------------- | -------------- | ---------------------- | ----------------------- | ----- |
| P0       | none/single       | none/single     | default/second | default/yolo           | none                    | 5     |
| P1       | single/multiple   | single/multiple | default/second | default/auto_edit/yolo | switch model/permission | 7     |
| P2       | N/A/non-existent  | oversized       | default        | default                | none                    | 3     |

**Action items**:

- [ ] chat-aionrs-engineer reviews the case design and estimates the implementation effort
- [ ] Enter Gate 3 (implementation) once team-lead approves

**Known constraints**:

- Topic 1 decision: only verify that the DB `extra.model` is updated; do not verify the binary's sessionId.
- Topic 2 decision: only test that a switch takes effect within the same conversation; do not test cross-conversation persistence.
- Topic 3 decision: do not cover the edge behavior of switching the permission/model during a tool confirmation.
- Topic 4 decision: local only this round, skipped in CI (using `test.skip()` plus a binary check).

---

### 2026-04-22 engineer review of the Gate 2 test cases

**Participant**: chat-aionrs-engineer

**Review verdict**: ✅ **Excellent overall**; 4 details need adjusting

**Review dimensions**:

1. **TC-A-04 note (the conditions under which the guid page model selector is enabled)** — ⚠️ needs adjusting
2. **TC-A-05 assertion (the confirmation dialog selector)** — ⚠️ needs clarifying
3. **TC-A-08 / TC-A-14 assertions (cancelled status / file limit)** — ⚠️ needs verifying against the code
4. **TC-A-13 approach (environment variable injection)** — ⚠️ the implementation needs adjusting
5. **Consistency of the case notes** — ⚠️ needs filling in

---

#### 1. Whether the TC-A-04 note holds

**Problem**:
The TC-A-04 note says "if the model selector on the guid page is not enabled (the `isGeminiMode` branch), fall back to switching on the conversation page in TC-A-07."

**Source verification** (`GuidPage.tsx:467-469`):

```typescript
const PROVIDER_BASED_AGENTS = new Set(['gemini', 'aionrs']);
const isGeminiMode =
  PROVIDER_BASED_AGENTS.has(effectiveAgentType) &&
  (!agentSelection.isPresetAgent || agentSelection.currentEffectiveAgentInfo.isAvailable);
```

**Conclusion**: **The note does not hold** — `isGeminiMode` defaults to **true** for `aionrs` (because `PROVIDER_BASED_AGENTS` contains aionrs).

**Suggested adjustments**:

- Delete the TC-A-04 note: "if the model selector on the guid page is not enabled ... fall back to TC-A-07".
- Keep step 2 of TC-A-04: "open the model selector (`GuidModelSelector`) and choose the second model".
- Add a TC-A-04 precondition: "verify `isGeminiMode=true` (enabled by default for aionrs)".

---

#### 2. TC-A-05 assertion (the confirmation dialog selector)

**Problem**:
Line 328 of TC-A-05 says: "E2E layer: `page.waitForSelector('.confirmation-dialog', { timeout: 2000 })` should time out (proving there is no dialog)".

**Source verification** (`ConversationChatConfirm.tsx`):

- The confirmation dialog does **not** use the class `confirmation-dialog`.
- Actual structure: `<div className="relative p-16px bg-dialog-fill-0 ...">` (generated dynamically, no stable class).
- The component has **no** `data-testid`.

**Suggested adjustments**:

- Option A (recommended): add a testid at `ConversationChatConfirm.tsx:216` → `<div data-testid="conversation-confirmation-dialog">`.
- Option B (stopgap): use a text selector instead, `page.locator('text=/Yes, Allow|Allow Once/')`, and wait for it to time out.
- Rewrite the TC-A-05 assertion as:
  ```typescript
  // Verify there is no confirmation dialog (yolo mode auto-approves)
  await expect(page.locator('[data-testid="conversation-confirmation-dialog"]')).not.toBeVisible({ timeout: 5000 });
  ```

---

#### 3. TC-A-08 / TC-A-14 assertions (cancelled status / file limit)

**TC-A-08 problem** (L498):
The assertion says that after the first tool call is cancelled, `tool_status = 'Canceled'`.

**Source verification** (`chatLib.ts:183`):

```typescript
status: 'Executing' | 'Success' | 'Error' | 'Canceled' | 'Pending' | 'Confirming';
```

**Conclusion**: ✅ **The status exists**, but we still need to verify that **the cancellation is written to the DB**.

- `AionrsManager.ts:766-772` calls `agent.denyTool(callId, reason)`, which sends a `tool_deny` command.
- `index.ts:272-286` fires the `tool_cancelled` event → `type: 'tool_group', status: 'Canceled'`.
- **Confirmed**: the cancelled status **is** written to the DB (through the `addOrUpdateMessage` call chain).

**Suggestion**: ✅ **The assertion is valid**, no adjustment needed.

---

**TC-A-14 problem** (L835):
The assertion refers to a "front-end file size limit", and the note says "if the front end does not implement a size limit ... change this case to verify error handling at the binary layer".

**Source verification** (`FileService.ts:255-310`):

```typescript
async processDroppedFiles(files: FileList, ...) {
  // L291-294: catch the FILE_TOO_LARGE error and re-throw it
  if (error.message === 'FILE_TOO_LARGE') {
    throw error;
  }
}
```

**Finding**: **the front end does have a size limit mechanism** (when the WebUI uploads over HTTP the server checks the size and throws `FILE_TOO_LARGE`).

- Electron mode: no front-end limit; the file is written straight into the workspace.
- WebUI mode: the server enforces the limit (check the HTTP API configuration).

**Suggested adjustments**:

- **Keep TC-A-14** (test error handling at the binary layer in the Electron environment).
- Change the steps: do not verify a front-end block; instead **verify the error message returned by the binary/AI**.
- Change the expected behavior to:
  ```
  - The file is added to the uploadFile array successfully (the front end does not block it).
  - After the message is sent, the AI reply contains "file too large", or an error surfaces at the binary layer (timeout/OOM).
  ```
- Delete the note "if the front end does not implement a size limit ..." (it is now confirmed that the WebUI front end has a limit and Electron does not).

---

#### 4. TC-A-13 approach (environment variable injection)

**Problem** (L757):
The steps say "set the environment variable: `process.env.AION_CLI_PATH = '/dev/null'`".

**E2E environment assessment**:

- `process.env` is modified in the **Node.js test process**, which **does not affect the already-launched Electron child process**.
- The aionrs binary is resolved in the **main process** (`binaryResolver.ts`), which reads `process.env.AION_CLI_PATH`.

**Suggested adjustments**:

- Option A (recommended): set the environment variable in `test.beforeAll()` **before Electron starts**.
  ```typescript
  test.beforeAll(async () => {
    process.env.AION_CLI_PATH = '/dev/null';
    // The Electron launch inherits this environment variable
  });
  ```
- Option B (more involved): modify the main process environment dynamically through `electronApp.evaluate()`.
  ```typescript
  await electronApp.evaluate(() => {
    process.env.AION_CLI_PATH = '/dev/null';
  });
  ```
- **TC-A-13 adjustment**: change the steps to "set `AION_CLI_PATH=/dev/null` before the test starts (via `test.beforeAll` or on the command line, `AION_CLI_PATH=/dev/null npm run test:e2e`)".

---

#### 5. Consistency of the case notes

**Problem**:
TC-A-07 has the note "per the decision on topic 1, the binary's internal sessionId is not verified", but TC-A-08/09 (switching the permission mid-conversation) have no comparable note.

**Suggested additions** (to keep the style consistent):

- Add to TC-A-08: "per the decision on topic 3, the edge behavior of switching the permission during a tool confirmation is not covered (only cancel → resend is tested)".
- Add to TC-A-09: "per the decision on topic 2, cross-conversation persistence of 'always allow' is not verified; only that a switch takes effect within the same conversation".
- Add to TC-A-13: "per the decision on topic 4, this round is local only; CI handles a missing binary through the skip mechanism".

---

### Review Summary

| Review point              | Status              | Suggested adjustment                                                                 |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| 1. TC-A-04 note           | ⚠️ Does not hold    | Delete the "fall back to TC-A-07" note; aionrs enables the model selector by default |
| 2. TC-A-05 assertion      | ⚠️ Wrong selector   | Add a testid to ConversationChatConfirm, or use a text selector instead              |
| 3. TC-A-08 assertion      | ✅ Valid            | No adjustment needed; the `Canceled` status exists and is written to the DB          |
| 4. TC-A-14 assertion      | ⚠️ Needs adjusting  | Electron has no front-end limit, so test error handling at the binary layer          |
| 5. TC-A-13 implementation | ⚠️ Needs adjusting  | Set the environment variable in `test.beforeAll` (before Electron starts)            |
| 6. Note consistency       | ⚠️ Needs filling in | Add the topic decision notes to TC-A-08/09/13                                        |

**Next steps**:

- The designer adjusts `test-cases.md` according to the review feedback (estimated 30 minutes).
- The engineer adds the ConversationChatConfirm testid (prerequisite work, 5 minutes).
- Enter Gate 3 once team-lead approves.

---

## Follow-up Records

[Gate 3 discussion records will be appended here]
