---
title: Engine State Management
description: Centralized global state for the engine
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - state
  - global
  - management
  - coordination
related:
  - core-concepts/architecture
position: 20
icon: Database
---

# Engine State Management

The engine state provides centralized, thread-safe storage for global engine data. It manages metadata, GPU renderers, window communication, and shared resources. The implementation is in `crates/engine_state/`.

## What It Provides

The engine state provides:
- Key-value metadata storage
- GPU renderer registry (per-window)
- Window request channel
- Discord Rich Presence integration
- Type database access
- Window counting

## EngineState Structure

The main state container:

```rust
pub struct EngineState {
    inner: Arc<RwLock<EngineStateInner>>,
}

struct EngineStateInner {
    metadata: Metadata,
    renderers: RendererRegistry,
    window_count: usize,
    window_sender: Option<WindowRequestSender>,
    discord_presence: Option<DiscordPresence>,
    type_database: Option<Arc<TypeDatabase>>,
}
```

Uses `Arc<RwLock<>>` for thread-safe shared access.

## Creating Engine State

Create a new instance:

```rust
let state = EngineState::new();
```

With window sender:

```rust
let (sender, receiver) = window_request_channel();
let state = EngineState::new()
    .with_window_sender(sender);
```

## Global Instance

Set as global singleton:

```rust
state.clone().set_global();
```

Access globally:

```rust
if let Some(state) = EngineState::global() {
    // Use state
}
```

This allows accessing state from anywhere without passing references.

## Metadata Storage

Store arbitrary key-value pairs:

```rust
state.set_metadata("project_path".to_string(), "/path/to/project".to_string());
state.set_metadata("last_opened".to_string(), "2026-01-17".to_string());
```

Retrieve metadata:

```rust
if let Some(path) = state.get_metadata("project_path") {
    println!("Project: {}", path);
}
```

Metadata is thread-safe and can store any string data.

## Metadata Object

Direct metadata access:

```rust
let metadata = state.metadata();

// Set multiple values
metadata.set("key1".into(), "value1".into());
metadata.set("key2".into(), "value2".into());

// Get values
let value = metadata.get("key1");

// List all keys
let keys = metadata.keys();
```

## Renderer Registry

Track GPU renderers per window:

```rust
pub struct RendererRegistry {
    renderers: Arc<DashMap<u64, RendererHandle>>,
}

pub struct RendererHandle {
    // Platform-specific GPU renderer
}
```

Register a renderer:

```rust
state.set_window_gpu_renderer(window_id, renderer_handle);
```

Get renderer:

```rust
if let Some(renderer) = state.get_window_gpu_renderer(window_id) {
    // Use renderer
}
```

Remove renderer:

```rust
state.remove_window_gpu_renderer(window_id);
```

This allows multiple windows to have separate GPU renderers.

## Window Communication

The window request channel enables communication:

```rust
pub enum WindowRequest {
    Entry,
    ProjectSplash { project_path: String },
    Editor { project_path: String },
    CloseWindow { window_id: u64 },
    Terminal,
    Settings,
}
```

Request a window:

```rust
state.request_window(WindowRequest::Editor {
    project_path: "/path/to/project".to_string(),
});
```

The main event loop receives requests:

```rust
let (sender, mut receiver) = window_request_channel();
let state = EngineState::new().with_window_sender(sender);

// In main loop
while let Ok(request) = receiver.recv() {
    match request {
        WindowRequest::Editor { project_path } => {
            // Open editor window
        }
        WindowRequest::CloseWindow { window_id } => {
            // Close window
        }
        _ => {}
    }
}
```

## Window Counting

Track open windows:

```rust
// When window opens
let count = state.increment_window_count();

// When window closes
let count = state.decrement_window_count();

// Get count
let count = state.window_count();
```

Use this to quit when last window closes:

```rust
if state.decrement_window_count() == 0 {
    app.quit();
}
```

## Discord Rich Presence

Integrate Discord:

```rust
state.init_discord("YOUR_APPLICATION_ID")?;
```

Update presence:

```rust
if let Some(discord) = state.discord() {
    discord.set_activity("Editing MyProject", "Working on blueprints")?;
}
```

Clear presence:

```rust
if let Some(discord) = state.discord() {
    discord.clear_activity()?;
}
```

## Type Database Access

Store the project type database:

```rust
let type_db = Arc::new(TypeDatabase::new());
state.set_type_database(type_db.clone());
```

Access globally:

```rust
if let Some(type_db) = state.type_database() {
    let types = type_db.get_all();
}
```

This allows accessing types from any window or component.

## Thread Safety

The state is thread-safe:

```rust
let state = EngineState::new();
state.clone().set_global();

// Thread 1
std::thread::spawn(|| {
    let state = EngineState::global().unwrap();
    state.set_metadata("thread1".into(), "data1".into());
});

// Thread 2
std::thread::spawn(|| {
    let state = EngineState::global().unwrap();
    state.set_metadata("thread2".into(), "data2".into());
});
```

All operations use interior mutability (RwLock, DashMap).

## Cloning

Cloning is cheap (Arc reference count):

```rust
let state1 = EngineState::new();
let state2 = state1.clone();  // Both refer to same data
```

## Example: Project Manager

Using state to manage project data:

```rust
// Set current project
state.set_metadata("current_project".into(), project_path.clone());
state.set_metadata("project_name".into(), project_name.clone());

// Open editor window
state.request_window(WindowRequest::Editor {
    project_path: project_path.clone(),
});

// Track window
let window_id = state.increment_window_count();
state.set_metadata("latest_window_id".into(), window_id.to_string());
```

## Example: GPU Renderer Lifecycle

Managing renderer per window:

```rust
// Window opens
let window_id = window.id();
let renderer = GpuRenderer::new(1920, 1080);
let handle = RendererHandle::new(renderer);
state.set_window_gpu_renderer(window_id, handle);

// Render loop
if let Some(renderer) = state.get_window_gpu_renderer(window_id) {
    renderer.render_frame();
}

// Window closes
state.remove_window_gpu_renderer(window_id);
```

## Example: Session Persistence

Save/load session state:

```rust
// Save session
state.set_metadata("window_count".into(), state.window_count().to_string());
state.set_metadata("last_project".into(), project_path);

// Save to file
let metadata = state.metadata();
let json = serde_json::to_string(&metadata)?;
std::fs::write("session.json", json)?;

// Restore session
let json = std::fs::read_to_string("session.json")?;
let saved_metadata: Metadata = serde_json::from_str(&json)?;

// Restore state
if let Some(project) = saved_metadata.get("last_project") {
    state.request_window(WindowRequest::Editor {
        project_path: project,
    });
}
```

## Limitations

Current implementation:
- No persistence (state lost on shutdown)
- No change notifications (can't observe metadata)
- No namespacing (global flat key space)
- Limited typed access (everything is strings)

Future improvements:
- Persistent state across sessions
- Observable metadata (reactive updates)
- Namespaced metadata (project.name, editor.theme)
- Typed metadata system
- State history/undo
