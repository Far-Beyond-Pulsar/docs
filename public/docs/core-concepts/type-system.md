---
title: Type System
description: Pulsar's custom type system for strongly-typed game data
category: core-concepts
lastUpdated: '2026-01-12'
tags:
  - types
  - data
  - validation
  - type-system
related:
  - core-concepts/architecture
  - guides/working-with-assets
  - api-reference/type-database
position: 3
icon: TypeOutline
---

# Type System

Most game engines treat data files as opaque blobs—JSON or YAML that gets parsed at runtime, with errors discovered only when that specific code path runs. Pulsar takes a different approach: every piece of game data has a type, and those types are known at edit time. This gives you compile-time-like safety for your data files.

## Why a Type System?

You might wonder why Pulsar needs its own type system when Rust already has one. The short answer: Rust's type system works at compile time for code. Pulsar's type system extends that safety to data files that your game loads at runtime.

### The Problem with Untyped Data

Traditional workflow:
1. Write code that expects certain data structure
2. Create JSON file with that structure
3. Run game
4. Game crashes because field name was misspelled
5. Fix spelling
6. Run game again
7. Game crashes because field type was wrong
8. Fix type
9. Repeat until it works

This is slow, frustrating, and error-prone. Worse, some paths through your game might rarely execute, so bugs hide until players encounter them.

### The Typed Data Solution

Pulsar workflow:
1. Define types in Rust code
2. Create data file
3. Editor validates against type definitions as you type
4. Red squiggles show errors immediately
5. Autocomplete suggests valid field names
6. Type checker ensures correct data types
7. Game runs successfully (or fails for logic reasons, not data structure issues)

Errors are caught in the editor, not in the game. This is massively faster and less frustrating.

## Core Concepts

Let's build up the type system from first principles.

### Types as Metadata

In Pulsar, every Rust type you define becomes metadata that the editor understands:

```rust
// In your game code
pub struct Player {
    pub name: String,
    pub health: f32,
    pub max_health: f32,
    pub position: Vector3,
}
```

The type system extracts this definition and stores it in the Type Database. Now the editor knows:
- There's a type called `Player`
- It has four fields
- Each field has a specific type
- All fields are public (private fields aren't exposed to data)

### Data Files Reference Types

When you create a data file, you specify which type it uses:

```json
{
    "$type": "Player",
    "name": "Alice",
    "health": 100.0,
    "max_health": 100.0,
    "position": [0.0, 0.0, 0.0]
}
```

The `$type` field tells the editor "this data should match the Player type." The editor then validates every other field against the type definition.

If you misspell `health` as `helth`, you get an immediate error. If you put a string where a number belongs, error. If you forget a required field, error. All in the editor, before you ever run the game.

### The Type Database

The Type Database is where all type information lives. Think of it like a runtime version of the Rust compiler's type information, but accessible to editor tools.

It stores:

**Structs** - Data structures with named fields
```rust
pub struct Transform {
    pub position: Vector3,
    pub rotation: Quaternion,
    pub scale: Vector3,
}
```

**Enums** - Tagged unions with variants
```rust
pub enum GameState {
    Menu,
    Playing { level: u32 },
    Paused,
    GameOver { score: u32 },
}
```

**Traits** - Interface definitions
```rust
pub trait Damageable {
    fn take_damage(&mut self, amount: f32);
    fn is_alive(&self) -> bool;
}
```

**Type Aliases** - Named shortcuts
```rust
pub type EntityId = u64;
pub type Position = Vector3;
```

All of these are extracted from your Rust code and made available to the editor.

## How Types Are Discovered

The type system doesn't require manual registration (usually). Here's how it finds types:

### Automatic Extraction

When you open a project:
1. The Type Database scans all `.rs` files in your project
2. It parses them using the `syn` crate (same parser Rust macros use)
3. It extracts public type definitions
4. It builds a dependency graph (Type A references Type B, etc.)
5. It stores everything in an SQLite database for fast querying

This happens in the background. By the time you're looking at the editor, type information is already available.

### Rust Analyzer Integration

The Type Database also queries rust-analyzer (the Rust language server) for information it can't extract from syntax alone:
- Macro expansions (derive-generated code)
- Type inference results
- Cross-crate type definitions
- Generic type instantiations

This gives you complete type information, even for complex codebases.

### Manual Registration

If you need to manually register a type (rare, but possible):

```rust
use type_db::{TypeDatabase, TypeKind, Visibility};

type_db.register_with_path(
    "CustomType".into(),
    PathBuf::from("src/custom.rs"),
    TypeKind::Struct,
    Visibility::Public,
    vec![], // Dependencies
    None,   // Generic constraints
)?;
```

## Working with Types

### Querying the Type Database

```rust
use type_db::TypeDatabase;

// Get a specific type
let player_type = type_db.get_type("Player")?;

// Get all types of a certain kind
let all_structs = type_db.get_by_kind(TypeKind::Struct);

// Search by name
let results = type_db.search("Player");

// Get all types (for listing in UI)
let all_types = type_db.all();
```

This API is available to plugins, so your custom editors can be type-aware.

### Type Information Structure

```rust
pub struct TypeInfo {
    pub name: String,
    pub kind: TypeKind,
    pub path: PathBuf,  // Where the type is defined
    pub dependencies: Vec<String>,  // Other types this one references
    pub visibility: Visibility,
    pub fields: Option<Vec<FieldInfo>>,  // For structs
    pub variants: Option<Vec<VariantInfo>>,  // For enums
}

pub enum TypeKind {
    Struct,
    Enum,
    Trait,
    Alias,
}
```

Each `TypeInfo` is a complete description of a type, sufficient for validation and code generation.

## Using Types in Data Files

### JSON Format

The most common way to use types:

```json
{
    "$type": "Player",
    "name": "Bob",
    "health": 75.0,
    "max_health": 100.0,
    "position": [10.0, 0.0, 5.0]
}
```

Field order doesn't matter. The type system matches by name.

### Nested Types

Types can contain other types:

```rust
pub struct Inventory {
    pub items: Vec<Item>,
    pub max_capacity: u32,
}

pub struct Item {
    pub name: String,
    pub weight: f32,
}
```

In JSON:

```json
{
    "$type": "Inventory",
    "max_capacity": 20,
    "items": [
        {
            "$type": "Item",
            "name": "Sword",
            "weight": 5.0
        },
        {
            "$type": "Item",
            "name": "Potion",
            "weight": 0.5
        }
    ]
}
```

The type system validates nested structures recursively.

### Optional Fields

Rust's `Option<T>` maps naturally:

```rust
pub struct Quest {
    pub title: String,
    pub description: String,
    pub reward: Option<Item>,
}
```

In JSON, optional fields can be omitted or set to `null`:

```json
{
    "$type": "Quest",
    "title": "Find the Sword",
    "description": "Search the ruins",
    "reward": null
}
```

Or:

```json
{
    "$type": "Quest",
    "title": "Find the Sword",
    "description": "Search the ruins"
}
```

Both are valid.

### Enums in Data

Enums are trickier because they can have associated data:

```rust
pub enum PowerUp {
    Health { amount: f32 },
    Speed { duration: f32, multiplier: f32 },
    Invincibility,
}
```

In JSON, use a `variant` field:

```json
{
    "$type": "PowerUp",
    "variant": "Speed",
    "duration": 5.0,
    "multiplier": 2.0
}
```

For unit variants (no data):

```json
{
    "$type": "PowerUp",
    "variant": "Invincibility"
}
```

## Editor Integration

The type system isn't just about validation—it powers editor features.

### Real-Time Validation

As you type in a data file, the editor continuously validates:

```json
{
    "$type": "Player",
    "name": "Alice",
    "helth": 100.0  // ❌ Error: Unknown field 'helth'. Did you mean 'health'?
}
```

Errors appear immediately with suggestions. No need to save and run to find out you made a typo.

### Autocomplete

Start typing a field name and get suggestions:

```json
{
    "$type": "Player",
    "name": "Alice",
    "h|  // Autocomplete suggests: health, max_health
}
```

This works because the editor queries the Type Database for valid fields.

### Type-Aware Go-To-Definition

Click on a type name and jump to its Rust definition:

```json
{
    "$type": "Player",  // Ctrl+Click jumps to struct Player definition
    ...
}
```

This is bidirectional—you can also find all data files that use a given type.

### Type Inspector

The Type Debugger panel shows all types in your project. Click one to see:
- Fields and their types
- Methods (for traits)
- Where the type is defined
- What other types reference it
- All data files using this type

This is invaluable for understanding complex type relationships.

## Built-in Types

Pulsar provides a standard library of common types in `pulsar_std`:

### Primitives

All Rust primitives are supported:
- `bool`
- `i8`, `i16`, `i32`, `i64`, `i128`
- `u8`, `u16`, `u32`, `u64`, `u128`
- `f32`, `f64`
- `char`
- `String`

### Collections

Standard collections work naturally:
- `Vec<T>` - Dynamic array
- `HashMap<K, V>` - Hash map
- `HashSet<T>` - Set
- `Option<T>` - Optional value
- `Result<T, E>` - Result type

In JSON, these map intuitively:

```json
{
    "scores": [100, 200, 300],  // Vec<i32>
    "config": {                 // HashMap<String, String>
        "key1": "value1",
        "key2": "value2"
    },
    "optional_name": null       // Option<String>
}
```

### Math Types

Common game math types:
- `Vector2` - 2D vector
- `Vector3` - 3D vector
- `Vector4` - 4D vector / RGBA color
- `Quaternion` - Rotation
- `Matrix4` - 4x4 transformation matrix
- `Color` - RGBA color with helper constructors

Example:

```json
{
    "position": [1.0, 2.0, 3.0],  // Vector3
    "rotation": [0.0, 0.0, 0.0, 1.0],  // Quaternion (x, y, z, w)
    "color": [1.0, 0.5, 0.0, 1.0]  // Color (r, g, b, a)
}
```

### Engine Types

Types specific to Pulsar:
- `EntityId` - Unique entity identifier
- `AssetHandle<T>` - Reference to an asset
- `Transform` - Position, rotation, scale
- `Time` - Time and duration types

## Advanced Features

### Generic Types

Generics work like you'd expect:

```rust
pub struct Container<T> {
    pub value: T,
}
```

In data, the generic parameter is usually inferred from context or specified explicitly:

```json
{
    "$type": "Container<i32>",
    "value": 42
}
```

The Type Database tracks generic constraints and validates instantiations.

### Trait Bounds

Types can require trait implementations:

```rust
pub struct DamageSystem<T>
where
    T: Damageable + Clone
{
    pub targets: Vec<T>,
}
```

The type system verifies that concrete types meet the trait bounds.

### Derive Macros

Common traits can be auto-derived:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub name: String,
    pub weight: f32,
}
```

The type system understands derives and includes generated trait implementations in its metadata.

### Type Versioning

For save data that needs to evolve over time:

```rust
#[derive(Serialize, Deserialize)]
pub struct SaveData {
    pub version: u32,
    pub player: Player,
}

impl SaveData {
    pub fn migrate(data: serde_json::Value) -> Result<Self, Error> {
        let version = data["version"].as_u64().unwrap_or(0) as u32;
        
        match version {
            0 => Self::migrate_v0_to_v1(data),
            1 => serde_json::from_value(data),
            _ => Err(Error::UnsupportedVersion(version)),
        }
    }
}
```

Include a version field and write migration code explicitly. The type system can't do this automatically, but it makes the pattern clear.

## Validation

The type system validates data in multiple ways:

### Structural Validation

Checks that data matches the type structure:
- All required fields present
- No extra fields (unless type allows)
- Field types match definitions
- Enums use valid variants

### Semantic Validation

Checks logical constraints:
- Ranges (e.g., health between 0 and max_health)
- String patterns (e.g., valid email format)
- Cross-field dependencies

Semantic validation requires custom validators:

```rust
impl Validate for Player {
    fn validate(&self) -> Result<(), ValidationError> {
        if self.health > self.max_health {
            return Err(ValidationError::FieldConstraint {
                field: "health".into(),
                message: "Cannot exceed max_health".into(),
            });
        }
        Ok(())
    }
}
```

### Reference Validation

Checks that asset references are valid:

```rust
pub struct PlayerData {
    pub mesh: AssetHandle<Mesh>,
    pub texture: AssetHandle<Texture>,
}
```

The type system verifies that referenced assets exist and are the correct type.

## Performance

The type system is designed to be fast:

### Query Performance

- Hot types: <1ms lookup (in-memory cache)
- Cold types: ~10ms (database query)
- Full project scan: ~100ms for 1000 types

### Memory Usage

- Per type: ~1KB
- 1000 types: ~1MB
- Cache size: Configurable

### Optimization Tips

**Batch queries** - Use `get_many()` instead of repeated `get()` calls:

```rust
let types = type_db.get_many(&["Player", "Enemy", "Item"])?;
```

**Cache TypeInfo** - Store `Arc<TypeInfo>` to avoid re-querying:

```rust
struct MyEditor {
    type_info: Arc<TypeInfo>,
    // ...
}
```

**Index by path** - Fast lookup for file-based queries:

```rust
let types_in_file = type_db.get_by_path(&path)?;
```

## Common Patterns

### Component Types

ECS components are just types:

```rust
pub struct Position(pub Vector3);
pub struct Velocity(pub Vector3);
pub struct Health {
    pub current: f32,
    pub max: f32,
}
```

No special component macro needed. They're validated like any other type.

### Builder Pattern

Complex types often use builders:

```rust
pub struct PlayerBuilder {
    name: String,
    health: f32,
}

impl PlayerBuilder {
    pub fn new() -> Self {
        Self {
            name: String::new(),
            health: 100.0,
        }
    }
    
    pub fn with_name(mut self, name: String) -> Self {
        self.name = name;
        self
    }
    
    pub fn with_health(mut self, health: f32) -> Self {
        self.health = health;
        self
    }
    
    pub fn build(self) -> Player {
        Player {
            name: self.name,
            health: self.health,
            max_health: self.health,
            position: Vector3::ZERO,
        }
    }
}
```

The type system sees both the builder and the built type.

### Newtype Pattern

Distinguish similar primitive types:

```rust
pub struct PlayerId(pub u64);
pub struct ItemId(pub u64);
```

Now you can't accidentally use an ItemId where a PlayerId is expected.

## Error Handling

Type errors are strongly typed:

```rust
pub enum TypeError {
    NotFound { name: String },
    InvalidKind { expected: TypeKind, found: TypeKind },
    CircularDependency { chain: Vec<String> },
    ValidationError { field: String, message: String },
    ParseError { path: PathBuf, message: String },
}
```

All implement `std::error::Error` with descriptive messages.

### Error Recovery

The editor attempts graceful recovery from errors:

**Missing field** - Use default value if type implements `Default`
**Unknown type** - Show placeholder, allow editing as raw JSON
**Invalid data** - Highlight error, preserve file content

The goal is to never lose data, even when the type system can't fully understand it.

## Integration with Other Systems

### Asset System

Types can reference assets:

```rust
pub struct CharacterData {
    pub mesh: AssetHandle<Mesh>,
    pub animations: Vec<AssetHandle<Animation>>,
}
```

AssetHandle is type-safe—you can't put a Texture where a Mesh is expected.

### ECS

The type system powers ECS component storage:

```rust
// Type system knows this is a component
pub struct Transform {
    pub position: Vector3,
    pub rotation: Quaternion,
}

// ECS uses type info to store efficiently
world.add_component(entity, Transform::default());
```

### Serialization

All types in data files must implement `Serialize` and `Deserialize`:

```rust
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct MyType {
    // ...
}
```

Serde handles the actual serialization format. The type system provides validation and editor integration.

## Limitations

Current limitations (planned improvements):

- No runtime type creation
- No dynamic typing (everything is statically defined)
- Limited generic support (simple cases work)
- No procedural macros in data files

These are architectural choices, not temporary bugs. The type system prioritizes compile-time safety over runtime flexibility.

## Debugging

### Type Debugger UI

Open the Type Debugger panel (bottom of editor) to:
- Browse all project types
- See type details (fields, methods)
- View type relationships
- Find where types are used

### Console Commands

```bash
# Print type information
:type Player

# List all types
:types

# Search types
:type-search "Player"

# Validate a data file
:validate-file player.json
```

### Logging

Enable type system logging:

```rust
RUST_LOG=type_db=debug cargo run
```

This shows type discovery, query performance, and validation details.

## Best Practices

### Naming Conventions

- **Types**: `PascalCase` (Player, GameState)
- **Fields**: `snake_case` (max_health, is_alive)
- **Constants**: `SCREAMING_SNAKE_CASE` (MAX_PLAYERS)

### Organization

Group related types:

```
src/
├── types/
│   ├── mod.rs
│   ├── player.rs
│   ├── enemy.rs
│   └── items.rs
└── systems/
```

### Documentation

Document public types:

```rust
/// Represents a player character.
///
/// Players have health, inventory, and can move around the world.
/// They are controlled by player input or AI.
pub struct Player {
    /// The player's display name shown in-game
    pub name: String,
    
    /// Current health points (0.0 to max_health)
    pub health: f32,
}
```

Doc comments appear in the Type Debugger and help users understand your API.

### Avoid Complex Nesting

Deep nesting makes data files hard to edit:

```rust
// Hard to work with
pub struct A {
    pub b: B,
}

pub struct B {
    pub c: C,
}

pub struct C {
    pub d: D,
}

// Better: flatten when possible
pub struct FlatData {
    pub b_field: String,
    pub c_field: i32,
    pub d_field: f32,
}
```

## Future Directions

Planned improvements:

**Visual type editor** - Create types graphically without writing Rust

**Cross-language types** - Type system works with non-Rust languages

**Hot reload** - Update types without restarting the editor

**Version migration tools** - Automatically update data files when types change

**Type inference** - Omit `$type` when it's obvious from context

## Wrapping Up

Pulsar's type system brings compile-time-like safety to runtime data. It's more upfront work than throwing JSON at a parser, but the payoff is massive: catch errors early, get autocomplete everywhere, and never wonder what shape your data should be.

For practical examples, see:
- [Working with Assets](../guides/working-with-assets) - Using types in asset files
- [Type Database API](../../api-reference/type-database) - Programmatic access
- [Architecture](./architecture) - How types fit in the bigger picture

Or explore the Type Debugger in the editor—seeing real types from your project is often the best way to learn.
