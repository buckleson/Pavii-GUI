use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// PATH that replaces the process `$PATH` for command lookups and agent
/// spawns. The desktop shell sets it when the user's PATH changed after the
/// engine started (a CLI installed while the app is running), so detection
/// does not need a restart. Kept here instead of `std::env::set_var`, which is
/// unsound in a multi-threaded process.
static PATH_OVERRIDE: RwLock<Option<OsString>> = RwLock::new(None);

/// Replace the PATH used for command resolution and agent subprocesses.
/// An empty value clears the override.
pub fn set_path_override(path: Option<OsString>) {
    let value = path.filter(|p| !p.is_empty());
    *PATH_OVERRIDE.write().unwrap_or_else(|e| e.into_inner()) = value;
}

/// The PATH set by [`set_path_override`], if any.
pub fn path_override() -> Option<OsString> {
    PATH_OVERRIDE.read().unwrap_or_else(|e| e.into_inner()).clone()
}

fn which_any(cmd: &str) -> Option<PathBuf> {
    match path_override() {
        Some(path) => {
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            which::which_in(cmd, Some(OsStr::new(&path)), cwd).ok()
        }
        None => which::which(cmd).ok(),
    }
}

/// Resolve a command name to an absolute path.
///
/// Commands are resolved from the startup-enhanced `$PATH` via
/// `which::which`, or from the PATH override when one is set.
///
/// On Windows, if a bare name lookup fails we retry with the common
/// shim suffixes (`.cmd`, `.ps1`, `.bat`). Tools installed via npm
/// global / pnpm / yarn typically ship as `name.cmd`, and a user with a
/// trimmed `PATHEXT` would otherwise see them as missing.
pub fn resolve_command_path(cmd: &str) -> Option<PathBuf> {
    which_any(cmd).or_else(|| windows_shim_fallback(cmd))
}

#[cfg(windows)]
fn windows_shim_fallback(cmd: &str) -> Option<PathBuf> {
    // If the caller already passed an extension, no point retrying.
    if Path::new(cmd).extension().is_some() {
        return None;
    }
    for ext in ["cmd", "ps1", "bat"] {
        if let Some(p) = which_any(&format!("{cmd}.{ext}")) {
            return Some(p);
        }
    }
    None
}

#[cfg(not(windows))]
fn windows_shim_fallback(_cmd: &str) -> Option<PathBuf> {
    None
}

/// Resolve `cmd` to an absolute path **within `dir` only** — does not walk
/// `PATH`. Honours `PATHEXT` (so `widget.exe` is found on Windows), and on
/// Windows additionally tries `.cmd`, `.ps1`, `.bat` shim suffixes for
/// npm-/pnpm-installed CLIs whose extension `PATHEXT` may not list.
///
/// `dir` is wrapped via `std::env::join_paths` before being handed to
/// `which::which_in`, so a `dir` that itself contains the OS PATH
/// separator (`:` on Unix, `;` on Windows) cannot be misinterpreted as
/// two directories. If `dir` cannot be expressed as a single PATH
/// entry, we return `None` rather than searching a phantom location.
///
/// Returns `None` if the command cannot be resolved inside the directory.
pub fn resolve_command_in(cmd: &str, dir: &Path) -> Option<PathBuf> {
    let paths = std::env::join_paths([dir]).ok()?;
    if let Ok(p) = which::which_in(cmd, Some(&paths), dir) {
        return Some(p);
    }
    windows_shim_fallback_in(cmd, dir)
}

/// Try `cmd` plus the common Windows shim suffixes (`.cmd`, `.ps1`, `.bat`)
/// inside a single directory. Used by `resolve_command_in` for callers that
/// want a directory-scoped lookup (the global `windows_shim_fallback` below
/// goes through `which::which`, which walks the entire `PATH`).
#[cfg(windows)]
fn windows_shim_fallback_in(cmd: &str, dir: &Path) -> Option<PathBuf> {
    if Path::new(cmd).extension().is_some() {
        return None;
    }
    for ext in ["cmd", "ps1", "bat"] {
        let candidate = dir.join(format!("{cmd}.{ext}"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(not(windows))]
fn windows_shim_fallback_in(_cmd: &str, _dir: &Path) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn resolve_command_in_finds_executable_in_dir() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::TempDir::new().unwrap();
        let bin = tmp.path().join("widget");
        std::fs::write(&bin, b"#!/bin/sh\necho hi\n").unwrap();
        let mut perms = std::fs::metadata(&bin).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&bin, perms).unwrap();

        let found = resolve_command_in("widget", tmp.path()).expect("must find");
        assert_eq!(found, bin);
    }

    #[test]
    fn resolve_command_in_returns_none_for_missing_command() {
        let tmp = tempfile::TempDir::new().unwrap();
        let found = resolve_command_in("definitely-not-here", tmp.path());
        assert!(found.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_command_in_handles_dir_with_colon_safely() {
        // A path containing `:` is a separator-collision hazard for the
        // PATH string `which_in` consumes. We must NOT internally split
        // and search a wrong second segment — return None instead.
        let tmp = tempfile::TempDir::new().unwrap();
        let weird = tmp.path().join("with:colon");
        std::fs::create_dir(&weird).unwrap();
        // No `widget` file is created anywhere — the only way this could
        // return Some is if the function wrongly split `with:colon` and
        // found something in another segment.
        let found = resolve_command_in("widget", &weird);
        assert!(found.is_none(), "must not split on `:` inside dir; got {:?}", found);
    }

    #[cfg(windows)]
    #[test]
    fn resolve_command_in_falls_back_to_cmd_shim_on_windows() {
        // Simulate an npm-installed CLI: only `widget.cmd` exists, not `widget.exe`.
        let tmp = tempfile::TempDir::new().unwrap();
        let shim = tmp.path().join("widget.cmd");
        std::fs::write(&shim, b"@echo off\r\necho hi\r\n").unwrap();

        let found = resolve_command_in("widget", tmp.path()).expect("must find shim");
        assert!(
            found.to_string_lossy().to_lowercase().ends_with("widget.cmd"),
            "expected the .cmd shim; got {}",
            found.display()
        );
    }

    // ---- PATH override -------------------------------------------------
    //
    // The override is process-global. Each test below re-runs itself in a
    // child test process (`run_in_env_child`), so setting it can never leak
    // into, or race with, any other test in this binary. The guard still
    // clears it on exit (including panics) as a second line of defence.

    const OVERRIDE_WIDGET: &str = "aionui-path-override-widget";

    struct ClearOverrideOnDrop;

    impl Drop for ClearOverrideOnDrop {
        fn drop(&mut self) {
            set_path_override(None);
        }
    }

    fn fresh_override_child(test_name: &str) -> bool {
        crate::test_support::run_in_env_child(test_name, |_| {})
    }

    /// Create a fake CLI named `name` inside `dir` and return its path.
    #[cfg(unix)]
    fn write_fake_cli(dir: &Path, name: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let bin = dir.join(name);
        std::fs::write(&bin, b"#!/bin/sh\necho hi\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    /// Create a fake npm-style CLI shim (`name.cmd`) inside `dir`.
    #[cfg(windows)]
    fn write_fake_cli(dir: &Path, name: &str) -> PathBuf {
        let shim = dir.join(format!("{name}.cmd"));
        std::fs::write(&shim, b"@echo off\r\necho hi\r\n").unwrap();
        shim
    }

    fn assert_resolved_inside(found: &Path, dir: &Path) {
        let found = std::fs::canonicalize(found).unwrap();
        let dir = std::fs::canonicalize(dir).unwrap();
        assert!(
            found.starts_with(&dir),
            "expected {} to resolve inside {}",
            found.display(),
            dir.display()
        );
    }

    #[test]
    fn path_override_makes_command_in_override_dir_resolvable() {
        if !fresh_override_child("resolver::tests::path_override_makes_command_in_override_dir_resolvable") {
            return;
        }
        let _reset = ClearOverrideOnDrop;
        let tmp = tempfile::TempDir::new().unwrap();
        write_fake_cli(tmp.path(), OVERRIDE_WIDGET);

        assert_eq!(path_override(), None);
        assert!(
            resolve_command_path(OVERRIDE_WIDGET).is_none(),
            "fake CLI must not be on the process PATH before the override"
        );

        set_path_override(Some(tmp.path().as_os_str().to_owned()));

        assert_eq!(path_override().as_deref(), Some(tmp.path().as_os_str()));
        let found = resolve_command_path(OVERRIDE_WIDGET).expect("override dir must be searched");
        assert_resolved_inside(&found, tmp.path());
    }

    #[test]
    fn clearing_path_override_with_none_restores_process_path_lookup() {
        if !fresh_override_child("resolver::tests::clearing_path_override_with_none_restores_process_path_lookup") {
            return;
        }
        let _reset = ClearOverrideOnDrop;
        let tmp = tempfile::TempDir::new().unwrap();
        write_fake_cli(tmp.path(), OVERRIDE_WIDGET);

        set_path_override(Some(tmp.path().as_os_str().to_owned()));
        assert!(resolve_command_path(OVERRIDE_WIDGET).is_some());

        set_path_override(None);

        assert_eq!(path_override(), None);
        assert!(
            resolve_command_path(OVERRIDE_WIDGET).is_none(),
            "after clearing, lookups must fall back to the process PATH"
        );
    }

    #[test]
    fn empty_path_override_is_treated_as_cleared() {
        if !fresh_override_child("resolver::tests::empty_path_override_is_treated_as_cleared") {
            return;
        }
        let _reset = ClearOverrideOnDrop;
        let tmp = tempfile::TempDir::new().unwrap();
        write_fake_cli(tmp.path(), OVERRIDE_WIDGET);

        set_path_override(Some(tmp.path().as_os_str().to_owned()));
        assert!(path_override().is_some());

        set_path_override(Some(OsString::new()));

        assert_eq!(
            path_override(),
            None,
            "an empty PATH must clear the override, not store \"\""
        );
        assert!(resolve_command_path(OVERRIDE_WIDGET).is_none());
    }

    #[test]
    fn empty_path_override_on_fresh_state_stays_cleared() {
        if !fresh_override_child("resolver::tests::empty_path_override_on_fresh_state_stays_cleared") {
            return;
        }
        let _reset = ClearOverrideOnDrop;

        set_path_override(Some(OsString::new()));

        assert_eq!(path_override(), None);
    }

    #[test]
    fn path_override_replaces_rather_than_extends_process_path() {
        if !fresh_override_child("resolver::tests::path_override_replaces_rather_than_extends_process_path") {
            return;
        }
        let _reset = ClearOverrideOnDrop;
        // A command that is always on the process PATH of a test machine.
        let always_present = if cfg!(windows) { "cmd" } else { "sh" };
        if resolve_command_path(always_present).is_none() {
            // Unusual sandbox without the system shell on PATH; nothing to prove.
            return;
        }
        let empty = tempfile::TempDir::new().unwrap();

        set_path_override(Some(empty.path().as_os_str().to_owned()));

        assert!(
            resolve_command_path(always_present).is_none(),
            "with an override set, the process PATH must not be searched"
        );
    }
}
