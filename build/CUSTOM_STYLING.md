# Custom Installer Window Styling Guide

## Current Setup 🎨

Your installer now supports:
- **Custom colors**: Dark theme (#1a1a2e background, #0ea5e9 accent blue)
- **Custom fonts**: Segoe UI with proper sizing
- **Custom pages**: Fully styled nsDialogs pages
- **Background support**: Ready for custom background images

## Window Styling

The installer uses:
- Background: `0x1a1a2e` (dark blue-gray)
- Accent: `0x0ea5e9` (bright cyan)
- Text: `0xFFFFFF` (white)
- Secondary text: `0xCCCCCC` (light gray)

## Adding a Custom Background Image

### 1. Create Your Background

Requirements:
- Format: BMP (24-bit recommended)
- Size: 640x480 or 800x600 (standard installer sizes)
- Style: Dark-themed to match colors

### 2. Add to installer.nsh

In the `CustomGUIInit` function, uncomment these lines:
```nsis
File /oname=$PLUGINSDIR\background.bmp "build\background.bmp"
BgImage::SetBg /NOUNLOAD /FILLSCREEN $PLUGINSDIR\background.bmp
BgImage::Redraw /NOUNLOAD
```

### 3. Create with ImageMagick

```bash
# Create a gradient background (640x480)
magick convert -size 640x480 gradient:#1a1a2e-#0f3460 background.bmp

# Or with your logo overlay
magick convert -size 640x480 gradient:#1a1a2e-#0f3460 \
  logo.png -gravity center -composite background.bmp
```

### 4. Create with GIMP/Photoshop

1. New image: 640x480px
2. Fill with gradient: #1a1a2e → #0f3460
3. Add your logo/branding
4. Export as BMP (24-bit)
5. Save to `build/background.bmp`

## Custom Page Elements

The `CustomPageCreate` function creates a fully styled page with:

```nsis
- Title label: Large cyan text (#0ea5e9)
- Description: White text
- Feature list: Gray text with emojis
- Custom button: Cyan background, white text
```

### Customizing Elements

Change colors by modifying `SetCtlColors`:
```nsis
SetCtlColors $Label 0xTEXTCOLOR 0xBACKGROUNDCOLOR
```

Change fonts:
```nsis
CreateFont $0 "Font Name" SIZE WEIGHT
SendMessage $Label ${WM_SETFONT} $0 0
```

## Borderless Modern Window

For a modern, borderless installer window:

1. Uncomment in `customHeader`:
```nsis
!define MUI_CUSTOMFUNCTION_GUIINIT CustomGUIInit
```

2. This removes the default Windows frame for a sleek look

## Using BgImage Plugin

The BgImage plugin allows:
- Full-screen backgrounds
- Tiled backgrounds  
- Gradient backgrounds
- Image transparency

### Download BgImage Plugin

1. Download from: https://nsis.sourceforge.io/BgImage_plug-in
2. Extract `BgImage.dll` to: `C:\Users\[YourUser]\AppData\Local\electron-builder\Cache\nsis\nsis-X.X.X\Plugins\x86-unicode\`
3. Restart build

## Example: Full Custom Window

Complete example in `installer.nsh` with:
- Dark themed (#1a1a2e)
- Cyan accents (#0ea5e9)
- Custom fonts (Segoe UI)
- Emoji icons
- Feature list
- Styled buttons

## Testing Your Changes

```powershell
npm run build:win
```

Then run `dist\CubicLauncher Setup 0.2.0.exe` to see your styled installer!

## Color Palette

Your current theme:
```
Primary Background:  #1a1a2e (26, 26, 46)
Secondary:           #0f3460 (15, 52, 96)
Accent:              #0ea5e9 (14, 165, 233)
Text:                #ffffff (255, 255, 255)
Secondary Text:      #cccccc (204, 204, 204)
```

NSIS uses BGR format (reverse of RGB):
- #1a1a2e → 0x2e1a1a (but write as 0x1a1a2e)

## Advanced: Multiple Custom Pages

You can create multiple custom pages:

```nsis
Page custom CustomPage1Create CustomPage1Leave
Page custom CustomPage2Create CustomPage2Leave

Function CustomPage1Create
  ; First custom page
FunctionEnd

Function CustomPage2Create  
  ; Second custom page
FunctionEnd
```

## Resources

- NSIS Documentation: https://nsis.sourceforge.io/Docs/
- nsDialogs Plugin: https://nsis.sourceforge.io/Docs/nsDialogs/
- Modern UI 2: https://nsis.sourceforge.io/Docs/Modern%20UI%202/
- Color Picker (RGB to Hex): https://www.w3schools.com/colors/colors_picker.asp

## Tips

1. **Test frequently**: Build and test after each change
2. **Use emojis**: They add visual interest (✨🔄🎨⚡)
3. **Contrast**: Ensure text is readable on backgrounds
4. **Consistency**: Match your launcher's theme
5. **Performance**: Optimize images (compress BMP files)
