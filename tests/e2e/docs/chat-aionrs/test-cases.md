# Aion CLI (aionrs) E2E Test Cases

**Version**: Gate 2 first draft
**Author**: chat-aionrs-designer
**Date**: 2026-04-22
**Status**: Awaiting review

---

## 1. Case Structure

### 1.1 Case numbering rules

- **P0 (must test)**: TC-A-01 through TC-A-05 (baseline paths, the minimum usable functionality)
- **P1 (regular)**: TC-A-06 through TC-A-12 (dimension combinations, common scenarios)
- **P2 (edge)**: TC-A-13 through TC-A-15 (error handling, edge verification)

### 1.2 Global preconditions

**Preconditions shared by every aionrs test case**:

1. **The aionrs binary is available**: verified through `ipcBridge.fs.findAionrsBinary.invoke()`; otherwise skip every test.
2. **The user's configured model list has at least 1 usable provider**:
   - Call `ipcBridge.mode.getModelConfig.invoke()` to fetch the user's configured provider list.
   - Filter: exclude Google Auth providers (whose `platform` contains `gemini-with-google-auth`).
   - Check: at least 1 provider has an apiKey and a usable model.
   - If no provider is usable: skip every aionrs test with the reason "No non-Google-Auth provider with apiKey configured".

3. **Test data preparation**: the temporary working directory `/tmp/e2e-aionrs-<timestamp>/`.

**Model lookup helper** (implemented by the engineer):

```typescript
// tests/e2e/helpers/chatAionrs.ts
export async function getAionrsTestModels(page: Page): Promise<{
  modelA: TProviderWithModel; // The first usable model (the default model)
  modelB: TProviderWithModel | null; // The second usable model (if there is one)
}>;
```

### 1.3 Dimensions

| Dimension               | Possible values                         | Description                                                                                                                |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Folder attachment       | none / single / multiple                | The `atPath` array (source: `AionrsSendBox.tsx:331-337`)                                                                   |
| File upload             | none / single / multiple                | The `uploadFile` array (source: `useSendBoxFiles.ts`)                                                                      |
| Model                   | default / chosen                        | Picked from the user-configured provider list (source: `ipcBridge.mode.getModelConfig.invoke()`, Google Auth filtered out) |
| Permission              | default / auto_edit / yolo              | Source: the aionrs runtime capabilities                                                                                    |
| Mid-conversation action | switch model / switch permission / none | The conversation page's `AionrsModelSelector` / `AgentModeSelector`                                                        |

### 1.4 Cleanup conventions

**Naming pattern**: every test conversation is named `E2E-aionrs-<timestamp>-<scenario>`.

**Cleanup order** (run in `afterEach` for every case):

1. Stop the binary process: `ipcBridge.conversation.stopAgent.invoke(conversationId)`.
2. Delete the DB records: `DELETE FROM conversations WHERE name LIKE 'E2E-aionrs-%'` (messages are deleted by cascade).
3. Delete the temporary directory: `fs.rm('/tmp/e2e-aionrs-*', { recursive: true })`.
4. Clean up sessionStorage: `sessionStorage.removeItem('aionrs_initial_message_*')` plus `sessionStorage.removeItem('aionrs_initial_processed_*')`.

### 1.5 Screenshot requirements

At least 3 screenshots per case:

1. The guid page after the agent is selected (showing the input box and the configuration controls).
2. The conversation page after the first message is sent (showing the user message and the AI reply mid-stream).
3. The conversation once it is complete (showing the final message list, with the DB assertions passing).

---

## 2. P0 Cases (baseline paths)

### TC-A-01: Minimal usable path

**Priority**: P0
**Goal**: verify the minimal conversation flow with no attachments, the default model, and the default permission.

**Preconditions**:

- The global preconditions in §1.2.
- Call `getAionrsTestModels(page)` to obtain `modelA` (the default model).

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | none |
| Model | default (`modelA`) |
| Permission | default |
| Mid-conversation action | none |

**Steps**:

1. Open the app and navigate to the guid page (`/#/guid`).
2. Select the aionrs agent (click `[data-agent-backend="aionrs"]`).
3. Confirm the permission selector shows `default` (the `AgentModeSelector` default).
4. Type the test message: "Hello, aionrs! Please list files in current directory."
5. Click the send button.
6. Wait for the navigation to the conversation page (the URL matches `/conversation/aionrs/*`).
7. Wait for the streamed AI reply to finish (poll the DB for `messages.status='finish'`, 60s timeout).

**DB assertions**:

```sql
-- 1. Verify the conversation was created
SELECT id, name, type, model, status, json_extract(extra, '$.sessionMode') as mode
FROM conversations
WHERE name LIKE 'E2E-aionrs-%' AND id = ?;
-- Expected: type='aionrs', mode='default', status='finished'

-- 2. Verify the user message
SELECT id, type, position, content, status
FROM messages
WHERE conversation_id = ? AND position = 'right';
-- Expected: type='text', position='right', json_extract(content, '$.content') contains "Hello, aionrs!"

-- 3. Verify the AI reply
SELECT id, type, position, status, created_at
FROM messages
WHERE conversation_id = ? AND position = 'left' AND type = 'text';
-- Expected: at least 1 row, status='finish', created_at > the user message's created_at

-- 4. Verify the message ordering
SELECT COUNT(*) FROM messages WHERE conversation_id = ?;
-- Expected: >= 2 (user + AI)
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-minimal-path`
- temp dir: `/tmp/e2e-aionrs-<timestamp>-tc-a-01/` (the workspace)
- sessionStorage: `aionrs_initial_message_${conversationId}`, `aionrs_initial_processed_${conversationId}`

**Screenshots**: 3

---

### TC-A-02: Attach a single folder

**Priority**: P0
**Goal**: verify that once a folder is attached, the message content contains a reference to it.

**Preconditions**:

- The global preconditions in §1.2.
- The test folder exists in the temporary working directory: `/tmp/e2e-aionrs-<timestamp>/test-folder/`.

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | single (`test-folder/`) |
| File upload | none |
| Model | default |
| Permission | default |
| Mid-conversation action | none |

**Steps**:

1. Create the temporary directory and the test folder:
   ```bash
   mkdir -p /tmp/e2e-aionrs-<timestamp>/test-folder/
   echo "sample content" > /tmp/e2e-aionrs-<timestamp>/test-folder/sample.txt
   ```
2. Open the guid page and select the aionrs agent.
3. Pick `test-folder/` in the file tree (this fires `emitter.emit('aionrs.selected.file', [{ path, name, isFile: false }])`).
4. Confirm the guid page shows the folder tag (`data-testid="folder-tag-0"`).
5. Type the message: "What files are in the attached folder?"
6. Click send.
7. Wait for the AI reply on the conversation page to finish.

**DB assertions**:

```sql
-- 1. Verify the user message contains the folder reference
SELECT json_extract(content, '$.attachedDirs') as dirs
FROM messages
WHERE conversation_id = ? AND position = 'right';
-- Expected: dirs is a JSON array containing '{"path": ".../test-folder", "name": "test-folder", "isFile": false}'

-- 2. Verify the message content
SELECT json_extract(content, '$.content') as text
FROM messages
WHERE conversation_id = ? AND position = 'right';
-- Expected: text contains "What files are in the attached folder?"

-- 3. Verify the AI reply
SELECT status FROM messages WHERE conversation_id = ? AND position = 'left' AND type = 'text';
-- Expected: status='finish'
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-folder-single`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/` (contains test-folder)
- sessionStorage: same as TC-A-01

**Screenshots**: 3

---

### TC-A-03: Upload a single file

**Priority**: P0
**Goal**: verify that after a file is uploaded, the binary receives the `files` parameter.

**Preconditions**:

- The global preconditions in §1.2.
- The test file exists: `/tmp/e2e-test-file.txt` (contents: "Test file content for aionrs E2E").

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | single (`e2e-test-file.txt`) |
| Model | default |
| Permission | default |
| Mid-conversation action | none |

**Steps**:

1. Create the test file:
   ```bash
   echo "Test file content for aionrs E2E" > /tmp/e2e-test-file.txt
   ```
2. Open the guid page and select the aionrs agent.
3. Upload the file:
   - WebUI: use `<input type="file">` to pick `/tmp/e2e-test-file.txt`.
   - Desktop: call `ipcBridge.dialog.showOpen()` to pick the file.
4. Confirm the file preview card appears (`data-testid="file-card-0"`).
5. Type the message: "What is the content of the attached file?"
6. Click send.
7. Wait for the AI reply on the conversation page to finish.

**DB assertions**:

```sql
-- 1. Verify the user message contains the file reference
SELECT json_extract(content, '$.attachedFiles') as files
FROM messages
WHERE conversation_id = ? AND position = 'right';
-- Expected: files is a JSON array containing '/tmp/e2e-test-file.txt'

-- 2. Verify the AI reply mentions the file contents
SELECT json_extract(content, '$.content') as text
FROM messages
WHERE conversation_id = ? AND position = 'left' AND type = 'text';
-- Expected: text contains "Test file content" or the file name "e2e-test-file.txt"

-- 3. Verify the message completed
SELECT status FROM messages WHERE conversation_id = ? AND position = 'left';
-- Expected: status='finish'
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-file-single`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/` (the workspace)
- test file: `/tmp/e2e-test-file.txt` (deleted after the test)
- sessionStorage: same as TC-A-01

**Screenshots**: 3

---

### TC-A-04: Use the second model

**Priority**: P0
**Goal**: verify that after a non-default model is selected on the guid page, the DB records the correct model ID.

**Preconditions**:

- The global preconditions in §1.2.
- Call `getAionrsTestModels(page)` to obtain `{ modelA, modelB }`.
- If `modelB === null`: skip this case (reason: "Only 1 model available, skipping guid page model selection test").

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | none |
| Model | the second one (`modelB`) |
| Permission | default |
| Mid-conversation action | none |

**Steps**:

1. Open the guid page and select the aionrs agent.
2. Open the model selector (`GuidModelSelector`, only visible when `isGeminiMode=true`, source: `GuidPage.tsx:465-469`).
   - If it is not visible, skip this case (noting the reason: "guid page model selector not enabled").
3. Select `modelB` (do not hardcode a specific model ID).
4. Type the message: "What model are you using?"
5. Click send.
6. Wait for the AI reply on the conversation page to finish.

**DB assertions**:

```sql
-- 1. Verify the conversation's model fields
SELECT model, json_extract(extra, '$.model.useModel') as extra_model
FROM conversations
WHERE id = ?;
-- Expected: extra_model = modelB.useModel

-- 2. Verify the conversation finished
SELECT status FROM conversations WHERE id = ?;
-- Expected: status='finished'

-- 3. Verify the AI reply
SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND position = 'left';
-- Expected: >= 1
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-model-second`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/`
- sessionStorage: same as TC-A-01

**Screenshots**: 3

**Note**: if the guid page model selector is not enabled (the `isGeminiMode` state must be confirmed), this case switches the model on the conversation page instead (see TC-A-07).

---

### TC-A-05: Use the yolo permission

**Priority**: P0
**Goal**: verify that in yolo mode tool calls are auto-approved (no confirmation dialog).

**Preconditions**:

- The global preconditions in §1.2.

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | none |
| Model | default |
| Permission | yolo |
| Mid-conversation action | none |

**Steps**:

1. Open the guid page and select the aionrs agent.
2. Open the permission selector (`AgentModeSelector`, `data-testid="agent-mode-selector-aionrs"`).
3. Choose `yolo` mode (label: "YOLO").
4. Type the message: "Please create a file named test.txt with content 'E2E test'."
5. Click send.
6. **Verify that no confirmation dialog appears** (by watching the state of the `ConversationChatConfirm` component).
7. Wait for the tool to finish executing (poll the DB for `messages.type='tool_group'` with `status='Success'`).

**DB assertions**:

```sql
-- 1. Verify the permission mode was persisted
SELECT json_extract(extra, '$.sessionMode') as mode
FROM conversations
WHERE id = ?;
-- Expected: mode='yolo'

-- 2. Verify the tool call records
SELECT type, json_extract(content, '$[0].status') as tool_status
FROM messages
WHERE conversation_id = ? AND type = 'tool_group';
-- Expected: at least 1 row, tool_status IN ('Success', 'Executing', 'Error')
-- Note: the 'Confirming' status must never appear in yolo mode

-- 3. Verify there is no confirmation dialog (a front-end behavior check)
-- E2E layer: page.waitForSelector('.confirmation-dialog', { timeout: 2000 }) should time out (proving there is no dialog)
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-yolo-mode`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/` (contains the test.txt created by the binary)
- sessionStorage: same as TC-A-01

**Screenshots**: 3

---

## 3. P1 Cases (regular combinations)

### TC-A-06: Use the auto_edit permission

**Priority**: P1
**Goal**: verify that in auto_edit mode the edit/info tools are auto-approved while exec tools still require confirmation.

**Preconditions**:

- The global preconditions in §1.2.

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | none |
| Model | default |
| Permission | auto_edit |
| Mid-conversation action | none |

**Steps**:

1. Open the guid page and select the aionrs agent.
2. Choose `auto_edit` mode (label: "Auto-Accept Edits").
3. Type the message: "Please read the file ./README.md and summarize it." (this triggers an info tool).
4. Wait for the tool to finish executing (with no confirmation dialog).
5. Type a second message: "Now run command 'ls -la'." (this triggers an exec tool).
6. **Verify that a confirmation dialog appears** (`ConversationChatConfirm` is shown).
7. Click "Yes, Allow Once" to approve it.
8. Wait for the command to finish executing.

**DB assertions**:

```sql
-- 1. Verify the permission mode
SELECT json_extract(extra, '$.sessionMode') as mode
FROM conversations
WHERE id = ?;
-- Expected: mode='auto_edit'

-- 2. Verify the tool call records (info tools never enter the Confirming status)
SELECT json_extract(content, '$[0].name') as tool_name,
       json_extract(content, '$[0].status') as tool_status
FROM messages
WHERE conversation_id = ? AND type = 'tool_group';
-- Expected:
--   - info tools: status goes straight from Executing to Success (skipping Confirming)
--   - exec tools: status goes Confirming -> Executing -> Success (user confirmation required)
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-auto-edit-mode`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/`
- sessionStorage: same as TC-A-01

**Screenshots**: 4 (one extra screenshot of the confirmation dialog)

---

### TC-A-07: Switch the model mid-conversation

**Priority**: P1
**Goal**: verify that after switching the model mid-conversation, DB `conversations.extra.model` is updated to the new model ID.

**Preconditions**:

- The global preconditions in §1.2.
- Call `getAionrsTestModels(page)` to obtain `{ modelA, modelB }`.
- If `modelB === null`: skip this case (reason: "Only 1 model available, skipping model switch test").

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | none |
| Model | default (`modelA`) → the second one (`modelB`) |
| Permission | default |
| Mid-conversation action | switch model |

**Steps**:

1. Create the conversation as in TC-A-01 (using `modelA`).
2. Wait for the first AI reply to finish.
3. Click the conversation page's model selector (`AionrsModelSelector`, `data-testid="aionrs-model-selector"`).
4. Select `modelB` (do not hardcode a specific model ID).
5. Wait for the model switch to complete (poll the DB until `conversations.extra.model` is updated).
6. Type a second message: "What model are you using now?"
7. Wait for the AI reply to finish.

**DB assertions**:

```sql
-- 1. Verify the DB is updated after the model switch
SELECT json_extract(extra, '$.model.useModel') as current_model
FROM conversations
WHERE id = ?;
-- Expected: current_model = modelB.useModel

-- 2. Verify the message count
SELECT COUNT(*) FROM messages WHERE conversation_id = ?;
-- Expected: >= 4 (user message 1 + AI reply 1 + user message 2 + AI reply 2)

-- 3. Verify the second AI reply used the new model (inferred from the reply content, or by checking the request_trace event)
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-switch-model`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/`
- sessionStorage: same as TC-A-01

**Screenshots**: 4 (one extra screenshot of the open model selector)

**Note**: per the decision on topic 1, only the DB field update is verified; changes to the binary's internal sessionId are not.

---

### TC-A-08: Switch the permission mid-conversation (default → auto_edit)

**Priority**: P1
**Goal**: verify that after switching the permission mid-conversation, the tool confirmation behavior changes immediately.

**Preconditions**:

- The global preconditions in §1.2.

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | none |
| Model | default |
| Permission | default → auto_edit |
| Mid-conversation action | switch permission |

**Steps**:

1. Create the conversation as in TC-A-01 (default permission).
2. Type the message: "Please edit file test.txt and add line 'line 1'."
3. **Verify that a confirmation dialog appears** (default mode requires confirming edit tools).
4. Cancel the operation (click "No").
5. Open the permission selector and switch to `auto_edit`.
6. Type the same message again.
7. **Verify that no confirmation dialog appears** (auto_edit mode auto-approves edit tools).
8. Wait for the tool to finish executing.

**DB assertions**:

```sql
-- 1. Verify the DB is updated after the permission switch
SELECT json_extract(extra, '$.sessionMode') as mode
FROM conversations
WHERE id = ?;
-- Expected: mode='auto_edit'

-- 2. Verify the second tool call never entered the Confirming status
SELECT json_extract(content, '$[0].status') as tool_status, created_at
FROM messages
WHERE conversation_id = ? AND type = 'tool_group'
ORDER BY created_at DESC
LIMIT 1;
-- Expected: tool_status = 'Executing' or 'Success' (Confirming is skipped)

-- 3. Verify the first tool call was cancelled
SELECT json_extract(content, '$[0].status') as tool_status, created_at
FROM messages
WHERE conversation_id = ? AND type = 'tool_group'
ORDER BY created_at ASC
LIMIT 1;
-- Expected: tool_status = 'Canceled'
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-switch-permission-1`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/`
- sessionStorage: same as TC-A-01

**Screenshots**: 5 (2 of the confirmation dialog: once when it appears and once when it does not)

---

### TC-A-09: Switch the permission mid-conversation (auto_edit → yolo)

**Priority**: P1
**Goal**: verify that after switching to yolo, every tool is auto-approved.

**Preconditions**:

- The global preconditions in §1.2.

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | none |
| Model | default |
| Permission | auto_edit → yolo |
| Mid-conversation action | switch permission |

**Steps**:

1. Create the conversation (auto_edit permission).
2. Type the message: "Please run command 'pwd'." (this triggers an exec tool).
3. **Verify that a confirmation dialog appears** (auto_edit mode does not auto-approve exec).
4. Cancel the operation.
5. Switch the permission to `yolo`.
6. Type the same message again.
7. **Verify that no confirmation dialog appears** (yolo mode auto-approves every tool).
8. Wait for the command to finish executing.

**DB assertions**:

```sql
-- 1. Verify the permission switch
SELECT json_extract(extra, '$.sessionMode') as mode
FROM conversations
WHERE id = ?;
-- Expected: mode='yolo'

-- 2. Verify the second tool call never entered the Confirming status
SELECT json_extract(content, '$[0].status') as tool_status
FROM messages
WHERE conversation_id = ? AND type = 'tool_group'
ORDER BY created_at DESC
LIMIT 1;
-- Expected: tool_status IN ('Executing', 'Success')
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-switch-permission-2`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/`
- sessionStorage: same as TC-A-01

**Screenshots**: 4

---

### TC-A-10: Combination scenario (folder attachment + file upload + non-default model)

**Priority**: P1
**Goal**: verify that in a multi-dimension combination every attachment is passed to the binary correctly.

**Preconditions**:

- The global preconditions in §1.2.
- The temporary directory contains the test folder and the test file.

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | single |
| File upload | single |
| Model | the second one |
| Permission | auto_edit |
| Mid-conversation action | none |

**Steps**:

1. Create the test data:
   ```bash
   mkdir -p /tmp/e2e-aionrs-<timestamp>/folder-a/
   echo "content A" > /tmp/e2e-aionrs-<timestamp>/folder-a/file-a.txt
   echo "content B" > /tmp/e2e-test-file-b.txt
   ```
2. Open the guid page and select the aionrs agent.
3. Choose the second model plus the auto_edit permission.
4. Attach the folder `folder-a/`.
5. Upload the file `e2e-test-file-b.txt`.
6. Type the message: "Compare the content of the attached folder and file."
7. Click send.
8. Wait for the AI reply to finish.

**DB assertions**:

```sql
-- 1. Verify the user message contains both the folder and the file reference
SELECT json_extract(content, '$.attachedDirs') as dirs,
       json_extract(content, '$.attachedFiles') as files
FROM messages
WHERE conversation_id = ? AND position = 'right';
-- Expected:
--   dirs contains 'folder-a'
--   files contains 'e2e-test-file-b.txt'

-- 2. Verify the model and the permission
SELECT json_extract(extra, '$.model.useModel') as model,
       json_extract(extra, '$.sessionMode') as mode
FROM conversations
WHERE id = ?;
-- Expected: model = the second model's ID, mode='auto_edit'

-- 3. Verify the AI reply mentions both files
SELECT json_extract(content, '$.content') as text
FROM messages
WHERE conversation_id = ? AND position = 'left' AND type = 'text';
-- Expected: text contains "content A", "content B", or one of the file names
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-combo-folder-file-model`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/`
- test file: `/tmp/e2e-test-file-b.txt`
- sessionStorage: same as TC-A-01

**Screenshots**: 4

---

### TC-A-11: Upload multiple files

**Priority**: P1
**Goal**: verify the multi-file upload scenario.

**Preconditions**:

- The global preconditions in §1.2.
- The test files exist: `/tmp/e2e-file-1.txt`, `/tmp/e2e-file-2.txt`, `/tmp/e2e-file-3.txt`.

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | multiple (3 files) |
| Model | default |
| Permission | default |
| Mid-conversation action | none |

**Steps**:

1. Create the test files:
   ```bash
   echo "File 1 content" > /tmp/e2e-file-1.txt
   echo "File 2 content" > /tmp/e2e-file-2.txt
   echo "File 3 content" > /tmp/e2e-file-3.txt
   ```
2. Open the guid page and select the aionrs agent.
3. Upload all 3 files at once (WebUI: select multiple files; Desktop: call the dialog several times).
4. Confirm that 3 file preview cards are shown.
5. Type the message: "Count the total lines across all attached files."
6. Click send.
7. Wait for the AI reply to finish.

**DB assertions**:

```sql
-- 1. Verify the user message contains all 3 file references
SELECT json_extract(content, '$.attachedFiles') as files
FROM messages
WHERE conversation_id = ? AND position = 'right';
-- Expected: the files array has length 3 and contains every file path

-- 2. Verify the AI reply computed the right answer
SELECT json_extract(content, '$.content') as text
FROM messages
WHERE conversation_id = ? AND position = 'left' AND type = 'text';
-- Expected: text contains "3" or "three" (the line count)
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-multi-files`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/`
- test files: `/tmp/e2e-file-*.txt`
- sessionStorage: same as TC-A-01

**Screenshots**: 3

---

### TC-A-12: Attach multiple folders

**Priority**: P1
**Goal**: verify the multi-folder attachment scenario.

**Preconditions**:

- The global preconditions in §1.2.
- The temporary directory contains several test folders.

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | multiple (2 folders) |
| File upload | none |
| Model | default |
| Permission | default |
| Mid-conversation action | none |

**Steps**:

1. Create the test data:
   ```bash
   mkdir -p /tmp/e2e-aionrs-<timestamp>/folder-x/ /tmp/e2e-aionrs-<timestamp>/folder-y/
   echo "X content" > /tmp/e2e-aionrs-<timestamp>/folder-x/x.txt
   echo "Y content" > /tmp/e2e-aionrs-<timestamp>/folder-y/y.txt
   ```
2. Open the guid page and select the aionrs agent.
3. Pick `folder-x/` and then `folder-y/` in the file tree.
4. Confirm that 2 folder tags are shown.
5. Type the message: "List all files in both attached folders."
6. Click send.
7. Wait for the AI reply to finish.

**DB assertions**:

```sql
-- 1. Verify the user message contains both folder references
SELECT json_extract(content, '$.attachedDirs') as dirs
FROM messages
WHERE conversation_id = ? AND position = 'right';
-- Expected: the dirs array has length 2 and contains 'folder-x' and 'folder-y'

-- 2. Verify the AI reply lists the files from both folders
SELECT json_extract(content, '$.content') as text
FROM messages
WHERE conversation_id = ? AND position = 'left' AND type = 'text';
-- Expected: text contains "x.txt" and "y.txt"
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-multi-folders`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/` (contains folder-x and folder-y)
- sessionStorage: same as TC-A-01

**Screenshots**: 3

---

## 4. P2 Cases (edge verification)

### TC-A-13: Skip the tests when the binary is unreachable

**Priority**: P2
**Goal**: verify that the pre-test binary check works.

**Preconditions**:

- The aionrs binary is **unavailable** (simulated with the environment variable `AION_CLI_PATH=/dev/null`).

**Dimension combination**: N/A (this verifies the precondition check logic).

**Steps**:

1. Set the environment variable: `process.env.AION_CLI_PATH = '/dev/null'`.
2. Run the test suite (or a single case).
3. Verify that the test is skipped (status: skipped, reason: "aionrs binary not found").

**DB assertions**: N/A (the test never runs, so no DB records are produced).

**Expected behavior**:

- The test framework output contains the `test.skip()` marker.
- The console prints the skip reason: "aionrs binary not found, skipping E2E tests".
- The CI report shows the test as skipped (not failed).

**Cleanup obligations**: N/A (no DB records are produced).

**Screenshots**: 1 (of the test report, showing the skipped status).

**Implementation reference**:

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

### TC-A-14: Oversized file upload limit

**Priority**: P2
**Goal**: verify the front-end file size limit mechanism.

**Preconditions**:

- The global preconditions in §1.2.
- The test file exists: `/tmp/e2e-large-file.bin` (100MB).

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | none |
| File upload | oversized (100MB) |
| Model | default |
| Permission | default |
| Mid-conversation action | none |

**Steps**:

1. Create the oversized test file:
   ```bash
   dd if=/dev/zero of=/tmp/e2e-large-file.bin bs=1M count=100
   ```
2. Open the guid page and select the aionrs agent.
3. Attempt to upload `/tmp/e2e-large-file.bin`.
4. **Verify that an error message appears** (expected: the front end blocks it and shows a "file too large" message).
5. Confirm that the file was not added to the `uploadFile` array.

**DB assertions**: N/A (no message is sent, so no DB records are produced).

**Expected behavior**:

- The front end shows an error message (a Toast or Message component).
- No file preview card is shown.
- The send button stays enabled (but the message body does not include that file).

**Cleanup obligations**:

- test file: `/tmp/e2e-large-file.bin`

**Screenshots**: 2 (the upload attempt and the error message).

**Note**: if the front end does not implement a size limit (the logic in `FileService.processDroppedFiles()` must be confirmed), this case instead verifies error handling at the binary layer.

---

### TC-A-15: Attach a non-existent folder

**Priority**: P2
**Goal**: verify filesystem error handling.

**Preconditions**:

- The global preconditions in §1.2.

**Dimension combination**:
| Dimension | Value |
|------|------|
| Folder attachment | non-existent (`/tmp/e2e-nonexistent-folder/`) |
| File upload | none |
| Model | default |
| Permission | default |
| Mid-conversation action | none |

**Steps**:

1. Open the guid page and select the aionrs agent.
2. Fire the folder selection event manually (simulating the selection of a path that does not exist):
   ```typescript
   emitter.emit('aionrs.selected.file', [
     { path: '/tmp/e2e-nonexistent-folder/', name: 'e2e-nonexistent-folder', isFile: false },
   ]);
   ```
3. Confirm that the folder tag is shown (or that an error message is shown).
4. Type the message: "List files in the attached folder."
5. Click send.
6. Wait for the binary to handle it (an error or an empty result is expected).

**DB assertions**:

```sql
-- 1. Verify the user message records the folder reference (even though the path does not exist)
SELECT json_extract(content, '$.attachedDirs') as dirs
FROM messages
WHERE conversation_id = ? AND position = 'right';
-- Expected: dirs contains '/tmp/e2e-nonexistent-folder/'

-- 2. Verify the AI reply reports the error
SELECT json_extract(content, '$.content') as text
FROM messages
WHERE conversation_id = ? AND position = 'left' AND type = 'text';
-- Expected: text contains "not found", "does not exist", or a similar error message

-- 3. Verify the conversation status
SELECT status FROM conversations WHERE id = ?;
-- Expected: status='finished' (not 'error', because this is bad user input rather than a system failure)
```

**Cleanup obligations**:

- conversations name: `E2E-aionrs-<timestamp>-nonexistent-folder`
- temp dir: `/tmp/e2e-aionrs-<timestamp>/`
- sessionStorage: same as TC-A-01

**Screenshots**: 3

---

## 5. Scenarios Not Covered (recorded for reference)

Per the decision on topic 3, the following scenarios are **not covered** in this round of E2E work:

1. **Switching the permission during a tool confirmation**:
   - Scenario: the confirmation dialog is open → switch the permission to yolo → verify the dialog's behavior (does it disappear, get cancelled, or get re-evaluated?).
   - Reason: the current code does not define this edge behavior explicitly, and E2E should not lock in undefined behavior.

2. **Switching the model mid-stream**:
   - Scenario: the AI reply is streaming → switch the model → verify whether the current turn is interrupted, continues, or uses the new model.
   - Reason: same as above.

3. **Permission persistence across conversations and processes**:
   - Scenario: set "always allow" in conversation A → close the app → restart and create conversation B → verify whether the permission is remembered.
   - Reason: per the decision on topic 2, this round only tests that a switch takes effect within the same conversation.

4. **Concurrent conversation scenarios** (deferred to a later gate):
   - Scenario: open 2 aionrs conversations at once and send messages alternately → verify that the binary processes are isolated.
   - Reason: this needs more complex test orchestration (multiple Playwright tabs plus process monitoring), and this round focuses on the single-conversation flow.

---

## 6. Test Data Matrix (case summary)

| Case ID | Folder attachment | File upload  | Model            | Permission        | Mid-conversation action | Priority | Screenshots |
| ------- | ----------------- | ------------ | ---------------- | ----------------- | ----------------------- | -------- | ----------- |
| TC-A-01 | none              | none         | default          | default           | none                    | P0       | 3           |
| TC-A-02 | single            | none         | default          | default           | none                    | P0       | 3           |
| TC-A-03 | none              | single       | default          | default           | none                    | P0       | 3           |
| TC-A-04 | none              | none         | second           | default           | none                    | P0       | 3           |
| TC-A-05 | none              | none         | default          | yolo              | none                    | P0       | 3           |
| TC-A-06 | none              | none         | default          | auto_edit         | none                    | P1       | 4           |
| TC-A-07 | none              | none         | default → second | default           | switch model            | P1       | 4           |
| TC-A-08 | none              | none         | default          | default→auto_edit | switch permission       | P1       | 5           |
| TC-A-09 | none              | none         | default          | auto_edit→yolo    | switch permission       | P1       | 4           |
| TC-A-10 | single            | single       | second           | auto_edit         | none                    | P1       | 4           |
| TC-A-11 | none              | multiple (3) | default          | default           | none                    | P1       | 3           |
| TC-A-12 | multiple (2)      | none         | default          | default           | none                    | P1       | 3           |
| TC-A-13 | N/A               | N/A          | N/A              | N/A               | N/A                     | P2       | 1           |
| TC-A-14 | none              | oversized    | default          | default           | none                    | P2       | 2           |
| TC-A-15 | non-existent      | none         | default          | default           | none                    | P2       | 3           |

**Totals**:

- P0: 5 cases (baseline paths)
- P1: 7 cases (regular combinations plus mid-conversation actions)
- P2: 3 cases (edge verification)
- Total: 15 cases
- Total screenshots: 50

---

## 7. Suggested Implementation Order

### Phase 1: P0 cases (must pass)

1. TC-A-01 (minimal path) — implement first; it verifies the basic end-to-end flow.
2. TC-A-02 and TC-A-03 (attachments) — verify that files and folders are passed through.
3. TC-A-04 (model) — verify model selection.
4. TC-A-05 (yolo) — verify the permission levels.

### Phase 2: P1 cases (regular coverage)

1. TC-A-06 (auto_edit) — completes the coverage of the permission levels.
2. TC-A-07, TC-A-08, TC-A-09 (mid-conversation switching) — verify the dynamic behavior.
3. TC-A-10, TC-A-11, TC-A-12 (combination scenarios) — verify the dimensions crossing over.

### Phase 3: P2 cases (edge wrap-up)

1. TC-A-13 (binary check) — the CI skip mechanism.
2. TC-A-14 and TC-A-15 (error handling) — robustness verification.

---

## 8. Next Steps (Gate 2 → Gate 3)

1. **chat-aionrs-engineer** reviews this case design and estimates the implementation effort.
2. Enter Gate 3 (implementation) once **team-lead** approves.
3. Once the engineer finishes the implementation, the designer produces `implementation-mapping.md` (mapping TC ID → file:line:function name).

---

## Appendix A: Key Source References

| File                                                                          | Key lines | Description                                                         |
| ----------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| `src/renderer/pages/guid/GuidPage.tsx`                                        | 465-469   | Visibility of the guid page model selector (`isGeminiMode`)         |
| `src/renderer/pages/guid/components/AgentPillBar.tsx`                         | 58-122    | Agent pill click handling                                           |
| `src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`          | 331-337   | The `atPath` state (the attached folder array)                      |
| `src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`          | 103-125   | File upload handler                                                 |
| `src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`          | 206-212   | Sending a message (passing the `files` parameter)                   |
| `src/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection.ts` | 36-40     | Filtering out Google Auth models                                    |
| `src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`          | —         | Converts the aionrs runtime capabilities into permission options    |
| `src/process/task/AionrsManager.ts`                                           | 250-259   | Auto-approval logic for the permission modes                        |
| `src/process/task/AionrsManager.ts`                                           | 727-737   | `setMode()` persistence                                             |
| `src/process/task/AionrsManager.ts`                                           | 452-489   | The missing-finish fallback (15s timeout)                           |
| `aioncore aionui.db`                                                          | —         | conversations and messages are persisted exclusively by the backend |

---

## Appendix B: DB Assertion Query Templates

```sql
-- Query the basic conversation information
SELECT
  id,
  name,
  type,
  model,
  status,
  json_extract(extra, '$.sessionMode') as mode,
  json_extract(extra, '$.model.useModel') as extra_model,
  json_extract(extra, '$.lastTokenUsage.totalTokens') as tokens
FROM conversations
WHERE name LIKE 'E2E-aionrs-%';

-- Query the message list
SELECT
  id,
  msg_id,
  type,
  position,
  status,
  json_extract(content, '$.content') as text,
  json_extract(content, '$.attachedFiles') as files,
  json_extract(content, '$.attachedDirs') as dirs,
  created_at
FROM messages
WHERE conversation_id = ?
ORDER BY created_at ASC;

-- Query the tool calls
SELECT
  json_extract(content, '$[0].name') as tool_name,
  json_extract(content, '$[0].status') as tool_status,
  json_extract(content, '$[0].callId') as call_id,
  created_at
FROM messages
WHERE conversation_id = ? AND type = 'tool_group'
ORDER BY created_at ASC;

-- Query the thinking messages
SELECT
  json_extract(content, '$.content') as thinking_text,
  json_extract(content, '$.duration') as duration_ms,
  json_extract(content, '$.status') as thinking_status
FROM messages
WHERE conversation_id = ? AND type = 'thinking';

-- Clean up all E2E data
DELETE FROM conversations WHERE name LIKE 'E2E-aionrs-%';
```

---

**Document complete, awaiting the engineer's review.**
