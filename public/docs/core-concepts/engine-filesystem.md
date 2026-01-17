---
title: Engine Filesystem
description: Asset management and type indexing system
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - filesystem
  - assets
  - indexing
  - types
related:
  - core-concepts/architecture
position: 9
icon: FolderTree
---

# Engine Filesystem

The engine filesystem (`engine_fs`) provides centralized asset management and automatic indexing for Pulsar projects. It handles file operations and maintains the type database for quick lookups. The implementation is in `crates/engine_fs/`.

## What It Does

The filesystem layer provides:
- Automatic scanning and indexing of project assets
- File watchers that update indexes in real-time
- Type database integration for fast asset lookups
- Asset creation/update/delete operations
- Template-based asset creation

## EngineFs

The main type is `EngineFs` in `lib.rs`:

```rust
pub struct EngineFs {
    project_root: PathBuf,
    type_database: Arc<TypeDatabase>,
    operations: AssetOperations,
}
```

Creating an EngineFs instance scans the project directory and populates the type database:

```rust
let fs = EngineFs::new(project_root)?;
```

The initial scan walks the project directory, finds all asset files, and registers them in the type database. It skips hidden files (starting with `.`) and the `target` directory.

## Type Database Integration

The filesystem integrates tightly with the type database. When files are created, modified, or deleted, the type database is updated automatically.

Registration happens for JSON files with specific names:
- `struct.json` → `TypeKind::Struct`
- `enum.json` → `TypeKind::Enum`
- `trait.json` → `TypeKind::Trait`
- `*.alias.json` → `TypeKind::Alias`

The type name comes from the parent folder name. For example:
- `types/MyVector/struct.json` registers as type "MyVector" (Struct)
- `types/aliases/MyAlias.alias.json` registers as type "MyAlias" (Alias)

## Asset Operations

The `AssetOperations` type in `operations.rs` handles file operations:

```rust
pub struct AssetOperations {
    project_root: PathBuf,
    type_database: Arc<TypeDatabase>,
}
```

Operations ensure consistency between the filesystem and the type database. Every file operation updates both.

### Creating a Type Alias

```rust
let file_path = operations.create_type_alias("Vector3", r#"{
    "name": "Vector3",
    "underlying_type": "(f32, f32, f32)"
}"#)?;
```

This:
1. Checks if the name is unique in the type database
2. Creates `types/aliases/Vector3.alias.json`
3. Writes the JSON content
4. Registers in the type database

### Updating a Type Alias

```rust
operations.update_type_alias(&file_path, new_content)?;
```

This:
1. Parses the new content to validate JSON
2. Checks name uniqueness (or same file)
3. Writes the updated content
4. Updates the type database entry

### Deleting a Type Alias

```rust
operations.delete_type_alias(&file_path)?;
```

This:
1. Unregisters from the type database
2. Deletes the file

The order matters - unregister first so queries don't find a deleted file.

### Moving/Renaming

```rust
operations.move_type_alias(&old_path, &new_path)?;
```

This:
1. Unregisters the old path from the type database
2. Renames the file
3. Reads the content at the new location
4. Registers the new path in the type database

## File Watchers

The `watchers` module in `watchers.rs` monitors the project directory for changes:

```rust
pub fn start_watcher(
    project_root: PathBuf,
    type_database: Arc<TypeDatabase>,
) -> Result<()> {
    let (tx, rx) = std::sync::mpsc::channel();
    
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, _>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })?;
    
    watcher.watch(&project_root, RecursiveMode::Recursive)?;
    
    // Handle events in background thread
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            handle_fs_event(&event, &type_database);
        }
    });
    
    Ok(())
}
```

The watcher uses the `notify` crate to monitor filesystem events. When a file changes, it updates the type database automatically.

Event handling:

```rust
fn handle_fs_event(event: &Event, type_database: &TypeDatabase) {
    match &event.kind {
        EventKind::Create(_) | EventKind::Modify(_) => {
            // File created or modified - register/update
            for path in &event.paths {
                if let Some((name, kind)) = get_type_info(path) {
                    type_database.register_with_path(
                        name,
                        path.clone(),
                        kind,
                        None,
                        Some(format!("{:?}: {}", kind, name)),
                        None,
                    );
                }
            }
        }
        EventKind::Remove(_) => {
            // File removed - unregister
            for path in &event.paths {
                type_database.unregister_by_path(path);
            }
        }
        _ => {}
    }
}
```

The watcher runs in a background thread and updates the type database as files change. This keeps the index synchronized with the filesystem in real-time.

## Asset Templates

The `asset_templates` module defines all asset types the engine supports:

```rust
pub enum AssetKind {
    // Type System
    TypeAlias,
    Struct,
    Enum,
    Trait,
    
    // Blueprint System
    Blueprint,
    BlueprintClass,
    BlueprintFunction,
    
    // Scripts
    RustScript,
    LuaScript,
    
    // Scenes
    Scene,
    Prefab,
    
    // Materials & Shaders
    Material,
    Shader,
    
    // Audio
    AudioSource,
    AudioMixer,
    
    // UI
    UILayout,
    UITheme,
    
    // Data
    DataTable,
    JsonData,
    
    // Config
    ProjectConfig,
    EditorConfig,
}
```

Each asset kind has an extension and default directory:

```rust
impl AssetKind {
    pub fn extension(&self) -> &'static str {
        match self {
            AssetKind::TypeAlias => "alias.json",
            AssetKind::Struct => "struct.json",
            AssetKind::Blueprint => "blueprint.json",
            AssetKind::RustScript => "rs",
            AssetKind::Shader => "shader.wgsl",
            // ... more
        }
    }
    
    pub fn default_directory(&self) -> &'static str {
        match self {
            AssetKind::TypeAlias => "types/aliases",
            AssetKind::Struct => "types/structs",
            AssetKind::Blueprint => "blueprints",
            AssetKind::RustScript => "scripts/rust",
            AssetKind::Shader => "shaders",
            // ... more
        }
    }
}
```

This provides a consistent structure for projects. When creating an asset of a specific kind, the filesystem knows where to put it.

## Project Structure

A typical Pulsar project layout:

```
MyProject/
├── types/
│   ├── aliases/
│   │   └── Vector3.alias.json
│   ├── structs/
│   │   └── Player/
│   │       └── struct.json
│   └── enums/
│       └── GameState/
│           └── enum.json
├── blueprints/
│   ├── classes/
│   └── functions/
├── scripts/
│   ├── rust/
│   └── lua/
├── scenes/
├── materials/
├── shaders/
└── config/
```

The filesystem scans this structure and registers all recognized assets in the type database.

## Type Information Extraction

The watcher extracts type information from file paths:

```rust
fn get_type_info(path: &PathBuf) -> Option<(String, TypeKind)> {
    let extension = path.extension()?.to_str()?;
    let file_name = path.file_name()?.to_str()?;
    
    if extension == "json" {
        // Get parent folder name as the type name
        let type_name = path.parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())?
            .to_string();
        
        let kind = match file_name {
            "struct.json" => TypeKind::Struct,
            "enum.json" => TypeKind::Enum,
            "trait.json" => TypeKind::Trait,
            _ if file_name.contains("alias") => TypeKind::Alias,
            _ => return None,
        };
        
        return Some((type_name, kind));
    }
    
    None
}
```

This convention-based approach means the folder structure determines the type name. Moving a folder renames the type.

## Usage Example

Setting up filesystem monitoring for a project:

```rust
// Create the EngineFs instance
let mut engine_fs = EngineFs::new(project_root)?;

// Get type database for queries
let type_db = engine_fs.type_database();

// Query types
let structs = type_db.get_by_kind(TypeKind::Struct);
let vector3 = type_db.get_by_name("Vector3");

// Start watching for changes
watchers::start_watcher(
    engine_fs.project_root().clone(),
    type_db.clone()
)?;

// Now the type database automatically updates as files change
```

## Asset Operations Example

Creating and managing assets:

```rust
let ops = engine_fs.operations();

// Create a new type alias
let path = ops.create_type_alias("Position", r#"{
    "name": "Position",
    "underlying_type": "(f32, f32)"
}"#)?;

// Update it
ops.update_type_alias(&path, r#"{
    "name": "Position",
    "underlying_type": "(f64, f64)",
    "description": "High-precision position"
}"#)?;

// Move it to a different location
let new_path = project_root.join("types/aliases/WorldPosition.alias.json");
ops.move_type_alias(&path, &new_path)?;

// Delete it
ops.delete_type_alias(&new_path)?;
```

All operations keep the type database synchronized with the filesystem.

## Scan vs Watch

The filesystem provides two modes of index updates:

**Initial Scan** - `scan_project()` walks the entire directory tree and registers all assets. This is called once when EngineFs is created or when you explicitly re-scan.

**File Watching** - `start_watcher()` monitors filesystem events and incrementally updates the index. This runs continuously in the background.

Use scanning when you need a full rebuild of the index (like after a git pull that changed many files). Use watching for ongoing development where files change one at a time.

## Limitations

Current implementation:
- Only indexes JSON-based type definitions (structs, enums, traits, aliases)
- Doesn't index other asset types (blueprints, scenes, materials, etc.)
- File watching is single-threaded (one background thread handles all events)
- No deduplication of rapid file changes (every event triggers an update)

For large projects with many assets, the initial scan can take a moment. The watcher is efficient for incremental updates but doesn't batch rapid changes.

Future improvements could include:
- Indexing more asset types beyond type definitions
- Multi-threaded scanning for faster project initialization
- Debouncing filesystem events to batch rapid changes
- Caching parsed asset metadata to avoid repeated JSON parsing
