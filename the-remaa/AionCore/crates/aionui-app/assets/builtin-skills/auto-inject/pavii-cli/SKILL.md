---
name: pavii-cli
description: Create, inspect, proofread, and modify Office documents (.docx, .xlsx, .pptx) with officecli. Use when the user wants to create, read, check formatting of, find issues in, add charts to, or edit Office documents.
---

> **Platform note.** Snippets are bash (macOS / Linux). Check the OS first. On **Windows**, translate the shell syntax to PowerShell (officecli itself is cross-platform): `a && b` → `a; if ($?) { b }`; heredoc → write a temp file and pass it; `VAR=$(cmd)` → `$VAR = cmd`; `> /dev/null` → `> $null`; `grep` → `Select-String`; `jq` → `ConvertFrom-Json`; `python3` → `python`/`py`; `~/dir`, `/tmp` → `$env:USERPROFILE\dir`, `$env:TEMP`; `cp` / `mkdir -p` / `rm -rf` → `Copy-Item` / `New-Item -ItemType Directory -Force` / `Remove-Item -Recurse -Force`. With no obvious equivalent, prefer the built-in file/HTTP tools over raw shell.

# officecli

AI-friendly single-binary CLI for .docx, .xlsx, .pptx; no Office installation needed.

## Install

Check with `officecli --version`. If missing, **do not install it yourself** — tell the user this skill needs `officecli` and give them these commands (piping a remote script into a shell is the user's call). A new terminal may be needed for PATH.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/iOfficeAI/OfficeCli/main/install.sh | bash
# Windows (PowerShell)
irm https://raw.githubusercontent.com/iOfficeAI/OfficeCli/main/install.ps1 | iex
```

## Strategy

**L1 (read) → L2 (DOM edit) → L3 (raw XML)**; prefer higher layers. Add `--json` for structured output. **Before doc work, check Specialized Skills** below: fundraising decks, academic papers, financial models, dashboards, and Morph animations need their skill loaded first.

## Help (use instead of guessing)

When unsure of property names, value formats, or syntax, ALWAYS run help. `officecli help` ≡ `--help`; `officecli <cmd> --help` ≡ `officecli help <cmd>`.

```bash
officecli help                        # commands, global options, schema entry points
officecli help docx                   # docx elements
officecli help docx paragraph         # full schema: properties, aliases, examples, readbacks
officecli help docx set paragraph     # only props usable with `set`
officecli help docx paragraph --json  # machine-readable
```

Format aliases: `word`→`docx`, `excel`→`xlsx`, `ppt`/`powerpoint`→`pptx`. Verbs: `add`, `set`, `get`, `query`, `remove`. MCP: `{"command":"help","format":"docx","type":"paragraph"}`.

## Resident mode

Every command auto-starts a resident on first access (60s idle timeout; avoids file-lock conflicts). For longer sessions use `officecli open <file>` … `officecli close <file>` (saves and releases; 12min idle). Opt out: `OFFICECLI_NO_AUTO_RESIDENT=1`.

## Quick start

```bash
officecli create slides.pptx
officecli add slides.pptx / --type slide --prop title="Q4 Report" --prop background=1A1A2E
officecli add slides.pptx '/slide[1]' --type shape --prop text="Revenue grew 25%" --prop x=2cm --prop y=5cm --prop font=Arial --prop size=24 --prop color=FFFFFF
officecli create report.docx
officecli add report.docx /body --type paragraph --prop text="Executive Summary" --prop style=Heading1
officecli create data.xlsx
officecli set data.xlsx /Sheet1/A1 --prop value="Name" --prop bold=true
```

## L1: create, read, inspect

```bash
officecli create <file>               # blank .docx/.xlsx/.pptx (type from extension)
officecli view <file> <mode>          # see modes below
officecli get <file> <path> --depth N # node and children [--json]
officecli query <file> <selector>     # CSS-like query
officecli validate <file>             # validate against OpenXML schema
```

`view` modes: `outline`; `stats`; `issues` (`--type format|content|structure`, `--limit N`); `text` (`--start N --end N`, `--max-lines N`); `annotated`; `html` (static snapshot, `--browser`, `--page N` docx, `--start N --end N` pptx); `screenshot` / `svg` (pptx slide) / `pdf` (exporter plugin) / `forms` (form-fields JSON) with `-o`, `--screenshot-width/-height`, pptx `--grid N`.

`get`: any XML path via element localName. Text output: `path (type) "text" key=val ...`. Examples: `get report.docx '/body/p[3]' --depth 2 --json`; `get slides.pptx '/slide[1]' --depth 1` (all shapes on slide 1); `get data.xlsx '/Sheet1/B2' --json`.

**Stable IDs**: prefer `@attr=value` paths in multi-step work (positional indices shift on insert/delete): `/slide[1]/shape[@id=550950021]`, `/slide[1]/table[@id=1388430425]/tr[1]/tc[2]`, `/body/p[@paraId=1A2B3C4D]`, `/comments/comment[@commentId=1]`. PPT also accepts `@name=` (e.g. `shape[@name=Title 1]`, morph `!!` prefix aware). Slide, run, tr/tc, row use positional indices.

`query` selectors: `[attr=value]`, `[attr!=value]`, `[attr~=text]`, `[attr>=value]`, `[attr<=value]`, `:contains("text")`, `:empty`, `:has(formula)`, `:no-alt`; boolean `and`/`or` in `query`/`set`/`remove` (`cell[(type=Number or type=Date) and value>0]`); Excel by column name `Sheet1!row[Salary>5000]`. `set` accepts selectors and Excel-native paths. Bare unscoped selectors are rejected on `set`/`remove`. Example: `query report.docx 'paragraph[style=Normal] > run[font!=Arial]'`.

**Watch / selection / marks**: `officecli watch <file> [--port N]` (live preview, default 26315), `unwatch`, `goto <file> <path>`, `get <file> selected [--json]`, `mark` / `unmark` / `get-marks`. Read `references/watch-and-marks.md` before using them.

## L2: DOM operations

**set**: `officecli set <file> <path> --prop key=value [--prop ...]`. Any XML attribute is settable via element path (find it with `get --depth N`), even if absent. Without `--find`, formats the whole element. Values: colors `FF0000`, `#FF0000`, `red`, `rgb(255,0,0)`, `accent1`..`accent6`; spacing `12pt`, `0.5cm`, `1.5x`, `150%`; dimensions EMU `914400` or `2.54cm`, `1in`, `72pt`, `96px`. Dotted aliases `font.color=red`, `font.bold=true`, `font.size=14pt` work on shape/run/paragraph/table/row/cell/section/styles.

**find / replace** (top-level `--find` / `--replace` on `set`, `--find` on `query`; legacy `--prop find=X` works with a hint):

```bash
officecli set doc.docx '/body/p[1]' --find weather --prop bold=true --prop color=red   # format match (auto-splits runs)
officecli set doc.docx '/body/p[1]' --find '\d+%' --prop regex=true --prop color=red
officecli set doc.docx / --find draft --replace final                                  # / = whole document
officecli set doc.docx / --find draft --replace final --prop revision.author=Alice     # docx tracked change
```

Scope by path: `/`, `/body/p[1]`, `/slide[N]/shape[M]`, `/header[1]`, `/footer[1]`. Case-sensitive; insensitive: `--prop 'find=(?i)error' --prop regex=true`. Matches cross run boundaries. No match = silent success (`--json` gives `"matched": N`). Excel: only find + replace.

**add**:

```bash
officecli add <file> <parent> --type <type> [--prop ...]          # append
officecli add <file> <parent> --type <type> --after <path>        # or --before <path>, or --index N (0-based, legacy)
officecli add <file> <parent> --from <path>                       # clone, e.g. add f / --from '/slide[1]' (keeps cross-part rels)
officecli add doc.docx '/body/p[1]' --type run --after find:weather --prop text=" (sunny)"
officecli add doc.docx '/body/p[1]' --type table --after "find:First sentence." --prop rows=2 --prop cols=2
```

`--after`/`--before`/`--index` are mutually exclusive. `find:X` anchors: inline types (run, picture, hyperlink) insert in the paragraph; block types (table, paragraph) split it; PPT supports inline only. Element types per format: `references/element-types.md` (or `officecli help <format>`).

**Pivot tables (xlsx)**: `officecli add data.xlsx /Sheet1 --type pivottable --prop source="Sheet1!A1:E100" --prop rows=Region,Category --prop cols=Year --prop values="Sales:sum,Qty:count" --prop grandTotals=rows --prop subtotals=off --prop sort=asc`. Props: `rows`, `cols`, `values` (Field:func[:showDataAs]), `filters`, `source`, `position`, `layout` (compact/outline/tabular), `repeatLabels`, `blankRows`, `aggregate`, `showDataAs` (percent_of_total/row/col, running_total), `grandTotals`, `subtotals`, `sort`. Aggregators: sum, count, average, max, min, product, stdDev, stdDevp, var, varp, countNums. Date columns auto-group. Full schema: `officecli help xlsx pivottable`.

**Document-level props**: `set doc.docx / --prop docDefaults.font=Arial --prop docDefaults.fontSize=11pt`; `--prop protection=forms --prop evenAndOddHeaders=true`; `set data.xlsx / --prop calc.mode=manual --prop calc.refMode=r1c1`; `set slides.pptx / --prop defaultFont=Arial --prop show.loop=true --prop print.what=handouts`. All: `officecli help <format> /`.

**Sort (xlsx)**: `set data.xlsx /Sheet1 --prop sort="C desc" --prop sortHeader=true` (or a range path `'/Sheet1/A1:D100'`). Format `COL DIR[, COL DIR ...]`. Rejects ranges with merged cells or formulas; hyperlinks, comments, conditional formatting, drawings follow rows.

**move, swap, remove**: `officecli move <file> <path> [--to <parent>] [--index N] [--after <path>] [--before <path>]` (`--to` inferred from `--after`/`--before`); `officecli swap <file> <path1> <path2>`; `officecli remove <file> '/body/p[4]'`.

**batch** (one save cycle; continues on error, exit 1 if any item fails; `--stop-on-error` aborts; `--force` bypasses docx protection):

```bash
echo '[{"command":"set","path":"/Sheet1/A1","props":{"value":"Name","bold":"true"}}]' | officecli batch data.xlsx --json
officecli batch data.xlsx --commands '[{"op":"set","path":"/Sheet1/A1","props":{"value":"Done"}}]' --json
officecli batch data.xlsx --input updates.json --force --json
```

Ops: `add`, `set`, `get`, `query`, `remove`, `move`, `swap`, `view`, `raw`, `raw-set`, `validate`. Fields: `command` (or `op`), `path`, `parent`, `type`, `from`, `to`, `index`, `after`, `before`, `props`, `selector`, `mode`, `depth`, `part`, `xpath`, `action`, `xml`.

`officecli dump <file> [<path>]` emits replayable batch JSON — `.docx` full coverage, `.pptx` text/tables/pictures/charts/notes/theme + OLE/3D/video/audio/SmartArt/morph/p15 transitions via raw-set. Path default `/`; subtrees: `/body`, `/body/p[N]`, `/body/tbl[N]`, `/theme`, `/settings`, `/numbering`, `/styles`. `officecli refresh <file.docx>` recalculates TOC page numbers / PAGE / cross-references after replay (Word backend on Windows; headless-HTML fallback elsewhere). `officecli plugins list` adds `.doc`, `.hwpx`, `.pdf` export.

## L3: raw XML (only when L2 cannot do it)

No xmlns declarations needed. `officecli raw <file> <part>` (view); `officecli raw-set <file> <part> --xpath "..." --action replace --xml '<w:p>...</w:p>'`; `officecli add-part <file> <parent>` (new part, returns rId). Actions: `append`, `prepend`, `insertbefore`, `insertafter`, `replace`, `remove`, `setattr`. Parts: `officecli help <format> raw`.

## Pitfalls

- `--name "foo"` is wrong: all attributes go through `--prop name="foo"`.
- Always quote `[N]` paths: `'/slide[1]'` (shells glob-expand brackets).
- PPT `shape[1]` is usually the title placeholder; content is `shape[2]+`.
- `/shape[myname]` is not supported; use a numeric index or `@name=` (PPT only).
- Close the file in PowerPoint/WPS before modifying it.
- Newlines in `--prop text="..."`: use `\\n`.
- `$` in text: `--prop text="$15M"` strips `$15`; use single quotes `'$15M'` or a heredoc batch.
- Paths are **1-based** (`'/body/p[3]'` = third paragraph); `--index` is **0-based** — except Excel `add --type row` / `--type col`, where `--index N` is 1-based.
- After modifications, verify with `validate` and/or `view issues`.

## Specialized skills

`officecli load_skill <name>` prints a SKILL.md; follow its rules. Pick the most specific match, else the format default (`word` / `pptx` / `excel`). Load **one** skill per artifact (scenes include the default's rules), never stack; rules persist across turns, do not re-load; two artifacts → two loads.

- **docx**: `word` (reports, letters, memos, proposals); `academic-paper` (journal / conference / thesis: APA / Chicago / IEEE / MLA citations, equations, SEQ + PAGEREF cross-refs, multi-column, bibliography — not business docs).
- **pptx**: `pptx` (generic: board, sales, all-hands, launches); `pitch-deck` (**fundraising only**: seed / Series A-C / SAFE / convertible / strategic raise); `morph-ppt` (cinematic Morph animation); `morph-ppt-3d` (3D Morph: GLB models, camera moves, depth).
- **xlsx**: `excel` (generic workbooks, formulas, pivots, trackers); `financial-model` (models, scenarios, projections); `data-dashboard` (CSV/tabular → KPI / analytics / executive dashboards with charts and sparklines).
