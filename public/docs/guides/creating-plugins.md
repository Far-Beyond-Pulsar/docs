---
title: Creating Plugins for Pulsar
description: >-
  Complete step-by-step tutorial for building custom plugins - from cargo new to
  finished editor with GPUI rendering, file type registration, and error
  handling
category: guides
lastUpdated: '2026-01-12'
tags:
  - plugins
  - tutorial
  - rust
  - gpui
  - editor
related:
  - plugin-api
  - gpui-basics
  - project-structure
position: 1
icon: Puzzle
---

# Creating Plugins for Pulsar

This comprehensive guide walks you through creating a complete plugin for Pulsar, from initial setup to a fully functional JSON editor with syntax highlighting, validation, and integration with the Pulsar ecosystem.

## What You'll Build

By the end of this tutorial, you'll have created a JSON editor plugin that:
- Registers the `.json` file type
- Provides syntax highlighting and validation
- Includes a custom statusbar button
- Implements save/load functionality
- Handles errors gracefully
- Integrates with Pulsar's GPUI rendering system

## Prerequisites

Before starting, ensure you have:
- Rust 1.70 or later installed
- Pulsar development environment set up
- Basic understanding of Rust and async programming
- Familiarity with JSON format

## Step 1: Project Setup

### Creating the Plugin

Start by creating a new Rust library project:

```bash
cargo new --lib pulsar-json-editor
cd pulsar-json-editor
```

### Configuring Cargo.toml

Update your `Cargo.toml` to include Pulsar dependencies:

```toml
[package]
name = "pulsar-json-editor"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
pulsar-plugin-api = "0.1"
gpui = "0.1"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
anyhow = "1.0"
async-trait = "0.1"

[dev-dependencies]
tokio = { version = "1.0", features = ["full"] }
```

**Important Notes:**
- `crate-type = ["cdylib"]` builds a dynamic library that Pulsar can load
- `pulsar-plugin-api` provides the core plugin interfaces
- `gpui` is Pulsar's GPU-accelerated UI framework
- `serde_json` handles JSON parsing and validation

## Step 2: Plugin Structure

### Define the Plugin Manifest

Create `plugin.toml` in your project root:

```toml
[plugin]
name = "json-editor"
version = "0.1.0"
description = "Full-featured JSON editor with validation"
author = "Your Name"
license = "MIT"

[plugin.capabilities]
file_types = ["json"]
editor = true
statusbar = true

[plugin.configuration]
# Default settings
auto_format = true
validate_on_type = true
indent_size = 2
```

### Core Plugin Structure

Create the main plugin structure in `src/lib.rs`:

```rust
use pulsar_plugin_api::{Plugin, PluginContext, PluginMetadata, Result};
use pulsar_plugin_api::editor::{Editor, EditorContext};
use pulsar_plugin_api::ui::StatusBarItem;
use gpui::{AppContext, View, ViewContext};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonEditorConfig {
    pub auto_format: bool,
    pub validate_on_type: bool,
    pub indent_size: usize,
}

impl Default for JsonEditorConfig {
    fn default() -> Self {
        Self {
            auto_format: true,
            validate_on_type: true,
            indent_size: 2,
        }
    }
}

pub struct JsonEditorPlugin {
    config: JsonEditorConfig,
}

impl JsonEditorPlugin {
    pub fn new() -> Self {
        Self {
            config: JsonEditorConfig::default(),
        }
    }
}
```

## Step 3: Implementing the Plugin Trait

### Plugin Initialization

Implement the core `Plugin` trait:

```rust
#[async_trait::async_trait]
impl Plugin for JsonEditorPlugin {
    fn metadata(&self) -> PluginMetadata {
        PluginMetadata {
            name: "json-editor".to_string(),
            version: "0.1.0".to_string(),
            description: "Full-featured JSON editor".to_string(),
            author: "Your Name".to_string(),
        }
    }

    async fn initialize(&mut self, ctx: &PluginContext) -> Result<()> {
        // Load configuration
        if let Ok(config) = ctx.config::<JsonEditorConfig>() {
            self.config = config;
        }

        // Register file type
        ctx.register_file_type("json", &["json", "jsonc"])?;
        
        // Register editor
        ctx.register_editor("json", Box::new(JsonEditorFactory::new()))?;
        
        // Register statusbar item
        ctx.register_statusbar_item(Box::new(JsonStatusBarFactory))?;

        log::info!("JSON Editor plugin initialized");
        Ok(())
    }

    async fn shutdown(&mut self) -> Result<()> {
        log::info!("JSON Editor plugin shutting down");
        Ok(())
    }
}
```

**Key Points:**
- `metadata()` provides plugin information to Pulsar
- `initialize()` is called when the plugin loads
- `shutdown()` allows cleanup before unloading
- File type registration links extensions to your editor

## Step 4: Building the Editor

### Editor State Management

Create the editor state structure:

```rust
use pulsar_plugin_api::editor::{EditorBuffer, EditorFactory};

pub struct JsonEditor {
    buffer: EditorBuffer,
    config: JsonEditorConfig,
    validation_errors: Vec<ValidationError>,
    is_modified: bool,
}

#[derive(Clone, Debug)]
pub struct ValidationError {
    pub line: usize,
    pub column: usize,
    pub message: String,
}

impl JsonEditor {
    pub fn new(buffer: EditorBuffer, config: JsonEditorConfig) -> Self {
        Self {
            buffer,
            config,
            validation_errors: Vec::new(),
            is_modified: false,
        }
    }

    fn validate(&mut self) -> Result<()> {
        self.validation_errors.clear();
        
        let text = self.buffer.text();
        match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(_) => Ok(()),
            Err(e) => {
                self.validation_errors.push(ValidationError {
                    line: e.line(),
                    column: e.column(),
                    message: e.to_string(),
                });
                Ok(())
            }
        }
    }

    fn format(&mut self) -> Result<()> {
        let text = self.buffer.text();
        let value: serde_json::Value = serde_json::from_str(&text)?;
        let formatted = serde_json::to_string_pretty(&value)?;
        self.buffer.replace_all(&formatted);
        self.is_modified = true;
        Ok(())
    }
}
```

### Implementing the Editor Trait

```rust
#[async_trait::async_trait]
impl Editor for JsonEditor {
    async fn open(&mut self, ctx: &EditorContext) -> Result<()> {
        // Load file content
        if let Some(path) = ctx.file_path() {
            let content = tokio::fs::read_to_string(path).await?;
            self.buffer.set_text(&content);
        }
        
        // Initial validation
        self.validate()?;
        
        Ok(())
    }

    async fn save(&mut self, ctx: &EditorContext) -> Result<()> {
        // Validate before saving
        if !self.validation_errors.is_empty() {
            return Err(anyhow::anyhow!(
                "Cannot save: validation errors present"
            ));
        }

        // Auto-format if enabled
        if self.config.auto_format {
            self.format()?;
        }

        // Save to file
        if let Some(path) = ctx.file_path() {
            tokio::fs::write(path, self.buffer.text()).await?;
            self.is_modified = false;
        }

        Ok(())
    }

    fn is_modified(&self) -> bool {
        self.is_modified
    }

    fn can_close(&self) -> bool {
        !self.is_modified || self.validation_errors.is_empty()
    }
}
```

## Step 5: GPUI Rendering

### Creating the Editor View

Implement the visual representation using GPUI:

```rust
use gpui::*;

pub struct JsonEditorView {
    editor: Arc<parking_lot::RwLock<JsonEditor>>,
    scroll_offset: f32,
}

impl JsonEditorView {
    pub fn new(editor: JsonEditor, cx: &mut ViewContext<Self>) -> Self {
        Self {
            editor: Arc::new(parking_lot::RwLock::new(editor)),
            scroll_offset: 0.0,
        }
    }

    fn render_line_numbers(&self, cx: &mut ViewContext<Self>) -> impl Element {
        let editor = self.editor.read();
        let line_count = editor.buffer.line_count();

        div()
            .flex()
            .flex_col()
            .bg(rgb(0x1e1e1e))
            .text_color(rgb(0x858585))
            .p_2()
            .children((1..=line_count).map(|line| {
                div()
                    .font_family("monospace")
                    .text_size(px(14.0))
                    .child(format!("{:4}", line))
            }))
    }

    fn render_content(&self, cx: &mut ViewContext<Self>) -> impl Element {
        let editor = self.editor.read();
        let text = editor.buffer.text();
        let lines: Vec<&str> = text.lines().collect();

        div()
            .flex()
            .flex_col()
            .bg(rgb(0x252526))
            .text_color(rgb(0xd4d4d4))
            .p_2()
            .flex_grow()
            .children(lines.iter().enumerate().map(|(idx, line)| {
                self.render_line(idx, line, &editor.validation_errors, cx)
            }))
    }

    fn render_line(
        &self,
        line_num: usize,
        line: &str,
        errors: &[ValidationError],
        cx: &mut ViewContext<Self>,
    ) -> impl Element {
        let has_error = errors.iter().any(|e| e.line == line_num + 1);
        
        let mut element = div()
            .font_family("monospace")
            .text_size(px(14.0))
            .child(self.syntax_highlight(line));

        if has_error {
            element = element.bg(rgb(0x4b1818));
        }

        element
    }

    fn syntax_highlight(&self, line: &str) -> Vec<Box<dyn Element>> {
        // Simple syntax highlighting for JSON
        let mut elements = Vec::new();
        let mut current = String::new();
        let mut in_string = false;
        let mut in_key = false;

        for (i, ch) in line.chars().enumerate() {
            match ch {
                '"' => {
                    if !current.is_empty() {
                        elements.push(self.create_span(&current, in_string, in_key));
                        current.clear();
                    }
                    in_string = !in_string;
                    if in_string && line[..i].trim_start().is_empty() {
                        in_key = true;
                    } else if !in_string {
                        in_key = false;
                    }
                    current.push(ch);
                }
                ':' if !in_string => {
                    if !current.is_empty() {
                        elements.push(self.create_span(&current, false, false));
                        current.clear();
                    }
                    elements.push(self.create_span(":", false, false));
                }
                _ => current.push(ch),
            }
        }

        if !current.is_empty() {
            elements.push(self.create_span(&current, in_string, in_key));
        }

        elements
    }

    fn create_span(&self, text: &str, is_string: bool, is_key: bool) -> Box<dyn Element> {
        let color = if is_key {
            rgb(0x9cdcfe) // Light blue for keys
        } else if is_string {
            rgb(0xce9178) // Orange for string values
        } else if text.trim() == "true" || text.trim() == "false" {
            rgb(0x569cd6) // Blue for booleans
        } else if text.trim().parse::<f64>().is_ok() {
            rgb(0xb5cea8) // Green for numbers
        } else {
            rgb(0xd4d4d4) // Default
        };

        Box::new(
            div()
                .text_color(color)
                .child(text.to_string())
        )
    }

    fn render_error_panel(&self, cx: &mut ViewContext<Self>) -> impl Element {
        let editor = self.editor.read();
        
        if editor.validation_errors.is_empty() {
            return div();
        }

        div()
            .bg(rgb(0x1e1e1e))
            .border_t(px(1.0))
            .border_color(rgb(0x3e3e3e))
            .p_2()
            .children(editor.validation_errors.iter().map(|error| {
                div()
                    .flex()
                    .gap_2()
                    .text_color(rgb(0xf48771))
                    .child(format!("Line {}:{} - {}", error.line, error.column, error.message))
            }))
    }
}

impl Render for JsonEditorView {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl Element {
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(
                div()
                    .flex()
                    .flex_row()
                    .flex_grow()
                    .child(self.render_line_numbers(cx))
                    .child(self.render_content(cx))
            )
            .child(self.render_error_panel(cx))
    }
}
```

## Step 6: Statusbar Integration

### Creating a Statusbar Item

Add a statusbar indicator showing JSON validation status:

```rust
use pulsar_plugin_api::ui::{StatusBarFactory, StatusBarItemView};

pub struct JsonStatusBar {
    editor: Arc<parking_lot::RwLock<JsonEditor>>,
}

struct JsonStatusBarFactory;

impl StatusBarFactory for JsonStatusBarFactory {
    fn create(&self, ctx: &PluginContext) -> Result<Box<dyn StatusBarItemView>> {
        // Get current editor
        if let Some(editor) = ctx.active_editor::<JsonEditor>() {
            Ok(Box::new(JsonStatusBar { editor }))
        } else {
            Err(anyhow::anyhow!("No active JSON editor"))
        }
    }
}

impl StatusBarItemView for JsonStatusBar {
    fn render(&self, cx: &mut ViewContext<Self>) -> impl Element {
        let editor = self.editor.read();
        let (icon, color, text) = if editor.validation_errors.is_empty() {
            ("✓", rgb(0x4ec9b0), "Valid JSON")
        } else {
            ("✗", rgb(0xf48771), format!("{} errors", editor.validation_errors.len()))
        };

        div()
            .flex()
            .gap_2()
            .p_1()
            .px_2()
            .bg(rgb(0x007acc))
            .rounded(px(4.0))
            .text_color(color)
            .cursor_pointer()
            .on_click(cx.listener(|_, _, cx| {
                // Toggle error panel
            }))
            .child(icon.to_string())
            .child(text)
    }
}
```

## Step 7: Editor Factory

### Implementing the Factory Pattern

Create a factory to instantiate editors:

```rust
pub struct JsonEditorFactory {
    config: JsonEditorConfig,
}

impl JsonEditorFactory {
    pub fn new() -> Self {
        Self {
            config: JsonEditorConfig::default(),
        }
    }
}

impl EditorFactory for JsonEditorFactory {
    fn create(&self, buffer: EditorBuffer) -> Result<Box<dyn Editor>> {
        Ok(Box::new(JsonEditor::new(buffer, self.config.clone())))
    }

    fn file_extensions(&self) -> Vec<String> {
        vec!["json".to_string(), "jsonc".to_string()]
    }

    fn mime_types(&self) -> Vec<String> {
        vec!["application/json".to_string()]
    }
}
```

## Step 8: Error Handling

### Robust Error Management

Implement comprehensive error handling:

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum JsonEditorError {
    #[error("Invalid JSON: {0}")]
    InvalidJson(String),
    
    #[error("File IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("JSON parse error: {0}")]
    Parse(#[from] serde_json::Error),
    
    #[error("Buffer error: {0}")]
    Buffer(String),
}

impl JsonEditor {
    fn handle_error(&self, error: JsonEditorError, ctx: &EditorContext) {
        match error {
            JsonEditorError::InvalidJson(msg) => {
                ctx.show_error(&format!("JSON Validation Failed: {}", msg));
            }
            JsonEditorError::Io(e) => {
                ctx.show_error(&format!("File Error: {}", e));
            }
            JsonEditorError::Parse(e) => {
                ctx.show_error(&format!("Parse Error: {}", e));
            }
            JsonEditorError::Buffer(msg) => {
                ctx.show_error(&format!("Buffer Error: {}", msg));
            }
        }
    }
}
```

## Step 9: Plugin Export

### Exporting for Pulsar

Add the plugin export macro:

```rust
use pulsar_plugin_api::export_plugin;

export_plugin!(JsonEditorPlugin);

// This macro expands to:
// #[no_mangle]
// pub extern "C" fn _pulsar_plugin_create() -> *mut dyn Plugin {
//     Box::into_raw(Box::new(JsonEditorPlugin::new()))
// }
```

## Step 10: Building and Testing

### Building the Plugin

```bash
# Development build
cargo build

# Release build for production
cargo build --release

# The plugin will be at:
# target/debug/libpulsar_json_editor.so (Linux)
# target/debug/libpulsar_json_editor.dylib (macOS)
# target/debug/pulsar_json_editor.dll (Windows)
```

### Installing Locally

```bash
# Copy to Pulsar plugins directory
cp target/release/libpulsar_json_editor.* ~/.pulsar/plugins/

# Or use Pulsar's plugin manager
pulsar plugin install ./
```

### Testing the Plugin

Create a test JSON file:

```json
{
  "name": "test",
  "version": "1.0.0",
  "features": [
    "syntax highlighting",
    "validation",
    "auto-format"
  ]
}
```

Open it in Pulsar and verify:
1. Syntax highlighting works
2. Statusbar shows validation status
3. Invalid JSON shows errors
4. Save triggers auto-formatting

## Common Mistakes and Debugging

### Issue: Plugin Not Loading

**Symptoms:** Plugin doesn't appear in Pulsar

**Solutions:**
1. Check `plugin.toml` is in the correct location
2. Verify `crate-type = ["cdylib"]` in Cargo.toml
3. Ensure `export_plugin!` macro is called
4. Check Pulsar logs: `~/.pulsar/logs/plugin.log`

### Issue: Crashes on Load

**Symptoms:** Pulsar crashes when loading plugin

**Solutions:**
1. Verify all dependencies are compatible
2. Check for panics in initialization code
3. Use `Result` types properly, don't unwrap
4. Enable debug logging:

```rust
env_logger::init();
log::debug!("Plugin loading...");
```

### Issue: GPUI Rendering Problems

**Symptoms:** UI doesn't display correctly

**Solutions:**
1. Ensure all GPUI elements return `impl Element`
2. Check color values are valid RGB
3. Verify flex layouts have proper constraints
4. Use `cx.spawn()` for async operations

### Issue: Buffer Not Updating

**Symptoms:** Changes don't reflect in UI

**Solutions:**
1. Call `cx.notify()` after state changes
2. Use `RwLock` correctly for shared state
3. Ensure `Render` trait is implemented
4. Check event handlers are registered

## Advanced Features

### Adding Configuration UI

```rust
impl Plugin for JsonEditorPlugin {
    fn settings_view(&self, cx: &mut ViewContext<Self>) -> impl Element {
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(
                checkbox("Auto-format on save")
                    .checked(self.config.auto_format)
                    .on_change(cx.listener(|this, checked, cx| {
                        this.config.auto_format = checked;
                        cx.notify();
                    }))
            )
            .child(
                slider("Indent Size")
                    .value(self.config.indent_size)
                    .min(2)
                    .max(8)
                    .on_change(cx.listener(|this, value, cx| {
                        this.config.indent_size = value;
                        cx.notify();
                    }))
            )
    }
}
```

### Implementing Undo/Redo

```rust
use std::collections::VecDeque;

struct EditorHistory {
    undo_stack: VecDeque<String>,
    redo_stack: VecDeque<String>,
    max_history: usize,
}

impl JsonEditor {
    fn push_undo(&mut self) {
        if self.history.undo_stack.len() >= self.history.max_history {
            self.history.undo_stack.pop_front();
        }
        self.history.undo_stack.push_back(self.buffer.text().to_string());
        self.history.redo_stack.clear();
    }

    fn undo(&mut self) -> Result<()> {
        if let Some(text) = self.history.undo_stack.pop_back() {
            self.history.redo_stack.push_back(self.buffer.text().to_string());
            self.buffer.set_text(&text);
            self.is_modified = true;
        }
        Ok(())
    }
}
```

## Performance Optimization

### Lazy Rendering

```rust
impl JsonEditorView {
    fn render_visible_lines(&self, cx: &mut ViewContext<Self>) -> impl Element {
        let viewport_height = cx.viewport_size().height;
        let line_height = 20.0;
        let visible_lines = (viewport_height / line_height).ceil() as usize;
        let start_line = (self.scroll_offset / line_height) as usize;
        let end_line = (start_line + visible_lines).min(self.editor.read().buffer.line_count());

        // Only render visible lines
        div()
            .children((start_line..end_line).map(|line_num| {
                self.render_line(line_num, cx)
            }))
    }
}
```

### Debounced Validation

```rust
use std::time::{Duration, Instant};

struct Debouncer {
    last_trigger: Instant,
    delay: Duration,
}

impl JsonEditor {
    fn on_text_changed(&mut self, cx: &mut ViewContext<Self>) {
        if self.config.validate_on_type {
            if self.debouncer.should_trigger() {
                self.validate().ok();
                cx.notify();
            }
        }
    }
}
```

## Conclusion

You've now built a complete JSON editor plugin for Pulsar! This plugin demonstrates:

- Plugin architecture and lifecycle
- File type registration
- GPUI rendering with syntax highlighting
- Statusbar integration
- Save/load with validation
- Error handling
- Performance optimization

### Next Steps

1. Add JSON Schema validation
2. Implement code completion
3. Add find/replace functionality
4. Create unit tests
5. Publish to plugin registry

### Resources

- [Pulsar Plugin API Documentation](https://docs.pulsar-edit.dev/plugins)
- [GPUI Framework Guide](https://docs.pulsar-edit.dev/gpui)
- [Example Plugins Repository](https://github.com/pulsar-edit/plugins)
- [Community Discord](https://discord.gg/pulsar)

Happy plugin development!
