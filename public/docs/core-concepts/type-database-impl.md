---
title: Type Database
description: Fast in-memory type registry and search
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - types
  - database
  - indexing
  - search
related:
  - core-concepts/engine-filesystem
  - core-concepts/architecture
position: 13
icon: Database
---

# Type Database

The type database is an in-memory, thread-safe database for storing and searching user-defined runtime types. It provides fast registration, lookup, and fuzzy search capabilities. The implementation is in `crates/type_db/src/lib.rs`.

## What It Does

The type database provides:
- Fast registration and lookup by ID, name, or category
- Case-insensitive and fuzzy search
- Thread-safe concurrent access using `DashMap`
- Multiple indexes for efficient queries
- File path tracking for filesystem integration

## TypeInfo Structure

Each registered type has this structure:

```rust
pub struct TypeInfo {
    pub id: u64,
    pub name: String,
    pub category: Option<String>,
    pub description: Option<String>,
    pub file_path: Option<PathBuf>,
    pub type_kind: TypeKind,
    pub display_name: String,
    pub ast: Option<String>,
    pub last_modified: Option<SystemTime>,
}
```

Types are categorized by kind:

```rust
pub enum TypeKind {
    Alias,
    Struct,
    Enum,
    Trait,
}
```

## TypeDatabase Structure

The database maintains multiple indexes for fast lookups:

```rust
pub struct TypeDatabase {
    types: DashMap<u64, TypeInfo>,
    name_index: DashMap<String, Vec<u64>>,
    category_index: DashMap<String, Vec<u64>>,
    file_path_index: DashMap<PathBuf, u64>,
    next_id: AtomicU64,
}
```

The indexes allow O(1) lookups by ID, name, category, or file path.

## Creating a Database

Create a new empty database:

```rust
use type_db::TypeDatabase;

let db = TypeDatabase::new();
```

This initializes all indexes and sets the next ID to 0.

## Registering Types

Register a simple type:

```rust
let id = db.register_simple("Vector3", TypeKind::Struct);
```

Register with full metadata:

```rust
let id = db.register(
    "Player",
    Some("Game".to_string()),
    Some("Player entity struct".to_string()),
    None,
    TypeKind::Struct,
    None,
    None,
    None,
);
```

Register with file path (automatically extracts last_modified):

```rust
let id = db.register_with_path(
    "MyType",
    PathBuf::from("/path/to/file.json"),
    TypeKind::Alias,
    None,
    Some("Custom type alias".to_string()),
    None,
)?;
```

The database assigns a unique ID to each type (incrementing from 0).

## Querying Types

Get by ID:

```rust
if let Some(type_info) = db.get(id) {
    println!("Found type: {}", type_info.name);
}
```

Get by name:

```rust
let types = db.get_by_name("Vector3");
for type_info in types {
    println!("Found: {} (kind: {:?})", type_info.name, type_info.type_kind);
}
```

Names are case-insensitive, so "Vector3", "vector3", and "VECTOR3" all match the same entries.

Get by category:

```rust
let game_types = db.get_by_category("Game");
```

Get by kind:

```rust
let all_structs = db.get_by_kind(TypeKind::Struct);
```

Get by file path:

```rust
if let Some(type_info) = db.get_by_path(&path) {
    println!("File contains type: {}", type_info.name);
}
```

## Search

The database provides case-insensitive substring search:

```rust
let results = db.search("vec");
// Returns types with names containing "vec" (case-insensitive)
```

Search results are ordered by relevance (exact matches first, then substring matches).

## Fuzzy Search

Fuzzy search finds types with similar names:

```rust
let results = db.fuzzy_search("Vectr3", 2);
// Finds "Vector3" with Levenshtein distance <= 2
```

This is useful for autocomplete and typo-tolerant search.

## Removing Types

Unregister by ID:

```rust
if let Some(removed) = db.unregister(id) {
    println!("Removed: {}", removed.name);
}
```

Unregister by file path:

```rust
if let Some(removed) = db.unregister_by_path(&path) {
    println!("Removed type from: {:?}", path);
}
```

Removing a type cleans up all indexes (name, category, file path).

## Statistics

Get counts by kind:

```rust
let struct_count = db.count_by_kind(TypeKind::Struct);
let enum_count = db.count_by_kind(TypeKind::Enum);
```

Get all unique categories:

```rust
let categories = db.get_all_categories();
```

Total types:

```rust
let total = db.len();
```

Check if empty:

```rust
if db.is_empty() {
    println!("No types registered");
}
```

## Clearing

Clear all types:

```rust
db.clear();
```

This removes all entries and resets the next ID to 0.

## Thread Safety

The database uses `DashMap` for lock-free concurrent access:

```rust
use std::sync::Arc;

let db = Arc::new(TypeDatabase::new());

// Thread 1
let db1 = db.clone();
std::thread::spawn(move || {
    db1.register_simple("Type1", TypeKind::Struct);
});

// Thread 2
let db2 = db.clone();
std::thread::spawn(move || {
    let types = db2.get_by_name("Type1");
});
```

Multiple threads can read and write simultaneously without explicit locking.

## Filesystem Integration

The database integrates with the engine filesystem:

```rust
use engine_fs::EngineFs;

let fs = EngineFs::new(project_root)?;
let db = fs.type_database();

// Database is automatically populated by scanning project
let all_types = db.get_all();
```

File watchers update the database when files change, keeping it synchronized with the filesystem.

## AST Storage

Types can store their AST (Abstract Syntax Tree) representation:

```rust
let ast_json = serde_json::to_string(&ast)?;
db.register(
    "ComplexType",
    None,
    None,
    None,
    TypeKind::Alias,
    None,
    Some(ast_json),
    None,
);
```

This is used by the type editor to preserve the full type structure.

## Display Names

Types can have display names different from their internal names:

```rust
db.register(
    "Vec3",                    // Internal name
    None,
    None,
    None,
    TypeKind::Alias,
    Some("3D Vector".to_string()), // Display name
    None,
    None,
);
```

Display names appear in the UI while internal names are used for code generation.

## Performance

The database is optimized for:
- Fast inserts (O(1) amortized)
- Fast lookups by ID, name, category, or path (O(1))
- Reasonable search performance (O(n) but with early termination)
- Low memory overhead (inline storage for small strings)

For projects with thousands of types, all operations remain fast due to the indexed structure.

## Limitations

Current implementation:
- No persistence (in-memory only)
- No undo/redo for type operations
- No type dependencies or relationships
- No versioning or history tracking

For larger projects, you may want:
- SQLite backend for persistence
- Transaction support
- Type relationship graph
- Change tracking and history
