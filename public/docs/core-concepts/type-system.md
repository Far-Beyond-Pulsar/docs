---
title: Type Database
description: Pulsar's type registry for inspecting project types
category: core-concepts
lastUpdated: '2026-01-12'
tags:
  - types
  - database
  - inspection
  - type-debugger
related:
  - core-concepts/architecture
  - getting-started/quick-start
position: 3
icon: TypeOutline
---

# Type Database

Pulsar includes a **Type Database** (`type_db` crate) - an in-memory registry for storing and querying Rust types from your project. This powers the **Type Debugger** UI panel, which lets you browse and inspect all the structs, enums, traits, and type aliases in your codebase.

## What Is the Type Database?

The Type Database is a thread-safe, in-memory store that holds metadata about Rust types. It's populated by analyzing your project's code (via Rust Analyzer integration) and provides fast lookup and search capabilities.

Think of it as a runtime index of your project's type definitions, accessible to editor tooling.

## Core Concepts

### TypeInfo

Each registered type is represented as `TypeInfo`:

```rust
pub struct TypeInfo {
    pub id: u64,                      // Unique identifier
    pub name: String,                 // Type name (e.g., "Player")
    pub category: Option<String>,     // Optional category (e.g., "Components")
    pub description: Option<String>,  // Optional description
    pub file_path: Option<PathBuf>,   // Where the type is defined
    pub type_kind: TypeKind,          // Struct, Enum, Trait, or Alias
    pub display_name: String,         // UI display name
    pub ast: Option<String>,          // AST representation (for aliases)
    pub last_modified: Option<SystemTime>,
}
```

### TypeKind

Types are categorized by kind:

```rust
pub enum TypeKind {
    Alias,   // Type alias (type Foo = Bar;)
    Struct,  // Struct definition
    Enum,    // Enum definition
    Trait,   // Trait definition
}
```

## Using the Type Database

### Registering Types

Types are registered with the database:

```rust
use type_db::{TypeDatabase, TypeKind};

let db = TypeDatabase::new();

// Simple registration
let id = db.register_simple("Vector3", TypeKind::Struct);

// Full registration with metadata
let id = db.register(
    "Player",
    Some("Components".to_string()),  // category
    Some("Main player character".to_string()),  // description
    None,  // file_path
    TypeKind::Struct,
    None,  // display_name (defaults to name)
    None,  // ast
    None,  // last_modified
);

// Register with file path (automatically gets last_modified)
let id = db.register_with_path(
    "Enemy",
    PathBuf::from("src/components/enemy.rs"),
    TypeKind::Struct,
    None,
    Some("Enemy AI component".to_string()),
    None,
)?;
```

### Looking Up Types

Multiple lookup methods are provided:

```rust
// Get by ID
let type_info = db.get(id);

// Get by exact name (case-insensitive)
let types = db.get_by_name("Player");

// Get by category
let components = db.get_by_category("Components");

// Get by file path
let type_info = db.get_by_path(&PathBuf::from("src/player.rs"));

// Get by kind
let all_structs = db.get_by_kind(TypeKind::Struct);
let all_enums = db.get_by_kind(TypeKind::Enum);

// Get all types
let all_types = db.all();
```

### Searching Types

The database supports fuzzy searching:

```rust
// Substring search (case-insensitive)
let results = db.search("player");  // Finds "Player", "PlayerController", etc.

// Fuzzy search with scoring
let results = db.search_fuzzy("pc");
// Finds "PlayerController" (high score), "ProjectConfig" (lower score), etc.
// Results are sorted by relevance
```

### Removing Types

```rust
// Remove by ID
let removed = db.unregister(id);

// Remove by file path
let removed = db.unregister_by_path(&path);

// Clear all types
db.clear();
```

## Type Debugger UI

The Type Database powers the **Type Debugger** panel in the editor:

**Features:**
- Browse all types in your project
- Filter by kind (Structs, Enums, Traits, Aliases)
- Search and fuzzy search
- View type definitions and file locations
- See type relationships
- Jump to definition in code

**Access:**
- Open from menu: View > Type Debugger
- Keyboard shortcut: (configurable)
- Status bar button (when enabled)

The Type Debugger is unique to Pulsar - it provides x-ray vision into your project's type structure.

## Integration with Rust Analyzer

Pulsar integrates with Rust Analyzer to populate the Type Database:

1. Rust Analyzer indexes your project
2. Type information is extracted
3. Types are registered in the database
4. UI updates in real-time as you edit code

This keeps the Type Database synchronized with your actual code.

## Performance

The Type Database uses `DashMap` for concurrent access:

- **Thread-safe** - Multiple threads can query simultaneously
- **Fast lookups** - O(1) for ID-based, O(log n) for name-based
- **Efficient indexing** - Separate indices for names, categories, and file paths
- **Minimal memory** - Only metadata stored, not full type definitions

Performance characteristics:
- 10,000 type registrations: < 1 second
- Concurrent reads: Lock-free with DashMap
- Search: Substring search over all names

## Use Cases

**Type Debugging** - Browse your project's types without opening files

**Code Navigation** - Jump from type name to definition

**Type Inspection** - See all structs, enums, traits at a glance

**Project Understanding** - Quickly grasp the structure of unfamiliar code

**Refactoring** - Find all uses of a type by category or name

## Limitations

**No detailed type information** - Stores metadata only, not field definitions or method signatures (use Rust Analyzer for that)

**Manual updates** - Types must be explicitly registered/unregistered (automated via Rust Analyzer integration)

**No dependency tracking** - Doesn't track type relationships or dependencies

**In-memory only** - Not persisted to disk (rebuilt on project load)

## Example: Custom Plugin Using Type Database

Plugins can access the Type Database:

```rust
use type_db::TypeDatabase;

// Access global type database
let db = get_type_database();

// Find all component types
let components = db.get_by_category("Components");

// Show in custom UI panel
for component in components {
    println!("{}: {}", component.name, component.file_path);
}
```

## Wrapping Up

The Type Database is a simple but powerful tool for type inspection. It provides:

- Fast, thread-safe type lookup
- Fuzzy search capabilities
- Integration with Rust Analyzer
- Powers the Type Debugger UI panel

It's not a validation system or type checker - it's a registry for editor tooling to query project types efficiently.

For more details:
- [Architecture](./architecture) - How the Type Database fits into Pulsar
- [Quick Start](../getting-started/quick-start) - See the Type Debugger in action
