; LoadCreator uses the Windows GNU toolchain. WebView2Loader.dll is a runtime
; dependency of the generated executable and must sit next to it.

!macro NSIS_HOOK_PREINSTALL
  File "${MAINBINARYSRCPATH}\..\WebView2Loader.dll"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\WebView2Loader.dll"
!macroend
