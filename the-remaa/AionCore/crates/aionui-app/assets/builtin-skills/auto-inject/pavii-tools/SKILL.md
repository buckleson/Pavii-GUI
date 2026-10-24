---
name: pavii-tools
description: >
  Pavii agent tools (Code Map, Graph, Compress, Search, Reach): which to use for code
  questions, large outputs, web search, and reading web pages, videos, feeds or GitHub.
---

Pavii gives you these tools only while Pavii runs you. If a tool is not in your tool list or on PATH, the user turned it off: work without it. Never install, set up, or configure any of them.

## MCP tools

- **pavii-code-map** (code bases only): symbol search, callers and callees, the impact of a change. Use it before you read many files to find where something is.
- **pavii-graph** (code bases only): the structure of the project — modules, dependencies, communities. Use it for architecture questions.
- **pavii-compress**: compress a large tool output or document before you keep it in context; retrieve the original only when you need the detail.
- **pavii-search**: web search and page content. Use it when the answer needs current or outside information.

Prefer these to reading whole files or pasting long outputs. They save context.

## Commands (Pavii Reach)

Run these in the shell. They need no account.

- Web page as text: `curl -s "https://r.jina.ai/<URL>"`
- Video or podcast metadata and subtitles: `yt-dlp --skip-download --write-auto-subs --sub-langs en "<URL>"` (`yt-dlp -J "<URL>"` for metadata only)
- GitHub repositories, issues and pull requests: `gh` (when it is installed and signed in)

Never run `agent-reach` itself (`install`, `setup`, `skill`, `doctor`): it changes the user's home folder and suggests installs.
