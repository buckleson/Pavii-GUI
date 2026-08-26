//! Resolve chat-message file attachments to absolute device paths.
//!
//! The single shared point where a message's [`ChatFileRef`] list becomes
//! concrete paths, called at the send boundary by conversation + team. It
//! reproduces the legacy `[[AION_FILES]]` inlined-attachment content form so
//! every downstream consumer — aionrs `build_content_blocks`, the ACP prompt
//! (content-only), message persistence, and the user-message file chips in the
//! UI — is unchanged: only the *origin* of the paths moves from the client to
//! this backend edge.

use std::path::Path;

use aionui_api_types::ChatFileRef;
use aionui_common::constants::AIONUI_FILES_MARKER;

use crate::canonical;
use crate::service::ProjectService;
use crate::types::{FileOp, ProjectError, ReferenceInput};

/// A chat message whose attachments have been resolved to absolute paths and
/// re-inlined into [`content`](Self::content) via the `[[AION_FILES]]` marker.
#[derive(Debug)]
pub struct ResolvedChatMessage {
    /// User text with the attachment block appended (marker + one absolute path
    /// per line). Used verbatim for persistence, broadcast, and agent input.
    pub content: String,
    /// The resolved absolute paths, in order. Kept alongside `content` so
    /// aionrs's `build_content_blocks` strips the marker (files match) and
    /// re-adds its own; clearing this would leak the raw marker to aionrs.
    pub files: Vec<String>,
}

impl ProjectService {
    /// Resolve a message's `files` to absolute paths and return the inlined
    /// content. Atomic: any bad reference (unknown pe, escape, missing file,
    /// out-of-root upload, unreadable local path, failed materialization)
    /// fails the whole message.
    ///
    /// `upload_root` is the managed upload directory (`temp_dir()/aionui`);
    /// `Upload` paths must live under it.
    ///
    /// `materialize_workspace`: when set, every attachment that does not
    /// already live under this directory is COPIED into
    /// `<workspace>/attachments/` and the emitted paths point at the copies.
    /// This is what makes attachments readable by the agent CLI: its process
    /// cwd and sandbox are the workspace, while uploads land in the OS temp
    /// dir and host-picker files live anywhere — paths the CLI could not
    /// open ("the images in your message are visible in chat only",
    /// reported live 2026-08-27).
    pub async fn resolve_chat_message(
        &self,
        user_id: &str,
        content: &str,
        files: &[ChatFileRef],
        upload_root: &Path,
        materialize_workspace: Option<&Path>,
    ) -> Result<ResolvedChatMessage, ProjectError> {
        let mut paths = Vec::with_capacity(files.len());
        for file in files {
            paths.push(
                self.resolve_chat_file_ref(user_id, file, upload_root, FileOp::Read)
                    .await?,
            );
        }

        if let Some(workspace) = materialize_workspace {
            paths = materialize_attachments(workspace, paths).await?;
        }

        let content = if paths.is_empty() {
            content.to_owned()
        } else {
            format!("{content}\n\n{AIONUI_FILES_MARKER}\n{}", paths.join("\n"))
        };
        Ok(ResolvedChatMessage { content, files: paths })
    }

    /// Resolve a single [`ChatFileRef`] to an absolute device path.
    ///
    /// The per-ref identity→path core shared by [`resolve_chat_message`](Self::resolve_chat_message)
    /// (send boundary) and the preview content endpoint (`aionui-file`, cross-crate — hence `pub`).
    /// Guards differ by variant:
    /// - `Project` → [`resolve_reference`](Self::resolve_reference) with the caller's `op` (lexical +
    ///   realpath containment; read paths pass `Read`, the write endpoint passes `Write`); must exist
    ///   (file or folder).
    /// - `Upload` → an existing regular file under the managed `upload_root` (D2 invariant).
    /// - `Local` → a canonicalized existing regular file; **no sandbox** (the host picker that
    ///   produced it already exposes the whole filesystem).
    ///
    /// `op` only affects the `Project` arm's containment mode; `Upload`/`Local` are path-based and
    /// identical regardless of op.
    pub async fn resolve_chat_file_ref(
        &self,
        user_id: &str,
        file: &ChatFileRef,
        upload_root: &Path,
        op: FileOp,
    ) -> Result<String, ProjectError> {
        match file {
            ChatFileRef::Project { pe_id, relative_path } => {
                let resolved = self
                    .resolve_reference(
                        user_id,
                        ReferenceInput {
                            pe_id: pe_id.clone(),
                            relative_path: relative_path.clone(),
                            op,
                        },
                    )
                    .await?;
                let abs = resolved.absolute_path.ok_or_else(|| ProjectError::ChatFileMissing {
                    path: relative_path.clone(),
                })?;
                // A project ref may point at a file or a folder (the tree
                // allows attaching a directory); require only that it exists.
                if !Path::new(&abs).exists() {
                    return Err(ProjectError::ChatFileMissing { path: abs });
                }
                Ok(abs)
            }
            ChatFileRef::Upload { path } => {
                let candidate = Path::new(path);
                if !candidate.is_file() {
                    return Err(ProjectError::ChatFileMissing { path: path.clone() });
                }
                if !path_within(upload_root, candidate) {
                    return Err(ProjectError::UploadPathOutsideRoot { path: path.clone() });
                }
                Ok(path.clone())
            }
            ChatFileRef::Local { path } => {
                // A path the user explicitly picked in the host-file browser,
                // which already exposes the whole filesystem. No managed-root
                // restriction (that is the upload channel's D2 invariant only);
                // just canonicalize (collapsing `..`/symlinks) and require an
                // existing regular file.
                let canonical = std::fs::canonicalize(path)
                    .map_err(|_| ProjectError::LocalPathNotReadable { path: path.clone() })?;
                if !canonical.is_file() {
                    return Err(ProjectError::LocalPathNotReadable { path: path.clone() });
                }
                Ok(canonical.to_string_lossy().into_owned())
            }
        }
    }

    /// Upgrade a [`ChatFileRef`] to its strongest identity for `project_id`.
    ///
    /// A file opened from the explorer arrives as `Project{pe_id, relative_path}`,
    /// but the same file opened from a chat link arrives as `Local{path}` — two
    /// unequal refs for one file, so anything keyed on the ref (tab dedupe, the
    /// `fs` channel's change signal) treats them as different files. This turns a
    /// `Local` path that happens to live under one of the project's roots into the
    /// `Project` form, so equality reduces to comparing ref keys.
    ///
    /// Best-effort by design: a ref that cannot be upgraded is returned unchanged
    /// rather than rejected. Callers use the result for addressing, so "no stronger
    /// identity available" is a normal outcome, not an error.
    ///
    /// # Platform casing
    ///
    /// Whether two paths naming the same file compare equal is a platform
    /// property: `fs::canonicalize` resolves through a case-insensitive volume on
    /// macOS/Windows but not on Linux, the same divide
    /// [`canonical::IGNORE_PATH_CASING`] encodes for lexical identity. A caller
    /// doing its own `starts_with` on raw strings would miss matches on macOS and —
    /// worse — conflate distinct files on Linux, which is why this lives on the
    /// backend. Comparison here is between two realpaths, so the platform's own
    /// rule applies rather than a folding step of ours.
    pub async fn upgrade_chat_file_ref(
        &self,
        user_id: &str,
        project_id: &str,
        file: &ChatFileRef,
    ) -> Result<ChatFileRef, ProjectError> {
        // `Project` is already terminal, and `Upload` lives in a managed directory
        // that belongs to no root. Returning early also keeps the explorer's own
        // open path (already `Project`) from paying for a lookup it cannot use.
        let ChatFileRef::Local { path } = file else {
            return Ok(file.clone());
        };

        // Resolve symlinks and `..` before comparing, matching `path_within` and
        // `realpath_within`. A path that does not exist cannot be placed under a
        // root, and the caller still has a missing-file state to render, so keep the
        // local ref rather than failing.
        let Ok(absolute) = std::fs::canonicalize(path) else {
            return Ok(file.clone());
        };

        match self.find_owning_entry(user_id, project_id, &absolute).await? {
            Some((pe_id, relative_path)) => Ok(ChatFileRef::Project { pe_id, relative_path }),
            None => Ok(file.clone()),
        }
    }

    /// Find which of `project_id`'s roots contains `target`, with the path relative
    /// to it. `None` when the file sits outside every root. `target` must already be
    /// a realpath.
    ///
    /// The inverse of [`containment::resolve_relative`], which the codebase only had
    /// in the forward direction (given a root, is this path inside it). A project
    /// holds a handful of roots, so this walks them rather than indexing.
    ///
    /// At most one root can contain the file, so the first match is the answer:
    /// `attach_folder` focuses the existing entry when a descendant of a root is
    /// attached and rejects an ancestor as an overlap, which leaves the roots of a
    /// project mutually non-nesting.
    async fn find_owning_entry(
        &self,
        user_id: &str,
        project_id: &str,
        target: &Path,
    ) -> Result<Option<(String, String)>, ProjectError> {
        // Via the public project view rather than the store directly: this module
        // sits outside `service`, and widening the store's visibility to save one
        // hop would expose the whole data layer to every sibling module.
        let detail = self.get_project(user_id, project_id).await?;

        for entry in detail.explorer.entries {
            // Both sides must be realpaths for the prefix test to mean anything: a
            // stored root is lexical while the target came back from
            // `fs::canonicalize`, and on macOS that alone is the difference between
            // `/var/...` and `/private/var/...`.
            //
            // `uri_to_path` rather than `canonicalize`, matching `realpath_within`.
            // `canonicalize` would additionally ASCII-lowercase the path on
            // macOS/Windows, which serves lexical comparison — pointless here, since
            // the next line resolves the path for real. On a case-sensitive APFS
            // volume the lowercased form need not exist, and the failure would be
            // silent: this root would simply never match.
            let Ok(root_path) = canonical::uri_to_path(&entry.folder.resource_canonical) else {
                tracing::warn!(
                    pe_id = %entry.pe_id,
                    "stored folder URI is unparseable; skipping it while resolving a ref"
                );
                continue;
            };
            let Ok(root_path) = std::fs::canonicalize(&root_path) else {
                // A root whose folder is gone (unmounted, deleted) cannot own
                // anything; skip it instead of failing the whole lookup.
                tracing::warn!(
                    pe_id = %entry.pe_id,
                    "folder root is unreachable on disk; skipping it while resolving a ref"
                );
                continue;
            };
            // Not this root — the ordinary outcome for every root but one, so no log.
            let Ok(relative) = target.strip_prefix(&root_path) else {
                continue;
            };

            // Forward slashes on every platform: `relative_path` is a wire value
            // (protocol.md), not a host path.
            let relative_path = relative
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            return Ok(Some((entry.pe_id, relative_path)));
        }

        Ok(None)
    }
}

/// Whether `target` resolves inside `root` (both canonicalized, so `..` and
/// symlinks cannot escape). `target` is expected to exist (checked before).
fn path_within(root: &Path, target: &Path) -> bool {
    let (Ok(root), Ok(target)) = (std::fs::canonicalize(root), std::fs::canonicalize(target)) else {
        return false;
    };
    target.starts_with(root)
}

/// Copy resolved attachments into `<workspace>/attachments/`, returning the
/// destination paths. Files already under the workspace are passed through
/// untouched (a project-conversation attachment may already be in the cwd).
///
/// Collision policy: an existing destination with the SAME byte length is
/// reused (re-sending the same file must not spawn `name (2).ext` copies);
/// a different length gets a ` (N)` suffix like the upload store does.
async fn materialize_attachments(workspace: &Path, paths: Vec<String>) -> Result<Vec<String>, ProjectError> {
    if paths.is_empty() {
        return Ok(paths);
    }
    let attachments_dir = workspace.join("attachments");
    let mut out = Vec::with_capacity(paths.len());
    for source in paths {
        let source_path = Path::new(&source);
        if path_within(workspace, source_path) {
            out.push(source);
            continue;
        }
        tokio::fs::create_dir_all(&attachments_dir)
            .await
            .map_err(|e| ProjectError::AttachmentCopyFailed {
                path: attachments_dir.to_string_lossy().into_owned(),
                reason: e.to_string(),
            })?;
        let source_len = tokio::fs::metadata(source_path)
            .await
            .map_err(|e| ProjectError::AttachmentCopyFailed {
                path: source.clone(),
                reason: e.to_string(),
            })?
            .len();
        let file_name = source_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "attachment".to_owned());
        let (stem, ext) = match file_name.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() => (stem.to_owned(), format!(".{ext}")),
            _ => (file_name.clone(), String::new()),
        };
        let mut dest = attachments_dir.join(&file_name);
        let mut suffix = 2u32;
        loop {
            match tokio::fs::metadata(&dest).await {
                Err(_) => break,
                Ok(existing) if existing.len() == source_len => break,
                Ok(_) => {
                    dest = attachments_dir.join(format!("{stem} ({suffix}){ext}"));
                    suffix += 1;
                    if suffix > 100 {
                        return Err(ProjectError::AttachmentCopyFailed {
                            path: source.clone(),
                            reason: "too many name collisions in attachments dir".to_owned(),
                        });
                    }
                }
            }
        }
        let already_there = tokio::fs::metadata(&dest)
            .await
            .map(|existing| existing.len() == source_len)
            .unwrap_or(false);
        if !already_there {
            tokio::fs::copy(source_path, &dest)
                .await
                .map_err(|e| ProjectError::AttachmentCopyFailed {
                    path: source.clone(),
                    reason: e.to_string(),
                })?;
        }
        out.push(dest.to_string_lossy().into_owned());
    }
    Ok(out)
}

#[cfg(test)]
#[path = "chat_files_test.rs"]
mod chat_files_test;
