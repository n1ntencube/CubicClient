; Custom NSIS installer script for CubicLauncher
; This script adds custom window styling and functionality

!macro customHeader
  ; Custom branding text at bottom of installer
  BrandingText "NintenCube - CubicLauncher Installer"
!macroend

; Custom GUI initialization - called when installer window opens
!macro customInit
  ; Set custom window colors to dark theme
  SetCtlColors $HWNDPARENT 0x1a1a2e 0x1a1a2e
  
  ; Show styled welcome message
  MessageBox MB_ICONINFORMATION|MB_TOPMOST "🎮 Bienvenue dans l'installation de CubicLauncher!$\r$\n$\r$\nCe launcher vous permettra d'accéder aux serveurs Minecraft de NintenCube avec toutes les fonctionnalités nécessaires."
!macroend

!macro customInstall
  ; Custom install section - runs during installation
  DetailPrint "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  DetailPrint "📦 Installation de CubicLauncher en cours..."
  DetailPrint "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  ; Create additional registry keys for protocol handler (cubic://)
  DetailPrint "🔗 Configuration du protocole cubic://..."
  WriteRegStr HKCU "Software\Classes\cubic" "" "URL:Cubic Protocol"
  WriteRegStr HKCU "Software\Classes\cubic" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\cubic\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\cubic\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  
  ; Add uninstall registry info with custom metadata
  DetailPrint "📝 Enregistrement des informations de désinstallation..."
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "DisplayIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "Publisher" "NintenCube"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "URLInfoAbout" "https://github.com/n1ntencube/CubicLauncher"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "HelpLink" "https://github.com/n1ntencube/CubicLauncher/issues"
  
  DetailPrint "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  DetailPrint "✅ Configuration terminée avec succès!"
  DetailPrint "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
!macroend

!macro customUnInstall
  ; Custom uninstall section - runs during uninstallation
  DetailPrint "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  DetailPrint "🗑️ Désinstallation de CubicLauncher..."
  DetailPrint "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  ; Remove protocol handler registry keys
  DetailPrint "🔗 Suppression du protocole cubic://..."
  DeleteRegKey HKCU "Software\Classes\cubic"
  
  ; Ask if user wants to keep saved data with styled dialog
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_TOPMOST "💾 Conserver vos données ?$\r$\n$\r$\nVoulez-vous conserver vos paramètres, mondes Minecraft et données de jeu ?$\r$\n$\r$\nCliquez sur 'Non' pour tout supprimer." IDYES keep_data
    DetailPrint "🧹 Suppression des données utilisateur..."
    RMDir /r "$APPDATA\cubicclient"
    DetailPrint "✅ Données supprimées"
    Goto end_data_delete
  keep_data:
    DetailPrint "💾 Conservation des données utilisateur"
  end_data_delete:
  
  DetailPrint "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  DetailPrint "✅ Désinstallation terminée!"
  DetailPrint "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
!macroend

!macro customFinishPage
  ; Custom finish page with styled text
  !define MUI_FINISHPAGE_TITLE "🎉 Installation terminée !"
  !define MUI_FINISHPAGE_TEXT "CubicLauncher a été installé avec succès sur votre ordinateur.$\r$\n$\r$\n✨ Vous pouvez maintenant accéder aux serveurs Minecraft de NintenCube.$\r$\n$\r$\n🚀 Cliquez sur Terminer pour lancer le launcher."
  !define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !define MUI_FINISHPAGE_RUN_TEXT "Lancer CubicLauncher maintenant"
  !define MUI_FINISHPAGE_LINK "Visiter le site web de NintenCube"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/n1ntencube/CubicLauncher"
!macroend

!macro customWelcomePage
  ; Custom welcome page with styled text and emojis
  !define MUI_WELCOMEPAGE_TITLE "🎮 Bienvenue dans l'assistant d'installation de CubicLauncher"
  !define MUI_WELCOMEPAGE_TEXT "Cet assistant va vous guider dans l'installation de CubicLauncher.$\r$\n$\r$\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$\r$\n$\r$\n✨ Ce launcher vous permet d'accéder aux serveurs Minecraft de NintenCube avec :\r$\n$\r$\n  📦 Téléchargement automatique des mods$\r$\n  🔄 Mises à jour automatiques$\r$\n  🎨 Interface moderne et intuitive$\r$\n  ⚡ Performances optimisées$\r$\n$\r$\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$\r$\n$\r$\nCliquez sur Suivant pour continuer."
!macroend

!macro customInstallPage
  ; Custom install progress page styling
  !define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "✅ Installation terminée"
  !define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Tous les fichiers ont été installés"
  !define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "❌ Installation annulée"
  !define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "L'installation a été interrompue"
!macroend
