---
title: Theme System
description: Theme loading, switching, and persistence
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - themes
  - ui
  - styling
  - customization
related:
  - core-concepts/ui-framework
position: 12
icon: Palette
---

# Theme System

Pulsar's theme system manages UI appearance with hot-reloadable themes. Themes are JSON files that define colors, spacing, and other visual properties. The implementation is in `crates/ui/src/themes.rs`.

## What It Provides

The theme system provides:
- Loading themes from embedded resources
- Extracting themes to app data directory
- Theme switching with automatic UI updates
- Persistent theme selection across sessions
- Integration with GPUI's ThemeRegistry

## Theme Storage

Themes are stored in multiple locations:

- **Embedded** - `themes/*.json` (compiled into the binary)
- **Runtime** - `{appdata}/themes/*.json` (extracted at first run)
- **State** - `{appdata}/state.json` (saves selected theme)

The app data directory is platform-specific:
- Windows: `C:\Users\{user}\AppData\Roaming\Pulsar\Pulsar_Engine\`
- macOS: `~/Library/Application Support/com.Pulsar.Pulsar_Engine/`
- Linux: `~/.local/share/Pulsar/Pulsar_Engine/`

## Initialization

The theme system initializes on app startup:

```rust
crate::themes::init(cx);
```

This:
1. Loads the last selected theme from `state.json`
2. Checks if themes are extracted to app data
3. Extracts embedded themes if needed
4. Loads themes into GPUI's ThemeRegistry
5. Applies the saved theme (or defaults to "Default Dark")

## Theme Extraction

On first run, themes are extracted from the binary:

```rust
let themes_dir = app_data_dir.join("themes");
if !themes_dir.exists() {
    std::fs::create_dir_all(&themes_dir)?;
    for file in EmbeddedThemes::iter() {
        let data = EmbeddedThemes::get(&file).unwrap();
        std::fs::write(themes_dir.join(file.as_ref()), data.data)?;
    }
}
```

Embedded themes are compiled into the binary using `rust_embed`:

```rust
#[derive(RustEmbed)]
#[folder = "../../themes"]
struct EmbeddedThemes;
```

This allows themes to be modified at runtime (edit the JSON files) without recompiling.

## Theme State

The state file stores the selected theme and other UI preferences:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
struct State {
    theme: SharedString,
    scrollbar_show: Option<ScrollbarShow>,
}
```

State is saved to `{appdata}/state.json` when changed and loaded at startup.

## Theme Structure

A theme JSON file defines colors and visual properties:

```json
{
  "name": "Default Dark",
  "appearance": "dark",
  "style": {
    "background": "#1e1e1e",
    "foreground": "#d4d4d4",
    "border": "#3e3e42",
    "accent": "#007acc",
    "muted": "#808080",
    "destructive": "#f48771",
    "success": "#89d185",
    "warning": "#cca700"
  },
  "syntax": {
    "keyword": "#569cd6",
    "string": "#ce9178",
    "comment": "#6a9955",
    "function": "#dcdcaa"
  }
}
```

GPUI's theme system parses these and makes them available via the `ActiveTheme` trait.

## Using Themes in UI

Components access the current theme:

```rust
use crate::ActiveTheme;

div()
    .bg(cx.theme().background)
    .text_color(cx.theme().foreground)
    .border_1()
    .border_color(cx.theme().border)
```

The theme is reactive - changing themes updates all UI elements automatically.

## Switching Themes

Themes can be switched at runtime:

```rust
ThemeRegistry::set_theme_name("Ayu Light", cx);
```

This:
1. Loads the new theme from the registry
2. Updates all components using `cx.notify()`
3. Saves the selection to `state.json`

## Custom Themes

Users can add custom themes by placing JSON files in `{appdata}/themes/`. The theme system loads all JSON files in that directory.

Theme files must have this structure:

```json
{
  "name": "My Custom Theme",
  "appearance": "dark",
  "style": { ... },
  "syntax": { ... }
}
```

The `name` field must be unique. If two themes have the same name, the last one loaded wins.

## Built-in Themes

Pulsar includes several built-in themes:

- **Default Dark** - Dark theme with blue accents
- **Default Light** - Light theme for daytime use
- **Ayu Dark** - Popular dark theme
- **Ayu Light** - Popular light theme

More themes can be added by placing JSON files in the `themes/` directory before building.

## Hot Reload

Theme changes are detected and reloaded automatically when files change in the themes directory. The file watcher monitors for modifications and triggers a reload.

This allows designers to iterate on themes without restarting the editor.

## Theme API

The theme API provides:

```rust
// Get current theme
let theme = cx.theme();

// Access colors
let bg = theme.background;
let fg = theme.foreground;
let accent = theme.accent;

// Check appearance
if theme.appearance == "dark" {
    // Dark mode specific code
}
```

Themes are global state - changing the theme notifies all windows and components.

## Limitations

Current implementation:
- No theme editor UI (must edit JSON files)
- No theme validation (invalid JSON causes errors)
- No theme preview/thumbnail system
- No theme inheritance or composition

Future improvements could add:
- Visual theme editor
- Theme marketplace
- Theme preview mode
- Per-window themes
