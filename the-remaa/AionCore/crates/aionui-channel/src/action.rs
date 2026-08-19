use std::sync::Arc;

use tracing::{debug, info, warn};

use crate::approval_service::{AnswerOutcome, ApprovalService};
use crate::branding::brand_agent_label;
use crate::channel_settings::ChannelSettingsService;
use crate::commands::resolve_command;
use crate::error::ChannelError;
use crate::pairing::PairingService;
use crate::scheduled_tasks::{ScheduledTaskDirectory, tasks_text};
use crate::session::SessionManager;
use crate::session_directory::{
    SessionDirectory, active_buttons, active_text, page_buttons, page_text, project_buttons, project_list_text,
    project_page_buttons, project_page_text, resolve_project_ref,
};
use crate::stream_relay::{APPROVAL_CHOICE_KEY, APPROVAL_TICKET_KEY};
use crate::types::{
    ActionBehavior, ActionButton, ActionCategory, ActionContext, ActionResponse, UnifiedAction, UnifiedIncomingMessage,
};

/// Result of processing an incoming message.
///
/// The caller (ChannelManager / plugin) uses this to decide what to send
/// back to the IM platform.
#[derive(Debug, Clone)]
pub enum MessageResult {
    /// An action response to send/edit on the platform.
    Action(ActionResponse),
    /// Message was dispatched to the AI Agent. The caller should send
    /// a "thinking" placeholder and then relay stream events.
    Dispatched {
        owner_user_id: String,
        session_id: String,
        conversation_id: Option<String>,
    },
    /// Message was a text but user already has an active agent stream
    /// (no duplicate dispatch needed).
    AlreadyProcessing,
}

/// Processes incoming IM messages: authorization → action routing → AI dispatch.
///
/// This is the core message entry point for the channel system. Each
/// incoming `UnifiedIncomingMessage` is either:
/// 1. Rejected (unauthorized → pairing flow)
/// 2. Routed to an action handler (button callback)
/// 3. Dispatched to the AI Agent (text message)
pub struct ActionExecutor {
    pairing: Arc<PairingService>,
    session_mgr: Arc<SessionManager>,
    settings: Arc<ChannelSettingsService>,
    owner_user_id: Option<String>,
    /// Set in production by `build_channel_state`. Optional so the many
    /// constructor call sites that never exercise session listing stay simple;
    /// the session actions report plainly when it is absent rather than
    /// pretending there are no conversations.
    directory: Option<Arc<SessionDirectory>>,
    /// Optional for the same reason as `directory`.
    scheduled_tasks: Option<Arc<ScheduledTaskDirectory>>,
    /// Optional for the same reason as `directory`.
    approvals: Option<Arc<ApprovalService>>,
}

impl ActionExecutor {
    pub fn new(
        pairing: Arc<PairingService>,
        session_mgr: Arc<SessionManager>,
        settings: Arc<ChannelSettingsService>,
        owner_user_id: Option<String>,
    ) -> Self {
        Self {
            pairing,
            session_mgr,
            settings,
            owner_user_id,
            directory: None,
            scheduled_tasks: None,
            approvals: None,
        }
    }

    /// Attach the session directory that backs `/sessions`, `/status` and
    /// session attachment.
    /// Attach the approval service that answers permission buttons.
    pub fn with_approvals(mut self, approvals: Arc<ApprovalService>) -> Self {
        self.approvals = Some(approvals);
        self
    }

    /// Attach the scheduled-task reader that backs `/tasks`.
    pub fn with_scheduled_tasks(mut self, tasks: Arc<ScheduledTaskDirectory>) -> Self {
        self.scheduled_tasks = Some(tasks);
        self
    }

    pub fn with_session_directory(mut self, directory: Arc<SessionDirectory>) -> Self {
        self.directory = Some(directory);
        self
    }

    fn directory(&self) -> Result<&Arc<SessionDirectory>, ChannelError> {
        self.directory
            .as_ref()
            .ok_or_else(|| ChannelError::InvalidConfig("session directory is not configured".to_owned()))
    }

    pub fn owner_user_id(&self) -> Option<&str> {
        self.owner_user_id.as_deref()
    }

    /// Main entry point: handle an incoming message from any platform.
    ///
    /// Flow:
    /// 1. Authorization check → if unauthorized, trigger pairing
    /// 2. Button callback → route to action handler
    /// 3. Text message → get/create session → return Dispatched for AI
    pub async fn handle_incoming_message(&self, msg: &UnifiedIncomingMessage) -> Result<MessageResult, ChannelError> {
        let platform_type = msg.platform.to_string();
        let user_id = &msg.user.id;
        let chat_id = &msg.chat_id;
        let owner_user_id = msg
            .owner_user_id
            .as_deref()
            .or(self.owner_user_id.as_deref())
            .ok_or_else(|| ChannelError::InvalidConfig("channel owner user is required".to_owned()))?;

        // 1. Authorization check — resolve platform user → internal user ID
        let internal_user_id = self
            .pairing
            .get_internal_user_id(owner_user_id, user_id, &platform_type)
            .await?;

        let internal_user_id = match internal_user_id {
            Some(id) => id,
            None => {
                let response = self
                    .handle_unauthorized(owner_user_id, user_id, &platform_type, &msg.user.display_name)
                    .await?;
                return Ok(MessageResult::Action(response));
            }
        };

        // 2. Button callback → action routing
        if let Some(action) = &msg.action {
            let response = self.route_action(owner_user_id, action, &internal_user_id).await?;
            return Ok(MessageResult::Action(response));
        }

        // 3. Slash commands we own are handled here. Anything else falls through
        //    to the agent, so an agent's own slash commands keep working.
        if let Some(command) = resolve_command(&msg.content.text) {
            let action = UnifiedAction {
                category: command.category,
                action: command.action,
                params: command.params,
                context: ActionContext {
                    platform: msg.platform,
                    user_id: msg.user.id.clone(),
                    chat_id: msg.chat_id.clone(),
                    message_id: Some(msg.id.clone()),
                    session_id: None,
                },
            };
            let response = self.route_action(owner_user_id, &action, &internal_user_id).await?;
            return Ok(MessageResult::Action(response));
        }

        // 4. Text message → session resolution → AI dispatch
        let agent_config = self.settings.get_agent_config(owner_user_id, msg.platform).await?;
        let session = self
            .session_mgr
            .get_or_create_session(
                owner_user_id,
                &internal_user_id,
                chat_id,
                &agent_config.agent_type,
                None,
            )
            .await?;

        info!(
            session_id = %session.id,
            user_id = %user_id,
            chat_id = %chat_id,
            text_len = msg.content.text.len(),
            "message dispatched to agent"
        );

        Ok(MessageResult::Dispatched {
            owner_user_id: owner_user_id.to_owned(),
            session_id: session.id,
            conversation_id: session.conversation_id,
        })
    }

    /// Handles an unauthorized user: generate pairing code and return
    /// a response with instructions and action buttons.
    async fn handle_unauthorized(
        &self,
        owner_user_id: &str,
        platform_user_id: &str,
        platform_type: &str,
        display_name: &str,
    ) -> Result<ActionResponse, ChannelError> {
        let code = self
            .pairing
            .request_pairing(owner_user_id, platform_user_id, platform_type, Some(display_name))
            .await?;

        debug!(
            platform_user_id = %platform_user_id,
            code = %code,
            "pairing code generated for unauthorized user"
        );

        Ok(build_pairing_response(&code))
    }

    /// Routes an action to the appropriate handler by category.
    async fn route_action(
        &self,
        owner_user_id: &str,
        action: &UnifiedAction,
        internal_user_id: &str,
    ) -> Result<ActionResponse, ChannelError> {
        match action.category {
            ActionCategory::Platform => self.handle_platform_action(owner_user_id, action).await,
            ActionCategory::System => self.handle_system_action(owner_user_id, action, internal_user_id).await,
            ActionCategory::Chat => self.handle_chat_action(owner_user_id, action).await,
        }
    }

    // ── Platform actions ────────────────────────────────────────────

    async fn handle_platform_action(
        &self,
        owner_user_id: &str,
        action: &UnifiedAction,
    ) -> Result<ActionResponse, ChannelError> {
        match action.action.as_str() {
            "pairing.show" | "pairing.refresh" => {
                let code = self
                    .pairing
                    .request_pairing(
                        owner_user_id,
                        &action.context.user_id,
                        &action.context.platform.to_string(),
                        None,
                    )
                    .await?;
                Ok(build_pairing_response(&code))
            }
            "pairing.check" => {
                let authorized = self
                    .pairing
                    .is_user_authorized(
                        owner_user_id,
                        &action.context.user_id,
                        &action.context.platform.to_string(),
                    )
                    .await?;
                if authorized {
                    Ok(ActionResponse {
                        text: Some("You are authorized! Send a message to start chatting.".into()),
                        parse_mode: None,
                        buttons: None,
                        keyboard: None,
                        behavior: ActionBehavior::Send,
                        toast: None,
                        edit_message_id: None,
                    })
                } else {
                    Ok(ActionResponse {
                        text: Some("Still waiting for approval. Ask the admin to check Settings → Channel.".into()),
                        parse_mode: None,
                        buttons: Some(vec![vec![
                            ActionButton {
                                label: "Refresh".into(),
                                action: "pairing.refresh".into(),
                                params: None,
                            },
                            ActionButton {
                                label: "Check Again".into(),
                                action: "pairing.check".into(),
                                params: None,
                            },
                        ]]),
                        keyboard: None,
                        behavior: ActionBehavior::Send,
                        toast: None,
                        edit_message_id: None,
                    })
                }
            }
            "pairing.help" => Ok(ActionResponse {
                text: Some(
                    "To use this bot, you need authorization:\n\
                         1. Send any message to get a 6-digit pairing code\n\
                         2. Share this code with the admin\n\
                         3. Admin approves in Settings → Channel\n\
                         4. You're ready to chat!"
                        .into(),
                ),
                parse_mode: None,
                buttons: None,
                keyboard: None,
                behavior: ActionBehavior::Send,
                toast: None,
                edit_message_id: None,
            }),
            other => {
                warn!(action = %other, "unknown platform action");
                Ok(build_unknown_action_response(other))
            }
        }
    }

    // ── System actions ──────────────────────────────────────────────

    async fn handle_system_action(
        &self,
        owner_user_id: &str,
        action: &UnifiedAction,
        internal_user_id: &str,
    ) -> Result<ActionResponse, ChannelError> {
        match action.action.as_str() {
            "session.list" => {
                let directory = self.directory()?;
                let agent_config = self
                    .settings
                    .get_agent_config(owner_user_id, action.context.platform)
                    .await?;
                let attached = directory
                    .attached_conversation(
                        owner_user_id,
                        internal_user_id,
                        &action.context.chat_id,
                        &agent_config.agent_type,
                    )
                    .await?;
                let cursor = action.params.as_ref().and_then(|params| params.get("cursor")).cloned();

                let page = directory
                    .list_page(owner_user_id, cursor, attached.as_ref().map(|row| row.id.as_str()))
                    .await?;

                let buttons = page_buttons(&page);
                Ok(ActionResponse {
                    text: Some(page_text(&page)),
                    parse_mode: None,
                    buttons: (!buttons.is_empty()).then_some(buttons),
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: None,
                    edit_message_id: None,
                })
            }

            "session.attach" => {
                let directory = self.directory()?;
                let conversation_id = action
                    .params
                    .as_ref()
                    .and_then(|params| params.get("id"))
                    .ok_or_else(|| ChannelError::InvalidConfig("session.attach requires an id".to_owned()))?;
                let agent_config = self
                    .settings
                    .get_agent_config(owner_user_id, action.context.platform)
                    .await?;

                let conversation = directory
                    .attach(
                        owner_user_id,
                        internal_user_id,
                        &action.context.chat_id,
                        &agent_config.agent_type,
                        conversation_id,
                    )
                    .await?;

                Ok(ActionResponse {
                    text: Some(format!(
                        "Attached to \"{}\". Messages in this chat now go there.",
                        conversation.name
                    )),
                    parse_mode: None,
                    buttons: None,
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: Some("Attached".into()),
                    edit_message_id: None,
                })
            }

            "task.list" => {
                let tasks = self
                    .scheduled_tasks
                    .as_ref()
                    .ok_or_else(|| ChannelError::InvalidConfig("scheduled tasks are not configured".to_owned()))?;
                let (entries, truncated) = tasks.list(owner_user_id).await?;

                Ok(ActionResponse {
                    text: Some(tasks_text(&entries, aionui_common::now_ms(), truncated)),
                    parse_mode: None,
                    buttons: None,
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: None,
                    edit_message_id: None,
                })
            }

            "session.active" => {
                let directory = self.directory()?;
                let agent_config = self
                    .settings
                    .get_agent_config(owner_user_id, action.context.platform)
                    .await?;
                let attached = directory
                    .attached_conversation(
                        owner_user_id,
                        internal_user_id,
                        &action.context.chat_id,
                        &agent_config.agent_type,
                    )
                    .await?;

                let entries = directory
                    .list_active(owner_user_id, attached.as_ref().map(|row| row.id.as_str()))
                    .await?;
                let buttons = active_buttons(&entries);

                Ok(ActionResponse {
                    text: Some(active_text(&entries)),
                    parse_mode: None,
                    buttons: (!buttons.is_empty()).then_some(buttons),
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: None,
                    edit_message_id: None,
                })
            }

            "project.list" => {
                let directory = self.directory()?;
                let projects = directory.list_projects(owner_user_id).await?;
                let buttons = project_buttons(&projects);

                Ok(ActionResponse {
                    text: Some(project_list_text(&projects)),
                    parse_mode: None,
                    buttons: (!buttons.is_empty()).then_some(buttons),
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: None,
                    edit_message_id: None,
                })
            }

            "project.open" => {
                let directory = self.directory()?;
                let project_id = project_id_param(action, "project.open")?;
                let agent_config = self
                    .settings
                    .get_agent_config(owner_user_id, action.context.platform)
                    .await?;
                let attached = directory
                    .attached_conversation(
                        owner_user_id,
                        internal_user_id,
                        &action.context.chat_id,
                        &agent_config.agent_type,
                    )
                    .await?;

                let (page, scope) = directory
                    .list_project_page(owner_user_id, &project_id, attached.as_ref().map(|row| row.id.as_str()))
                    .await?;

                Ok(ActionResponse {
                    text: Some(project_page_text(&page, &scope)),
                    parse_mode: None,
                    buttons: Some(project_page_buttons(&page, &scope)),
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: None,
                    edit_message_id: None,
                })
            }

            "project.start" => {
                let directory = self.directory()?;
                let project_id = project_id_param(action, "project.start")?;
                let agent_config = self
                    .settings
                    .get_agent_config(owner_user_id, action.context.platform)
                    .await?;

                // Resolving the project first means an unknown or someone
                // else project fails before the chat session is reset --
                // otherwise a mis-tap would silently detach the chat.
                let (_page, scope) = directory.list_project_page(owner_user_id, &project_id, None).await?;
                let workspace = directory.project_workspace_path(owner_user_id, &project_id).await?;

                self.session_mgr
                    .reset_session(
                        owner_user_id,
                        internal_user_id,
                        &action.context.chat_id,
                        &agent_config.agent_type,
                        workspace.as_deref(),
                    )
                    .await?;

                // A conversation is only created once a message is sent, so
                // say what actually happens rather than claiming one exists.
                let text = match workspace.as_deref() {
                    Some(path) => format!(
                        "Ready to start a session in \"{}\" ({path}).
Send a message and it will begin there.",
                        scope.name
                    ),
                    None => format!(
                        "Ready to start a session for \"{}\".
This project has no local folder, so the session will not be bound to it.",
                        scope.name
                    ),
                };

                Ok(ActionResponse {
                    text: Some(text),
                    parse_mode: None,
                    buttons: None,
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: Some("Ready".into()),
                    edit_message_id: None,
                })
            }

            "session.new" => {
                let user_id = internal_user_id;
                let chat_id = &action.context.chat_id;
                let agent_config = self
                    .settings
                    .get_agent_config(owner_user_id, action.context.platform)
                    .await?;
                let session = self
                    .session_mgr
                    .reset_session(owner_user_id, user_id, chat_id, &agent_config.agent_type, None)
                    .await?;

                Ok(ActionResponse {
                    text: Some(format!(
                        "New session created.\nAgent: {}\nSession: {}",
                        brand_agent_label(&session.agent_type),
                        &session.id[..8]
                    )),
                    parse_mode: None,
                    buttons: Some(vec![vec![ActionButton {
                        label: "Help".into(),
                        action: "help.show".into(),
                        params: None,
                    }]]),
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: None,
                    edit_message_id: None,
                })
            }
            "session.status" => {
                let user_id = internal_user_id;
                let chat_id = &action.context.chat_id;
                let agent_config = self
                    .settings
                    .get_agent_config(owner_user_id, action.context.platform)
                    .await?;
                let session = self
                    .session_mgr
                    .get_or_create_session(owner_user_id, user_id, chat_id, &agent_config.agent_type, None)
                    .await?;

                // Name the attached conversation when the directory is wired.
                // Without it the status still reports the session, so callers
                // that never configured a directory keep working.
                let attached = match self.directory.as_ref() {
                    Some(directory) => directory
                        .attached_conversation(owner_user_id, user_id, chat_id, &agent_config.agent_type)
                        .await
                        .ok()
                        .flatten(),
                    None => None,
                };
                let attached_line = match &attached {
                    Some(row) => format!("\nAttached to: {}", row.name),
                    None => String::new(),
                };

                Ok(ActionResponse {
                    text: Some(format!(
                        "Session: {}\nAgent: {}{}\nCreated: {}\nLast active: {}",
                        &session.id[..8],
                        brand_agent_label(&session.agent_type),
                        attached_line,
                        session.created_at,
                        session.last_activity,
                    )),
                    parse_mode: None,
                    buttons: Some(vec![
                        vec![ActionButton {
                            label: "Sessions".into(),
                            action: "session.list".into(),
                            params: None,
                        }],
                        vec![ActionButton {
                            label: "New Session".into(),
                            action: "session.new".into(),
                            params: None,
                        }],
                    ]),
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: None,
                    edit_message_id: None,
                })
            }
            "help.show" => Ok(build_help_response()),
            "help.features" => Ok(ActionResponse {
                text: Some(
                    "Features:\n\
                         • AI chat through your configured assistant\n\
                         • Tool execution with auto-approval\n\
                         • Session isolation per chat"
                        .into(),
                ),
                parse_mode: None,
                buttons: None,
                keyboard: None,
                behavior: ActionBehavior::Send,
                toast: None,
                edit_message_id: None,
            }),
            "help.pairing" => Ok(ActionResponse {
                text: Some(
                    "Pairing:\n\
                         Send any message → get a 6-digit code → admin approves → you're in!"
                        .into(),
                ),
                parse_mode: None,
                buttons: None,
                keyboard: None,
                behavior: ActionBehavior::Send,
                toast: None,
                edit_message_id: None,
            }),
            "help.tips" => Ok(ActionResponse {
                text: Some(
                    "Tips:\n\
                         • Start a new session to clear context\n\
                         • Use /help to see available commands\n\
                         • In group chats, @mention the bot"
                        .into(),
                ),
                parse_mode: None,
                buttons: None,
                keyboard: None,
                behavior: ActionBehavior::Send,
                toast: None,
                edit_message_id: None,
            }),
            "settings.show" => Ok(ActionResponse {
                text: Some(
                    "Settings are managed in the desktop app.\n\
                         Go to Settings → Channel to configure plugins and manage users."
                        .into(),
                ),
                parse_mode: None,
                buttons: None,
                keyboard: None,
                behavior: ActionBehavior::Send,
                toast: None,
                edit_message_id: None,
            }),
            other => {
                warn!(action = %other, "unknown system action");
                Ok(build_unknown_action_response(other))
            }
        }
    }

    // ── Chat actions ────────────────────────────────────────────────

    async fn handle_chat_action(
        &self,
        owner_user_id: &str,
        action: &UnifiedAction,
    ) -> Result<ActionResponse, ChannelError> {
        match action.action.as_str() {
            "chat.send" | "chat.regenerate" | "chat.continue" => {
                // These are handled by the message flow, not action responses.
                // Return a placeholder; the real logic is in ChannelMessageService.
                Ok(ActionResponse {
                    text: None,
                    parse_mode: None,
                    buttons: None,
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast: Some("Processing...".into()),
                    edit_message_id: None,
                })
            }
            "action.copy" => Ok(ActionResponse {
                text: None,
                parse_mode: None,
                buttons: None,
                keyboard: None,
                behavior: ActionBehavior::Answer,
                toast: Some("Copied to clipboard".into()),
                edit_message_id: None,
            }),
            "system.confirm" => {
                let approvals = self
                    .approvals
                    .as_ref()
                    .ok_or_else(|| ChannelError::InvalidConfig("approvals are not configured".to_owned()))?;

                let params = action.params.as_ref();
                let ticket = params
                    .and_then(|p| p.get(APPROVAL_TICKET_KEY))
                    .cloned()
                    .ok_or_else(|| ChannelError::InvalidConfig("system.confirm requires a ticket".to_owned()))?;
                // A non-numeric index is a malformed button, not a choice.
                // Treating it as 0 would authorize whatever happens to be first.
                let choice_index: usize = params
                    .and_then(|p| p.get(APPROVAL_CHOICE_KEY))
                    .and_then(|value| value.parse().ok())
                    .ok_or_else(|| ChannelError::InvalidConfig("system.confirm requires a choice".to_owned()))?;

                let outcome = approvals.answer(owner_user_id, &ticket, choice_index).await?;

                let (text, toast) = match &outcome {
                    AnswerOutcome::Delivered { approval, choice } => {
                        debug!(
                            ticket = %ticket,
                            conversation_id = %approval.conversation_id,
                            denied = choice.denies,
                            "approval answered from chat"
                        );
                        (
                            Some(format!("{} \u{2014} {}", approval.summary, choice.label)),
                            Some(choice.label.clone()),
                        )
                    }
                    // A stale button is a normal thing to tap; saying so beats
                    // a silent no-op that reads as the bot being broken.
                    AnswerOutcome::AlreadyResolved => (
                        Some("That request was already answered or has expired.".to_owned()),
                        Some("Already answered".to_owned()),
                    ),
                    AnswerOutcome::UnknownChoice => (
                        Some("That option is no longer available.".to_owned()),
                        Some("Unavailable".to_owned()),
                    ),
                };

                Ok(ActionResponse {
                    text,
                    parse_mode: None,
                    buttons: None,
                    keyboard: None,
                    behavior: ActionBehavior::Send,
                    toast,
                    edit_message_id: None,
                })
            }
            other => {
                warn!(action = %other, "unknown chat action");
                Ok(build_unknown_action_response(other))
            }
        }
    }
}

// ── Helper builders ─────────────────────────────────────────────────

fn build_pairing_response(code: &str) -> ActionResponse {
    ActionResponse {
        text: Some(format!(
            "Welcome! To use this bot, you need authorization.\n\n\
             Your pairing code: *{code}*\n\n\
             Share this code with the admin, who can approve it in \
             Settings → Channel → Pairing Requests.\n\
             The code expires in 10 minutes."
        )),
        parse_mode: None,
        buttons: Some(vec![vec![
            ActionButton {
                label: "Refresh Code".into(),
                action: "pairing.refresh".into(),
                params: None,
            },
            ActionButton {
                label: "Check Status".into(),
                action: "pairing.check".into(),
                params: None,
            },
            ActionButton {
                label: "Help".into(),
                action: "pairing.help".into(),
                params: None,
            },
        ]]),
        keyboard: None,
        behavior: ActionBehavior::Send,
        toast: None,
        edit_message_id: None,
    }
}

fn build_help_response() -> ActionResponse {
    ActionResponse {
        text: Some(
            "How can I help?\n\
             Choose an option below or just send me a message."
                .into(),
        ),
        parse_mode: None,
        buttons: Some(vec![
            vec![
                ActionButton {
                    label: "New Session".into(),
                    action: "session.new".into(),
                    params: None,
                },
                ActionButton {
                    label: "Session Status".into(),
                    action: "session.status".into(),
                    params: None,
                },
            ],
            vec![
                ActionButton {
                    label: "Features".into(),
                    action: "help.features".into(),
                    params: None,
                },
                ActionButton {
                    label: "Tips".into(),
                    action: "help.tips".into(),
                    params: None,
                },
            ],
        ]),
        keyboard: None,
        behavior: ActionBehavior::Send,
        toast: None,
        edit_message_id: None,
    }
}

fn build_unknown_action_response(action: &str) -> ActionResponse {
    ActionResponse {
        text: Some(format!("Unknown action: {action}")),
        parse_mode: None,
        buttons: None,
        keyboard: None,
        behavior: ActionBehavior::Send,
        toast: None,
        edit_message_id: None,
    }
}

/// Read the project reference a project button carries.
///
/// Buttons send the id without its `project_` prefix to stay inside the
/// 64-byte callback budget, so it is expanded back here.
fn project_id_param(action: &UnifiedAction, what: &str) -> Result<String, ChannelError> {
    action
        .params
        .as_ref()
        .and_then(|params| params.get("i"))
        .map(|reference| resolve_project_ref(reference))
        .ok_or_else(|| ChannelError::InvalidConfig(format!("{what} requires a project reference")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ActionContext, MessageContentType, PluginType, UnifiedMessageContent, UnifiedUser};
    use aionui_api_types::WebSocketMessage;
    use aionui_common::{TimestampMs, now_ms};
    use aionui_db::models::{
        AssistantSessionRow, AssistantUserRow, ChannelPluginRow, ClientPreference, PairingCodeRow,
    };
    use aionui_db::{DbError, IChannelRepository, IClientPreferenceRepository, UpdatePluginStatusParams};
    use aionui_realtime::EventBroadcaster;
    use std::collections::HashMap;
    use std::sync::Mutex;

    // ── Mock EventBroadcaster ──────────────────────────────────────────

    struct MockBroadcaster;

    impl EventBroadcaster for MockBroadcaster {
        fn broadcast(&self, _event: WebSocketMessage<serde_json::Value>) {}
    }

    // ── Mock IChannelRepository ────────────────────────────────────────
    const OWNER_ID: &str = "owner-test";

    struct MockRepo {
        users: Mutex<Vec<AssistantUserRow>>,
        sessions: Mutex<Vec<AssistantSessionRow>>,
        pairings: Mutex<Vec<PairingCodeRow>>,
    }

    impl MockRepo {
        fn new() -> Self {
            Self {
                users: Mutex::new(Vec::new()),
                sessions: Mutex::new(Vec::new()),
                pairings: Mutex::new(Vec::new()),
            }
        }

        fn add_authorized_user(&self, platform_user_id: &str, platform_type: &str) {
            let user = AssistantUserRow {
                id: format!("user_{platform_user_id}"),
                owner_user_id: OWNER_ID.to_owned(),
                platform_user_id: platform_user_id.to_owned(),
                platform_type: platform_type.to_owned(),
                display_name: Some("Test User".into()),
                authorized_at: now_ms(),
                last_active: None,
                session_id: None,
            };
            self.users.lock().unwrap().push(user);
        }
    }

    #[async_trait::async_trait]
    impl IChannelRepository for MockRepo {
        async fn get_all_plugins(&self, _owner_user_id: &str) -> Result<Vec<ChannelPluginRow>, DbError> {
            Ok(vec![])
        }
        async fn get_plugin(&self, _owner_user_id: &str, _id: &str) -> Result<Option<ChannelPluginRow>, DbError> {
            Ok(None)
        }
        async fn upsert_plugin(&self, _owner_user_id: &str, _row: &ChannelPluginRow) -> Result<(), DbError> {
            Ok(())
        }
        async fn update_plugin_status(
            &self,
            _owner_user_id: &str,
            _id: &str,
            _params: &UpdatePluginStatusParams,
        ) -> Result<(), DbError> {
            Ok(())
        }
        async fn delete_plugin(&self, _owner_user_id: &str, _id: &str) -> Result<(), DbError> {
            Ok(())
        }

        async fn get_all_users(&self, _owner_user_id: &str) -> Result<Vec<AssistantUserRow>, DbError> {
            Ok(self.users.lock().unwrap().clone())
        }
        async fn get_user_by_platform(
            &self,
            _owner_user_id: &str,
            platform_user_id: &str,
            platform_type: &str,
        ) -> Result<Option<AssistantUserRow>, DbError> {
            let users = self.users.lock().unwrap();
            Ok(users
                .iter()
                .find(|u| u.platform_user_id == platform_user_id && u.platform_type == platform_type)
                .cloned())
        }
        async fn create_user(&self, _owner_user_id: &str, row: &AssistantUserRow) -> Result<(), DbError> {
            self.users.lock().unwrap().push(row.clone());
            Ok(())
        }
        async fn update_user_last_active(
            &self,
            _owner_user_id: &str,
            _id: &str,
            _last_active: TimestampMs,
        ) -> Result<(), DbError> {
            Ok(())
        }
        async fn delete_user(&self, _owner_user_id: &str, _id: &str) -> Result<(), DbError> {
            Ok(())
        }

        async fn get_all_sessions(&self, _owner_user_id: &str) -> Result<Vec<AssistantSessionRow>, DbError> {
            Ok(self.sessions.lock().unwrap().clone())
        }
        async fn get_session(&self, _owner_user_id: &str, id: &str) -> Result<Option<AssistantSessionRow>, DbError> {
            let sessions = self.sessions.lock().unwrap();
            Ok(sessions.iter().find(|s| s.id == id).cloned())
        }
        async fn get_or_create_session(
            &self,
            _owner_user_id: &str,
            user_id: &str,
            chat_id: &str,
            new_row: &AssistantSessionRow,
        ) -> Result<AssistantSessionRow, DbError> {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(existing) = sessions
                .iter_mut()
                .find(|s| s.user_id == user_id && s.chat_id.as_deref() == Some(chat_id))
            {
                existing.last_activity = new_row.last_activity;
                return Ok(existing.clone());
            }
            sessions.push(new_row.clone());
            Ok(new_row.clone())
        }
        async fn update_session_activity(
            &self,
            _owner_user_id: &str,
            _id: &str,
            _last_activity: TimestampMs,
        ) -> Result<(), DbError> {
            Ok(())
        }
        async fn update_session_conversation(
            &self,
            _owner_user_id: &str,
            id: &str,
            conversation_id: &str,
        ) -> Result<(), DbError> {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(s) = sessions.iter_mut().find(|s| s.id == id) {
                s.conversation_id = Some(conversation_id.to_owned());
                Ok(())
            } else {
                Err(DbError::NotFound(id.into()))
            }
        }
        async fn update_session_agent_type(
            &self,
            _owner_user_id: &str,
            id: &str,
            agent_type: &str,
        ) -> Result<(), DbError> {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(s) = sessions.iter_mut().find(|s| s.id == id) {
                s.agent_type = agent_type.to_owned();
                Ok(())
            } else {
                Err(DbError::NotFound(id.into()))
            }
        }
        async fn delete_sessions_by_user(&self, _owner_user_id: &str, user_id: &str) -> Result<(), DbError> {
            self.sessions.lock().unwrap().retain(|s| s.user_id != user_id);
            Ok(())
        }
        async fn delete_session_by_user_chat(
            &self,
            _owner_user_id: &str,
            user_id: &str,
            chat_id: &str,
        ) -> Result<(), DbError> {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.retain(|s| !(s.user_id == user_id && s.chat_id.as_deref() == Some(chat_id)));
            Ok(())
        }

        async fn create_pairing(&self, _owner_user_id: &str, row: &PairingCodeRow) -> Result<(), DbError> {
            self.pairings.lock().unwrap().push(row.clone());
            Ok(())
        }
        async fn get_pending_pairings(&self, _owner_user_id: &str) -> Result<Vec<PairingCodeRow>, DbError> {
            let pairings = self.pairings.lock().unwrap();
            Ok(pairings.iter().filter(|p| p.status == "pending").cloned().collect())
        }
        async fn get_pairing_by_code(
            &self,
            _owner_user_id: &str,
            code: &str,
        ) -> Result<Option<PairingCodeRow>, DbError> {
            let pairings = self.pairings.lock().unwrap();
            Ok(pairings.iter().find(|p| p.code == code).cloned())
        }
        async fn update_pairing_status(&self, _owner_user_id: &str, code: &str, status: &str) -> Result<(), DbError> {
            let mut pairings = self.pairings.lock().unwrap();
            if let Some(p) = pairings.iter_mut().find(|p| p.code == code) {
                p.status = status.to_owned();
                Ok(())
            } else {
                Err(DbError::NotFound(code.into()))
            }
        }
        async fn cleanup_expired_pairings(&self, _owner_user_id: &str, _now: TimestampMs) -> Result<u64, DbError> {
            Ok(0)
        }
    }

    // ── Mock IClientPreferenceRepository ──────────────────────────────

    struct MockPrefRepo;

    #[async_trait::async_trait]
    impl IClientPreferenceRepository for MockPrefRepo {
        async fn get_all(&self, _user_id: &str) -> Result<Vec<ClientPreference>, DbError> {
            Ok(vec![])
        }
        async fn get_by_keys(&self, _user_id: &str, _keys: &[&str]) -> Result<Vec<ClientPreference>, DbError> {
            Ok(vec![])
        }
        async fn upsert_batch(&self, _user_id: &str, _entries: &[(&str, &str)]) -> Result<(), DbError> {
            Ok(())
        }
        async fn delete_keys(&self, _user_id: &str, _keys: &[&str]) -> Result<(), DbError> {
            Ok(())
        }
    }

    // ── Test helpers ───────────────────────────────────────────────────

    fn setup() -> (ActionExecutor, Arc<MockRepo>) {
        let repo = Arc::new(MockRepo::new());
        let broadcaster = Arc::new(MockBroadcaster);
        let pairing = Arc::new(PairingService::new(repo.clone(), broadcaster));
        let session_mgr = Arc::new(SessionManager::new(repo.clone()));
        let pref_repo: Arc<dyn IClientPreferenceRepository> = Arc::new(MockPrefRepo);
        let settings = Arc::new(ChannelSettingsService::new(pref_repo));
        let executor = ActionExecutor::new(pairing, session_mgr, settings, Some(OWNER_ID.to_owned()));
        (executor, repo)
    }

    fn setup_without_owner() -> (ActionExecutor, Arc<MockRepo>) {
        let repo = Arc::new(MockRepo::new());
        let broadcaster = Arc::new(MockBroadcaster);
        let pairing = Arc::new(PairingService::new(repo.clone(), broadcaster));
        let session_mgr = Arc::new(SessionManager::new(repo.clone()));
        let pref_repo: Arc<dyn IClientPreferenceRepository> = Arc::new(MockPrefRepo);
        let settings = Arc::new(ChannelSettingsService::new(pref_repo));
        let executor = ActionExecutor::new(pairing, session_mgr, settings, None);
        (executor, repo)
    }

    fn make_text_message(user_id: &str, chat_id: &str, text: &str, platform: PluginType) -> UnifiedIncomingMessage {
        UnifiedIncomingMessage {
            owner_user_id: None,
            id: "msg_1".into(),
            platform,
            chat_id: chat_id.into(),
            user: UnifiedUser {
                id: user_id.into(),
                username: None,
                display_name: "Test".into(),
                avatar_url: None,
            },
            content: UnifiedMessageContent {
                content_type: MessageContentType::Text,
                text: text.into(),
                attachments: None,
            },
            timestamp: now_ms(),
            reply_to_message_id: None,
            action: None,
            raw: None,
        }
    }

    fn make_action_message(
        user_id: &str,
        chat_id: &str,
        action_name: &str,
        category: ActionCategory,
        platform: PluginType,
        params: Option<HashMap<String, String>>,
    ) -> UnifiedIncomingMessage {
        UnifiedIncomingMessage {
            owner_user_id: None,
            id: "msg_1".into(),
            platform,
            chat_id: chat_id.into(),
            user: UnifiedUser {
                id: user_id.into(),
                username: None,
                display_name: "Test".into(),
                avatar_url: None,
            },
            content: UnifiedMessageContent {
                content_type: MessageContentType::Action,
                text: String::new(),
                attachments: None,
            },
            timestamp: now_ms(),
            reply_to_message_id: None,
            action: Some(UnifiedAction {
                action: action_name.into(),
                category,
                params,
                context: ActionContext {
                    platform,
                    user_id: user_id.into(),
                    chat_id: chat_id.into(),
                    message_id: None,
                    session_id: None,
                },
            }),
            raw: None,
        }
    }

    // ── Authorization tests ────────────────────────────────────────────

    #[tokio::test]
    async fn unauthorized_user_gets_pairing_response() {
        let (executor, _repo) = setup();
        let msg = make_text_message("tg_42", "chat_1", "Hello", PluginType::Telegram);

        let result = executor.handle_incoming_message(&msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                assert_eq!(resp.behavior, ActionBehavior::Send);
                let text = resp.text.unwrap();
                assert!(text.contains("pairing code"));
                assert!(resp.buttons.is_some());
            }
            _ => panic!("Expected Action result for unauthorized user"),
        }
    }

    #[tokio::test]
    async fn missing_owner_user_id_is_rejected() {
        let (executor, _repo) = setup_without_owner();
        let msg = make_text_message("tg_42", "chat_1", "Hello", PluginType::Telegram);

        let err = executor.handle_incoming_message(&msg).await.unwrap_err();
        assert!(matches!(err, ChannelError::InvalidConfig(_)));
        assert!(err.to_string().contains("owner user"));
    }

    #[tokio::test]
    async fn authorized_user_text_dispatches_to_agent() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_text_message("tg_42", "chat_1", "Hello AI", PluginType::Telegram);
        let result = executor.handle_incoming_message(&msg).await.unwrap();

        match result {
            MessageResult::Dispatched { session_id, .. } => {
                assert!(!session_id.is_empty());
            }
            _ => panic!("Expected Dispatched result for authorized user"),
        }
    }

    // ── Platform action tests ──────────────────────────────────────────

    #[tokio::test]
    async fn pairing_show_generates_code() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "pairing.show",
            ActionCategory::Platform,
            PluginType::Telegram,
            None,
        );
        let result = executor.handle_incoming_message(&msg).await.unwrap();

        match result {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                assert!(text.contains("pairing code"));
            }
            _ => panic!("Expected Action result"),
        }
    }

    #[tokio::test]
    async fn pairing_check_authorized() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "pairing.check",
            ActionCategory::Platform,
            PluginType::Telegram,
            None,
        );
        let result = executor.handle_incoming_message(&msg).await.unwrap();

        match result {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                assert!(text.contains("authorized"));
            }
            _ => panic!("Expected Action result"),
        }
    }

    #[tokio::test]
    async fn pairing_check_not_authorized() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_99", // different user
            "chat_1",
            "pairing.check",
            ActionCategory::Platform,
            PluginType::Telegram,
            None,
        );
        // tg_99 is not authorized, but the action itself needs the user to be authorized
        // first (it's routed via handle_incoming_message which checks auth first)
        // So for this test, authorize tg_99 too
        repo.add_authorized_user("tg_99", "telegram");

        let result = executor.handle_incoming_message(&msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                // tg_99 is authorized
                assert!(text.contains("authorized"));
            }
            _ => panic!("Expected Action result"),
        }
    }

    #[tokio::test]
    async fn pairing_help_returns_instructions() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "pairing.help",
            ActionCategory::Platform,
            PluginType::Telegram,
            None,
        );
        let result = executor.handle_incoming_message(&msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                assert!(text.contains("authorization"));
            }
            _ => panic!("Expected Action result"),
        }
    }

    // ── System action tests ────────────────────────────────────────────

    #[tokio::test]
    async fn session_new_creates_session() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "session.new",
            ActionCategory::System,
            PluginType::Telegram,
            None,
        );
        let result = executor.handle_incoming_message(&msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                assert!(text.contains("New session"));
                // With no client_preferences configured the agent defaults to
                // the internal one, which is shown under its brand.
                assert!(text.contains("paviirs"), "unexpected reply: {text}");
                assert!(!text.contains("aionrs"), "the internal token must not reach the chat");
            }
            _ => panic!("Expected Action result"),
        }
    }

    #[tokio::test]
    async fn session_new_resets_existing_session() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        // First: send a text message to create a session
        let text_msg = make_text_message("tg_42", "chat_1", "Hello", PluginType::Telegram);
        let r1 = executor.handle_incoming_message(&text_msg).await.unwrap();
        let sid1 = match r1 {
            MessageResult::Dispatched { session_id, .. } => session_id,
            _ => panic!("Expected Dispatched"),
        };

        // Then: session.new should delete old + create fresh
        let new_msg = make_action_message(
            "tg_42",
            "chat_1",
            "session.new",
            ActionCategory::System,
            PluginType::Telegram,
            None,
        );
        let r2 = executor.handle_incoming_message(&new_msg).await.unwrap();
        match r2 {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                assert!(text.contains("New session"));
            }
            _ => panic!("Expected Action result"),
        }

        // Send another text message — the session ID should differ
        let text_msg2 = make_text_message("tg_42", "chat_1", "Again", PluginType::Telegram);
        let r3 = executor.handle_incoming_message(&text_msg2).await.unwrap();
        let sid3 = match r3 {
            MessageResult::Dispatched { session_id, .. } => session_id,
            _ => panic!("Expected Dispatched"),
        };
        // New session has different full ID (reset deleted the old one)
        assert_ne!(sid1, sid3);

        // Only 1 session should exist for this user+chat
        let sessions = repo.sessions.lock().unwrap();
        let user_chat_sessions: Vec<_> = sessions
            .iter()
            .filter(|s| s.user_id == "user_tg_42" && s.chat_id.as_deref() == Some("chat_1"))
            .collect();
        assert_eq!(user_chat_sessions.len(), 1);
    }

    #[tokio::test]
    async fn session_status_shows_info() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "session.status",
            ActionCategory::System,
            PluginType::Telegram,
            None,
        );
        let result = executor.handle_incoming_message(&msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                assert!(text.contains("Session:"));
                assert!(text.contains("Agent:"));
            }
            _ => panic!("Expected Action result"),
        }
    }

    #[tokio::test]
    async fn help_show_returns_menu() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "help.show",
            ActionCategory::System,
            PluginType::Telegram,
            None,
        );
        let result = executor.handle_incoming_message(&msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                assert!(resp.text.is_some());
                assert!(resp.buttons.is_some());
                let buttons = resp.buttons.unwrap();
                assert!(buttons.len() >= 2); // at least 2 rows
                assert!(
                    !buttons.iter().flatten().any(|button| button.action == "agent.show"),
                    "help menu must not expose direct agent selection"
                );
            }
            _ => panic!("Expected Action result"),
        }
    }

    #[tokio::test]
    async fn agent_show_is_treated_as_unknown_action() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "agent.show",
            ActionCategory::System,
            PluginType::Telegram,
            None,
        );
        let result = executor.handle_incoming_message(&msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                assert!(text.contains("Unknown action"));
                assert!(text.contains("agent.show"));
            }
            _ => panic!("Expected Action result"),
        }
    }

    #[tokio::test]
    async fn agent_select_is_treated_as_unknown_action() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let params = HashMap::from([("agentType".into(), "acp".into())]);
        let select_msg = make_action_message(
            "tg_42",
            "chat_1",
            "agent.select",
            ActionCategory::System,
            PluginType::Telegram,
            Some(params),
        );
        let result = executor.handle_incoming_message(&select_msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                assert!(text.contains("Unknown action"));
                assert!(text.contains("agent.select"));
            }
            _ => panic!("Expected Action result"),
        }
    }

    // ── Chat action tests ──────────────────────────────────────────────

    /// Send a `system.confirm` with whatever params, and return the error.
    async fn confirm_error(params: HashMap<String, String>) -> ChannelError {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "system.confirm",
            ActionCategory::Chat,
            PluginType::Telegram,
            Some(params),
        );
        executor
            .handle_incoming_message(&msg)
            .await
            .expect_err("a confirm with nothing behind it must not report success")
    }

    #[tokio::test]
    async fn system_confirm_without_an_approval_service_says_so() {
        // Reporting success here would tell the user their answer landed while
        // the agent stayed blocked.
        let error = confirm_error(HashMap::from([("t".into(), "abc123".into()), ("v".into(), "0".into())])).await;

        assert!(
            matches!(&error, ChannelError::InvalidConfig(msg) if msg.contains("approvals")),
            "expected an approvals-not-configured error, got {error:?}"
        );
    }

    #[tokio::test]
    async fn system_confirm_rejects_a_button_with_no_ticket() {
        let error = confirm_error(HashMap::from([("v".into(), "0".into())])).await;
        assert!(
            matches!(&error, ChannelError::InvalidConfig(msg) if msg.contains("ticket") || msg.contains("approvals")),
            "expected a specific error, got {error:?}"
        );
    }

    #[tokio::test]
    async fn system_confirm_rejects_a_non_numeric_choice() {
        // Falling back to index 0 would authorize whatever happens to be first.
        let error = confirm_error(HashMap::from([
            ("t".into(), "abc123".into()),
            ("v".into(), "not-a-number".into()),
        ]))
        .await;
        assert!(
            matches!(&error, ChannelError::InvalidConfig(msg) if msg.contains("choice") || msg.contains("approvals")),
            "expected a specific error, got {error:?}"
        );
    }

    #[tokio::test]
    async fn action_copy_returns_answer() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "action.copy",
            ActionCategory::Chat,
            PluginType::Telegram,
            None,
        );
        let result = executor.handle_incoming_message(&msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                assert_eq!(resp.behavior, ActionBehavior::Answer);
                assert!(resp.toast.as_deref().unwrap().contains("Copied"));
            }
            _ => panic!("Expected Action result"),
        }
    }

    // ── Unknown action tests ───────────────────────────────────────────

    #[tokio::test]
    async fn unknown_platform_action() {
        let (executor, repo) = setup();
        repo.add_authorized_user("tg_42", "telegram");

        let msg = make_action_message(
            "tg_42",
            "chat_1",
            "unknown.action",
            ActionCategory::Platform,
            PluginType::Telegram,
            None,
        );
        let result = executor.handle_incoming_message(&msg).await.unwrap();
        match result {
            MessageResult::Action(resp) => {
                let text = resp.text.unwrap();
                assert!(text.contains("Unknown action"));
            }
            _ => panic!("Expected Action result"),
        }
    }

    // ── build_pairing_response tests ───────────────────────────────────

    #[test]
    fn pairing_response_contains_code() {
        let resp = build_pairing_response("123456");
        let text = resp.text.unwrap();
        assert!(text.contains("123456"));
        assert!(text.contains("pairing code"));
        assert_eq!(resp.behavior, ActionBehavior::Send);
        assert!(resp.buttons.is_some());
    }

    #[test]
    fn help_response_has_buttons() {
        let resp = build_help_response();
        assert!(resp.text.is_some());
        let buttons = resp.buttons.unwrap();
        assert!(!buttons.is_empty());
    }

    #[test]
    fn unknown_action_response_includes_name() {
        let resp = build_unknown_action_response("foo.bar");
        let text = resp.text.unwrap();
        assert!(text.contains("foo.bar"));
    }
}
