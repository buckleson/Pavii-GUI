//! Asset tests for the `pavii-tools` auto-inject skill.
//!
//! The skill tells agents which Pavii agent tools exist and when to use them.
//! Its MCP server names must match the builtin rows the desktop app creates
//! (`RECOMMENDED_TOOLS[].mcpServerName`), and it must never send an agent to
//! the upstream setup commands that write the user's global config.

use std::path::{Path, PathBuf};

fn skill_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/builtin-skills/auto-inject/pavii-tools")
}

fn skill_body() -> String {
    std::fs::read_to_string(skill_dir().join("SKILL.md")).expect("pavii-tools/SKILL.md must exist")
}

#[test]
fn frontmatter_name_matches_directory_name() {
    let skill = skill_body();

    assert!(skill.starts_with("---\n"), "frontmatter must open the file");
    assert!(
        skill.contains("\nname: pavii-tools\n"),
        "frontmatter name must match the directory name"
    );
    assert!(skill.contains("\ndescription:"), "description is required");
}

/// Auto-inject descriptions are sent with every turn; keep this one small.
#[test]
fn description_stays_short() {
    let skill = skill_body();
    let frontmatter = skill.split("\n---").next().unwrap();
    let description = frontmatter.split("description:").nth(1).unwrap();
    let words = description.split_whitespace().filter(|w| *w != ">").count();

    assert!(words <= 35, "description has {words} words; keep it at 35 or fewer");
}

#[test]
fn skill_names_every_builtin_tool_row() {
    let skill = skill_body();

    for row in ["pavii-code-map", "pavii-graph", "pavii-compress", "pavii-search"] {
        assert!(skill.contains(row), "skill must name the `{row}` MCP row");
    }
}

/// These commands write `~/.claude*`, `~/.codex`, `~/.agents` or system packages.
/// The skill may name the Reach ones only to forbid them, and must never name
/// the others at all.
#[test]
fn skill_never_runs_upstream_setup_commands() {
    let skill = skill_body();

    for forbidden in [
        "trail init",
        "headroom wrap",
        "graphify install",
        "npm install",
        "pip install",
        "uv tool install",
    ] {
        assert!(!skill.contains(forbidden), "skill must not mention `{forbidden}`");
    }
    assert!(
        skill.contains("Never run `agent-reach` itself"),
        "skill must forbid the Reach setup commands"
    );
    // Even `doctor --json` creates ~/.agent-reach and prints install advice.
    assert!(
        !skill.contains("doctor --json"),
        "skill must not send agents to agent-reach doctor"
    );
}

#[test]
fn skill_says_tools_exist_only_inside_pavii() {
    let skill = skill_body();

    assert!(skill.contains("only while Pavii runs you"));
    assert!(skill.contains("Never install"));
}
