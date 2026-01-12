---
title: Pulsar Architecture
description: Understanding how Pulsar Engine is built
category: core-concepts
lastUpdated: '2026-01-12'
tags:
  - architecture
  - design
  - systems
related:
  - core-concepts/plugin-system
  - core-concepts/type-system
position: 1
icon: Network
---

# Pulsar Architecture

Pulsar Engine is built from the ground up with a focus on modularity, clarity, and long-term maintainability. This document explains how the major systems fit together and why they're designed the way they are.

## Design Philosophy

Before diving into the technical details, let's talk about the principles that guide Pulsar's architecture:

**Editor stability is paramount** - The editor should never crash, even when your game code does. Pulsar achieves this by running game code in separate processes and isolating plugin failures.

**Modular by default** - Systems have clear boundaries and communicate through well-defined interfaces. You can understand one part of Pulsar without needing to understand all of it.

**Type safety everywhere** - Rust's type system enforces correctness at compile time. Pulsar extends this with its own type database for game data.

**No magic** - If something happens in Pulsar, there's explicit code making it happen. No hidden conventions or implicit behavior.

## System Layers

Pulsar is organized into distinct layers, each with specific responsibilities:

```
┌─────────────────────────────────────────────────────┐
│                  UI Layer (GPUI)                    │
│   Editor windows │ Panels │ Menus │ Interactions    │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│               Editor Services                       │
│   File Manager │ Terminal │ Problems │ Debugger     │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│                Plugin System                        │
│   File Types │ Editors │ Statusbar │ Lifecycle      │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│               Backend Services                      │
│   Rust Analyzer │ Type DB │ File Watchers           │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│                Core Engine                          │
│   Rendering │ ECS │ Physics │ Assets                 │
└─────────────────────────────────────────────────────┘
```

Let's explore each layer.

## The UI Layer

Pulsar's entire editor interface is built with GPUI, a GPU-accelerated UI framework. This isn't just a styling choice—it's fundamental to how the editor works.

### Why GPUI?

Traditional UI frameworks (like Qt or immediate-mode GUIs) can struggle with complex editor layouts, especially when you're displaying thousands of items or doing real-time updates. GPUI leverages the GPU for rendering, meaning the UI stays smooth even under heavy load.

### Key Concepts

**Entities** - Managed containers for UI state. Think of them like React components but with strong ownership semantics:

```rust
struct MyPanel {
    data: Model<PanelData>,
    // ...
}

impl MyPanel {
    fn new(cx: &mut WindowContext) -> Self {
        let data = cx.new_model(|_| PanelData::default());
        Self { data }
    }
}
```

**Views** - Renderable UI elements that produce element trees:

```rust
impl Render for MyPanel {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .child(Label::new("My Panel"))
            .child(Button::new("Click Me"))
    }
}
```

**Contexts** - Manage threading and state access. Different contexts provide different capabilities (WindowContext, ViewContext, etc.).

### UI Crates

The `ui-crates/` directory contains all the editor windows and panels:

- `ui_core` - Main application shell, window management
- `ui_entry` - Launcher/welcome screen
- `ui_project_launcher` - Project selection and creation
- `ui_file_manager` - File browser and navigation
- `ui_problems` - Diagnostic viewer (errors, warnings)
- `ui_terminal` - Integrated terminal
- `ui_type_debugger` - Type system inspection
- `ui_level_editor` - 3D scene editor (in development)
- `ui_settings` - Preferences and configuration

Each is a separate crate that can be developed and tested independently.

## Editor Services

These are the background systems that keep the editor running smoothly.

### File Manager Service

Watches your project directory for changes and maintains an in-memory representation of your project structure. When you add, delete, or rename files, the file manager detects it immediately and updates the UI.

**Key features:**
- Recursive directory watching
- File type detection
- Change debouncing (avoid spam from rapid file changes)
- Integration with the plugin system for custom file types

### Problems Service

Aggregates diagnostics from multiple sources:
- Rust Analyzer (compiler errors, warnings, lints)
- Custom plugin validators
- Build system output

The problems panel displays all of these in one place, sorted by severity and location.

### Terminal Service

Provides an integrated terminal that can:
- Run arbitrary shell commands
- Execute Cargo commands with special handling
- Display colored output
- Maintain history across sessions

The terminal runs in a separate thread to avoid blocking the UI.

## The Plugin System

This is one of Pulsar's most distinctive features. Plugins aren't scripts or interpreted code—they're compiled Rust dynamic libraries (DLLs) loaded at runtime.

### Why Dynamic Libraries?

**Performance** - Native code runs at full speed. No interpretation overhead.

**Type safety** - Plugins are checked by the Rust compiler. If it compiles, most bugs are already caught.

**Full API access** - Plugins have access to the entire editor API, not a restricted sandbox.

**Hot reloading** - (Planned) Plugins can be reloaded without restarting the editor.

### Plugin Capabilities

Plugins can:

1. **Register file types** - Define new asset types with custom extensions and default content
2. **Provide editors** - Implement custom editors for those file types
3. **Add statusbar buttons** - Quick actions in the editor footer
4. **Hook lifecycle events** - Respond to plugin load/unload, project open/close, etc.

### Plugin Architecture

```rust
pub trait EditorPlugin: Send + Sync {
    fn metadata(&self) -> PluginMetadata;
    fn file_types(&self) -> Vec<FileTypeDefinition>;
    fn editors(&self) -> Vec<EditorMetadata>;
    fn create_editor(...) -> Result<(Arc<dyn PanelView>, Box<dyn EditorInstance>)>;
    // Optional hooks
    fn on_load(&mut self) {}
    fn on_unload(&mut self) {}
}
```

Plugins export a C-ABI compatible function that returns a trait object:

```rust
#[no_mangle]
pub extern "C" fn _plugin_create() -> *mut dyn EditorPlugin {
    Box::into_raw(Box::new(MyPlugin::default()))
}
```

The plugin manager loads the DLL, calls this function, and gets a plugin instance.

### Memory Safety

Since plugins cross the DLL boundary, memory management needs special attention:

- **Allocation** - Plugins allocate memory in their own heap
- **Deallocation** - The main app never frees plugin memory directly
- **Cleanup** - Plugins provide `_plugin_destroy` to clean up properly

## Backend Services

These services run on background threads and communicate with the editor through async channels.

### Rust Analyzer Manager

Rust Analyzer (rust-analyzer) is the language server for Rust. Pulsar integrates it to provide:
- Code completion
- Type information on hover
- Go-to-definition
- Diagnostics (errors and warnings)

The manager:
1. Spawns rust-analyzer as a child process
2. Communicates via JSON-RPC (LSP protocol)
3. Parses responses and updates the editor
4. Handles crashes and restarts automatically

### Type Database

Pulsar maintains a database of all types in your project:
- Structs and their fields
- Enums and their variants
- Traits and their methods
- Type aliases
- Function signatures

This enables:
- The type debugger UI
- Validation of data files
- Cross-reference navigation
- Intelligent autocomplete in custom editors

The type database is populated by:
1. Parsing Rust source files
2. Extracting type information from rust-analyzer
3. Processing procedural macro outputs

### File System Watchers

File system events (create, modify, delete) are detected using platform-specific APIs (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows).

Changes trigger:
- UI updates in the file manager
- Re-indexing in rust-analyzer
- Type database refresh
- Plugin file type handlers

## The Core Engine

While the editor is Pulsar's current focus, the core game engine is being developed in parallel. This includes:

### Rendering System
- Vulkan/Metal/DirectX backends
- Physically-based rendering (PBR)
- Deferred rendering pipeline
- GPU-driven rendering
- Compute shader integration

### Entity-Component-System (ECS)
- Custom ECS implementation optimized for game workloads
- Archetype-based storage for cache efficiency
- Parallel system execution
- Query DSL for component access

### Physics
- Integration with external physics engines
- Custom collision detection
- Deterministic simulation for multiplayer

### Asset Pipeline
- Streaming asset loading
- Hot-reload support
- Format conversion (glTF → internal format)
- LOD generation

## Data Flow Examples

Let's walk through some common scenarios to see how the systems interact.

### Opening a Project

1. User selects a project in the launcher (`ui_project_launcher`)
2. `ui_core` receives the project path
3. File manager starts watching the project directory
4. Plugin manager loads editor plugins from `plugins/editor/`
5. Plugins register their file types and editors
6. Rust Analyzer spawns and begins indexing
7. Type database starts loading project types
8. File manager populates the file tree
9. Editor windows become active

### Editing a File

1. User double-clicks `game/src/player.rs` in the file manager
2. File manager checks the file type (`.rs` → Rust source)
3. Plugin manager finds a suitable editor (built-in Rust editor)
4. Editor loads the file content
5. Rust Analyzer provides diagnostics
6. Problems panel displays any errors
7. User makes changes
8. File watcher detects the modification
9. Rust Analyzer re-analyzes the file
10. Diagnostics update in real-time

### Running a Build

1. User clicks "Build" or runs `cargo build` in the terminal
2. Terminal service spawns Cargo process
3. Cargo output streams to the terminal
4. Errors/warnings are parsed
5. Problems panel updates with build diagnostics
6. On success, Type database refreshes
7. Plugins can react to build completion

## Threading Model

Pulsar uses a hybrid threading approach to balance responsiveness and performance:

**Main Thread**
- All UI rendering (GPUI requirement)
- User input handling
- Editor state updates
- Must never block (< 16ms for 60fps)

**Background Threads**
- Rust Analyzer communication
- File system watching
- Type database queries
- Plugin operations

**Tokio Async Runtime**
- Network requests (multiplayer)
- Long-running operations
- File I/O

Communication uses:
- `tokio` channels for async message passing
- `Arc<Mutex<T>>` for shared state (sparingly)
- GPUI's `Context` for UI updates from background threads

## Configuration and Settings

### Engine Configuration

Global settings stored in `%AppData%/Pulsar/` (Windows) or `~/.config/pulsar/` (Linux):

- `config.json` - Editor preferences
- `themes/` - UI themes
- `plugins/` - User-installed plugins
- `recent-projects.json` - Recent project list

### Project Configuration

Per-project settings in the project root:

- `Cargo.toml` - Rust workspace manifest
- `project.toml` - Pulsar-specific settings
- `.pulsar/` - Editor metadata (don't commit to Git)
- `assets/` - Game assets
- `src/` or `game/src/` - Source code

## Extension Points

Want to extend Pulsar? Here are the official extension mechanisms:

1. **Editor Plugins** - Custom file types and editors
2. **Themes** - UI appearance customization
3. **Language Support** - Via Rust Analyzer extensions
4. **Asset Importers** - Convert external formats to Pulsar assets
5. **Build Scripts** - Custom build steps via Cargo

More extension points (scripting, visual node editors, etc.) are planned as the architecture matures.

## Future Directions

Pulsar's architecture is designed to support features currently in development:

- **Collaborative Editing** - Multiple users editing the same project simultaneously
- **Visual Scripting** - Node-based logic for non-programmers
- **Integrated Profiler** - Performance analysis directly in the editor
- **Asset Streaming** - Large worlds loaded on-demand
- **Platform Abstraction** - Restored Linux and macOS support

## Wrapping Up

Pulsar's architecture prioritizes clarity and modularity. Each system has a specific job and communicates through well-defined interfaces. This makes the codebase easier to understand, maintain, and extend.

If you want to dive deeper:
- [Plugin Development](../guides/creating-plugins) - Build your own editor plugins
- [Type System](./type-system) - How Pulsar's type database works
- [UI Framework](./ui-framework) - GPUI in detail

Or just browse the source code—it's well-commented and organized to be readable.

