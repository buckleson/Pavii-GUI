# Aion CLI (aionrs) E2E Test Requirements

**Version**: v1.1 (revised)
**Author**: chat-aionrs-analyst
**Date**: 2026-04-22
**Status**: Gate 1 complete, plus the v1.1 revision (corrects where aionrs models come from)

---

## 1. Business Scenario

### 1.1 End-to-end flow

The user picks the aionrs agent on the **guid home page**, configures the context (files / folders / model / permission), sends a message, lands on the **aionrs conversation page**, receives a streamed reply, and can switch the model or permission mid-conversation.

**Critical path** (traced through the source):

1. **guid home page** (`src/renderer/pages/guid/GuidPage.tsx:83-100`)
   - The user clicks the aionrs pill in `AgentPillBar` (`data-agent-backend="aionrs"`).
   - Optional: pick a model through `GuidModelSelector` (the ACP model list).
   - Optional: pick a permission mode through `AgentModeSelector`.
   - Optional: upload files / attach folders (not yet supported on the guid page, supported on the conversation page).
   - Type a message and click send → a conversation is created and the app navigates to `/conversation/aionrs/<id>`.

2. **aionrs conversation page** (`src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx:27-54`)
   - Renders `MessageList` (the message history).
   - `AionrsSendBox` provides file upload, folder attachment, model selection, and permission selection.
   - After a message is sent, the front end calls into the process side through `ipcBridge.conversation.sendMessage.invoke()`.

3. **Process side** (`src/process/task/AionrsManager.ts:78-781`)
   - Creates an `AionrsAgent` instance (`src/process/agent/aionrs/index.ts:54-450`).
   - Starts the aionrs binary (stdin/stdout JSON Lines protocol).
   - Handles the streamed events (`stream_start`, `text_delta`, `thinking`, `tool_request`, `stream_end`, and so on).
   - Runs the permission confirmation logic (`auto_edit` / `yolo` auto-approve some tools).

4. **Backend persistence**
   - The backend owns `aionui.db` exclusively; Electron no longer accesses SQLite directly.
   - Conversation records are persisted by the `/api/conversations*` contracts.
   - Message records are the responsibility of the backend message persistence layer.

---

## 2. Enumeration of Test Dimensions

### 2.1 Dimension definitions

| Dimension                   | Levels   | Description                                              | Source reference                                          |
| --------------------------- | -------- | -------------------------------------------------------- | --------------------------------------------------------- |
| **Folder attachment**       | 2 levels | Not attached / attached                                  | `AionrsSendBox.tsx:331-337` atPath state + event listener |
| **File upload**             | 2 levels | No upload / upload                                       | `AionrsSendBox.tsx:103-125` file input handler            |
| **Model**                   | 2 levels | Pick 2 from the ACP model list (recommended setup below) | `GuidModelSelector.tsx` + `useGuidModelSelection.ts`      |
| **Permission mode**         | 3 levels | default / auto_edit / yolo                               | aionrs runtime capabilities + `AgentModeSelector`         |
| **Mid-conversation switch** | Required | Switch the model and switch the permission               | `AionrsModelSelector.tsx` + `AgentModeSelector`           |

### 2.2 Dimension details

#### Folder attachment (2 levels)

**Level 1 - not attached**:

- `atPath = []` when the message is sent.
- `workspace` points at the temporary directory `/tmp/e2e-chat-aionrs-<scenario>-<ts>/`.

**Level 2 - folder attached**:

- Triggered by `emitter.emit('aionrs.selected.file', items)`.
- `atPath` contains `{path: '/tmp/...', name: 'folder-name', isFile: false}`.
- The conversation page shows a blue tag (`AionrsSendBox.tsx:423-446`).

**Preconditions**:

- E2E creates a temporary folder at `/tmp/e2e-chat-aionrs-<scenario>-<ts>/`.
- Selection happens through `invokeBridge(page, 'fs.readdir', ...)` or the UI file tree.

**Verification points**:

- DB `messages.content` contains the folder path (a JSON field).
- The binary receives the `files` parameter (verified through the IPC bridge).

---

#### File upload (2 levels)

**Level 1 - no upload**:

- `uploadFile = []`

**Level 2 - file uploaded**:

- Desktop: `ipcBridge.dialog.showOpen({ properties: ['openFile'] })`
- WebUI: `page.setInputFiles('input[type="file"]', filePath)`
- `uploadFile` holds an array of absolute paths.

**Preconditions**:

- E2E creates the test file `/tmp/e2e-chat-aionrs-<scenario>-<ts>/test.txt` (contents: "E2E test file").

**Verification points**:

- A file preview card appears after the upload (`AionrsSendBox.tsx:413-421`).
- DB `messages.content` contains the file path.
- The binary receives the `files` parameter.

---

#### Model (2 levels)

**Where models come from** (the user-configured provider list):

**Important correction**: aionrs does **not** use the ACP model list. It uses the general provider list that the user configures under Settings → Model.

**Source reference**:

- `src/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection.ts:34-40`:
  ```typescript
  const { providers: allProviders, ... } = useModelProviderList();
  const providers = allProviders.filter(p => !p.platform?.toLowerCase().includes('gemini-with-google-auth'));
  ```
- Where `useModelProviderList()` gets its data (`src/renderer/hooks/agent/useModelProviderList.ts:30`):
  ```typescript
  const { data: modelConfig } = useSWR('model.config', () => ipcBridge.mode.getModelConfig.invoke());
  ```
  → that is, the provider list stored in the user's config file (not dynamically probed).

**Difference from ACP agents**:

- **ACP agents** (Claude Code / Qwen Code / iFlow): models are probed through `ipcBridge.acpConversation.getModelInfo` (reported back after the agent process starts).
- **aionrs**: models are read through `ipcBridge.mode.getModelConfig` (the user's config file, excluding `gemini-with-google-auth`).

**Level definitions** (determined dynamically at runtime, must not be hardcoded):

1. **Level 1 - default model**:
   - E2E setup queries `ipcBridge.mode.getModelConfig.invoke()`.
   - Filters out `gemini-with-google-auth`.
   - Takes `providers[0].model[0]` (the first model of the first available provider).

2. **Level 2 - switched model**:
   - A different model under the same provider: `providers[0].model[1]`.
   - Or a different provider: `providers[1].model[0]` (if a second provider exists).

**E2E preconditions** (see the new topic in §8):

- At least 1 non-Google-Auth provider.
- That provider must have at least 2 usable models (for the switching test).
- If there is only 1 model, the test degrades to "verify the current model only, do not test switching".

**Verification strategy**:

- Query the DB through `invokeBridge(page, 'conversation.get', { id })`.
- Check the `conversations.model` field (the model ID).
- Check that `conversations.extra.model` (JSON) contains `{ id, useModel, name, ... }`.

**Known constraints**:

- aionrs **does not support Google Auth** (filtered in `useAionrsModelSelection.ts:36-40`).
- Model switching behavior: E2E only verifies that the DB field is updated, not that the binary restarts (see the decision on topic 1 in §8).

---

#### Permission mode (3 levels)

**Enumeration of levels** (reported by the aionrs runtime capabilities):

```typescript
aionrs: [
  { value: 'default', label: 'Default' },
  { value: 'auto_edit', label: 'Auto-Accept Edits' },
  { value: 'yolo', label: 'YOLO' },
];
```

| mode        | label             | Behavior                                                                    | Source reference                              |
| ----------- | ----------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| `default`   | Default           | Every tool call requires confirmation                                       | `AionrsManager.ts:250-296` confirmation logic |
| `auto_edit` | Auto-Accept Edits | Auto-approves edit and info tools; exec and mcp tools still need confirming | `AionrsManager.ts:254-259`                    |
| `yolo`      | YOLO              | Auto-approves every tool                                                    | `AionrsManager.ts:250-253`                    |

**Permission switching entry points**:

- guid page: `GuidActionRow.tsx:277-287` — the `AgentModeSelector` component.
- Conversation page: `AionrsSendBox.tsx:391-401` — also uses `AgentModeSelector`.
- Process side: `AionrsManager.ts:727-737` — `setMode()` updates the DB and sends `set_mode` to the binary.

**Verification strategy**:

- Query the DB: `SELECT json_extract(extra, '$.sessionMode') FROM conversations WHERE id = ?`
- Expected value: `'default' | 'auto_edit' | 'yolo'`

**Test coverage**:

- Select each of the 3 modes once on the guid page (3 cases).
- Switch between the 3 modes mid-conversation (see "Mid-conversation switching" in §2.3).

---

#### Mid-conversation switching (required)

**Switching the model**:

- Action: click the `AionrsModelSelector` button on the conversation page and pick a different model.
- Expectation: it takes effect on the next message sent (whether the binary must restart is still to be probed by E2E).
- Verification: query the DB for `conversations.extra.model.useModel`.

**Switching the permission**:

- Action: click the `AgentModeSelector` button on the conversation page and pick a different permission.
- Expectation: it takes effect immediately (`AionrsManager.setMode()` sends `set_mode` to the binary).
- Verification: query the DB for `conversations.extra.sessionMode`.

**Edge scenario** (awaiting a team-lead decision — see topic 3 in §8):

- Switching the permission while a tool confirmation dialog is open → current behavior still to be probed (does it cancel the pending confirmation?).

---

### 2.3 Case matrix (orthogonal coverage)

**Full permutation**: 2 (folder) x 2 (upload) x 2 (model) x 3 (permission) = **24 combinations**

**Convergence strategy** (designer and engineer consensus):

- **P0 core cases** (5): no attachments + default model + default permission (the baseline path).
- **P1 common cases** (7): single file, single folder, multiple files, multiple folders, model switching, permission switching.
- **P2 edge cases** (3-5): oversized files, concurrent conversations, protocol errors, process crashes.

**Recommended case list** (11-17 cases, orthogonal design):

| #   | Folder attachment | File upload        | Model   | Permission | Mid-conversation switch  | Priority |
| --- | ----------------- | ------------------ | ------- | ---------- | ------------------------ | -------- |
| 1   | none              | none               | default | default    | -                        | P0       |
| 2   | attached          | none               | default | default    | -                        | P1       |
| 3   | none              | upload             | default | default    | -                        | P1       |
| 4   | attached          | upload             | default | default    | -                        | P1       |
| 5   | none              | none               | default | auto_edit  | -                        | P1       |
| 6   | none              | none               | default | yolo       | -                        | P1       |
| 7   | none              | none               | default | default    | switch model             | P1       |
| 8   | none              | none               | default | default    | switch permission        | P1       |
| 9   | none              | upload (oversized) | default | default    | -                        | P2       |
| 10  | none              | none               | default | default    | concurrent conversations | P2       |
| 11  | none              | none               | default | default    | binary crash             | P2       |

---

## 3. Binary Preconditions

### 3.1 Resolving the binary path (decision Q3)

**Resolution strategy** (pick one; option 2 is recommended):

**Option 1 - hardcoded path**:

```typescript
const AIONRS_BINARY_PATH = '/Users/zhoukai/.local/bin/aionrs';
```

**Option 2 - look it up on PATH** (**recommended**, more robust):

```typescript
// Look it up through binaryResolver
const binary = await ipcBridge.fs.findAionrsBinary.invoke();
if (!binary) {
  test.skip('aionrs binary not found in PATH or ~/.local/bin/aionrs, skipping E2E tests');
}
```

**Source reference**: `src/process/agent/aionrs/binaryResolver.ts`

- Resolution order: the `AION_CLI_PATH` environment variable → `~/.aionui/bin/aion-<platform>-<arch>` → the `aion` command on the system PATH.

**Verification command** (confirmed by team-lead):

```bash
$ which aionrs
/Users/zhoukai/.local/bin/aionrs
```

**E2E implementation convention**:

```typescript
// tests/e2e/setup/aionrs.setup.ts
export async function checkAionrsBinary(page: Page): Promise<boolean> {
  try {
    const binary = await invokeBridge(page, 'fs.findAionrsBinary');
    if (!binary) {
      console.error('[E2E Setup] aionrs binary not found in PATH or ~/.local/bin/aionrs');
      return false;
    }
    console.log(`[E2E Setup] aionrs binary found: ${binary}`);
    return true;
  } catch (error) {
    console.error('[E2E Setup] Failed to check aionrs binary:', error);
    return false;
  }
}

// tests/e2e/specs/chat-aionrs/*.spec.ts
test.beforeAll(async ({ page }) => {
  const hasBinary = await checkAionrsBinary(page);
  if (!hasBinary) {
    test.skip('aionrs binary not found, skipping E2E tests');
  }
});
```

**Key requirements** (team-lead instruction):

- If the binary is missing, the test **must** call `test.skip()` and print a clear error message (never skip silently).
- Example error message: `aionrs binary not found in PATH or ~/.local/bin/aionrs`

---

### 3.2 Binary startup and timeouts

**Startup flow** (`src/process/agent/aionrs/index.ts:85-157`):

1. Create the `AionrsAgent` instance.
2. Call `spawn(binaryPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })`.
3. Wait for the `ready` event (JSON Lines: `{"type":"ready","session_id":"...","capabilities":{...}}`).
4. Timeout: **30s** (`index.ts:136-140`).

**E2E timeout setting**:

```typescript
test(
  'should start aionrs conversation',
  async ({ page }) => {
    // Playwright test timeout: 60s (leaves plenty of room for the binary to start)
  },
  { timeout: 60000 }
);
```

**Failure scenarios**:

- Startup timeout: throws `Error('aionrs ready timeout (30s)')`.
- Process crash: `childProcess.on('exit')` fires and the front end receives an `error` event.

---

## 4. Temporary Directories and the Cleanup Contract (decision Q4)

### 4.1 Temporary directory convention

**Directory layout**:

```
/tmp/e2e-chat-aionrs-<scenario>-<timestamp>/
├── test-file.txt          # Test file for the file upload case
├── test-folder/           # Test directory for the folder attachment case
│   └── sample.md
└── .aionrs/               # aionrs session files (created by the binary)
```

**Naming convention**:

- `<scenario>`: a description of the case scenario (such as `no-attach`, `single-file`, `single-folder`, `multi-attach`).
- `<timestamp>`: `Date.now()` or `YYYYMMDD-HHmmss`.

**When it is created**: in `beforeEach()`, or just before the case starts.

---

### 4.2 Cleanup contract (mandatory per team-lead)

#### Cleanup order (must run in this order to avoid foreign key conflicts)

```typescript
afterEach(async ({ page }) => {
  const conversationId = /* the conversation ID of the current case */;
  const tmpDir = /* the temporary directory of the current case */;

  try {
    // 1. Stop the aionrs binary process
    await invokeBridge(page, 'conversation.stop', { conversation_id: conversationId });

    // 2. Clean up the DB (messages are deleted by cascade)
    await invokeBridge(page, 'db.exec', {
      sql: "DELETE FROM conversations WHERE name LIKE 'E2E-aionrs-%'"
    });

    // 3. Clean up the filesystem (temporary directory plus the aionrs session files)
    await invokeBridge(page, 'fs.rm', { path: tmpDir, recursive: true });

    // 4. Clean up the UI state (ESC x 5 closes every popup and modal)
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    // 5. Clean up sessionStorage
    await page.evaluate(() => {
      sessionStorage.clear();
    });

    // 6. Verify the cleanup completed (optional, but recommended)
    const remaining = await invokeBridge(page, 'db.query', {
      sql: "SELECT COUNT(*) as count FROM conversations WHERE name LIKE 'E2E-aionrs-%'"
    });
    if (remaining[0].count > 0) {
      throw new Error(`E2E cleanup failed: ${remaining[0].count} conversations still exist`);
    }
  } catch (error) {
    // A cleanup failure must throw (mandatory per team-lead)
    console.error('[E2E Cleanup] Failed:', error);
    throw error;
  }
});
```

#### Cleanup scope

| Resource type         | Cleanup rule                                             | How it is verified              |
| --------------------- | -------------------------------------------------------- | ------------------------------- |
| **DB conversations**  | `DELETE WHERE name LIKE 'E2E-aionrs-%'`                  | `SELECT COUNT(*)` expects 0     |
| **DB messages**       | Cascade delete (`ON DELETE CASCADE`)                     | Cleaned up automatically        |
| **FS temp directory** | `rm -rf /tmp/e2e-chat-aionrs-*`                          | `fs.existsSync()` expects false |
| **FS aionrs session** | Contained inside the temp directory                      | Same as above                   |
| **UI state**          | ESC x 5 plus navigation to a safe page (such as `/guid`) | Verified by screenshot          |
| **sessionStorage**    | `clear()`                                                | `sessionStorage.length === 0`   |

#### Conversation naming convention (mandatory)

```typescript
const conversationName = `E2E-aionrs-${scenario}-${Date.now()}`;
// Example: 'E2E-aionrs-no-attach-1745327890123'
```

**Key requirements**:

- The prefix **must** be `E2E-aionrs-` (the cleanup SQL depends on it).
- Include a scenario description (so logs are easy to trace).
- Include a timestamp (to avoid name collisions).

---

## 5. Database Fields to Verify

### 5.1 conversations table

**Key fields** (persisted in the backend-owned `conversations` table):

| Field        | Type        | Validation rule                            | Source reference           |
| ------------ | ----------- | ------------------------------------------ | -------------------------- |
| `id`         | TEXT PK     | Not null, UUID format                      | -                          |
| `name`       | TEXT        | Matches the `'E2E-aionrs-*'` pattern       | -                          |
| `type`       | TEXT        | Always `'aionrs'`                          | -                          |
| `model`      | TEXT        | The model ID (such as `'claude-opus-4-7'`) | `AionrsManager.ts:108`     |
| `status`     | TEXT        | `'pending' \| 'running' \| 'finished'`     | `AionrsManager.ts:524-526` |
| `extra`      | TEXT (JSON) | See the extra field in §5.1.1              | -                          |
| `created_at` | INTEGER     | Timestamp (ms)                             | -                          |
| `updated_at` | INTEGER     | ≥ created_at                               | -                          |

#### 5.1.1 Structure of the extra field (JSON)

```json
{
  "workspace": "/tmp/e2e-chat-aionrs-...",
  "sessionMode": "default" | "auto_edit" | "yolo",
  "lastTokenUsage": {
    "totalTokens": 1234
  },
  "model": {
    "id": "anthropic",
    "useModel": "claude-opus-4-7",
    "name": "Anthropic",
    "baseUrl": "https://api.anthropic.com/v1",
    "platform": "claude",
    "...": "..."
  }
}
```

**Source references**:

- `sessionMode`: `AionrsManager.ts:740-747` — `saveSessionMode()`
- `lastTokenUsage`: `AionrsManager.ts:432-449` — `saveContextUsage()`
- `model`: `useGuidModelSelection.ts:119-120` — persists the model selection

---

### 5.2 messages table

**Key fields** (persisted in the backend-owned `messages` table):

| Field             | Type        | Validation rule                                                       | Source reference |
| ----------------- | ----------- | --------------------------------------------------------------------- | ---------------- |
| `id`              | TEXT PK     | Not null, UUID format                                                 | -                |
| `conversation_id` | TEXT FK     | References conversations.id                                           | -                |
| `msg_id`          | TEXT        | The binary's streaming msg_id (for AI replies) or the user message ID | -                |
| `type`            | TEXT        | `'text' \| 'tool_group' \| 'thinking' \| ...`                         | `chatLib.ts`     |
| `content`         | TEXT (JSON) | See the content field in §5.2.1                                       | -                |
| `position`        | TEXT        | `'left' \| 'right' \| 'center' \| 'pop'`                              | -                |
| `status`          | TEXT        | `'finish' \| 'pending' \| 'error' \| 'work'`                          | -                |
| `created_at`      | INTEGER     | Timestamp (ms)                                                        | -                |

#### 5.2.1 Structure of the content field (JSON)

**User message (position='right')**:

```json
{
  "content": "The message text the user typed",
  "attachedFiles": ["/tmp/.../test.txt"],
  "attachedDirs": ["/tmp/.../test-folder"]
}
```

**AI text reply (type='text', position='left')**:

```json
{
  "content": "The text of the AI reply (assembled from the deltas)"
}
```

**Thinking message (type='thinking')**:

```json
{
  "content": "The contents of a <think> tag or a thought event",
  "duration": 1234,
  "status": "thinking" | "done"
}
```

**Tool call (type='tool_group')**:

```json
[
  {
    "callId": "tool_call_uuid",
    "name": "edit_file",
    "description": "Edit /tmp/.../test.txt",
    "status": "Confirming" | "Executing" | "Success" | "Error" | "Canceled",
    "resultDisplay": "...",
    "renderOutputAsMarkdown": false
  }
]
```

---

### 5.3 Example E2E assertions

```typescript
test('should verify DB records after conversation', async ({ page }) => {
  const conversationId = /* ... */;

  // 1. Verify the conversation exists and has the right type
  const conv = await invokeBridge(page, 'conversation.get', { id: conversationId });
  expect(conv).toBeDefined();
  expect(conv.type).toBe('aionrs');
  expect(conv.status).toBe('finished');
  expect(conv.extra.sessionMode).toBe('default');

  // 2. Verify there are at least 2 messages (user + AI)
  const messages = await invokeBridge(page, 'db.query', {
    sql: 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    params: [conversationId]
  });
  expect(messages.length).toBeGreaterThanOrEqual(2);

  // 3. Verify the user message
  const userMsg = messages[0];
  expect(userMsg.position).toBe('right');
  expect(userMsg.type).toBe('text');
  expect(JSON.parse(userMsg.content).content).toContain('Hello');

  // 4. Verify the AI reply
  const aiMsg = messages.find(m => m.position === 'left' && m.type === 'text');
  expect(aiMsg).toBeDefined();
  expect(aiMsg.status).toBe('finish');
  expect(JSON.parse(aiMsg.content).content).toBeTruthy();
});
```

---

## 6. Testability Assessment

### 6.1 Existing data-testid coverage

**guid page** (found by the engineer; previously misjudged):

- ✅ **Already present**: `data-agent-pill="true"`, `data-agent-backend="aionrs"`, `data-agent-selected`
- Location: `src/renderer/pages/guid/components/AgentPillBar.tsx:79-82`

**Conversation page**:

- ❌ **Zero** testids (they must be added)

---

### 6.2 List of data-testids to add

#### P0 priority (blocks testing, must be added)

```tsx
// src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx
<div data-testid="aionrs-sendbox">
  {/* The SendBox root element */}
</div>

// src/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector.tsx
<Button data-testid="aionrs-model-selector">
  {/* The model selector button */}
</Button>

// src/renderer/components/agent/AgentModeSelector.tsx (shared component)
<Button data-testid={`agent-mode-selector-${backend}`}>
  {/* When backend='aionrs' → data-testid="agent-mode-selector-aionrs" */}
</Button>

// src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx (file input)
<input
  type="file"
  data-testid="aionrs-file-upload-input"
  multiple
  style={{ display: 'none' }}
/>

// src/renderer/pages/guid/components/GuidActionRow.tsx (attach folder button)
<Button
  data-testid="aionrs-attach-folder-btn"
  onClick={() => ipcBridge.dialog.showOpen({ properties: ['openDirectory'] })}
>
  {/* The attach folder button (desktop only) */}
</Button>
```

#### P1 priority (improves stability, recommended)

```tsx
// Send button
<Button data-testid="aionrs-send-btn" />

// File preview card
<FilePreview key={path} data-testid={`aionrs-file-preview-${idx}`} />

// Folder tag
<Tag key={item.path} data-testid={`aionrs-folder-tag-${idx}`} />

// Model dropdown item
<Menu.Item key={modelId} data-testid={`aionrs-model-menu-item-${modelId}`} />

// Permission dropdown item
<Menu.Item key={mode} data-testid={`aionrs-mode-menu-item-${mode}`} />
```

---

### 6.3 Example E2E interaction path

**Scenario**: no attachments + default model + default permission

```typescript
test('should complete aionrs conversation with no attachments', async ({ page }) => {
  // 1. Navigate to the guid page
  await page.goto('/#/guid');

  // 2. Select the aionrs agent
  await page.click('[data-agent-backend="aionrs"][data-agent-selected="false"]');

  // 3. Type a message (through a Playwright locator)
  const textarea = page.locator('textarea[placeholder*="aionrs"]');
  await textarea.fill('Hello, aionrs!');

  // 4. Click the send button
  await page.click('.send-button-custom'); // Or [data-testid="aionrs-send-btn"]

  // 5. Wait for the navigation to the conversation page
  await page.waitForURL(/\/conversation\/aionrs\/.+/, { timeout: 10000 });

  // 6. Extract the conversationId
  const url = page.url();
  const conversationId = url.match(/\/conversation\/aionrs\/(.+)/)?.[1];
  expect(conversationId).toBeTruthy();

  // 7. Wait for the AI reply (by polling the DB)
  await waitForAIResponse(page, conversationId, { timeout: 60000 });

  // 8. Verify the DB records
  const messages = await invokeBridge(page, 'db.query', {
    sql: 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at',
    params: [conversationId],
  });
  expect(messages.length).toBeGreaterThanOrEqual(2);
  expect(messages[0].position).toBe('right'); // The user message
  expect(messages[1].position).toBe('left'); // The AI reply
});
```

---

## 7. Edge and Failure Scenarios

### 7.1 Binary layer failures

| Scenario              | Expected behavior                                                               | Source reference           |
| --------------------- | ------------------------------------------------------------------------------- | -------------------------- |
| Binary missing        | `test.skip()` plus a clear error message                                        | `binaryResolver.ts`        |
| Startup timeout (30s) | Throws `Error('aionrs ready timeout')`                                          | `index.ts:136-140`         |
| Process crash         | The front end receives an `error` event and the conversation is marked as error | `AionrsManager.ts:297-298` |
| Resume fails          | Falls back to a new session automatically                                       | `index.ts:143-154`         |

---

### 7.2 Concurrent conversations

**Scenario**: open 2 aionrs conversations at once and send messages alternately.

**Expectation**: each conversation maintains its own binary process and session (the `AionrsManager` instances are independent).

**Verification points**:

- The DB contains 2 `conversations` rows (with different `id` values).
- Each conversation has its own `sessionId` (taken from the binary's `ready` event).

---

### 7.3 Oversized file upload

**Scenario**: upload a file larger than 100MB (or more than 1000 files).

**Expectation**: the front-end file handling layer (`FileService.processDroppedFiles()`) should limit the size/count and show an error message.

**Verification points**:

- E2E creates a 100MB test file and attempts to upload it.
- Verify whether a `Message.error()` prompt is shown.

**Known constraint**: the exact limits must be checked in the `FileService` source (not yet traced in this requirements document).

---

### 7.4 Protocol errors

**Scenario**: the binary returns invalid JSON Lines (such as `{"type":"unknown"}`).

**Expectation**: the front end fails to parse it, logs an error, and does not crash.

**Source reference**: `src/process/agent/aionrs/index.ts:116-119` — `JSON.parse()` is wrapped in a `try-catch`.

---

## 8. Topics Awaiting Decisions (team-lead has decided)

### Topic 0: provider configuration prerequisites for the E2E environment (new)

**Background**: aionrs uses the user-configured provider list (not ACP probing), so E2E depends on the provider configuration of the test environment.

**Preconditions**:

1. **At least 1 non-Google-Auth provider** (with `gemini-with-google-auth` filtered out).
2. **That provider must have at least 2 usable models** (for the level 1 plus level 2 switching test).

**Degradation strategy** (when the conditions are not met):

- Only 1 model available: the tests degrade to "verify the current model only, skip the switching scenarios".
- No usable provider: `test.skip('No available providers for aionrs, skipping E2E tests')`.

**Dynamic model selection** (implemented in the E2E setup):

```typescript
// tests/e2e/setup/aionrs.setup.ts
export async function getAionrsTestModels(page: Page): Promise<{
  defaultModel: { providerId: string; modelId: string } | null;
  switchModel: { providerId: string; modelId: string } | null;
}> {
  const providers = await invokeBridge(page, 'mode.getModelConfig');

  // Filter out gemini-with-google-auth
  const availableProviders = providers.filter(
    (p) => !p.platform?.toLowerCase().includes('gemini-with-google-auth') && p.enabled !== false
  );

  if (availableProviders.length === 0) return { defaultModel: null, switchModel: null };

  const firstProvider = availableProviders[0];
  const models = firstProvider.model || [];

  return {
    defaultModel: models.length > 0 ? { providerId: firstProvider.id, modelId: models[0] } : null,
    switchModel: models.length > 1 ? { providerId: firstProvider.id, modelId: models[1] } : null,
  };
}
```

**Verification points**:

- The E2E `beforeAll` checks the return value of `getAionrsTestModels()`.
- If `defaultModel === null`: skip every test.
- If `switchModel === null`: skip the model switching tests (TC-A-07).

---

### Topic 1: does switching the model require restarting the binary? (P0, decided)

**Background**: `AionrsAgent.setConfig(model)` sends a `set_config` command, but the binary's capability has not been verified.

**engineer's suggestion**: use an **exploratory E2E test** to record the current behavior; no advance verification is needed.

```typescript
test('model switching probe', async ({ page }) => {
  // 1. Send message A (model M1)
  // 2. Switch the model to M2
  // 3. Send message B
  // 4. Query the DB: messages[B].extra.model === M2 ? 'runtime switching works' : 'a restart is required'
});
```

**Decision**: [to be filled in by team-lead]

---

### Topic 2: does the "always allow" permission need to be persisted? (P2, reviewers agreed on B)

**Background**: it is currently held in memory (`AionrsApprovalStore`) and is lost when the process restarts.

**Reviewer consensus**: **keep it in memory** (option B); persistence is a product requirement and not an E2E blocker.

**Decision**: **B** (team-lead adopts the reviewers' suggestion)

---

### Topic 3: what happens when the permission/model is switched during a tool confirmation? (P1, undecided)

**Background**: the current code does not handle this explicitly (the confirmation logic in `AionrsManager.ts:253-296` is independent).

**Options**:

- A) Cancel the pending confirmation when the permission is switched (the analyst's and designer's suggestion).
- B) Keep the pending confirmation when the permission is switched (leave things as they are).
- C) Probe the current behavior with E2E first, then decide (the engineer's suggestion).

**Decision**: [to be filled in by team-lead]

---

### Topic 4: where does the binary come from in CI? (P0, reviewers agreed on C)

**Reviewer consensus**: **skip short term** (option C), with DevOps configuration in the long term.

**Implementation plan** (if C is chosen):

```typescript
// tests/e2e/setup/aionrs.setup.ts
export async function checkAionrsBinary(page: Page): Promise<boolean> {
  try {
    const binary = await invokeBridge(page, 'fs.findAionrsBinary');
    return binary !== null;
  } catch {
    return false;
  }
}

// tests/e2e/specs/chat-aionrs/*.spec.ts
test.beforeAll(async ({ page }) => {
  const hasBinary = await checkAionrsBinary(page);
  if (!hasBinary) {
    test.skip('aionrs binary not found in PATH or ~/.local/bin/aionrs, skipping E2E tests');
  }
});
```

**Decision**: **C** (team-lead adopts the reviewers' suggestion)

---

## 9. Deliverable Document List

| Document                     | Path                                           | Status                                |
| ---------------------------- | ---------------------------------------------- | ------------------------------------- |
| Gate 1 requirements document | `tests/e2e/docs/chat-aionrs/requirements.md`   | ✅ Complete (this document)           |
| Gate 1 discussion log        | `tests/e2e/docs/chat-aionrs/discussion-log.md` | ✅ Complete (reviewed by 2 reviewers) |
| Gate 2 test cases            | `tests/e2e/docs/chat-aionrs/test-cases.md`     | ⏳ Awaiting the designer's draft      |
| Gate 3 implementation map    | `tests/e2e/docs/chat-aionrs/implementation.md` | ⏳ Awaiting the engineer's draft      |

---

## 10. Next Steps (Gate 1 → Gate 2)

1. ✅ **Gate 1 complete**: the analyst drafted the requirements, the designer and engineer reviewed them, and team-lead made the decisions.
2. ⏳ **Gate 2 starting**: the designer drafts `test-cases.md` (15 cases, graded P0/P1/P2).
3. ⏳ **Prerequisite work** (blocks Gate 3):
   - The engineer adds 15+ data-testids to the conversation page (estimated 1-2 hours).
   - The engineer implements the DB cleanup helper (estimated 30 minutes).
4. ⏳ **Gate 3 implementation**: the engineer implements the E2E test suite (estimated 3-5 days).

---

---

## Revision History

### v1.1 (2026-04-22)

**Revised by**: chat-aionrs-analyst
**Trigger**: the user pointed out a research error — aionrs models do not come from ACP probing.

**Changes**:

1. **§2 dimension C (model)** — corrected where models come from
   - ❌ Wrong: "selected from the ACP model list"
   - ✅ Right: "selected from the user-configured provider list (excluding gemini-with-google-auth)"
   - Source: `ipcBridge.mode.getModelConfig.invoke()` (the config file), not `ipcBridge.acpConversation.getModelInfo` (dynamic probing).

2. **§8 topic 0 (new)** — provider configuration prerequisites for the E2E environment
   - At least 1 non-Google-Auth provider.
   - That provider must have at least 2 usable models.
   - Degradation strategy: with only 1 model, skip the switching tests; with no provider, skip every test.
   - Dynamic model selection implementation: the `getAionrsTestModels()` helper.

3. **Additional source references**:
   - `src/renderer/hooks/agent/useModelProviderList.ts:30` — `ipcBridge.mode.getModelConfig.invoke()`
   - `src/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection.ts:34-40` — filters out Google Auth

**Impact**:

- Gate 2 case design: the designer must confirm the preconditions of TC-A-04 (choosing a model on the guid page) and TC-A-07 (switching mid-conversation).
- Gate 3 implementation: the engineer must implement the `getAionrsTestModels()` helper (which queries the provider list dynamically).

---

## Appendix: Source File List

| File                                                                          | Lines  | Key functionality                                                            |
| ----------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| `src/renderer/pages/guid/GuidPage.tsx`                                        | 83-100 | providerAgentKey state (aionrs/gemini)                                       |
| `src/renderer/pages/guid/components/AgentPillBar.tsx`                         | 79-82  | Agent pill rendering plus data-testid                                        |
| `src/renderer/pages/guid/components/GuidActionRow.tsx`                        | 67-330 | File attachments, mode selector, send button                                 |
| `src/renderer/pages/guid/components/GuidModelSelector.tsx`                    | 35-100 | Model selector (guid page)                                                   |
| `src/renderer/hooks/agent/useModelProviderList.ts`                            | 30     | `ipcBridge.mode.getModelConfig.invoke()` — the user-configured provider list |
| `src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx`             | 19-57  | Conversation page container, MessageList, SendBox                            |
| `src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`          | 88-459 | Send box logic, file attachments, permission selection                       |
| `src/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector.tsx`    | 19-135 | Model selector (conversation page)                                           |
| `src/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection.ts` | 24-73  | Model selection hook (filters out Google Auth)                               |
| `src/renderer/pages/conversation/platforms/aionrs/useAionrsMessage.ts`        | 20-321 | Streamed message handling and tool status                                    |
| `src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`          | —      | Converts the aionrs runtime capabilities into permission options             |
| `src/process/task/AionrsManager.ts`                                           | 78-781 | Process management, permission approval, DB persistence                      |
| `src/process/agent/aionrs/index.ts`                                           | 54-450 | Binary startup and the stdin/stdout protocol                                 |
| `src/process/agent/aionrs/binaryResolver.ts`                                  | —      | Binary path resolution logic                                                 |
| `aioncore aionui.db`                                                          | —      | conversations and messages are persisted exclusively by the backend          |
