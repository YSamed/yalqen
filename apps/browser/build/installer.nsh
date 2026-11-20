; Registers Yalqen as a browser so Windows offers it under Default apps.
;
; electron-builder cannot do this itself: `win.protocols` is macOS-only (its type
; is documented that way) and NSIS never reads it, while `fileAssociations` is
; extension-based and cannot claim http/https. So the registry layout Windows
; wants is written here.
;
; electron-builder includes this in both the installer and the uninstaller build,
; so customUnInstall below cleans up what customInstall wrote.

!define YALQEN_CLIENT_KEY "Software\Clients\StartMenuInternet\${APP_EXECUTABLE_FILENAME}"

; A protocol ProgID. Windows refuses a generic ProgID for a URL scheme, and the
; `URL Protocol` value is what marks the key as a scheme handler rather than a
; file handler. Deliberately not the executable name: ProgIDs have no extension.
!define YALQEN_PROGID "YalqenHTML"

; SHELL_CONTEXT follows the install mode chosen on the assisted installer's mode
; page: HKCU for a per-user install, HKLM for per-machine. Writing to a fixed hive
; would leave a stale registration behind when the other mode is later installed.
!macro yalqenRegisterBrowser root
  WriteRegStr ${root} "Software\Classes\${YALQEN_PROGID}" "" "${PRODUCT_NAME} Document"
  WriteRegStr ${root} "Software\Classes\${YALQEN_PROGID}" "URL Protocol" ""
  WriteRegStr ${root} "Software\Classes\${YALQEN_PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr ${root} "Software\Classes\${YALQEN_PROGID}\shell\open\command" "" '"$appExe" "%1"'

  ; The client type subkey for a browser must be named after the executable.
  WriteRegStr ${root} "${YALQEN_CLIENT_KEY}" "" "${PRODUCT_NAME}"
  WriteRegStr ${root} "${YALQEN_CLIENT_KEY}\DefaultIcon" "" "$appExe,0"
  WriteRegStr ${root} "${YALQEN_CLIENT_KEY}\shell\open\command" "" '"$appExe"'

  ; Capabilities is what the Default apps page reads to list and apply a choice.
  WriteRegStr ${root} "${YALQEN_CLIENT_KEY}\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr ${root} "${YALQEN_CLIENT_KEY}\Capabilities" "ApplicationDescription" "${APP_DESCRIPTION}"
  WriteRegStr ${root} "${YALQEN_CLIENT_KEY}\Capabilities" "ApplicationIcon" "$appExe,0"
  WriteRegStr ${root} "${YALQEN_CLIENT_KEY}\Capabilities\URLAssociations" "http" "${YALQEN_PROGID}"
  WriteRegStr ${root} "${YALQEN_CLIENT_KEY}\Capabilities\URLAssociations" "https" "${YALQEN_PROGID}"
  WriteRegStr ${root} "${YALQEN_CLIENT_KEY}\Capabilities\Startmenu" "StartmenuInternet" "${APP_EXECUTABLE_FILENAME}"

  ; Points Default apps at the Capabilities block above.
  WriteRegStr ${root} "Software\RegisteredApplications" "${PRODUCT_NAME}" "${YALQEN_CLIENT_KEY}\Capabilities"
!macroend

!macro yalqenUnregisterBrowser root
  DeleteRegValue ${root} "Software\RegisteredApplications" "${PRODUCT_NAME}"
  DeleteRegKey ${root} "${YALQEN_CLIENT_KEY}"
  DeleteRegKey ${root} "Software\Classes\${YALQEN_PROGID}"
!macroend

!macro customInstall
  !insertmacro yalqenRegisterBrowser SHELL_CONTEXT
!macroend

!macro customUnInstall
  !insertmacro yalqenUnregisterBrowser SHELL_CONTEXT
!macroend
