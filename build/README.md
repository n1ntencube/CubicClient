# Build Assets for CubicLauncher Installer

This directory contains assets for customizing the Windows installer (NSIS).

## Current Styling Features ✨

The installer now includes:
- 🎨 **Custom colors**: Dark theme (#1a1a2e background, #0ea5e9 accents)
- 📝 **French language**: All text in French
- 🎭 **Emoji icons**: Visual indicators in messages and progress
- 📊 **Styled progress bars**: Smooth gradient progress indicators
- 💬 **Enhanced dialogs**: Informative messages with better formatting
- 🔗 **URL protocol**: Registers `cubic://` protocol handler
- 📦 **Detailed logs**: Installation progress with visual separators
- 🗑️ **Smart uninstall**: Preserves user data by default

## Custom Text & Messages

All text is customizable in `installer.nsh`:
- Welcome page with feature list
- Installation progress messages with emojis
- Finish page with launch option
- Uninstall confirmation with data preservation option

## Required Files

### Icons
- **icon.ico** (256x256): Main application icon
  - Used for installer icon, uninstaller icon, and app icon
  - Must be .ico format with multiple sizes: 16x16, 32x32, 48x48, 256x256

### Installer Graphics (Optional)
- **installerHeader.bmp** (150x57 pixels, 24-bit BMP)
  - Header image shown at the top of installer pages
  - Recommended: Use your brand colors and logo

- **installerSidebar.bmp** (164x314 pixels, 24-bit BMP)  
  - Sidebar image shown on welcome and finish pages
  - Recommended: Vertical banner with your branding

## Custom NSIS Script

**installer.nsh** contains custom NSIS macros:
- `customHeader`: Branding and window title
- `customInit`: Runs before installer starts (welcome message)
- `customInstall`: Custom installation steps (adds URL protocol handler)
- `customUnInstall`: Custom uninstallation (cleans up registry, asks about data)
- `customWelcomePage`: Welcome page text
- `customFinishPage`: Finish page text

## Creating Icons

### Using ImageMagick:
```bash
# Convert PNG to ICO with multiple sizes
magick convert logo.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

### Using GIMP:
1. Open your logo PNG
2. Scale to 256x256 (Image → Scale Image)
3. Export As → icon.ico
4. Select "Compressed (PNG)" and all sizes

## Creating BMP Files

### Header (150x57):
```bash
magick convert -size 150x57 xc:white -fill "#1a1a2e" -draw "rectangle 0,0 150,57" installerHeader.bmp
```

### Sidebar (164x314):
```bash
magick convert -size 164x314 xc:white -fill "#1a1a2e" -draw "rectangle 0,0 164,314" installerSidebar.bmp
```

Or use any image editor (Photoshop, GIMP) to create 24-bit BMP files.

## Customization Options

Edit `package.json` → `build.nsis` section:

```json
{
  "oneClick": false,              // Allow custom installation
  "perMachine": false,            // Install per-user (not system-wide)
  "allowElevation": true,         // Allow admin elevation if needed
  "runAfterFinish": true,         // Launch app after install
  "createDesktopShortcut": true,  // Create desktop icon
  "createStartMenuShortcut": true,// Create start menu entry
  "deleteAppDataOnUninstall": false, // Keep user data on uninstall
  "license": "LICENSE.txt"        // Show license agreement
}
```

## Testing

Build the installer:
```bash
npm run build:win
```

The installer will be in `dist/` folder.
