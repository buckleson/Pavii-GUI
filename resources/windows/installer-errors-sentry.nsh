!ifndef AIONUI_INSTALLER_ERRORS_SENTRY_NSH
!define AIONUI_INSTALLER_ERRORS_SENTRY_NSH

!include "${PROJECT_DIR}\resources\windows\support\_sentry-dsn.generated.nsh"
!include "${PROJECT_DIR}\resources\windows\installer-messages.nsh"

!define AIONUI_E_UNINSTALLER_COPY_OR_REBUILD_FAILED "E1001"
!define AIONUI_E_OLD_UNINSTALL_FAILED "E1002"
!define AIONUI_E_INSTALL_DIR_REMOVE_OR_LOCKED "E1003"
!define AIONUI_E_EXTRACT_FAILED "E1010"
!define AIONUI_E_DISK_INSUFFICIENT "E1020"
!define AIONUI_E_BUNDLED_AIONCORE_INCOMPLETE "E1030"
!define AIONUI_E_CORE_APP_FILES_INCOMPLETE "E1031"
!define AIONUI_E_ARCH_MISMATCH "E1040"
!define AIONUI_E_ACTIVE_INSTALLER_CONFLICT "E1050"
!define AIONUI_E_REGISTRY_STATE_INVALID "E1060"
!define AIONUI_E_ACTIVE_MARKER_WRITE_FAILED "E1070"
!define AIONUI_E_INVALID_INSTALL_PATH "E1090"

/*
 * Transactional-update snapshot. During an update, customRemoveFiles renames
 * the working install to `$INSTDIR.__old` and records it here INSTEAD of
 * deleting it; only a fully verified install (customInstall) deletes the
 * snapshot. Any fatal failure in between restores it, so a failed update can
 * never leave the machine without a bootable app — which is exactly what
 * happened live on 2026-08-27 (E1010 after the old install was gone).
 */
Var /GLOBAL AionUiOldSnapshotPath

!macro AIONUI_ROLLBACK_OLD_SNAPSHOT
  ${If} $AionUiOldSnapshotPath != ""
    ${If} ${FileExists} "$AionUiOldSnapshotPath\*.*"
      ; The extractor may have left $INSTDIR as the installer's own OutPath,
      ; which would self-lock the rename below. ($AionUiCurrentOutDir is
      ; deliberately not updated here: it lives in process-control.nsh, which
      ; the failure-messagebox smoke harness does not include, and after a
      ; rollback the session ends in Quit anyway.)
      SetOutPath $TEMP
      RMDir /r "$INSTDIR.__failed"
      ClearErrors
      Rename "$INSTDIR" "$INSTDIR.__failed"
      ClearErrors
      Rename "$AionUiOldSnapshotPath" "$INSTDIR"
      ${If} ${Errors}
        !insertmacro AIONUI_SLOG "event=rollback-failed snapshot=$AionUiOldSnapshotPath instDir=$INSTDIR"
      ${Else}
        !insertmacro AIONUI_SLOG "event=rollback-restored snapshot=$AionUiOldSnapshotPath instDir=$INSTDIR"
        RMDir /r "$INSTDIR.__failed"
      ${EndIf}
    ${EndIf}
    StrCpy $AionUiOldSnapshotPath ""
  ${EndIf}
!macroend

/*
 * Free-space gate (E1020).
 *
 * Until now E1020 was defined and never raised: nothing anywhere measured disk
 * space, so running out of it surfaced as whatever happened to fail first --
 * a half-written payload reported as E1010 "could not extract", which reads as
 * a corrupt download and sends the user to re-download instead of freeing
 * space. This checks before anything is mutated and says the true cause.
 *
 * Threshold: a complete install occupies 1022 MB (measured 2026-08-28;
 * 704 MB of that is `resources`). On an update the previous install is
 * RENAMED to the snapshot, which costs nothing on the same volume, so either
 * path needs room for one fresh payload. The margin covers version growth,
 * the installer's own temp extraction, and filesystem slack.
 */
!define AIONUI_MIN_FREE_MB 1536

Var /GLOBAL AionUiFreeMbExit
Var /GLOBAL AionUiFreeMb

; Sets $AionUiFreeMb to the free megabytes on $INSTDIR's volume, or "" when it
; cannot be measured. Never fails or prompts — callers decide what to do.
!macro AIONUI_MEASURE_FREE_MB
  StrCpy $AionUiFreeMb ""
  ; AvailableFreeSpace, not TotalFreeSpace: it honours a per-user disk quota,
  ; which is what this installer can actually write.
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$root = [System.IO.Path]::GetPathRoot('$INSTDIR'); \
    if (-not $$root) { exit }; \
    $$drive = New-Object System.IO.DriveInfo $$root; \
    if (-not $$drive.IsReady) { exit }; \
    [Console]::Out.Write([string][math]::Floor($$drive.AvailableFreeSpace / 1MB)) \
  }"`
  Pop $AionUiFreeMbExit
  Pop $AionUiFreeMb
!macroend

!macro AIONUI_ASSERT_FREE_SPACE _PHASE
  !insertmacro AIONUI_MEASURE_FREE_MB

  ${If} $AionUiFreeMb == ""
    ; Fail OPEN. A broken probe must never block an install that would have
    ; worked; the unknown is recorded so a support log still shows we looked.
    !insertmacro AIONUI_LOG_EVENT "event=disk-check result=unknown phase=${_PHASE} exit=$AionUiFreeMbExit instDir=$INSTDIR"
  ${ElseIf} $AionUiFreeMb < ${AIONUI_MIN_FREE_MB}
    !insertmacro AIONUI_LOG_EVENT "event=disk-check result=insufficient phase=${_PHASE} freeMb=$AionUiFreeMb requiredMb=${AIONUI_MIN_FREE_MB} instDir=$INSTDIR"
    !insertmacro AIONUI_FAIL_REPORTABLE_DIAGNOSTICS \
      ${AIONUI_E_DISK_INSUFFICIENT} \
      "event=session-end result=fail code=${AIONUI_E_DISK_INSUFFICIENT} phase=${_PHASE} fatal=1 freeMb=$AionUiFreeMb requiredMb=${AIONUI_MIN_FREE_MB}" \
      "${AIONUI_MSG_DISK_INSUFFICIENT_EN}" \
      "${AIONUI_MSG_DISK_INSUFFICIENT_ACTION_EN}" \
      "Free space: $AionUiFreeMb MB$\r$\nRequired: ${AIONUI_MIN_FREE_MB} MB$\r$\nInstall folder: $INSTDIR"
  ${Else}
    !insertmacro AIONUI_LOG_EVENT "event=disk-check result=ok phase=${_PHASE} freeMb=$AionUiFreeMb requiredMb=${AIONUI_MIN_FREE_MB}"
  ${EndIf}
!macroend

!macro AIONUI_FAIL_UX _CODE _DETAIL _MSG_EN _ACTION_EN _DIAGNOSTICS_EN
  !insertmacro AIONUI_ROLLBACK_OLD_SNAPSHOT
  !insertmacro AIONUI_SLOG "event=session-end result=fail code=${_CODE} detail=${_DETAIL}"
  Push $9
  ${If} ${Silent}
    StrCpy $9 "auto"
  ${Else}
    StrCpy $9 "yes"
    MessageBox MB_YESNO|MB_ICONSTOP \
      "${AIONUI_MSG_INSTALL_FAILED_EN} (${_CODE})$\r$\n$\r$\n\
      ${_MSG_EN}$\r$\n$\r$\n\
      ${AIONUI_MSG_SUGGESTED_ACTION_EN}:$\r$\n${_ACTION_EN}$\r$\n$\r$\n\
      ${AIONUI_MSG_DIAGNOSTICS_EN}:$\r$\n${_DIAGNOSTICS_EN}$\r$\n$\r$\n\
      ${AIONUI_MSG_INSTALLER_LOG_EN}:$\r$\n$AionUiSessionLogPath$\r$\n$\r$\n\
      ${AIONUI_MSG_SEND_REPORT_EN}" \
      /SD IDNO IDNO +2
    Goto +2
    StrCpy $9 "no"
  ${EndIf}
  ${If} $9 == "no"
    !insertmacro AIONUI_SLOG "event=report-skipped reason=user-declined code=${_CODE}"
  ${ElseIf} $9 == "auto"
    !insertmacro AIONUI_SLOG "event=report-auto reason=silent code=${_CODE}"
    !insertmacro AIONUI_REPORT_TO_SENTRY_NOUI "${_CODE}" "${_DETAIL}"
  ${Else}
    !insertmacro AIONUI_REPORT_TO_SENTRY "${_CODE}" "${_DETAIL}"
  ${EndIf}
  Pop $9
  !insertmacro AIONUI_CLEAR_ACTIVE_INSTALLER_MARKER
  SetErrorLevel 2
  Quit
!macroend

!macro AIONUI_FAIL_REPORTABLE _CODE _DETAIL _MSG_EN _ACTION_EN
  !insertmacro AIONUI_FAIL_UX ${_CODE} "${_DETAIL}" "${_MSG_EN}" "${_ACTION_EN}" "${_DETAIL}"
!macroend

!macro AIONUI_FAIL_REPORTABLE_ROOTED _ROOT_CODE _WRAPPER_CODE _DETAIL _MSG_EN _ACTION_EN
  !insertmacro AIONUI_FAIL_UX "${_ROOT_CODE}" "wrapperCode=${_WRAPPER_CODE} ${_DETAIL}" "${_MSG_EN}" "${_ACTION_EN}" "${_DETAIL}"
!macroend

!macro AIONUI_FAIL_REPORTABLE_DIAGNOSTICS _CODE _DETAIL _MSG_EN _ACTION_EN _DIAGNOSTICS_EN
  !insertmacro AIONUI_FAIL_UX ${_CODE} "${_DETAIL}" "${_MSG_EN}" "${_ACTION_EN}" "${_DIAGNOSTICS_EN}"
!macroend

!macro AIONUI_FAIL_REPORTABLE_ROOTED_DIAGNOSTICS _ROOT_CODE _WRAPPER_CODE _DETAIL _MSG_EN _ACTION_EN _DIAGNOSTICS_EN
  !insertmacro AIONUI_FAIL_UX "${_ROOT_CODE}" "wrapperCode=${_WRAPPER_CODE} ${_DETAIL}" "${_MSG_EN}" "${_ACTION_EN}" "${_DIAGNOSTICS_EN}"
!macroend

!macro AIONUI_REPORT_TO_SENTRY _CODE _DETAIL
  !insertmacro AIONUI_REPORT_TO_SENTRY_IMPL "${_CODE}" "${_DETAIL}" ""
!macroend

!macro AIONUI_REPORT_TO_SENTRY_NOUI _CODE _DETAIL
  !insertmacro AIONUI_REPORT_TO_SENTRY_IMPL "${_CODE}" "${_DETAIL}" "-NoUi"
!macroend

!macro AIONUI_REPORT_TO_SENTRY_IMPL _CODE _DETAIL _NO_UI
  Push $9
  InitPluginsDir
  File /oname=$PLUGINSDIR\aionui-report-installer-failure.ps1 "${PROJECT_DIR}\resources\windows\support\report-installer-failure.ps1"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\aionui-report-installer-failure.ps1" -Dsn "${AIONUI_SENTRY_DSN}" -LogPath "$AionUiSessionLogPath" -Code "${_CODE}" -Detail "${_DETAIL}" -Release "${VERSION}" -Arch "${AIONUI_TARGET_ARCH}" -Session "$AionUiSessionId" -Updated "$AionUiIsUpdated" ${_NO_UI}`
  Pop $9
  Pop $9
!macroend

!endif
