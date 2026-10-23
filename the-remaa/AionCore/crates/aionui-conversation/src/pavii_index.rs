//! Best-effort per-project session index at `<workspace>/.pavii/sessions.json`.
//!
//! The desktop reads this file to show which Pavii conversations (and which
//! agent-CLI sessions) belong to a project folder. It is written only for
//! user-supplied workspaces — never for the engine's auto-provisioned temp
//! workspaces under `<workspace_root>/conversations/` — and every failure is
//! warn-logged and swallowed: the index must never fail a request or a turn.
//!
//! The JSON shape (camelCase, `version: 1`) is the desktop contract
//! `PaviiSessionsFile` in `packages/desktop/src/common/types/agent/paviiData.ts`.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use aionui_common::{TimestampMs, now_ms};
use aionui_db::models::{AcpSessionRow, ConversationRow};
use aionui_db::{
    CreateAcpSessionParams, DbError, IAcpSessionRepository, IConversationRepository, PersistedSessionState,
    SaveRuntimeStateParams,
};
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

const PAVII_DIR: &str = ".pavii";
const SESSIONS_FILE: &str = "sessions.json";
const SESSIONS_TMP_FILE: &str = "sessions.json.tmp";
const GITIGNORE_FILE: &str = ".gitignore";
const GITIGNORE_CONTENT: &str = "*\n";
const SESSIONS_FILE_VERSION: u32 = 1;

/// `extra.import_source` values the desktop importer sets at create time.
const IMPORT_SOURCES: &[&str] = &["claude-import", "codex-import"];
const DEFAULT_SOURCE: &str = "pavii";

/// Serializes read-modify-write cycles on `sessions.json` within this process
/// (several conversations may share one workspace, and they share the tmp name).
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// One entry of `.pavii/sessions.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaviiSessionEntry {
    pub conversation_id: String,
    pub title: String,
    pub agent_id: Option<String>,
    pub backend: Option<String>,
    pub backend_session_id: Option<String>,
    pub source: String,
    pub created_at: TimestampMs,
    pub last_active_at: TimestampMs,
}

#[derive(Debug, Serialize, Deserialize)]
struct PaviiSessionsFile {
    version: u32,
    sessions: Vec<PaviiSessionEntry>,
}

/// Whether `workspace` is one of the engine's auto-provisioned temp
/// workspaces (all of which live under `<workspace_root>/conversations/`).
fn is_engine_workspace(workspace_root: &Path, workspace: &Path) -> bool {
    workspace.starts_with(workspace_root.join("conversations"))
}

fn extra_str<'a>(extra: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    extra
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// Build the index entry for a conversation, or `None` when it has no
/// user-supplied workspace. `backend_session_id` overrides the stored anchor.
fn entry_for_conversation(
    workspace_root: &Path,
    row: &ConversationRow,
    acp_row: Option<&AcpSessionRow>,
    backend_session_id: Option<&str>,
    last_active_at: TimestampMs,
) -> Option<(PathBuf, PaviiSessionEntry)> {
    let extra: serde_json::Value = serde_json::from_str(&row.extra).ok()?;
    let workspace = PathBuf::from(extra_str(&extra, "workspace")?);
    if is_engine_workspace(workspace_root, &workspace) {
        return None;
    }
    let agent_id = acp_row
        .map(|acp| acp.agent_id.trim())
        .filter(|id| !id.is_empty())
        .or_else(|| extra_str(&extra, "agent_id"))
        .map(str::to_owned);
    let source = extra_str(&extra, "import_source")
        .filter(|source| IMPORT_SOURCES.contains(source))
        .unwrap_or(DEFAULT_SOURCE)
        .to_owned();
    let backend_session_id = backend_session_id
        .map(str::to_owned)
        .or_else(|| acp_row.and_then(|acp| acp.session_id.clone()));
    let entry = PaviiSessionEntry {
        conversation_id: row.id.clone(),
        title: row.name.clone(),
        agent_id,
        backend: extra_str(&extra, "backend").map(str::to_owned),
        backend_session_id,
        source,
        created_at: row.created_at,
        last_active_at,
    };
    Some((workspace, entry))
}

/// Insert or replace `entry` in `<workspace>/.pavii/sessions.json` and make
/// sure `.pavii/.gitignore` exists. Returns the parse error when an existing
/// file was malformed and has been rewritten with just this entry.
fn write_entry(workspace: &Path, entry: &PaviiSessionEntry) -> std::io::Result<Option<String>> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let dir = workspace.join(PAVII_DIR);
    // `create_dir` (not `_all`): a workspace that vanished must not be recreated.
    match std::fs::create_dir(&dir) {
        Ok(()) => {}
        Err(err) if err.kind() == ErrorKind::AlreadyExists => {}
        Err(err) => return Err(err),
    }
    let gitignore = dir.join(GITIGNORE_FILE);
    if !gitignore.exists() {
        std::fs::write(&gitignore, GITIGNORE_CONTENT)?;
    }

    let path = dir.join(SESSIONS_FILE);
    let mut malformed = None;
    let mut file = match std::fs::read(&path) {
        Ok(bytes) => match serde_json::from_slice::<PaviiSessionsFile>(&bytes) {
            Ok(file) if file.version == SESSIONS_FILE_VERSION => file,
            Ok(file) => {
                malformed = Some(format!("unsupported version {}", file.version));
                PaviiSessionsFile::empty()
            }
            Err(err) => {
                malformed = Some(err.to_string());
                PaviiSessionsFile::empty()
            }
        },
        Err(err) if err.kind() == ErrorKind::NotFound => PaviiSessionsFile::empty(),
        Err(err) => return Err(err),
    };

    match file
        .sessions
        .iter_mut()
        .find(|existing| existing.conversation_id == entry.conversation_id)
    {
        Some(existing) => *existing = entry.clone(),
        None => file.sessions.push(entry.clone()),
    }

    let bytes = serde_json::to_vec_pretty(&file).map_err(std::io::Error::other)?;
    let tmp = dir.join(SESSIONS_TMP_FILE);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;
    Ok(malformed)
}

impl PaviiSessionsFile {
    fn empty() -> Self {
        Self {
            version: SESSIONS_FILE_VERSION,
            sessions: Vec::new(),
        }
    }
}

/// Upsert the conversation's entry into its workspace's `.pavii/sessions.json`.
///
/// Best-effort: no-op for conversations without a user-supplied workspace;
/// any failure is warn-logged (conversation id + error only) and swallowed.
/// `backend_session_id` is the freshly bound CLI session id, when known;
/// otherwise the stored `acp_session.session_id` is used.
pub(crate) async fn sync_conversation_entry(
    conversations: &dyn IConversationRepository,
    acp_sessions: &dyn IAcpSessionRepository,
    workspace_root: &Path,
    user_id: &str,
    conversation_id: &str,
    backend_session_id: Option<&str>,
) {
    let row = match conversations.get(user_id, conversation_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return,
        Err(err) => {
            warn!(conversation_id, error = %err, "pavii index: conversation lookup failed");
            return;
        }
    };
    let acp_row = match acp_sessions.get_for_user(user_id, conversation_id).await {
        Ok(acp_row) => acp_row,
        Err(err) => {
            warn!(conversation_id, error = %err, "pavii index: acp_session lookup failed");
            None
        }
    };
    let Some((workspace, entry)) =
        entry_for_conversation(workspace_root, &row, acp_row.as_ref(), backend_session_id, now_ms())
    else {
        return;
    };

    let result = tokio::task::spawn_blocking(move || write_entry(&workspace, &entry)).await;
    match result {
        Ok(Ok(None)) => debug!(conversation_id, "pavii index: session entry written"),
        Ok(Ok(Some(parse_error))) => warn!(
            conversation_id,
            error = %parse_error,
            "pavii index: malformed sessions.json rewritten with this entry only"
        ),
        Ok(Err(err)) => warn!(conversation_id, error = %err, "pavii index: write failed"),
        Err(err) => warn!(conversation_id, error = %err, "pavii index: write task failed"),
    }
}

/// `IAcpSessionRepository` decorator that mirrors every successful backend
/// session bind (`update_session_id_for_user`) into `.pavii/sessions.json`.
///
/// The bind sites — the direct-CLI session pump and `AcpSessionSyncService`
/// in `aionui-ai-agent` — sit below this crate and cannot see workspaces, so
/// the hook rides the repository they already write through. Every other
/// method forwards unchanged.
pub struct PaviiIndexedAcpSessionRepository {
    inner: Arc<dyn IAcpSessionRepository>,
    conversations: Arc<dyn IConversationRepository>,
    workspace_root: PathBuf,
}

impl PaviiIndexedAcpSessionRepository {
    pub fn new(
        inner: Arc<dyn IAcpSessionRepository>,
        conversations: Arc<dyn IConversationRepository>,
        workspace_root: PathBuf,
    ) -> Self {
        Self {
            inner,
            conversations,
            workspace_root,
        }
    }
}

#[async_trait::async_trait]
impl IAcpSessionRepository for PaviiIndexedAcpSessionRepository {
    async fn get_for_user(&self, user_id: &str, conversation_id: &str) -> Result<Option<AcpSessionRow>, DbError> {
        self.inner.get_for_user(user_id, conversation_id).await
    }

    async fn create(&self, params: &CreateAcpSessionParams<'_>) -> Result<AcpSessionRow, DbError> {
        self.inner.create(params).await
    }

    async fn update_session_id_for_user(
        &self,
        user_id: &str,
        conversation_id: &str,
        session_id: &str,
    ) -> Result<bool, DbError> {
        let updated = self
            .inner
            .update_session_id_for_user(user_id, conversation_id, session_id)
            .await?;
        if updated {
            sync_conversation_entry(
                self.conversations.as_ref(),
                self.inner.as_ref(),
                &self.workspace_root,
                user_id,
                conversation_id,
                Some(session_id),
            )
            .await;
        }
        Ok(updated)
    }

    async fn clear_session_id_for_user(&self, user_id: &str, conversation_id: &str) -> Result<bool, DbError> {
        self.inner.clear_session_id_for_user(user_id, conversation_id).await
    }

    async fn delete_for_user(&self, user_id: &str, conversation_id: &str) -> Result<bool, DbError> {
        self.inner.delete_for_user(user_id, conversation_id).await
    }

    async fn load_runtime_state_for_user(
        &self,
        user_id: &str,
        conversation_id: &str,
    ) -> Result<Option<PersistedSessionState>, DbError> {
        self.inner.load_runtime_state_for_user(user_id, conversation_id).await
    }

    async fn save_runtime_state_for_user(
        &self,
        user_id: &str,
        conversation_id: &str,
        params: &SaveRuntimeStateParams<'_>,
    ) -> Result<bool, DbError> {
        self.inner
            .save_runtime_state_for_user(user_id, conversation_id, params)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aionui_db::{SqliteAcpSessionRepository, SqliteConversationRepository, init_database_memory};

    const USER: &str = "user-pavii-index";

    struct Fixture {
        _db: aionui_db::Database,
        conversations: Arc<dyn IConversationRepository>,
        acp_sessions: Arc<dyn IAcpSessionRepository>,
        /// Engine work dir; auto workspaces live under `<root>/conversations`.
        root: tempfile::TempDir,
        /// A user-chosen project folder.
        workspace: tempfile::TempDir,
    }

    async fn fixture() -> Fixture {
        let db = init_database_memory().await.unwrap();
        let pool = db.pool().clone();
        sqlx::query(
            "INSERT OR IGNORE INTO users \
                (id, user_type, username, password_hash, status, session_generation, created_at, updated_at) \
             VALUES (?, 'local', ?, 'hash', 'active', 0, 0, 0)",
        )
        .bind(USER)
        .bind(USER)
        .execute(&pool)
        .await
        .unwrap();
        Fixture {
            conversations: Arc::new(SqliteConversationRepository::new(pool.clone())),
            acp_sessions: Arc::new(SqliteAcpSessionRepository::new(pool)),
            _db: db,
            root: tempfile::tempdir().unwrap(),
            workspace: tempfile::tempdir().unwrap(),
        }
    }

    impl Fixture {
        async fn insert_conversation(&self, id: &str, name: &str, extra: serde_json::Value) {
            let row = ConversationRow {
                id: id.into(),
                user_id: USER.into(),
                name: name.into(),
                r#type: "acp".into(),
                extra: extra.to_string(),
                model: None,
                status: Some("pending".into()),
                source: Some("aionui".into()),
                channel_chat_id: None,
                pinned: false,
                pinned_at: None,
                created_at: 1_700_000_000_000,
                updated_at: 1_700_000_000_000,
                project_id: None,
                folder_id: None,
                name_source: None,
            };
            self.conversations.create(&row).await.unwrap();
        }

        async fn insert_acp_session(&self, id: &str, agent_id: &str) {
            self.acp_sessions
                .create(&CreateAcpSessionParams {
                    user_id: USER,
                    conversation_id: id,
                    agent_source: "builtin",
                    agent_id,
                })
                .await
                .unwrap();
        }

        async fn sync(&self, id: &str, backend_session_id: Option<&str>) {
            sync_conversation_entry(
                self.conversations.as_ref(),
                self.acp_sessions.as_ref(),
                self.root.path(),
                USER,
                id,
                backend_session_id,
            )
            .await;
        }

        fn decorated(&self) -> PaviiIndexedAcpSessionRepository {
            PaviiIndexedAcpSessionRepository::new(
                self.acp_sessions.clone(),
                self.conversations.clone(),
                self.root.path().to_path_buf(),
            )
        }

        fn workspace_str(&self) -> String {
            self.workspace.path().to_string_lossy().into_owned()
        }

        fn pavii_dir(&self) -> PathBuf {
            self.workspace.path().join(PAVII_DIR)
        }

        fn read_sessions(&self) -> serde_json::Value {
            let bytes = std::fs::read(self.pavii_dir().join(SESSIONS_FILE)).expect("sessions.json should exist");
            serde_json::from_slice(&bytes).expect("sessions.json should be valid JSON")
        }
    }

    #[tokio::test]
    async fn create_writes_camel_case_sessions_file_and_gitignore() {
        let fx = fixture().await;
        fx.insert_conversation(
            "conv-a",
            "First chat",
            serde_json::json!({ "workspace": fx.workspace_str(), "backend": "claude" }),
        )
        .await;
        fx.insert_acp_session("conv-a", "2d23ff1c").await;

        fx.sync("conv-a", None).await;

        let gitignore = std::fs::read_to_string(fx.pavii_dir().join(GITIGNORE_FILE)).unwrap();
        assert_eq!(gitignore, "*\n");
        assert!(
            !fx.pavii_dir().join(SESSIONS_TMP_FILE).exists(),
            "tmp file must be renamed away"
        );

        let file = fx.read_sessions();
        assert_eq!(file["version"], 1);
        let sessions = file["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        let entry = &sessions[0];
        assert_eq!(entry["conversationId"], "conv-a");
        assert_eq!(entry["title"], "First chat");
        assert_eq!(entry["agentId"], "2d23ff1c");
        assert_eq!(entry["backend"], "claude");
        assert_eq!(entry["backendSessionId"], serde_json::Value::Null);
        assert_eq!(entry["source"], "pavii");
        assert_eq!(entry["createdAt"], 1_700_000_000_000_i64);
        assert!(entry["lastActiveAt"].as_i64().unwrap() > 0);
        // No snake_case keys leak into the desktop contract.
        assert!(entry.get("conversation_id").is_none());
        assert!(entry.get("backend_session_id").is_none());
    }

    #[tokio::test]
    async fn existing_gitignore_is_left_untouched() {
        let fx = fixture().await;
        std::fs::create_dir(fx.pavii_dir()).unwrap();
        std::fs::write(fx.pavii_dir().join(GITIGNORE_FILE), "custom\n").unwrap();
        fx.insert_conversation("conv-a", "t", serde_json::json!({ "workspace": fx.workspace_str() }))
            .await;

        fx.sync("conv-a", None).await;

        assert_eq!(
            std::fs::read_to_string(fx.pavii_dir().join(GITIGNORE_FILE)).unwrap(),
            "custom\n"
        );
        assert_eq!(fx.read_sessions()["sessions"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn second_write_upserts_same_conversation_without_duplicates() {
        let fx = fixture().await;
        let extra = serde_json::json!({ "workspace": fx.workspace_str(), "backend": "claude" });
        fx.insert_conversation("conv-a", "A", extra.clone()).await;
        fx.insert_conversation("conv-b", "B", extra).await;
        fx.insert_acp_session("conv-a", "2d23ff1c").await;

        fx.sync("conv-a", None).await;
        fx.sync("conv-b", None).await;
        fx.sync("conv-a", Some("11111111-2222-3333-4444-555555555555")).await;

        let file = fx.read_sessions();
        let sessions = file["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 2, "one entry per conversation: {file}");
        let a: Vec<_> = sessions.iter().filter(|s| s["conversationId"] == "conv-a").collect();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0]["backendSessionId"], "11111111-2222-3333-4444-555555555555");
        // conv-b survives the conv-a rewrite.
        assert!(sessions.iter().any(|s| s["conversationId"] == "conv-b"));
    }

    #[tokio::test]
    async fn stored_acp_session_id_is_used_when_no_override_given() {
        let fx = fixture().await;
        fx.insert_conversation("conv-a", "A", serde_json::json!({ "workspace": fx.workspace_str() }))
            .await;
        fx.insert_acp_session("conv-a", "2d23ff1c").await;
        fx.acp_sessions
            .update_session_id_for_user(USER, "conv-a", "stored-session")
            .await
            .unwrap();

        fx.sync("conv-a", None).await;

        assert_eq!(fx.read_sessions()["sessions"][0]["backendSessionId"], "stored-session");
    }

    #[tokio::test]
    async fn agent_id_falls_back_to_extra_without_acp_row() {
        let fx = fixture().await;
        fx.insert_conversation(
            "conv-a",
            "A",
            serde_json::json!({ "workspace": fx.workspace_str(), "agent_id": "extra-agent" }),
        )
        .await;

        fx.sync("conv-a", None).await;

        let entry = &fx.read_sessions()["sessions"][0];
        assert_eq!(entry["agentId"], "extra-agent");
        assert_eq!(entry["backend"], serde_json::Value::Null);
        assert_eq!(entry["backendSessionId"], serde_json::Value::Null);
    }

    #[tokio::test]
    async fn malformed_sessions_file_is_rewritten_with_only_the_new_entry() {
        let fx = fixture().await;
        std::fs::create_dir(fx.pavii_dir()).unwrap();
        std::fs::write(fx.pavii_dir().join(SESSIONS_FILE), b"{ not json").unwrap();
        fx.insert_conversation("conv-a", "A", serde_json::json!({ "workspace": fx.workspace_str() }))
            .await;

        fx.sync("conv-a", None).await;

        let file = fx.read_sessions();
        assert_eq!(file["version"], 1);
        let sessions = file["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["conversationId"], "conv-a");
    }

    #[tokio::test]
    async fn unsupported_version_file_is_replaced() {
        let fx = fixture().await;
        std::fs::create_dir(fx.pavii_dir()).unwrap();
        let other = serde_json::json!({
            "version": 2,
            "sessions": [{
                "conversationId": "old", "title": "old", "agentId": null, "backend": null,
                "backendSessionId": null, "source": "pavii", "createdAt": 1, "lastActiveAt": 1
            }]
        });
        std::fs::write(fx.pavii_dir().join(SESSIONS_FILE), other.to_string()).unwrap();
        fx.insert_conversation("conv-a", "A", serde_json::json!({ "workspace": fx.workspace_str() }))
            .await;

        fx.sync("conv-a", None).await;

        let file = fx.read_sessions();
        assert_eq!(file["version"], 1);
        let sessions = file["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["conversationId"], "conv-a");
    }

    #[tokio::test]
    async fn engine_temp_workspace_is_skipped() {
        let fx = fixture().await;
        let temp_ws = fx.root.path().join("conversations").join("2026").join("acp-temp-x");
        std::fs::create_dir_all(&temp_ws).unwrap();
        fx.insert_conversation(
            "conv-a",
            "A",
            serde_json::json!({ "workspace": temp_ws.to_string_lossy() }),
        )
        .await;

        fx.sync("conv-a", Some("sid")).await;

        assert!(
            !temp_ws.join(PAVII_DIR).exists(),
            "engine workspace must not get a .pavii dir"
        );
    }

    #[tokio::test]
    async fn conversation_without_workspace_writes_nothing() {
        let fx = fixture().await;
        fx.insert_conversation("conv-a", "A", serde_json::json!({ "workspace": "   " }))
            .await;
        fx.insert_conversation("conv-b", "B", serde_json::json!({})).await;

        fx.sync("conv-a", None).await;
        fx.sync("conv-b", None).await;
        // Unknown conversation: silently ignored.
        fx.sync("conv-missing", None).await;

        assert!(!fx.pavii_dir().exists());
    }

    #[tokio::test]
    async fn missing_workspace_directory_is_not_created() {
        let fx = fixture().await;
        let gone = fx.workspace.path().join("deleted-project");
        fx.insert_conversation(
            "conv-a",
            "A",
            serde_json::json!({ "workspace": gone.to_string_lossy() }),
        )
        .await;

        fx.sync("conv-a", None).await;

        assert!(!gone.exists(), "a vanished workspace must not be recreated");
    }

    #[tokio::test]
    async fn source_comes_from_known_import_source_else_pavii() {
        let fx = fixture().await;
        let cases = [
            ("conv-claude", Some("claude-import"), "claude-import"),
            ("conv-codex", Some("codex-import"), "codex-import"),
            ("conv-unknown", Some("gemini-import"), "pavii"),
            ("conv-blank", Some("  "), "pavii"),
            ("conv-none", None, "pavii"),
        ];
        for (id, import_source, _) in cases {
            let mut extra = serde_json::json!({ "workspace": fx.workspace_str() });
            if let Some(source) = import_source {
                extra["import_source"] = serde_json::Value::String(source.into());
            }
            fx.insert_conversation(id, id, extra).await;
            fx.sync(id, None).await;
        }

        let file = fx.read_sessions();
        let sessions = file["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), cases.len());
        for (id, _, expected) in cases {
            let entry = sessions
                .iter()
                .find(|s| s["conversationId"] == id)
                .unwrap_or_else(|| panic!("missing {id} in {file}"));
            assert_eq!(entry["source"], expected, "source for {id}");
        }
    }

    #[tokio::test]
    async fn decorator_mirrors_backend_session_bind_into_index() {
        let fx = fixture().await;
        fx.insert_conversation(
            "conv-a",
            "A",
            serde_json::json!({ "workspace": fx.workspace_str(), "backend": "claude" }),
        )
        .await;
        fx.insert_acp_session("conv-a", "2d23ff1c").await;
        let decorated = fx.decorated();

        let updated = decorated
            .update_session_id_for_user(USER, "conv-a", "11111111-2222-3333-4444-555555555555")
            .await
            .unwrap();

        assert!(updated);
        let entry = &fx.read_sessions()["sessions"][0];
        assert_eq!(entry["conversationId"], "conv-a");
        assert_eq!(entry["backendSessionId"], "11111111-2222-3333-4444-555555555555");
        // The bind also reached the database through the inner repository.
        let row = decorated.get_for_user(USER, "conv-a").await.unwrap().unwrap();
        assert_eq!(row.session_id.as_deref(), Some("11111111-2222-3333-4444-555555555555"));
    }

    #[tokio::test]
    async fn decorator_writes_nothing_when_bind_updates_no_row() {
        let fx = fixture().await;
        // Conversation with a workspace but no acp_session row.
        fx.insert_conversation("conv-a", "A", serde_json::json!({ "workspace": fx.workspace_str() }))
            .await;

        let updated = fx
            .decorated()
            .update_session_id_for_user(USER, "conv-a", "sid")
            .await
            .unwrap();

        assert!(!updated);
        assert!(!fx.pavii_dir().exists());
    }

    #[tokio::test]
    async fn decorator_forwards_clear_and_delete_to_inner() {
        let fx = fixture().await;
        fx.insert_conversation("conv-a", "A", serde_json::json!({})).await;
        fx.insert_acp_session("conv-a", "2d23ff1c").await;
        let decorated = fx.decorated();
        decorated
            .update_session_id_for_user(USER, "conv-a", "sid")
            .await
            .unwrap();

        assert!(decorated.clear_session_id_for_user(USER, "conv-a").await.unwrap());
        assert_eq!(
            fx.acp_sessions
                .get_for_user(USER, "conv-a")
                .await
                .unwrap()
                .unwrap()
                .session_id,
            None
        );
        assert!(decorated.delete_for_user(USER, "conv-a").await.unwrap());
        assert!(fx.acp_sessions.get_for_user(USER, "conv-a").await.unwrap().is_none());
    }
}
