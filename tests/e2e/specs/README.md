# Team E2E Specs

> This file is the shared contract between ciwei (test) and laochui (dev). Read it before you touch anything.

---

## 1. First, understand what Aion Team is

**Aion Team is an AI team system driven by a leader. The user never operates team members directly; the user only talks to the leader.**

**The leader is itself an agent, and its type can be claude, codex, or gemini.** Each leader type has its own independent orchestration capability, so E2E has to cover all three leader types, not just one.

What a real user session looks like:

| What the user wants      | What the user actually does                                                    |
| ------------------------ | ------------------------------------------------------------------------------ |
| Recruit a codex engineer | Type in the leader chat box: "Add a codex type member named Dev1"              |
| Fire a member            | Type in the leader chat box: "Fire the member named Dev1"                      |
| Assign work to a member  | Type in the leader chat box: "Ask Dev1 to write unit tests"                    |
| Intra-team communication | The leader decides on its own whether to forward, broadcast, or reply directly |

**There is no "Add member" button and no "Fire" button in the UI. The only control the user has is the leader's chat input.**

An E2E test simulates exactly that user: Playwright opens the app, types natural language into the leader chat box, waits for the leader to reason and act, and verifies that the UI responds correctly.

---

## 2. The core chain

```
User types natural language into the leader chat box
    -> leader interprets the intent
    -> leader calls the matching MCP tool (spawn_agent / fire_agent / ...)
    -> the operation executes
    -> the UI reacts (new tab appears / tab disappears / message rendered)
```

**E2E verifies this chain end to end. Skip any link and it does not count as verified.**

---

## 3. Where invokeBridge fits

invokeBridge is a test utility, not a user path. A real user has no idea it exists.

**Allowed for:**

| Scenario                                                  | Example                                  |
| --------------------------------------------------------- | ---------------------------------------- |
| **setup**: obtain a teamId, read the initial member count | `invokeBridge(page, 'team.list', ...)`   |
| **assertion**: confirm backend state agrees with the UI   | `invokeBridge(page, 'team.get', { id })` |

**Never use it to trigger an operation** — adding a member, firing a member, sending a message, and so on must go through the leader chat input and nothing else. If you trigger an operation with invokeBridge, you are not testing Aion Team; you are testing an ordinary RPC endpoint.

---

## 4. laochui's prerequisites

**The whitelist has exactly one definition: `claude`, `codex`, `gemini`, and frontend and backend must agree.**

### ✅ Task 1: whitelist adjustment (done)

`TEAM_SUPPORTED_BACKENDS` in `src/common/types/teamTypes.ts` is the single source of truth.
`TeammateManager.ts` and `TeamMcpServer.ts` both reference that constant, so neither needs a separate edit.

Current value: `new Set(['claude', 'codex', 'gemini'])` (codebuddy has been removed).

### Task 2: confirm all three leader types can add members over MCP (required; report the result to ciwei)

The lifecycle test adds a member through natural language on three teams, one per leader type. laochui must confirm that the claude, codex, and gemini leaders all reach the `spawn_agent` MCP tool without anything blocking the path, and fix whatever is broken. **The result must be reported to ciwei explicitly; ciwei only starts writing tests after receiving confirmation that all three leader paths work.**

---

## 5. File structure rules

### ✅ Correct: one test body, iterating leader types with `for...of` (distinct teams)

```ts
// team-agent-lifecycle.e2e.ts
const LEADER_CONFIGS = [
  { leaderType: 'claude', teamName: 'E2E Team (claude)' },
  { leaderType: 'codex', teamName: 'E2E Team (codex)' },
  { leaderType: 'gemini', teamName: 'E2E Team (gemini)' },
] as const;

for (const { leaderType, teamName } of LEADER_CONFIGS) {
  test(`team lifecycle: ${leaderType} leader`, async ({ page }) => {
    // Same logic throughout; leaderType / teamName are captured from the closure.
  });
}
```

### ❌ Forbidden: one file per agent type

```
team-claude.e2e.ts    ❌
team-codex.e2e.ts     ❌
team-gemini.e2e.ts    ❌
```

When a new type joins the whitelist, extend the `LEADER_CONFIGS` list; do not create a new file.

---

## 6. Current file status

| File                          | Responsibility                                                       | Status  |
| ----------------------------- | -------------------------------------------------------------------- | ------- |
| `team-create.e2e.ts`          | UI creation flow plus creating one team per leader type              | ✅ Done |
| `team-agent-lifecycle.e2e.ts` | Parameterized end-to-end chain (add + fire), iterated by leader type | ✅ Done |
| `team-whitelist.e2e.ts`       | The UI dropdown only lists whitelisted agents                        | ✅ Done |
| `team-communication.e2e.ts`   | Verification of the user message-send chain                          | ✅ Done |

Incorrect files that have been deleted (they triggered operations through invokeBridge, or were per-type files):
`team-add-agent.e2e.ts`, `team-remove-agent.e2e.ts`, `team-multi-agent.e2e.ts`, `team-codebuddy.e2e.ts`

---

## 7. team-agent-lifecycle.e2e.ts specification

### Preconditions

**The lifecycle test depends on the three teams already existing.** Run `team-create.e2e.ts` first; it is responsible for creating:

- `E2E Team (claude)`
- `E2E Team (codex)`
- `E2E Team (gemini)`

Every test opens with an `expect(team).toBeTruthy()` precondition check, so a missing team fails immediately instead of passing silently. **Do not create teams inside the lifecycle test** — that is team-create.e2e.ts's job.

### Test logic

Use `for...of` rather than `test.each`, which avoids Playwright's ambiguous argument order:

```ts
const LEADER_CONFIGS = [
  { leaderType: 'claude', teamName: 'E2E Team (claude)' },
  { leaderType: 'codex', teamName: 'E2E Team (codex)' },
  { leaderType: 'gemini', teamName: 'E2E Team (gemini)' },
] as const;

for (const { leaderType, teamName } of LEADER_CONFIGS) {
  test(`team lifecycle: ${leaderType} leader`, async ({ page }) => {
    // [setup] Find the team for this leader type (invokeBridge is legitimate here).
    const teams = await invokeBridge<Array<{ id: string; name: string; agents: unknown[] }>>(page, 'team.list', {
      userId: 'system_default_user',
    });
    const team = teams.find((t) => t.name === teamName);
    expect(team).toBeTruthy();
    const initialCount = team!.agents.length;

    // [setup] Navigate to that team's page and wait for the leader input to be ready.
    await page.locator(`text=${teamName}`).first().click();
    await page.waitForURL(/\/team\//);
    const chatInput = page.locator('textarea').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    // [action] Add a member through the leader in natural language. The name carries a
    // timestamp so leftover data from an earlier run cannot collide.
    const memberName = `E2E-member-${Date.now()}`;
    await chatInput.fill(`Add a claude type member named ${memberName}`);
    await chatInput.press('Enter');

    // [assert] Wait for the new tab to appear (leader reasoning + MCP call, 60s timeout).
    await expect(page.locator(`text=${memberName}`).first()).toBeVisible({ timeout: 60000 });

    // [assert] Confirm the state through invokeBridge (legitimate).
    const afterAdd = await invokeBridge<{ agents: unknown[] }>(page, 'team.get', { id: team!.id });
    expect(afterAdd.agents.length).toBe(initialCount + 1);

    // [action] Fire the member through the leader in natural language.
    await chatInput.fill(`Fire the member named ${memberName}`);
    await chatInput.press('Enter');

    // [assert] Wait for the tab to disappear.
    await expect(page.locator(`text=${memberName}`).first()).not.toBeVisible({ timeout: 60000 });

    // [assert] Confirm the state through invokeBridge (legitimate).
    const afterFire = await invokeBridge<{ agents: unknown[] }>(page, 'team.get', { id: team!.id });
    expect(afterFire.agents.length).toBe(initialCount);
  });
}
```

### Key design notes

- **The parameter is the leader type, not the member type**: each test targets a team with one specific leader type, and what it verifies is that leader's orchestration ability.
- **`for...of` instead of `test.each`**: Playwright's `test.each` has a different argument order from Vitest's and is easy to get wrong; closure capture with `for...of` is clearer.
- **Instructions are written in English**: the leader's comprehension then does not depend on the app's display language, and English is the more stable input for the LLM.
- **memberName carries a timestamp**: a same-named member left behind by a failed run cannot corrupt the assertions.
- **initialCount is read dynamically**: each test reads it through invokeBridge at the start rather than hardcoding a number.
- **60000ms timeout**: the leader needs LLM reasoning plus an MCP tool call, so responses take a while.
- **Wait for chatInput before acting**: after navigating you must wait for the textarea to become visible before filling it, or you may type into a blank page.

---

## 8. Key UI selectors

| Element            | Selector                                               |
| ------------------ | ------------------------------------------------------ |
| Sidebar team entry | `page.locator('text=E2E Team (claude)').first()`, etc. |
| Leader chat input  | `page.locator('textarea').first()`                     |
| Send               | `.press('Enter')`                                      |
| Agent tab          | `page.locator('text=memberName').first()`              |
| Team page URL      | `/team/{id}`                                           |

---

## 9. How to run

```bash
# All team E2E tests (create first, then lifecycle)
E2E_PACKAGED=1 bun run test:e2e:team

# Only create the three teams (the lifecycle precondition)
E2E_PACKAGED=1 bun run test:e2e:team:create

# Only the lifecycle test
E2E_PACKAGED=1 bun run test:e2e:team:lifecycle

# Only the whitelist dropdown test
E2E_PACKAGED=1 bun run test:e2e:team:whitelist

# Only the message-send chain test
E2E_PACKAGED=1 bun run test:e2e:team:comm

# Only the gemini leader (TEAM_AGENT filter; comma-separated values are supported)
TEAM_AGENT=gemini E2E_PACKAGED=1 bun run test:e2e:team:lifecycle

# Only claude + codex
TEAM_AGENT=claude,codex E2E_PACKAGED=1 bun run test:e2e:team

# Create only the gemini team as well
TEAM_AGENT=gemini E2E_PACKAGED=1 bun run test:e2e:team:create
```

**Environment variables:**

| Variable         | Default                     | Meaning                                                                                                                                                                                                  |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_PACKAGED=1` | unset (local dev mode)      | Launch the app from the packaged build under `out/`                                                                                                                                                      |
| `E2E_DEV=1`      | unset                       | Force dev mode (`electron .`)                                                                                                                                                                            |
| `TEAM_AGENT`     | empty (all three types run) | Leader-type filter, comma-separated (`gemini` or `claude,codex`). Filtering happens centrally in `helpers/teamConfig.ts`, so every test file picks it up automatically through `TEAM_SUPPORTED_BACKENDS` |

In packaged mode the app uses whatever API key is already configured locally, so **no extra configuration is needed**.

**npm scripts at a glance:**

| Command                   | Meaning                     |
| ------------------------- | --------------------------- |
| `test:e2e:team`           | Every `team-*.e2e.ts`       |
| `test:e2e:team:create`    | Team creation only          |
| `test:e2e:team:lifecycle` | Lifecycle only (add + fire) |
| `test:e2e:team:whitelist` | Whitelist dropdown only     |
| `test:e2e:team:comm`      | Message sending only        |

---

## 10. Red lines (violating one means redoing the work; no exceptions)

1. **Using invokeBridge to trigger any operation (add/remove/fire)** -> redo
2. **Creating a file named `team-{agentType}.e2e.ts`** -> redo
3. **Testing or referring to codebuddy** -> redo
4. **Writing code before the approach is signed off** -> redo
5. **laochui and ciwei working separately without aligning first** -> redo
6. **`TEAM_SUPPORTED_BACKENDS` being anything other than `['claude', 'codex', 'gemini']`** -> not done
7. **The lifecycle test creating only one team or covering only one leader type** -> redo
