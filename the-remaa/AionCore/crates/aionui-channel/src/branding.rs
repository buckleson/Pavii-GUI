//! Branding for text a chat channel shows.
//!
//! `aionrs` is the internal agent identifier and a wire contract: it is the
//! serialized `AgentType`, the value stored in `conversations.type`, the name of
//! on-disk `.aionrs/` directories, and a settings key. It must not be renamed
//! (`aionui-conversation/src/session_context.rs` says so at the one place that
//! already brands a derived name).
//!
//! So it is branded where it is *displayed* instead, which is what the desktop
//! app does in `packages/desktop/src/common/utils/assistantBranding.ts`. The
//! channel commands were a new display surface with no such layer, so the raw
//! token reached the chat -- in `/new`, in `/status`, and inside conversation
//! titles like `tg-aionrs-<chat>`.
//!
//! Rewriting on the way out rather than in the row means history is covered
//! too: conversations and temp workspaces created before the rebrand keep their
//! stored names and still read correctly.

use std::sync::LazyLock;

use regex::Regex;

/// The internal identifier, never shown.
pub const INTERNAL_AGENT_TOKEN: &str = "aionrs";

/// What the internal agent is called in anything a user reads.
pub const BRANDED_AGENT_TOKEN: &str = "paviirs";

/// Matches the identifier only as a whole token.
///
/// Word boundaries rather than a plain substring replace, so `tg-aionrs-123`
/// and `aionrs-temp-abc` are caught while a longer word that merely contains
/// the letters is left alone.
static AGENT_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\baionrs\b").expect("agent token pattern is a valid regex"));

/// Brand an agent type for display.
///
/// Every other agent type is its own product name already (`acp`, `codex`,
/// `antigravity`, ...) and passes through untouched.
pub fn brand_agent_label(agent_type: &str) -> String {
    brand_display_text(agent_type)
}

/// Brand any stored string on its way to a chat.
///
/// Used for conversation titles and project names, which were written before
/// this branding existed and still carry the raw token.
pub fn brand_display_text(text: &str) -> String {
    if !text.contains(INTERNAL_AGENT_TOKEN) {
        // The common case; avoids building a new String for every row.
        return text.to_owned();
    }
    AGENT_TOKEN.replace_all(text, BRANDED_AGENT_TOKEN).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brands_the_agent_type_on_its_own() {
        assert_eq!(brand_agent_label("aionrs"), "paviirs");
    }

    #[test]
    fn leaves_every_other_agent_type_alone() {
        // These are already product names; rewriting them would be wrong.
        for agent_type in ["acp", "codex", "antigravity", "nanobot", "remote", "gemini"] {
            assert_eq!(brand_agent_label(agent_type), agent_type);
        }
    }

    #[test]
    fn brands_the_token_inside_a_channel_conversation_title() {
        // `channel_conversation_name` builds these; rows written before the
        // rebrand still carry the raw token.
        assert_eq!(brand_display_text("tg-aionrs-123456"), "tg-paviirs-123456");
    }

    #[test]
    fn brands_a_legacy_temp_workspace_name() {
        // New temp workspaces are already "pavii-temp-"; older ones are not.
        assert_eq!(brand_display_text("aionrs-temp-conv-1"), "paviirs-temp-conv-1");
    }

    #[test]
    fn brands_every_occurrence_not_just_the_first() {
        assert_eq!(brand_display_text("aionrs and aionrs"), "paviirs and paviirs");
    }

    #[test]
    fn leaves_text_without_the_token_untouched() {
        for text in ["Morning briefing", "acp-temp-conv-2", "", "   "] {
            assert_eq!(brand_display_text(text), text);
        }
    }

    #[test]
    fn does_not_rewrite_a_longer_word_that_merely_contains_the_letters() {
        // A user-named conversation must not be mangled.
        assert_eq!(brand_display_text("xaionrsy"), "xaionrsy");
        assert_eq!(brand_display_text("aionrsx"), "aionrsx");
    }

    #[test]
    fn is_idempotent() {
        // Branding twice must not produce "paviirsrs" or similar.
        let once = brand_display_text("tg-aionrs-1");
        assert_eq!(brand_display_text(&once), once);
    }

    #[test]
    fn the_branded_token_does_not_contain_the_internal_one() {
        // What makes idempotency hold; a future rename must preserve it.
        assert!(!BRANDED_AGENT_TOKEN.contains(INTERNAL_AGENT_TOKEN));
    }
}
