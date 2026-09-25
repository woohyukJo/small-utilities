!macro customCheckAppRunning
  nsExec::ExecToStack '"$SYSDIR\sc.exe" stop BreakdownGuard'
  Pop $0
  Pop $1
  Sleep 2500
!macroend
!macro customInstall
  nsExec::ExecToStack '"$INSTDIR\resources\guard\Breakdown.Guard.exe" --configure --app "$INSTDIR\BREAKDOWN.exe"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "BREAKDOWN service configuration failed."
    Abort
  ${EndIf}
  SetShellVarContext all
  nsExec::ExecToStack '"$SYSDIR\icacls.exe" "$APPDATA\BREAKDOWN" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "BREAKDOWN data permissions could not be configured."
    Abort
  ${EndIf}
  ; The helper uses ArgumentList instead of nested NSIS/CRT path quoting.
  nsExec::ExecToStack '"$INSTDIR\resources\guard\Breakdown.Guard.exe" --register-service'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "BREAKDOWN service registration failed (exit $0).$\r$\n$1$\r$\nDetails: $APPDATA\BREAKDOWN\install-service.log"
    Abort
  ${EndIf}
!macroend
!macro customUnInstall
  nsExec::ExecToStack '"$SYSDIR\sc.exe" stop BreakdownGuard'
  Pop $0
  Pop $1
  Sleep 2500
  nsExec::ExecToStack '"$SYSDIR\sc.exe" delete BreakdownGuard'
  Pop $0
  Pop $1
  ; Retain user profile/data. Never touch MIUUYY or Codex.
!macroend
