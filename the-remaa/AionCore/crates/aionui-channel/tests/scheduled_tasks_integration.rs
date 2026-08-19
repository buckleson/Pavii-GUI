//! Integration tests for reading scheduled tasks from a channel.
//!
//! Real in-memory SQLite: the ordering and owner scoping being asserted here
//! are properties of the query, not of the rendering.

use std::sync::Arc;

use aionui_common::{TimestampMs, now_ms};
use aionui_db::models::{ConversationRow, CronJobRow};
use aionui_db::{
    IConversationRepository, ICronRepository, IUserRepository, SqliteConversationRepository, SqliteCronRepository,
    SqliteUserRepository, init_database_memory,
};

use aionui_channel::scheduled_tasks::{ScheduledTaskDirectory, TASKS_LISTED, tasks_text};

const OWNER_ID: &str = "system_default_user";

struct Harness {
    directory: ScheduledTaskDirectory,
    jobs: Arc<dyn ICronRepository>,
    users: Arc<dyn IUserRepository>,
    conversations: Arc<dyn IConversationRepository>,
    _db: aionui_db::Database,
}

async fn setup() -> Harness {
    let db = init_database_memory().await.unwrap();
    let jobs: Arc<dyn ICronRepository> = Arc::new(SqliteCronRepository::new(db.pool().clone()));
    let users: Arc<dyn IUserRepository> = Arc::new(SqliteUserRepository::new(db.pool().clone()));
    let conversations: Arc<dyn IConversationRepository> =
        Arc::new(SqliteConversationRepository::new(db.pool().clone()));
    Harness {
        directory: ScheduledTaskDirectory::new(Arc::clone(&jobs)),
        jobs,
        users,
        conversations,
        _db: db,
    }
}

/// `cron_jobs.conversation_id` is a foreign key, so every job needs a real
/// conversation behind it.
async fn conversation_for(harness: &Harness, user_id: &str) -> String {
    let id = aionui_common::generate_id();
    harness
        .conversations
        .create(&ConversationRow {
            id: id.clone(),
            user_id: user_id.to_owned(),
            name: "Cron conversation".to_owned(),
            r#type: "aionrs".to_owned(),
            extra: "{}".to_owned(),
            model: None,
            status: Some("finished".to_owned()),
            source: Some("aionui".to_owned()),
            channel_chat_id: None,
            pinned: false,
            pinned_at: None,
            created_at: now_ms(),
            updated_at: now_ms(),
            project_id: None,
            folder_id: None,
            name_source: None,
        })
        .await
        .unwrap();
    id
}

fn job(name: &str, user_id: &str, conversation_id: String) -> CronJobRow {
    let now = now_ms();
    CronJobRow {
        id: aionui_common::generate_prefixed_id("cron"),
        user_id: user_id.to_owned(),
        name: name.to_owned(),
        enabled: true,
        schedule_kind: "every".to_owned(),
        schedule_value: "3600000".to_owned(),
        schedule_tz: None,
        schedule_description: None,
        payload_message: "do the thing".to_owned(),
        execution_mode: "existing".to_owned(),
        agent_config: None,
        conversation_id,
        conversation_title: None,
        created_by: "user".to_owned(),
        skill_content: None,
        description: None,
        created_at: now,
        updated_at: now,
        next_run_at: Some(now + 3_600_000),
        last_run_at: None,
        last_status: None,
        last_error: None,
        run_count: 0,
        retry_count: 0,
        max_retries: 3,
        queue_enabled: false,
    }
}

#[tokio::test]
async fn no_tasks_reads_as_empty_not_an_error() {
    let harness = setup().await;

    let (entries, truncated) = harness.directory.list(OWNER_ID).await.unwrap();

    assert!(entries.is_empty());
    assert!(!truncated);
    assert!(tasks_text(&entries, now_ms(), truncated).contains("No scheduled tasks"));
}

#[tokio::test]
async fn lists_the_owners_tasks_with_their_schedule() {
    let harness = setup().await;
    harness
        .jobs
        .insert(&job(
            "Nightly digest",
            OWNER_ID,
            conversation_for(&harness, OWNER_ID).await,
        ))
        .await
        .unwrap();

    let (entries, _) = harness.directory.list(OWNER_ID).await.unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "Nightly digest");
    assert_eq!(entries[0].schedule, "every 1h");
    assert!(entries[0].enabled);
}

#[tokio::test]
async fn a_description_is_preferred_over_the_raw_schedule() {
    let harness = setup().await;
    let mut row = job("Weekday standup", OWNER_ID, conversation_for(&harness, OWNER_ID).await);
    row.schedule_kind = "cron".to_owned();
    row.schedule_value = "0 9 * * 1-5".to_owned();
    row.schedule_description = Some("Weekday mornings".to_owned());
    harness.jobs.insert(&row).await.unwrap();

    let (entries, _) = harness.directory.list(OWNER_ID).await.unwrap();

    assert_eq!(entries[0].schedule, "Weekday mornings");
}

#[tokio::test]
async fn a_paused_task_is_listed_but_marked_paused() {
    // Hiding it would make a silently-disabled automation invisible, which is
    // the thing you most want to notice.
    let harness = setup().await;
    let mut row = job("Paused job", OWNER_ID, conversation_for(&harness, OWNER_ID).await);
    row.enabled = false;
    harness.jobs.insert(&row).await.unwrap();

    let (entries, truncated) = harness.directory.list(OWNER_ID).await.unwrap();

    assert_eq!(entries.len(), 1);
    assert!(!entries[0].enabled);
    assert!(tasks_text(&entries, now_ms(), truncated).contains("paused"));
}

#[tokio::test]
async fn a_missed_run_reads_as_due_rather_than_negative() {
    let harness = setup().await;
    let now = now_ms();
    let mut row = job("Overdue", OWNER_ID, conversation_for(&harness, OWNER_ID).await);
    row.next_run_at = Some(now - 3_600_000);
    harness.jobs.insert(&row).await.unwrap();

    let (entries, truncated) = harness.directory.list(OWNER_ID).await.unwrap();
    let text = tasks_text(&entries, now, truncated);

    assert!(text.contains("due now"), "unexpected text: {text}");
    assert!(!text.contains("in -"), "a past run must not render as a negative wait");
}

#[tokio::test]
async fn a_task_with_no_next_run_is_still_listed() {
    let harness = setup().await;
    let mut row = job("Unscheduled", OWNER_ID, conversation_for(&harness, OWNER_ID).await);
    row.next_run_at = None;
    harness.jobs.insert(&row).await.unwrap();

    let (entries, truncated) = harness.directory.list(OWNER_ID).await.unwrap();

    assert_eq!(entries.len(), 1);
    assert!(tasks_text(&entries, now_ms(), truncated).contains("not scheduled"));
}

#[tokio::test]
async fn soonest_first_then_unscheduled_then_paused() {
    let harness = setup().await;
    let now = now_ms();

    let mut later = job("Later", OWNER_ID, conversation_for(&harness, OWNER_ID).await);
    later.next_run_at = Some(now + 7_200_000);
    harness.jobs.insert(&later).await.unwrap();

    let mut paused = job("Paused", OWNER_ID, conversation_for(&harness, OWNER_ID).await);
    paused.enabled = false;
    harness.jobs.insert(&paused).await.unwrap();

    let mut unscheduled = job("Unscheduled", OWNER_ID, conversation_for(&harness, OWNER_ID).await);
    unscheduled.next_run_at = None;
    harness.jobs.insert(&unscheduled).await.unwrap();

    let mut sooner = job("Sooner", OWNER_ID, conversation_for(&harness, OWNER_ID).await);
    sooner.next_run_at = Some(now + 60_000);
    harness.jobs.insert(&sooner).await.unwrap();

    let (entries, _) = harness.directory.list(OWNER_ID).await.unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

    assert_eq!(names, vec!["Sooner", "Later", "Unscheduled", "Paused"]);
}

#[tokio::test]
async fn the_listing_is_capped_and_says_so() {
    let harness = setup().await;
    let now = now_ms();
    for i in 0..(TASKS_LISTED + 5) {
        let mut row = job(
            &format!("Task {i}"),
            OWNER_ID,
            conversation_for(&harness, OWNER_ID).await,
        );
        row.next_run_at = Some(now + 60_000 + i as TimestampMs);
        harness.jobs.insert(&row).await.unwrap();
    }

    let (entries, truncated) = harness.directory.list(OWNER_ID).await.unwrap();

    assert_eq!(entries.len(), TASKS_LISTED);
    assert!(truncated);
    assert!(tasks_text(&entries, now, truncated).contains("Showing the first"));
}

#[tokio::test]
async fn another_owners_tasks_are_not_listed() {
    let harness = setup().await;
    // cron_jobs.user_id is a foreign key into users, so the second owner
    // has to be a real one.
    let other = harness.users.create_user("someone_else", "hash").await.unwrap();

    harness
        .jobs
        .insert(&job("Mine", OWNER_ID, conversation_for(&harness, OWNER_ID).await))
        .await
        .unwrap();
    harness
        .jobs
        .insert(&job("Theirs", &other.id, conversation_for(&harness, &other.id).await))
        .await
        .unwrap();

    let (mine, _) = harness.directory.list(OWNER_ID).await.unwrap();
    let (theirs, _) = harness.directory.list(&other.id).await.unwrap();

    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].name, "Mine");
    assert_eq!(theirs.len(), 1);
    assert_eq!(theirs[0].name, "Theirs");
}

#[tokio::test]
async fn an_unknown_owner_gets_an_empty_list_not_everything() {
    let harness = setup().await;
    harness
        .jobs
        .insert(&job("Mine", OWNER_ID, conversation_for(&harness, OWNER_ID).await))
        .await
        .unwrap();

    let (entries, _) = harness.directory.list("nobody").await.unwrap();

    assert!(entries.is_empty());
}

#[tokio::test]
async fn the_last_run_outcome_is_carried_through() {
    let harness = setup().await;
    let mut row = job("Flaky", OWNER_ID, conversation_for(&harness, OWNER_ID).await);
    row.last_status = Some("error".to_owned());
    harness.jobs.insert(&row).await.unwrap();

    let (entries, truncated) = harness.directory.list(OWNER_ID).await.unwrap();

    assert_eq!(entries[0].last_status.as_deref(), Some("error"));
    assert!(tasks_text(&entries, now_ms(), truncated).contains("last: error"));
}
