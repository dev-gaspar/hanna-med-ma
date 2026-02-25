!include "MUI2.nsh"

Name "HannaMed RPA"
OutFile "${__DIR__}\HannaMed-RPA-Setup.exe"
InstallDir "$PROGRAMFILES\HannaMed RPA"
RequestExecutionLevel admin

; Make the installer silent by default or show basic UI
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Section "Main Section" SEC01
    SetOutPath "$INSTDIR"
    File "${__DIR__}\..\dist\HannamedRPA.exe"
    
    ; Create Start Menu shortcuts
    CreateDirectory "$SMPROGRAMS\HannaMed RPA"
    CreateShortcut "$SMPROGRAMS\HannaMed RPA\HannaMed RPA.lnk" "$INSTDIR\HannamedRPA.exe"
    
    ; Create uninstaller
    WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
    Delete "$INSTDIR\HannamedRPA.exe"
    Delete "$INSTDIR\uninstall.exe"
    RMDir "$INSTDIR"
    
    Delete "$SMPROGRAMS\HannaMed RPA\HannaMed RPA.lnk"
    RMDir "$SMPROGRAMS\HannaMed RPA"
SectionEnd
