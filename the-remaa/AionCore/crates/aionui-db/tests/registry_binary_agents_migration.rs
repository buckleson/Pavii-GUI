use aionui_db::{IAgentMetadataRepository, SqliteAgentMetadataRepository, init_database_memory};

#[tokio::test]
async fn verified_registry_binary_agents_store_stable_registry_identity() {
    let db = init_database_memory().await.unwrap();
    let repo = SqliteAgentMetadataRepository::new(db.pool().clone());
    let cases = [
        ("amp-acp", "amp-acp", r#"[]"#, Some("bypass")),
        ("cortex-code", "cortex", r#"["acp","serve"]"#, Some("bypass")),
        ("corust-agent", "corust-agent-acp", r#"[]"#, None),
        ("devin", "devin", r#"["acp"]"#, Some("bypass")),
        ("harn", "harn", r#"["serve","acp"]"#, None),
        ("junie", "junie", r#"["--acp=true"]"#, None),
        ("poolside", "pool", r#"["acp"]"#, None),
        ("stakpak", "stakpak", r#"["acp"]"#, None),
        ("vtcode", "vtcode", r#"["acp"]"#, None),
    ];
    for (backend, command, args, yolo_id) in cases {
        let row = repo.find_builtin_by_backend(backend).await.unwrap().unwrap();
        assert_eq!(row.description, None, "{backend} builtin description");
        let expected_icon = format!("/api/assets/logos/acp-registry/{backend}.svg");
        assert_eq!(row.icon.as_deref(), Some(expected_icon.as_str()), "{backend} icon");
        assert_eq!(row.command.as_deref(), Some(command), "{backend} command");
        assert_eq!(row.args.as_deref(), Some(args), "{backend} args");
        assert_eq!(row.yolo_id.as_deref(), yolo_id);
        let source: serde_json::Value = serde_json::from_str(row.agent_source_info.as_deref().unwrap()).unwrap();
        assert!(source.get("registry_id").is_none());
        assert!(source.get("distribution").is_none());
        assert!(source.get("version").is_none());
        let policy: serde_json::Value = serde_json::from_str(row.behavior_policy.as_deref().unwrap()).unwrap();
        // 033 retired both team veto keys; capability is derived from the agent's
        // advertised MCP transports, never pinned in the stored policy.
        assert!(policy.get("team_capable_override").is_none());
        assert!(policy.get("supports_team").is_none());
    }
}

/// 041 repoints Kiro at `kiro-cli`. 003 had picked `kiro-cli-chat`, which the
/// Unix installer ships but the Windows one does not: `%LOCALAPPDATA%\Kiro-Cli\`
/// holds a single `kiro-cli.exe` that is itself the chat binary. Availability
/// resolves one name against PATH with no alias fallback, so the old value made
/// every Windows install report Kiro as not installed.
#[tokio::test]
async fn kiro_is_probed_by_its_cross_platform_cli_binary() {
    let db = init_database_memory().await.unwrap();
    let repo = SqliteAgentMetadataRepository::new(db.pool().clone());

    let row = repo.find_builtin_by_backend("kiro").await.unwrap().unwrap();

    assert_eq!(row.command.as_deref(), Some("kiro-cli"), "kiro command");
    // `acp` stays the entry point -- hidden from the top-level help, but
    // `kiro-cli acp --help` reports "Start Agent Client Protocol (ACP) agent".
    assert_eq!(row.args.as_deref(), Some(r#"["acp"]"#), "kiro args");

    let source: serde_json::Value = serde_json::from_str(row.agent_source_info.as_deref().unwrap()).unwrap();
    assert_eq!(
        source.get("binary_name").and_then(serde_json::Value::as_str),
        Some("kiro-cli"),
        "kiro binary_name must match the command it probes"
    );
    // Kiro is a direct-CLI agent: a bridge would make availability require npx.
    assert!(source.get("bridge_binary").is_none(), "kiro must stay unbridged");
}
