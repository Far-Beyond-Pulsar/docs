---
title: Translation & Internationalization
description: YAML-based translation system with instant language switching and zero-overhead lookups
category: core-concepts
lastUpdated: '2026-01-22'
tags:
  - i18n
  - localization
  - translations
  - internationalization
  - multi-language
related:
  - core-concepts/architecture
  - core-concepts/level-editor
position: 20
icon: Globe
---

Pulsar includes a comprehensive translation system built on `rust-i18n`, providing instant language switching across the entire UI with zero runtime overhead. The system loads all translations for the current language into memory at startup, enabling O(1) lookups without disk I/O. Users can switch languages dynamically via the titlebar dropdown, with the UI updating immediately without requiring a restart.

## Why Internationalization Matters

Game engines serve developers worldwide, and forcing everyone to work in English creates unnecessary barriers. A Russian developer should be able to navigate the level editor in Russian. A Chinese artist should see UI panels in Chinese. When tools adapt to users rather than forcing adaptation, productivity increases and frustration decreases.

Most translation systems add significant overhead—either loading files on demand (slow) or using complex key lookup mechanisms (also slow). Pulsar takes a different approach. All translations for the active language load at engine startup into a simple HashMap. Subsequent lookups are just hash table accesses, taking nanoseconds rather than microseconds. The YAML source files provide a translator-friendly format with clear structure and version control compatibility.

## Architecture Overview

The translation system consists of three layers working together. At the bottom sits the YAML files containing actual translation strings, organized by component and language. These files live in `locales/` directories next to the Rust code they translate, keeping translations close to the UI they describe. The middle layer is `rust-i18n`, which parses YAML files at compile time and generates efficient lookup code. At the top, the `t!()` macro provides a simple API for retrieving translated strings throughout the codebase.

```mermaid
graph TD
    A[YAML Translation Files] -->|Compile-time| B[rust-i18n Parser]
    B -->|Generates| C[HashMap Lookup Code]
    C -->|Runtime| D[In-Memory Translation Cache]
    D -->|O(1) Lookup| E[UI Components]
    F[Locale Selector] -->|set_locale| D
    E -->|t! macro| D
```

The diagram shows how translation data flows from source files to runtime lookups. At compile time, `rust-i18n` embeds all translations directly into the binary. At runtime, changing languages simply swaps which HashMap the lookup code references. No file I/O occurs during normal operation.

![Language Selector](./images/translation-locale-selector.png)
*The language selector in the main titlebar, showing all available languages with the current selection marked*

## Translation File Format

Translation files use YAML with a specific structure designed for clarity and maintainability. Each file begins with a version number, followed by nested keys and their translations:

```yaml
_version: 2

LevelEditor.Toolbar.StartSimulation:
  en: "Start Simulation (F5)"
  zh-CN: "开始模拟 (F5)"
  zh-HK: "開始模擬 (F5)"
  it: "Avvia Simulazione (F5)"

LevelEditor.Toolbar.StopSimulation:
  en: "Stop Simulation (Shift+F5)"
  zh-CN: "停止模拟 (Shift+F5)"
  zh-HK: "停止模擬 (Shift+F5)"
  it: "Ferma Simulazione (Shift+F5)"

LevelEditor.Hierarchy.Title:
  en: "Hierarchy"
  zh-CN: "层级"
  zh-HK: "層級"
  it: "Gerarchia"
```

The key structure uses dot notation to create logical hierarchies. `LevelEditor.Toolbar.StartSimulation` clearly indicates this string belongs to the Level Editor's toolbar, specifically the Start Simulation button. This convention makes it easy to find related translations and understand context when translating.

Language codes follow the ISO 639-1 standard (`en` for English) with optional region codes (`zh-CN` for Simplified Chinese, `zh-HK` for Traditional Chinese). The system falls back to English if a translation is missing, ensuring the UI never shows raw key names.

## Using Translations in Code

The `t!()` macro provides the primary interface for retrieving translations. Import `rust_i18n::t` and use it anywhere you need translated text:

```rust
use rust_i18n::t;

// In a button tooltip
Button::new("play")
    .icon(IconName::Play)
    .tooltip(t!("LevelEditor.Toolbar.StartSimulation"))

// In a panel title
div()
    .text_base()
    .font_weight(FontWeight::SEMIBOLD)
    .child(t!("LevelEditor.Hierarchy.Title").to_string())
```

The macro returns a `Cow<'static, str>`, which is either a borrowed static string or an owned String. Most GPUI methods accept `Cow<str>` directly for tooltips and labels. For inline text that requires `IntoElement`, call `.to_string()` to convert to a String. The compiler will optimize this appropriately—if the translation is a static string, the conversion becomes a copy rather than an allocation.

For functions that need the current or change languages:

```rust
use ui_level_editor::{locale, set_locale};

// Get current language
let current = locale(); // Returns "en", "zh-CN", etc.

// Change language
set_locale("zh-CN");

// UI updates automatically on next render
window.refresh();
```

The `set_locale` function swaps the active translation HashMap immediately. Any `t!()` calls after this point will return strings in the new language. Calling `window.refresh()` triggers a redraw, updating all visible text.

## Initializing Translations

Each crate that contains translations must initialize the `rust-i18n` system. This happens once at crate load time using a macro invocation:

```rust
// In lib.rs or main.rs
rust_i18n::i18n!("locales", fallback = "en");
```

This macro scans the `locales/` directory at compile time, parsing all YAML files it finds. The `fallback` parameter specifies which language to use when a translation key is missing. English serves as the fallback for Pulsar, ensuring developers always see readable text even for untranslated strings.

After initialization, export convenience functions for accessing the locale system:

```rust
/// Get current locale
pub fn locale() -> String {
    rust_i18n::locale().to_string()
}

/// Set locale
pub fn set_locale(locale: &str) {
    rust_i18n::set_locale(locale);
}
```

These wrappers provide a cleaner API for crate consumers and isolate the dependency on `rust-i18n` to a single location.

## Directory Structure

Translation files live in `locales/` directories next to the code they translate. This keeps translations close to the UI, making it easy to find and update strings when modifying features:

```
ui-crates/ui_level_editor/
├── src/
│   ├── lib.rs                    # Initializes i18n
│   └── level_editor/
│       └── ui/
│           ├── toolbar.rs        # Uses t!() macro
│           ├── hierarchy.rs      # Uses t!() macro
│           └── properties.rs     # Uses t!() macro
└── locales/
    └── level_editor.yml          # All translations for this crate
```

Large projects might split translations into multiple files for maintainability:

```
locales/
├── toolbar.yml      # Toolbar translations
├── hierarchy.yml    # Hierarchy panel translations
├── properties.yml   # Properties panel translations
└── viewport.yml     # Viewport and camera translations
```

The `rust-i18n` macro automatically discovers and loads all `.yml` files in the `locales/` directory, merging them into a single translation database.

## Adding New Languages

To add support for a new language, update every translation key in the YAML file with the new language code. For example, adding German:

```yaml
LevelEditor.Toolbar.StartSimulation:
  en: "Start Simulation (F5)"
  zh-CN: "开始模拟 (F5)"
  zh-HK: "開始模擬 (F5)"
  it: "Avvia Simulazione (F5)"
  de: "Simulation starten (F5)"    # New German translation
```

After adding translations, update the locale selector in the main titlebar to include the new language. Open `ui-crates/ui_common/src/menu/mod.rs` and add a new menu item:

```rust
impl Render for LocaleSelector {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let current_locale = locale().to_string();

        Button::new("btn")
            .small()
            .ghost()
            .icon(IconName::Globe)
            .popup_menu(move |menu, _, _| {
                menu
                    .menu_with_check(
                        "English",
                        current_locale == "en",
                        Box::new(SelectLocale("en".into()))
                    )
                    .menu_with_check(
                        "简体中文 (Simplified Chinese)",
                        current_locale == "zh-CN",
                        Box::new(SelectLocale("zh-CN".into()))
                    )
                    // ... other languages ...
                    .menu_with_check(
                        "Deutsch (German)",
                        current_locale == "de",
                        Box::new(SelectLocale("de".into()))
                    )
            })
    }
}
```

The next time you compile, the new language will appear in the dropdown and work immediately.

## Naming Conventions

Translation keys follow a hierarchical naming convention that reflects the UI structure. This makes keys predictable and easy to discover:

```
Component.Section.Element

Examples:
LevelEditor.Toolbar.StartSimulation
LevelEditor.Hierarchy.AddObject
LevelEditor.Properties.NoSelection
LevelEditor.Viewport.CameraMode
```

The first segment identifies the major component (LevelEditor, MainMenu, SettingsPanel). The second segment narrows to a specific panel or area (Toolbar, Hierarchy, Properties). The final segment describes the actual UI element (StartSimulation, AddObject).

For common patterns, establish reusable naming schemes:

- Buttons: `{Component}.{Section}.{ActionName}` (e.g., `LevelEditor.Toolbar.Play`)
- Labels: `{Component}.{Section}.{LabelName}` (e.g., `LevelEditor.Properties.Transform`)
- Tooltips: Same as the element they describe
- Messages: `{Component}.{Section}.{MessageType}` (e.g., `LevelEditor.Properties.NoSelection`)

Consistency in naming makes it easy for translators to understand context and for developers to find the right keys when writing code.

## Performance Characteristics

The translation system is designed for zero runtime overhead. At engine startup, `rust-i18n` loads all translations for the active language into a HashMap stored in static memory. The HashMap uses perfect hashing for constant-time lookups. Each `t!()` call becomes a single hash table access, typically completing in 10-20 nanoseconds.

```rust
// This compiles to approximately:
pub fn t(key: &str) -> &'static str {
    TRANSLATIONS_MAP.get(key).unwrap_or(key)
}
```

Because translations embed directly in the binary, no file I/O occurs during normal operation. The only disk access happens at compile time when the `i18n!` macro parses YAML files. This means translation lookups never block, never fail, and never allocate. The entire translation database lives in read-only memory, making concurrent access from multiple threads completely safe without locks.

Changing languages has a small one-time cost—swapping a pointer to the active HashMap. This operation is atomic and takes less than a microsecond. After the swap, all subsequent `t!()` calls use the new language with no additional overhead.

## Language Selector Implementation

The main titlebar includes a globe icon button that opens a dropdown showing all available languages. The implementation lives in `ui_common/src/menu/mod.rs`:

```rust
struct LocaleSelector {
    focus_handle: FocusHandle,
}

impl LocaleSelector {
    fn on_select_locale(
        &mut self,
        locale: &SelectLocale,
        window: &mut Window,
        _: &mut Context<Self>
    ) {
        set_locale(&locale.0);
        window.refresh();
    }
}
```

When a user selects a language, the `on_select_locale` handler calls `set_locale` to change the active language, then refreshes the window to trigger a redraw. Because translations live in memory, this refresh is instantaneous—no loading screens or delays.

The popup menu builds dynamically based on the current locale, placing a checkmark next to the active language:

```rust
.popup_menu(move |menu, _, _| {
    menu
        .menu_with_check(
            "English",
            current_locale == "en",
            Box::new(SelectLocale("en".into()))
        )
        .menu_with_check(
            "简体中文 (Simplified Chinese)",
            current_locale == "zh-CN",
            Box::new(SelectLocale("zh-CN".into()))
        )
        // ... more languages ...
})
```

This pattern makes it easy to add new languages—simply add another `.menu_with_check` call with the appropriate language code.

## Adding Translations to New Components

When creating a new UI component, follow this process to add translation support:

1. **Add the i18n initialization** to your crate's `lib.rs` if not already present:

```rust
rust_i18n::i18n!("locales", fallback = "en");

pub fn locale() -> String {
    rust_i18n::locale().to_string()
}

pub fn set_locale(locale: &str) {
    rust_i18n::set_locale(locale);
}
```

2. **Create the locales directory** and YAML file:

```bash
mkdir -p my_crate/locales
touch my_crate/locales/my_component.yml
```

3. **Add translation keys** for all user-facing text:

```yaml
_version: 2

MyComponent.Panel.Title:
  en: "My Component"
  zh-CN: "我的组件"

MyComponent.Button.Save:
  en: "Save"
  zh-CN: "保存"
```

4. **Import the t! macro** in files that need translations:

```rust
use rust_i18n::t;
```

5. **Replace hardcoded strings** with t!() calls:

```rust
// Before
.child("Save")

// After
.child(t!("MyComponent.Button.Save").to_string())
```

6. **Add the dependency** to Cargo.toml if not already present:

```toml
[dependencies]
rust-i18n.workspace = true
```

The next time you compile, your component will support multiple languages automatically.

## Handling Dynamic Content

Translation keys work for static UI text, but some content is dynamic—error messages with variable data, lists with counts, timestamps. For these cases, use Rust's string formatting with translated templates:

```rust
// Translation key
FileDialog.SelectedFiles:
  en: "Selected {count} files"
  zh-CN: "已选择 {count} 个文件"

// Usage
let count = selected_files.len();
let message = t!("FileDialog.SelectedFiles")
    .replace("{count}", &count.to_string());
```

For more complex cases with pluralization:

```rust
FileDialog.ItemCount:
  en:
    zero: "No items"
    one: "1 item"
    other: "{count} items"
  zh-CN:
    zero: "没有项目"
    one: "1 个项目"
    other: "{count} 个项目"
```

The `rust-i18n` crate includes built-in support for plural rules, handling the different pluralization rules across languages automatically.

## Translation Workflow

For large projects with multiple translators, establish a clear workflow to avoid conflicts and ensure consistency:

1. **Developers add English strings** when implementing new features
2. **English acts as the source of truth** for key names and meanings
3. **Translators receive YAML files** for their target languages
4. **Translators add translations** alongside English entries
5. **Pull requests include both code and translation updates**

Use comments in YAML files to provide context for translators:

```yaml
# Tooltip for the button that starts the game simulation
LevelEditor.Toolbar.StartSimulation:
  en: "Start Simulation (F5)"
  zh-CN: "开始模拟 (F5)"

# Button label for saving the current scene
LevelEditor.Toolbar.Save:
  en: "Save Scene"
  zh-CN: "保存场景"
```

Comments help translators understand context, especially for short strings where meaning might be ambiguous.

## Testing Translations

Test translations by switching languages during development. Keep the language selector visible and periodically switch between English and your target languages. Missing translations will fall back to English, making them easy to spot.

For automated testing, create a script that extracts all `t!()` calls from the codebase and verifies every key exists in the YAML files:

```rust
// Test example
#[test]
fn test_all_translations_exist() {
    let yaml = std::fs::read_to_string("locales/level_editor.yml").unwrap();
    let translations: HashMap<String, HashMap<String, String>> = 
        serde_yaml::from_str(&yaml).unwrap();
    
    // Verify all languages have the same keys
    let english_keys: HashSet<_> = translations.keys().collect();
    for (lang, keys) in &translations {
        let lang_keys: HashSet<_> = keys.keys().collect();
        assert_eq!(english_keys, lang_keys, 
            "Language {} is missing keys", lang);
    }
}
```

This test catches incomplete translations before they reach users.

## Current Language Support

Pulsar currently supports four languages in the Level Editor:

- **English (en)**: Primary language, source of truth
- **Simplified Chinese (zh-CN)**: Mainland China
- **Traditional Chinese (zh-HK)**: Hong Kong, Taiwan
- **Italian (it)**: Italy

The main titlebar locale selector dynamically shows all available languages. Adding new languages requires updating translation YAML files and adding corresponding menu items to the locale selector.

## Migration from Hardcoded Strings

Existing code with hardcoded English strings can be migrated incrementally:

1. **Identify UI text** that should be translatable
2. **Add translation keys** to the YAML file with English text
3. **Replace string literals** with `t!()` calls
4. **Add other language translations** after verifying English works
5. **Test by switching languages** to verify the changes

This approach allows gradual migration without requiring all strings to be translated simultaneously. The fallback to English ensures the UI remains functional throughout the migration process.

## Best Practices

Follow these guidelines when working with translations:

- **Keep keys predictable**: Use consistent naming conventions
- **Provide context**: Add comments for ambiguous strings
- **Test all languages**: Switch languages regularly during development
- **Avoid concatenation**: Use formatted strings instead of building text from pieces
- **Handle pluralization**: Different languages have different plural rules
- **Include shortcuts**: Keep keyboard shortcuts in translated strings when relevant
- **Group related strings**: Organize keys by component and section
- **Document new keys**: Explain context when adding translation keys
- **Version your files**: The `_version` field helps track format changes

## Future Enhancements

The translation system will continue to evolve. Planned improvements include integration with professional translation management systems, allowing translators to work through web interfaces rather than editing YAML files directly. This streamlines workflows for large translation teams.

Support for right-to-left languages like Arabic and Hebrew requires UI layout changes beyond just string replacement. The framework will gain bidirectional text support, allowing the entire interface to flip horizontally when appropriate.

Dynamic translation reloading during development will enable translators to see changes immediately without recompiling. The engine will watch YAML files for modifications and hot-reload translations on save, providing instant feedback.

Translation memory will track previously translated strings, suggesting translations for similar new strings. This accelerates translation work and improves consistency across the application.

## Integration with External Tools

The YAML-based approach integrates cleanly with standard translation tools. Many translation management platforms support YAML import/export, allowing professional translators to work with familiar tools rather than learning engine-specific systems.

For projects with tight integration needs, the SQLite database approach mentioned in earlier discussions remains an option. While YAML provides better version control and human readability, SQLite enables runtime translation updates and more sophisticated translation memory features. The architecture supports both approaches through the same `t!()` macro interface.

## Adding Translations to Your Project

When contributing to Pulsar or building games on top of it, you should translate any user-facing text. This section provides detailed guidance on properly implementing translations to ensure users worldwide can work effectively with your tools.

### Component-Level Translation Organization

Organize translations by component to keep files manageable. Rather than one massive YAML file with thousands of entries, split translations into logical units:

```
my_game/
├── locales/
│   ├── main_menu.yml           # Main menu and splash screen
│   ├── gameplay_hud.yml        # In-game UI elements
│   ├── inventory.yml           # Inventory system
│   ├── settings.yml            # Settings panels
│   └── dialogs.yml             # Dialog boxes and messages
```

This structure mirrors the actual code organization, making it easy to find and update translations when modifying features. If you change the inventory UI, you know exactly which file contains the relevant translations.

The translation system automatically merges all YAML files it finds, so splitting into multiple files doesn't affect runtime behavior. You gain organizational benefits with zero runtime cost.
