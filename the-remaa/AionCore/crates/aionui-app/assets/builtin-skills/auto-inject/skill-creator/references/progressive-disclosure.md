# Progressive Disclosure Patterns

Skills load in three levels:

1. **Metadata (name + description)** — always in context (~100 words)
2. **SKILL.md body** — when the skill triggers (<5k words)
3. **Bundled resources** — as needed (unlimited; scripts can run without being read into context)

Keep the SKILL.md body to essentials and under 500 lines; split content into separate files when approaching this. Reference every split-out file from SKILL.md and say clearly when to read it.

**Key principle:** when a skill supports multiple variations, frameworks, or options, keep only the core workflow and selection guidance in SKILL.md; move variant-specific details (patterns, examples, configuration) into reference files.

## Pattern 1: High-level guide with references

```markdown
# PDF Processing

## Quick start

Extract text with pdfplumber:
[code example]

## Advanced features

- **Form filling**: See [FORMS.md](FORMS.md) for complete guide
- **API reference**: See [REFERENCE.md](REFERENCE.md) for all methods
```

The agent loads FORMS.md or REFERENCE.md only when needed.

## Pattern 2: Domain- or variant-specific organization

```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── reference/
    ├── finance.md (revenue, billing metrics)
    ├── sales.md (opportunities, pipeline)
    └── product.md (API usage, features)
```

A question about sales metrics reads only sales.md. Likewise for variants (`cloud-deploy/references/aws.md`, `gcp.md`, `azure.md`): when the user chooses AWS, read only aws.md.

## Pattern 3: Conditional details

```markdown
## Creating documents

Use docx-js for new documents. See [DOCX-JS.md](DOCX-JS.md).

## Editing documents

For simple edits, modify the XML directly.
**For tracked changes**: See [REDLINING.md](REDLINING.md)
```

## Guidelines

- **Avoid deeply nested references** — keep references one level deep; all reference files link directly from SKILL.md.
- **Structure longer reference files** — for files over 100 lines, put a table of contents at the top.
- If reference files are large (>10k words), include grep search patterns in SKILL.md.
- Information lives in either SKILL.md or a reference file, not both. Prefer reference files for detail unless it is core; keep essential procedure and workflow guidance in SKILL.md.

## Resource examples

- `scripts/`: `scripts/rotate_pdf.py` for PDF rotation. Token efficient, deterministic, may run without loading into context; may still need reading for patching or environment-specific changes.
- `references/`: `finance.md` (financial schemas), `mnda.md` (company NDA template), `policies.md`, `api_docs.md`. Use for database schemas, API docs, domain knowledge, company policies, detailed workflow guides.
- `assets/`: `logo.png`, `slides.pptx`, `frontend-template/`, `font.ttf`. Templates, images, icons, boilerplate, fonts, sample documents that get copied or modified.

## Planning examples (Step 2)

- `pdf-editor` ("Help me rotate this PDF"): rotating needs the same code each time → `scripts/rotate_pdf.py`.
- `frontend-webapp-builder` ("Build me a todo app"): same boilerplate HTML/React each time → `assets/hello-world/` template.
- `big-query` ("How many users have logged in today?"): schemas re-discovered each time → `references/schema.md`.
