//! Asset tests for the `pavii-context` auto-inject skill.
//!
//! The skill is shipped as a file, not as code, so the contract worth pinning is
//! the file itself: where it sits, that it parses, and that the rules the feature
//! depends on are actually present in the text an agent will read.

use std::path::{Path, PathBuf};

fn skill_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/builtin-skills/auto-inject/pavii-context")
}

fn skill_body() -> String {
    std::fs::read_to_string(skill_dir().join("SKILL.md")).expect("pavii-context/SKILL.md must exist")
}

/// `resolve_skill_source_path` probes by directory name while `auto_inject_names`
/// returns the frontmatter name. If they diverge the workspace symlink step
/// silently misses and the skill never reaches a native CLI.
#[test]
fn frontmatter_name_matches_directory_name() {
    let skill = skill_body();

    assert!(skill.starts_with("---\n") || skill.starts_with("---\r\n"), "frontmatter must open the file");
    assert!(skill.contains("\nname: pavii-context"), "frontmatter name must match the directory name");

    let dir_name = skill_dir().file_name().unwrap().to_string_lossy().into_owned();
    assert_eq!(dir_name, "pavii-context");
}

/// A skill with an empty description is dropped silently, and for native CLIs the
/// description is the only thing that decides whether the body is ever loaded.
#[test]
fn description_is_present_and_carries_the_trigger() {
    let skill = skill_body();

    assert!(skill.contains("description:"), "description is required");
    assert!(skill.contains("pavii-ard.md"), "description must name the architecture record");
    assert!(skill.contains("pavii-hoff.md"), "description must name the handoff");
    assert!(skill.contains("project directory"), "description must carry the project trigger");
}

/// The role rule is the whole team behaviour. `Role: lead` writes, `Role: teammate`
/// does not, and an absent role means a solo project session.
#[test]
fn skill_states_the_team_role_rule() {
    let skill = skill_body();

    assert!(skill.contains("Role: lead"), "must name the leader role verbatim as injected");
    assert!(skill.contains("Role: teammate"), "must name the teammate role verbatim as injected");
    assert!(skill.contains("Read only"), "a teammate must be told not to write");
    assert!(skill.contains("team context"), "must give the helper fallback for an unclear role");
}

/// With no workspace selected the cwd is a throwaway per-conversation temp dir.
/// Writing context files there produces per-session garbage, so the guard matters.
#[test]
fn skill_guards_against_scratch_workspaces() {
    let skill = skill_body();

    assert!(skill.contains(".git"), "must name a project marker");
    assert!(skill.contains("package.json"), "must name a project marker");
    assert!(skill.contains("scratch workspace"), "must say what a markerless directory is");
    assert!(skill.contains("read nothing, write nothing"), "must say what to do there");
}

#[test]
fn skill_states_the_update_cadence_and_the_evidence_rule() {
    let skill = skill_body();

    assert!(skill.contains("three to four exchanges"), "must state the cadence");
    assert!(skill.contains("Never invent content"), "must forbid padding a heading");
    assert!(skill.contains("secrets"), "must forbid writing secrets into the files");
}

/// The body defers to these rather than inlining them, so a missing template would
/// leave an agent with an instruction it cannot follow.
#[test]
fn referenced_templates_exist_and_are_not_empty() {
    for name in ["ard-template.md", "hoff-template.md"] {
        let path = skill_dir().join("references").join(name);
        let body = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("{name} must exist"));
        assert!(body.len() > 200, "{name} must have real content");
    }

    let skill = skill_body();
    assert!(skill.contains("references/ard-template.md"));
    assert!(skill.contains("references/hoff-template.md"));
}
