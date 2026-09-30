# Wisconsin Creative App Icon Source

The approved app identity is the Block W Icon Composer document at `IconComposerCandidates/vintage-helmet/BlockW.icon`.

The main Wisconsin target compiles its complete copy at `ios/Wisconsin/AppIcons/AppIcon.icon`. The dedicated kiosk target compiles `ios/IconSources/KioskIcon.icon` directly as its primary icon: the original vintage Bucky + Block W vector on black. Keep the shared `Assets.xcassets/AppIcon.appiconset` catalog intact.

After editing the main icon in Icon Composer, sync its complete package and verify the Wisconsin target build. Kiosk edits use `KioskIcon.icon` directly; verify the WisconsinKiosk target build. The app does not ship alternate icons or expose an icon picker.
