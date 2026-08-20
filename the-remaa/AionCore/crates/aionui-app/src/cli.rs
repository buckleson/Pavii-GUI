//! CLI argument definitions for the `paviicore` binary.
//!
//! Kept separate from `main.rs` to isolate the clap surface (struct + enum +
//! attribute soup) from the runtime entry point. Visibility is `pub(crate)`
//! because only `main.rs` consumes it.

use std::ffi::OsString;
use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Parser)]
#[command(name = "paviicore", about = "Pavii Engine Backend Server", version)]
pub(crate) struct Cli {
    /// Host address to listen on.
    #[arg(long, default_value_t = String::from(aionui_common::constants::DEFAULT_HOST))]
    pub host: String,

    /// Port number to listen on.
    #[arg(long, default_value_t = aionui_common::constants::DEFAULT_PORT)]
    pub port: u16,

    /// Data directory for database and file storage.
    #[arg(long, default_value = "data")]
    pub data_dir: PathBuf,

    /// Parent process ID used to terminate the backend when the desktop app dies.
    #[arg(long)]
    pub parent_pid: Option<u32>,

    /// Working directory for conversation workspaces.
    /// Falls back to AIONUI_WORK_DIR env, then to data-dir.
    #[arg(long)]
    pub work_dir: Option<PathBuf>,

    /// Host application version used for extension engine compatibility.
    #[arg(long, default_value_t = env!("CARGO_PKG_VERSION").to_string())]
    pub app_version: String,

    /// Run in local embedded mode (skip authentication, use system_default_user).
    #[arg(long)]
    pub local: bool,

    /// Identity source mode. AionPro mode requires AIONCORE_BOOTSTRAP_SECRET.
    #[arg(long, value_enum, default_value_t = IdentityModeArg::Webui)]
    pub identity_mode: IdentityModeArg,

    /// Directory for log files. Defaults to {data-dir}/logs/.
    #[arg(long)]
    pub log_dir: Option<PathBuf>,

    /// Log level filter (e.g. "info", "debug", "info,aionui_mcp=trace").
    #[arg(long)]
    pub log_level: Option<String>,

    /// Dump prompt diagnostics to {data-dir}/prompt-dumps.
    #[arg(long)]
    pub dump_prompts: bool,

    /// Explicitly back up a corruption-like local database and create a fresh database during startup.
    #[arg(long)]
    pub recover_corrupted_database: bool,

    /// Managed runtime resource source selection.
    #[arg(long, value_enum, default_value_t = ManagedResourcesModeArg::Download)]
    pub managed_resources_mode: ManagedResourcesModeArg,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManagedResourcesModeArg {
    Bundled,
    Download,
}

#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IdentityModeArg {
    Local,
    Webui,
    Aionpro,
}

impl From<IdentityModeArg> for aionui_app::IdentityMode {
    fn from(value: IdentityModeArg) -> Self {
        match value {
            IdentityModeArg::Local => Self::Local,
            IdentityModeArg::Webui => Self::WebUi,
            IdentityModeArg::Aionpro => Self::AionPro,
        }
    }
}

impl From<ManagedResourcesModeArg> for aionui_runtime::ManagedResourcesMode {
    fn from(value: ManagedResourcesModeArg) -> Self {
        match value {
            ManagedResourcesModeArg::Bundled => Self::Bundled,
            ManagedResourcesModeArg::Download => Self::Download,
        }
    }
}

// `Mcp` prefix is load-bearing on Mcp* variants — clap derives the kebab-case
// subcommand name (`mcp-team-stdio`) that external callers (the ACP agent CLI,
// which spawns it from `session/new.mcpServers`) depend on verbatim.
#[derive(Subcommand, Debug)]
pub(crate) enum Command {
    /// Print the top-level agent-facing CLI capability index.
    Capabilities,
    /// Agent-facing automation CLI for AionUi configuration.
    Config(ConfigArgs),
    /// Agent-facing read-only troubleshooting CLI for AionUi diagnosis.
    Diagnose(DiagnoseArgs),
    /// Agent-facing Team collaboration CLI fallback.
    Team(TeamArgs),
    /// PreToolUse permission gate for the Antigravity CLI (spawned by agy).
    /// Reads the tool request on stdin, asks the running AionUi backend, and
    /// writes agy's decision to stdout.
    AntigravityHook,
    /// Stdio ↔ TCP bridge for the team MCP server (spawned by the ACP agent CLI).
    /// MCP stdio server for team tools (spawned by the ACP agent CLI).
    McpTeamStdio,
    /// Self-check: hydrate the agent registry, probe every CLI on `$PATH`,
    /// and print a per-agent availability table. Useful when the user
    /// reports "no agent works" — running this from the same shell the
    /// app launched from confirms whether each backend is detectable
    /// before involving server logs.
    Doctor,
    /// Prepare current-platform managed runtime resources under a bundle output root.
    PrepareManagedResources(PrepareManagedResourcesArgs),
}

impl Command {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Capabilities => "capabilities",
            Self::Config(_) => "config",
            Self::Diagnose(_) => "diagnose",
            Self::Team(_) => "team",
            Self::AntigravityHook => "antigravity-hook",
            Self::McpTeamStdio => "mcp-team-stdio",
            Self::Doctor => "doctor",
            Self::PrepareManagedResources(_) => "prepare-managed-resources",
        }
    }

    pub(crate) fn need_runtime(&self) -> bool {
        matches!(self, Self::Doctor | Self::PrepareManagedResources(_))
    }
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigArgs {
    #[command(subcommand)]
    pub command: ConfigCommand,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct DiagnoseArgs {
    #[command(subcommand)]
    pub command: DiagnoseCommand,
}

#[derive(Args, Debug, Clone)]
#[command(disable_help_subcommand = true)]
pub(crate) struct TeamArgs {
    #[command(subcommand)]
    pub command: TeamCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum TeamCommand {
    Capabilities,
    Help,
    Context,
    Members,
    ReadMessages,
    SendMessage,
    InterruptAgent,
    Task(TeamTaskArgs),
    ListAssistants,
    DescribeAssistant,
    SpawnAgent,
    RenameAgent,
    ClearAgentContext,
    ShutdownAgent,
    #[command(external_subcommand)]
    Unknown(Vec<OsString>),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct TeamTaskArgs {
    #[command(subcommand)]
    pub command: TeamTaskCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum TeamTaskCommand {
    Create,
    Update,
    List,
    #[command(external_subcommand)]
    Unknown(Vec<OsString>),
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum DiagnoseCommand {
    /// Print the agent-readable diagnose CLI capability contract.
    Capabilities,
    /// Print the current agent runtime context.
    Context,
    /// Read backend health.
    Health,
    /// Read a cross-domain diagnostic snapshot.
    Overview,
    /// Inspect conversation state and messages.
    Conversations(DiagnoseConversationsArgs),
    /// Inspect provider health summary.
    Providers(DiagnoseProvidersArgs),
    /// Inspect MCP server summary.
    Mcp(DiagnoseMcpArgs),
    /// Inspect scheduled task summary.
    Cron(DiagnoseCronArgs),
    /// Inspect team summary.
    Teams(DiagnoseTeamsArgs),
    /// Read engine logs.
    Logs(DiagnoseLogsArgs),
    /// Controlled HTTP read escape hatch.
    Http(DiagnoseHttpArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct DiagnoseConversationsArgs {
    #[command(subcommand)]
    pub command: DiagnoseConversationsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum DiagnoseConversationsCommand {
    List,
    Get,
    Messages,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct DiagnoseProvidersArgs {
    #[command(subcommand)]
    pub command: DiagnoseSummaryCommand,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct DiagnoseMcpArgs {
    #[command(subcommand)]
    pub command: DiagnoseSummaryCommand,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct DiagnoseCronArgs {
    #[command(subcommand)]
    pub command: DiagnoseSummaryCommand,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct DiagnoseTeamsArgs {
    #[command(subcommand)]
    pub command: DiagnoseSummaryCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum DiagnoseSummaryCommand {
    Summary,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct DiagnoseLogsArgs {
    #[command(subcommand)]
    pub command: DiagnoseLogsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum DiagnoseLogsCommand {
    Tail,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct DiagnoseHttpArgs {
    #[command(subcommand)]
    pub command: DiagnoseHttpCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum DiagnoseHttpCommand {
    Get,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigCommand {
    /// Print the agent-readable config CLI capability contract.
    Capabilities,
    /// Print the current agent runtime context.
    Context,
    /// Manage conversations.
    Conversation(ConfigConversationArgs),
    /// Manage assistants and assistant-owned behavior.
    Assistants(ConfigAssistantsArgs),
    /// Manage AionUi skills.
    Skills(ConfigSkillsArgs),
    /// Manage MCP servers and OAuth state.
    Mcp(ConfigMcpArgs),
    /// Manage model providers.
    Providers(ConfigProvidersArgs),
    /// Manage backend and client settings.
    Settings(ConfigSettingsArgs),
    /// Manage agent catalog and custom agents.
    Agents(ConfigAgentsArgs),
    /// Manage scheduled tasks.
    Cron(ConfigCronArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigAssistantsArgs {
    #[command(subcommand)]
    pub command: ConfigAssistantsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigAssistantsCommand {
    List,
    Get,
    Create,
    Update,
    Delete,
    Import,
    State,
    Rule(ConfigAssistantRuleArgs),
    Skill(ConfigAssistantSkillArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigAssistantRuleArgs {
    #[command(subcommand)]
    pub command: ConfigAssistantTextCommand,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigAssistantSkillArgs {
    #[command(subcommand)]
    pub command: ConfigAssistantTextCommand,
}

#[derive(Subcommand, Debug, Clone, Copy)]
pub(crate) enum ConfigAssistantTextCommand {
    Read,
    Write,
    Delete,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigSkillsArgs {
    #[command(subcommand)]
    pub command: ConfigSkillsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigSkillsCommand {
    List,
    Info,
    Paths,
    Import,
    Delete,
    Scan,
    ExternalPaths(ConfigSkillsExternalPathsArgs),
    Market(ConfigSkillsMarketArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigSkillsExternalPathsArgs {
    #[command(subcommand)]
    pub command: ConfigSkillsExternalPathsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigSkillsExternalPathsCommand {
    List,
    Add,
    Remove,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigSkillsMarketArgs {
    #[command(subcommand)]
    pub command: ConfigSkillsMarketCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigSkillsMarketCommand {
    Enable,
    Disable,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigMcpArgs {
    #[command(subcommand)]
    pub command: ConfigMcpCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigMcpCommand {
    Servers(ConfigMcpServersArgs),
    TestConnection,
    AgentConfigs,
    Oauth(ConfigMcpOauthArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigMcpServersArgs {
    #[command(subcommand)]
    pub command: ConfigMcpServersCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigMcpServersCommand {
    List,
    Get,
    Create,
    Update,
    Delete,
    Toggle,
    Import,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigMcpOauthArgs {
    #[command(subcommand)]
    pub command: ConfigMcpOauthCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigMcpOauthCommand {
    CheckStatus,
    Login,
    Logout,
    Authenticated,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigProvidersArgs {
    #[command(subcommand)]
    pub command: ConfigProvidersCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigProvidersCommand {
    List,
    Create,
    Update,
    Delete,
    DetectProtocol,
    FetchModels,
    Models(ConfigProviderModelsArgs),
    HealthCheck,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigProviderModelsArgs {
    #[command(subcommand)]
    pub command: ConfigProviderModelsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigProviderModelsCommand {
    Fetch,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigSettingsArgs {
    #[command(subcommand)]
    pub command: ConfigSettingsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigSettingsCommand {
    Get,
    Patch,
    Client(ConfigSettingsClientArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigSettingsClientArgs {
    #[command(subcommand)]
    pub command: ConfigSettingsClientCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigSettingsClientCommand {
    Get,
    Put,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigAgentsArgs {
    #[command(subcommand)]
    pub command: ConfigAgentsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigAgentsCommand {
    List,
    Enable,
    Overrides(ConfigAgentOverridesArgs),
    Custom(ConfigAgentCustomArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigAgentOverridesArgs {
    #[command(subcommand)]
    pub command: ConfigAgentOverridesCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigAgentOverridesCommand {
    Get,
    Set,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigAgentCustomArgs {
    #[command(subcommand)]
    pub command: ConfigAgentCustomCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigAgentCustomCommand {
    Create,
    Update,
    Delete,
    TryConnect,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigCronArgs {
    #[command(subcommand)]
    pub command: ConfigCronCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigCronCommand {
    Jobs(ConfigCronJobsArgs),
    Current(ConfigCronCurrentArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigCronJobsArgs {
    #[command(subcommand)]
    pub command: ConfigCronJobsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigCronJobsCommand {
    List,
    Get,
    Create,
    Update,
    Delete,
    Run,
    Skill(ConfigCronJobSkillArgs),
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigCronJobSkillArgs {
    #[command(subcommand)]
    pub command: ConfigCronJobSkillCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigCronJobSkillCommand {
    Get,
    Save,
    Delete,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigCronCurrentArgs {
    #[command(subcommand)]
    pub command: ConfigCronCurrentCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigCronCurrentCommand {
    List,
    Create,
    Update,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct ConfigConversationArgs {
    #[command(subcommand)]
    pub command: ConfigConversationCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigConversationCommand {
    Rename,
}

#[derive(Args, Debug, Clone)]
pub(crate) struct PrepareManagedResourcesArgs {
    /// Bundle output root. Aioncore writes the managed resources under
    /// `<bundle-out>/{node,acp}/...` for packaging.
    #[arg(long)]
    pub bundle_out: PathBuf,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use clap::Parser;
    use clap::error::ErrorKind;

    use super::{
        Cli, Command, ConfigArgs, ConfigCommand, ManagedResourcesModeArg, PrepareManagedResourcesArgs, TeamCommand,
    };

    #[test]
    fn long_version_flag_uses_workspace_package_version() {
        let result = Cli::try_parse_from(["paviicore", "--version"]);
        let err = match result {
            Ok(_) => panic!("expected --version to exit through clap DisplayVersion"),
            Err(err) => err,
        };

        assert_eq!(err.kind(), ErrorKind::DisplayVersion);
        let rendered = err.to_string();
        assert!(
            rendered.contains("paviicore"),
            "version output should contain binary name, got: {rendered:?}"
        );
        assert!(
            rendered.contains(env!("CARGO_PKG_VERSION")),
            "version output should contain package version {}, got: {rendered:?}",
            env!("CARGO_PKG_VERSION")
        );
    }

    #[test]
    fn short_version_flag_uses_workspace_package_version() {
        let result = Cli::try_parse_from(["paviicore", "-V"]);
        let err = match result {
            Ok(_) => panic!("expected -V to exit through clap DisplayVersion"),
            Err(err) => err,
        };

        assert_eq!(err.kind(), ErrorKind::DisplayVersion);
        let rendered = err.to_string();
        assert!(
            rendered.contains("paviicore"),
            "version output should contain binary name, got: {rendered:?}"
        );
        assert!(
            rendered.contains(env!("CARGO_PKG_VERSION")),
            "version output should contain package version {}, got: {rendered:?}",
            env!("CARGO_PKG_VERSION")
        );
    }

    #[test]
    fn prepare_managed_resources_accepts_bundle_out() {
        let cli = Cli::parse_from([
            "paviicore",
            "prepare-managed-resources",
            "--bundle-out",
            "/tmp/paviicore-bundle",
        ]);

        match cli.command {
            Some(Command::PrepareManagedResources(args)) => {
                assert_eq!(args.bundle_out, std::path::Path::new("/tmp/paviicore-bundle"));
            }
            other => panic!("unexpected command parsed: {other:?}"),
        }
    }

    #[test]
    fn managed_resources_mode_defaults_to_download() {
        let cli = Cli::parse_from(["paviicore"]);
        assert_eq!(cli.managed_resources_mode, ManagedResourcesModeArg::Download);
    }

    #[test]
    fn managed_resources_mode_accepts_download() {
        let cli = Cli::parse_from(["paviicore", "--managed-resources-mode", "download"]);
        assert_eq!(cli.managed_resources_mode, ManagedResourcesModeArg::Download);
    }

    #[test]
    fn parent_pid_accepts_positive_integer() {
        let cli = Cli::parse_from(["paviicore", "--parent-pid", "4242"]);
        assert_eq!(cli.parent_pid, Some(4242));
    }

    #[test]
    fn dump_prompts_defaults_to_false() {
        let cli = Cli::parse_from(["paviicore"]);
        assert!(!cli.dump_prompts);
    }

    #[test]
    fn dump_prompts_accepts_flag() {
        let cli = Cli::parse_from(["paviicore", "--dump-prompts"]);
        assert!(cli.dump_prompts);
    }

    #[test]
    fn recover_corrupted_database_flag_defaults_to_false() {
        let cli = Cli::parse_from(["paviicore"]);
        assert!(!cli.recover_corrupted_database);
    }

    #[test]
    fn recover_corrupted_database_flag_is_accepted() {
        let cli = Cli::parse_from(["paviicore", "--recover-corrupted-database"]);
        assert!(cli.recover_corrupted_database);
    }

    #[test]
    fn command_as_str_returns_clap_subcommand_names() {
        let prepare_args = PrepareManagedResourcesArgs {
            bundle_out: PathBuf::from("/tmp/paviicore-bundle"),
        };

        let cases = [
            (
                Command::Config(ConfigArgs {
                    command: ConfigCommand::Context,
                }),
                "config",
            ),
            (Command::McpTeamStdio, "mcp-team-stdio"),
            (Command::AntigravityHook, "antigravity-hook"),
            (Command::Doctor, "doctor"),
            (
                Command::PrepareManagedResources(prepare_args),
                "prepare-managed-resources",
            ),
        ];

        for (command, expected) in cases {
            assert_eq!(command.as_str(), expected);
        }
    }

    #[test]
    fn config_cli_accepts_agent_facing_design_command_paths() {
        let commands: &[&[&str]] = &[
            &["paviicore", "config", "capabilities"],
            &["paviicore", "config", "context"],
            &["paviicore", "config", "conversation", "rename"],
            &["paviicore", "config", "assistants", "list"],
            &["paviicore", "config", "assistants", "get"],
            &["paviicore", "config", "assistants", "create"],
            &["paviicore", "config", "assistants", "update"],
            &["paviicore", "config", "assistants", "delete"],
            &["paviicore", "config", "assistants", "import"],
            &["paviicore", "config", "assistants", "state"],
            &["paviicore", "config", "assistants", "rule", "read"],
            &["paviicore", "config", "assistants", "rule", "write"],
            &["paviicore", "config", "assistants", "rule", "delete"],
            &["paviicore", "config", "assistants", "skill", "read"],
            &["paviicore", "config", "assistants", "skill", "write"],
            &["paviicore", "config", "assistants", "skill", "delete"],
            &["paviicore", "config", "skills", "list"],
            &["paviicore", "config", "skills", "info"],
            &["paviicore", "config", "skills", "paths"],
            &["paviicore", "config", "skills", "import"],
            &["paviicore", "config", "skills", "delete"],
            &["paviicore", "config", "skills", "scan"],
            &["paviicore", "config", "mcp", "servers", "list"],
            &["paviicore", "config", "mcp", "servers", "get"],
            &["paviicore", "config", "mcp", "servers", "create"],
            &["paviicore", "config", "mcp", "servers", "update"],
            &["paviicore", "config", "mcp", "servers", "delete"],
            &["paviicore", "config", "mcp", "servers", "toggle"],
            &["paviicore", "config", "mcp", "servers", "import"],
            &["paviicore", "config", "mcp", "test-connection"],
            &["paviicore", "config", "mcp", "agent-configs"],
            &["paviicore", "config", "mcp", "oauth", "check-status"],
            &["paviicore", "config", "mcp", "oauth", "login"],
            &["paviicore", "config", "mcp", "oauth", "logout"],
            &["paviicore", "config", "mcp", "oauth", "authenticated"],
            &["paviicore", "config", "providers", "list"],
            &["paviicore", "config", "providers", "create"],
            &["paviicore", "config", "providers", "update"],
            &["paviicore", "config", "providers", "delete"],
            &["paviicore", "config", "providers", "detect-protocol"],
            &["paviicore", "config", "providers", "fetch-models"],
            &["paviicore", "config", "providers", "models", "fetch"],
            &["paviicore", "config", "providers", "health-check"],
            &["paviicore", "config", "settings", "get"],
            &["paviicore", "config", "settings", "patch"],
            &["paviicore", "config", "settings", "client", "get"],
            &["paviicore", "config", "settings", "client", "put"],
            &["paviicore", "config", "agents", "list"],
            &["paviicore", "config", "agents", "enable"],
            &["paviicore", "config", "agents", "overrides", "get"],
            &["paviicore", "config", "agents", "overrides", "set"],
            &["paviicore", "config", "agents", "custom", "create"],
            &["paviicore", "config", "agents", "custom", "update"],
            &["paviicore", "config", "agents", "custom", "delete"],
            &["paviicore", "config", "agents", "custom", "try-connect"],
            &["paviicore", "config", "cron", "jobs", "list"],
            &["paviicore", "config", "cron", "jobs", "get"],
            &["paviicore", "config", "cron", "jobs", "create"],
            &["paviicore", "config", "cron", "jobs", "update"],
            &["paviicore", "config", "cron", "jobs", "delete"],
            &["paviicore", "config", "cron", "jobs", "run"],
            &["paviicore", "config", "cron", "jobs", "skill", "get"],
            &["paviicore", "config", "cron", "jobs", "skill", "save"],
            &["paviicore", "config", "cron", "jobs", "skill", "delete"],
            &["paviicore", "config", "skills", "external-paths", "list"],
            &["paviicore", "config", "skills", "external-paths", "add"],
            &["paviicore", "config", "skills", "external-paths", "remove"],
            &["paviicore", "config", "skills", "market", "enable"],
            &["paviicore", "config", "skills", "market", "disable"],
        ];

        for command in commands {
            let result = Cli::try_parse_from(*command);
            assert!(result.is_ok(), "command should parse: {command:?}");
        }
    }

    /// Resolves a `team ...` argv to its parsed subcommand, or `None` when clap
    /// swallowed it into `TeamCommand::Unknown`.
    ///
    /// `Unknown` is an `external_subcommand`, so a missing subcommand still
    /// parses successfully — asserting `is_ok()` alone proves nothing about
    /// whether the command is actually wired.
    fn parse_team_command(argv: &[&str]) -> Option<TeamCommand> {
        let cli = Cli::try_parse_from(argv).ok()?;
        let Some(Command::Team(args)) = cli.command else {
            return None;
        };
        match args.command {
            TeamCommand::Unknown(_) => None,
            command => Some(command),
        }
    }

    /// Every tool in the shared Team registry advertises a `cli_command`, and
    /// that path is printed by `team capabilities`, `team help`, and the CLI
    /// transport prompt. A tool present in the registry but missing from
    /// `TeamCommand` sends agents at a command that can only fail, so the
    /// registry is the source of truth for this test rather than a hand-kept
    /// list that drifts when a tool is added.
    #[test]
    fn every_registry_tool_has_a_wired_team_cli_subcommand() {
        for tool in aionui_api_types::team_tool_descriptors() {
            let mut argv = vec!["paviicore", "team"];
            argv.extend(tool.cli_command.iter().map(String::as_str));
            assert!(
                parse_team_command(&argv).is_some(),
                "`{}` is advertised by tool {} but is not wired into TeamCommand",
                argv[1..].join(" "),
                tool.name
            );
        }
    }

    #[test]
    fn team_cli_accepts_agent_facing_command_paths() {
        // Registry-independent commands; the tool-backed paths are covered by
        // `every_registry_tool_has_a_wired_team_cli_subcommand`.
        let commands: &[&[&str]] = &[
            &["paviicore", "team", "capabilities"],
            &["paviicore", "team", "help"],
            &["paviicore", "team", "context"],
        ];

        for command in commands {
            assert!(
                parse_team_command(command).is_some(),
                "command should parse to a wired subcommand: {command:?}"
            );
        }
    }

    #[test]
    fn unwired_team_subcommand_is_reported_as_unknown() {
        assert!(
            parse_team_command(&["paviicore", "team", "definitely-not-a-command"]).is_none(),
            "the guard above only works if an unwired path resolves to Unknown"
        );
    }

    #[test]
    fn prepare_managed_resources_requires_bundle_out() {
        let err = match Cli::try_parse_from(["paviicore", "prepare-managed-resources"]) {
            Ok(_) => panic!("prepare-managed-resources should require --bundle-out"),
            Err(err) => err,
        };
        assert_eq!(err.kind(), clap::error::ErrorKind::MissingRequiredArgument);
    }
}
