//! Reading scheduled tasks from a chat channel.
//!
//! Read-only on purpose. Enable/disable buttons are the obvious next step, but
//! a mis-tap there stops an automation silently and there is no undo on a
//! phone, so listing has to prove itself first.
//!
//! Everything here takes `now` as an argument rather than reading the clock, so
//! the rendering is testable without freezing time.

use std::sync::Arc;

use aionui_common::TimestampMs;
use aionui_db::ICronRepository;

use crate::error::ChannelError;

/// Scheduled tasks listed in one message.
///
/// Read-only text, so this is bounded by message length rather than by the
/// inline-keyboard limits that cap the session picker.
pub const TASKS_LISTED: usize = 20;

/// One scheduled task, reduced to what is worth reading on a phone.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskEntry {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// Human-readable cadence, e.g. "every 30m" or "0 9 * * 1-5".
    pub schedule: String,
    pub next_run_at: Option<TimestampMs>,
    /// Outcome of the most recent run, when there has been one.
    pub last_status: Option<String>,
}

/// Describe a schedule without needing a calendar or a timezone.
///
/// Prefers the description the creator supplied; falls back to the raw
/// schedule, which is at least unambiguous. `schedule_kind` is one of `at`,
/// `every` or `cron` (see `aionui_cron::types::schedule_to_row_fields`).
fn describe_schedule(kind: &str, value: &str, description: Option<&str>) -> String {
    if let Some(description) = description.map(str::trim).filter(|d| !d.is_empty()) {
        return description.to_owned();
    }
    match kind {
        "every" => match value.parse::<i64>() {
            Ok(ms) => format!("every {}", humanize_duration(ms)),
            Err(_) => format!("every {value}"),
        },
        "cron" => value.to_owned(),
        "at" => "once".to_owned(),
        other => other.to_owned(),
    }
}

/// Coarse duration, largest useful unit only. Precision past that is noise in
/// a phone notification.
fn humanize_duration(ms: i64) -> String {
    const SECOND: i64 = 1_000;
    const MINUTE: i64 = 60 * SECOND;
    const HOUR: i64 = 60 * MINUTE;
    const DAY: i64 = 24 * HOUR;

    let ms = ms.max(0);
    if ms >= DAY {
        format!("{}d", ms / DAY)
    } else if ms >= HOUR {
        format!("{}h", ms / HOUR)
    } else if ms >= MINUTE {
        format!("{}m", ms / MINUTE)
    } else if ms >= SECOND {
        format!("{}s", ms / SECOND)
    } else {
        "now".to_owned()
    }
}

/// When the next run falls, relative to `now`.
///
/// Relative rather than absolute so no timezone has to be guessed for the
/// reader -- the chat and the server need not agree on one.
fn describe_next_run(next_run_at: Option<TimestampMs>, now: TimestampMs, enabled: bool) -> String {
    if !enabled {
        return "paused".to_owned();
    }
    match next_run_at {
        None => "not scheduled".to_owned(),
        // A next run in the past means the runner has not picked it up yet.
        // Rendering it as "in -3h" would read as a bug rather than a backlog.
        Some(at) if at <= now => "due now".to_owned(),
        Some(at) => format!("in {}", humanize_duration(at - now)),
    }
}

/// Render the task list. Plain text: there is nothing to tap yet.
pub fn tasks_text(entries: &[TaskEntry], now: TimestampMs, truncated: bool) -> String {
    if entries.is_empty() {
        return "No scheduled tasks yet. Create one in the desktop app under Scheduled Tasks.".to_owned();
    }

    let mut lines = vec![format!("Scheduled tasks ({}):", entries.len())];
    for entry in entries {
        let mut line = format!(
            "\u{2022} {} \u{2014} {} \u{2192} {}",
            entry.name,
            entry.schedule,
            describe_next_run(entry.next_run_at, now, entry.enabled)
        );
        if let Some(status) = entry.last_status.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            line.push_str(&format!(" (last: {status})"));
        }
        lines.push(line);
    }
    if truncated {
        // A capped list that says nothing reads as the whole list.
        lines.push(format!(
            "Showing the first {TASKS_LISTED}; open the desktop app to see the rest."
        ));
    }
    lines.join("\n")
}

/// Reads the owner's scheduled tasks.
pub struct ScheduledTaskDirectory {
    jobs: Arc<dyn ICronRepository>,
}

impl ScheduledTaskDirectory {
    pub fn new(jobs: Arc<dyn ICronRepository>) -> Self {
        Self { jobs }
    }

    /// The owner's tasks, soonest first, plus whether the list was capped.
    ///
    /// Ordering puts what is about to happen at the top; paused tasks and ones
    /// with no next run sort last because there is nothing to wait for.
    pub async fn list(&self, owner_user_id: &str) -> Result<(Vec<TaskEntry>, bool), ChannelError> {
        let rows = self.jobs.list_all_for_user(owner_user_id).await?;

        let mut entries: Vec<TaskEntry> = rows
            .into_iter()
            .map(|row| TaskEntry {
                id: row.id,
                name: row.name,
                enabled: row.enabled,
                schedule: describe_schedule(
                    &row.schedule_kind,
                    &row.schedule_value,
                    row.schedule_description.as_deref(),
                ),
                next_run_at: row.next_run_at,
                last_status: row.last_status,
            })
            .collect();

        entries.sort_by(|a, b| {
            let key = |e: &TaskEntry| match (e.enabled, e.next_run_at) {
                (true, Some(at)) => (0, at, String::new()),
                (true, None) => (1, 0, e.name.clone()),
                (false, _) => (2, 0, e.name.clone()),
            };
            key(a).cmp(&key(b))
        });

        let truncated = entries.len() > TASKS_LISTED;
        entries.truncate(TASKS_LISTED);
        Ok((entries, truncated))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: TimestampMs = 1_700_000_000_000;

    fn entry(name: &str, enabled: bool, next_run_at: Option<TimestampMs>) -> TaskEntry {
        TaskEntry {
            id: format!("cron_{name}"),
            name: name.to_owned(),
            enabled,
            schedule: "every 1h".to_owned(),
            next_run_at,
            last_status: None,
        }
    }

    #[test]
    fn describes_the_three_schedule_kinds() {
        // The only kinds the schema stores; see schedule_to_row_fields.
        assert_eq!(describe_schedule("every", "1800000", None), "every 30m");
        assert_eq!(describe_schedule("cron", "0 9 * * 1-5", None), "0 9 * * 1-5");
        assert_eq!(describe_schedule("at", "1700000000000", None), "once");
    }

    #[test]
    fn a_supplied_description_wins_over_the_raw_schedule() {
        assert_eq!(
            describe_schedule("cron", "0 9 * * 1-5", Some("Weekday mornings")),
            "Weekday mornings"
        );
    }

    #[test]
    fn a_blank_description_falls_back_rather_than_rendering_nothing() {
        assert_eq!(describe_schedule("every", "60000", Some("   ")), "every 1m");
    }

    #[test]
    fn an_unparseable_interval_still_says_something() {
        // Defensive: the column is TEXT, so a bad value must not be silently
        // rendered as an empty schedule.
        assert_eq!(describe_schedule("every", "soon", None), "every soon");
    }

    #[test]
    fn an_unknown_kind_is_shown_rather_than_swallowed() {
        assert_eq!(describe_schedule("lunar", "whatever", None), "lunar");
    }

    #[test]
    fn durations_collapse_to_one_useful_unit() {
        assert_eq!(humanize_duration(500), "now");
        assert_eq!(humanize_duration(5_000), "5s");
        assert_eq!(humanize_duration(90_000), "1m");
        assert_eq!(humanize_duration(3 * 3_600_000), "3h");
        assert_eq!(humanize_duration(50 * 3_600_000), "2d");
    }

    #[test]
    fn a_negative_duration_does_not_render_a_minus_sign() {
        assert_eq!(humanize_duration(-5_000), "now");
    }

    #[test]
    fn a_paused_task_says_paused_not_a_next_run() {
        // Otherwise a disabled task looks like it is about to fire.
        assert_eq!(describe_next_run(Some(NOW + 60_000), NOW, false), "paused");
    }

    #[test]
    fn a_missed_run_reads_as_due_rather_than_negative() {
        assert_eq!(describe_next_run(Some(NOW - 10_800_000), NOW, true), "due now");
    }

    #[test]
    fn a_run_at_exactly_now_is_due() {
        assert_eq!(describe_next_run(Some(NOW), NOW, true), "due now");
    }

    #[test]
    fn a_task_with_no_next_run_says_so() {
        assert_eq!(describe_next_run(None, NOW, true), "not scheduled");
    }

    #[test]
    fn an_upcoming_run_is_relative() {
        assert_eq!(describe_next_run(Some(NOW + 7_200_000), NOW, true), "in 2h");
    }

    #[test]
    fn an_empty_list_explains_itself() {
        let text = tasks_text(&[], NOW, false);
        assert!(text.contains("No scheduled tasks"));
        assert!(
            text.contains("desktop app"),
            "an empty list should say where to make one"
        );
    }

    #[test]
    fn a_truncated_list_says_it_is_truncated() {
        let entries: Vec<TaskEntry> = (0..TASKS_LISTED)
            .map(|i| entry(&format!("t{i}"), true, Some(NOW + 60_000)))
            .collect();

        let text = tasks_text(&entries, NOW, true);

        assert!(text.contains("Showing the first"));
    }

    #[test]
    fn a_complete_list_does_not_claim_to_be_truncated() {
        let text = tasks_text(&[entry("only", true, Some(NOW + 60_000))], NOW, false);
        assert!(!text.contains("Showing the first"));
    }

    #[test]
    fn the_last_status_is_shown_when_there_is_one() {
        let mut failed = entry("nightly", true, Some(NOW + 60_000));
        failed.last_status = Some("error".to_owned());

        assert!(tasks_text(&[failed], NOW, false).contains("last: error"));
    }

    #[test]
    fn a_task_that_never_ran_shows_no_status_clause() {
        assert!(!tasks_text(&[entry("fresh", true, None)], NOW, false).contains("last:"));
    }
}
