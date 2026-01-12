---
title: "Engine"
description: "Main engine class for initialization and game loop management"
category: "api-reference/core"
order: 1
lastUpdated: "2026-01-11"
tags: ["api", "core", "engine"]
related: ["api-reference/core/GameObject", "getting-started/quick-start"]
---

# Engine

The `Engine` class is the main entry point for the game engine. It manages initialization, the game loop, and core systems.

## Module

```rust
use game_engine::Engine;
```

## Overview

The Engine handles:
- System initialization
- Plugin management
- Game loop execution
- Resource management
- Event dispatching

## Constructor

### `new()`

Creates a new Engine instance with default configuration.

```rust
pub fn new() -> Self
```

**Example:**

```rust
use game_engine::Engine;

let mut engine = Engine::new();
```

## Methods

### `add_plugin`

Adds a plugin to the engine.

```rust
pub fn add_plugin<P: Plugin>(&mut self, plugin: P) -> &mut Self
```

**Parameters:**
- `plugin` - A type implementing the `Plugin` trait

**Returns:** `&mut Self` for method chaining

**Example:**

```rust
engine.add_plugin(DefaultPlugins)
      .add_plugin(PhysicsPlugin);
```

### `add_system`

Registers a system to run every frame.

```rust
pub fn add_system<S: System>(&mut self, system: S) -> &mut Self
```

**Parameters:**
- `system` - A function or type implementing `System`

**Returns:** `&mut Self` for method chaining

**Example:**

```rust
fn my_system(query: Query<&Transform>) {
    // System logic
}

engine.add_system(my_system);
```

### `add_resource`

Adds a global resource accessible to all systems.

```rust
pub fn add_resource<R: Resource>(&mut self, resource: R) -> &mut Self
```

**Parameters:**
- `resource` - A type implementing `Resource`

**Returns:** `&mut Self` for method chaining

**Example:**

```rust
#[derive(Resource)]
struct GameState {
    score: u32,
}

engine.add_resource(GameState { score: 0 });
```

### `run`

Starts the game loop. This method blocks until the application exits.

```rust
pub fn run(self) -> !
```

**Example:**

```rust
engine.run(); // Runs forever until window closes
```

### `run_once`

Runs a single frame of the game loop. Useful for testing.

```rust
pub fn run_once(&mut self)
```

**Example:**

```rust
// Useful for unit tests
let mut engine = Engine::new();
engine.run_once();
```

## Complete Example

```rust
use game_engine::prelude::*;

fn main() {
    // Create and configure engine
    let mut engine = Engine::new()
        .add_plugin(DefaultPlugins)
        .add_plugin(PhysicsPlugin)
        .add_resource(GameConfig::default())
        .add_system(spawn_player)
        .add_system(move_player)
        .add_system(check_collisions);

    // Start the game loop
    engine.run();
}

fn spawn_player(mut commands: Commands) {
    commands.spawn(PlayerBundle::default());
}

fn move_player(
    keyboard: Res<Input<KeyCode>>,
    mut query: Query<&mut Transform, With<Player>>,
) {
    // Movement logic
}

fn check_collisions(
    query: Query<(&Transform, &Collider)>,
    mut events: EventWriter<CollisionEvent>,
) {
    // Collision detection
}
```

## Configuration

The engine can be configured with `EngineConfig`:

```rust
use game_engine::{Engine, EngineConfig};

let config = EngineConfig {
    window_title: "My Game".to_string(),
    window_size: (1920, 1080),
    vsync: true,
    max_fps: Some(60),
};

let engine = Engine::from_config(config);
```

## Performance Considerations

::: tip
Systems added with `add_system` run in parallel when possible. The engine automatically detects data dependencies and schedules systems accordingly.
:::

::: warning
Avoid blocking operations in systems (like I/O or network calls). Use async tasks or dedicated threads instead.
:::

## Common Patterns

### Plugin Bundle

```rust
struct GamePlugin;

impl Plugin for GamePlugin {
    fn build(&self, engine: &mut Engine) {
        engine
            .add_system(spawn_enemies)
            .add_system(enemy_ai)
            .add_resource(EnemySpawner::default());
    }
}

// Use the plugin
engine.add_plugin(GamePlugin);
```

### Conditional Systems

```rust
// Only run system when in Playing state
engine.add_system(
    player_movement.run_if(in_state(GameState::Playing))
);
```

## See Also

- [App](./App) - High-level application builder
- [World](./World) - Entity and component storage
- [Plugin](./Plugin) - Plugin trait documentation
- [Quick Start Guide](../../getting-started/quick-start)

## Version History

| Version | Changes |
|---------|---------|
| 1.0.0 | Initial release |
| 0.9.0 | Beta API |
