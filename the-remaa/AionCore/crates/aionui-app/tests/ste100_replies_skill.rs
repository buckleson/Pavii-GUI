//! Asset tests for the `ste100-replies` auto-inject skill.
//!
//! The skill is shipped as a file, not as code, so the contract worth pinning is
//! the file itself: where it sits, that it parses, and that the rules the reply
//! style depends on are actually present in the text an agent will read.

use std::path::{Path, PathBuf};

fn skill_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/builtin-skills/auto-inject/ste100-replies")
}

fn skill_body() -> String {
    std::fs::read_to_string(skill_dir().join("SKILL.md")).expect("ste100-replies/SKILL.md must exist")
}

/// `resolve_skill_source_path` probes by directory name while `auto_inject_names`
/// returns the frontmatter name. The desktop app also excludes the skill by this
/// id when the STE100 setting is off, so all three must agree.
#[test]
fn frontmatter_name_matches_directory_name() {
    let skill = skill_body();

    assert!(
        skill.starts_with("---\n") || skill.starts_with("---\r\n"),
        "frontmatter must open the file"
    );
    assert!(
        skill.contains("\nname: ste100-replies"),
        "frontmatter name must match the directory name"
    );

    let dir_name = skill_dir().file_name().unwrap().to_string_lossy().into_owned();
    assert_eq!(dir_name, "ste100-replies");
}

/// A skill with an empty description is dropped silently, and for native CLIs the
/// description is the only thing that decides whether the body is ever loaded.
#[test]
fn description_is_present_and_names_the_style() {
    let skill = skill_body();

    assert!(skill.contains("description:"), "description is required");
    assert!(skill.contains("ASD-STE100"), "description must name the standard");
}

#[test]
fn skill_states_the_sentence_length_limits() {
    let skill = skill_body();

    assert!(
        skill.contains("no more than 20 words"),
        "must state the instruction limit"
    );
    assert!(
        skill.contains("no more than 25 words"),
        "must state the description limit"
    );
}

/// Rewriting code or commands into "simple English" would break them, so the
/// exemption is part of the contract.
#[test]
fn skill_keeps_code_and_commands_unchanged() {
    let skill = skill_body();

    assert!(skill.contains("## Do not change"), "must have the exemption section");
    assert!(skill.contains("Code, commands"), "must exempt code and commands");
    assert!(skill.contains("Copy them exactly"), "must say to copy them verbatim");
}

/// The skill is injected into every reply; it must never tell an agent to install
/// software on the user's machine.
#[test]
fn skill_never_tells_the_model_to_install_anything() {
    let skill = skill_body().to_lowercase();

    for forbidden in ["npm install", "pip install", "uv tool install"] {
        assert!(!skill.contains(forbidden), "skill must not mention `{forbidden}`");
    }

    // Matched as whole words, so "confirm" does not trip the `irm` check.
    let words: Vec<&str> = skill.split(|c: char| !c.is_ascii_alphanumeric()).collect();
    for forbidden in ["curl", "irm"] {
        assert!(!words.contains(&forbidden), "skill must not mention `{forbidden}`");
    }
}
