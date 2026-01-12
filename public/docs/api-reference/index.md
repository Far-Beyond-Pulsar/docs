---
title: API Reference
description: Complete API documentation for the game engine
category: api-reference
lastUpdated: '2026-01-12'
tags:
  - api
  - reference
  - documentation
position: 3
icon: BookOpen
---

# API Reference

Complete API documentation for all engine modules.

## Core Modules

### [Core](./core/Engine)

The core engine APIs:

- **[Engine](./core/Engine)** - Main engine class for initialization
- **[GameObject](./core/GameObject)** - Base game object
- **[Component](./core/Component)** - Component base class

## API by Category

### Initialization

```rust
use game_engine::prelude::*;

fn main() {
    App::new()
        .add_plugin(DefaultPlugins)
        .run();
}
```

### Entity Management

```rust
// Spawn entity
commands.spawn(SpriteBundle::default());

// Query entities
fn system(query: Query<&Transform>) {
    for transform in query.iter() {
        // Process
    }
}
```

### Resources

```rust
// Add resource
app.add_resource(MyResource::default());

// Access resource
fn system(resource: Res<MyResource>) {
    // Use resource
}
```

## Quick Reference

| Type | Description | Module |
|------|-------------|--------|
| `App` | Application builder | `game_engine::app` |
| `World` | Entity container | `game_engine::ecs` |
| `Transform` | Position/rotation/scale | `game_engine::transform` |
| `Sprite` | 2D image | `game_engine::sprite` |
| `Mesh` | 3D mesh | `game_engine::mesh` |

## Browse by Module

- [Core](./core/Engine) - Engine core functionality
- Graphics - Rendering and graphics
- Physics - Physics simulation
- Audio - Sound and music
- Input - Keyboard, mouse, gamepad

## Common Patterns

### Creating a System

```rust
fn my_system(
    query: Query<&Transform>,
    time: Res<Time>,
    mut commands: Commands,
) {
    // System logic
}

// Register the system
app.add_system(my_system);
```

### Working with Components

```rust
// Define a component
#[derive(Component)]
struct Health {
    current: f32,
    max: f32,
}

// Use in a system
fn damage_system(mut query: Query<&mut Health>) {
    for mut health in query.iter_mut() {
        health.current -= 10.0;
    }
}
```

## API Conventions

::: info
All engine APIs follow Rust naming conventions:
- Types use `PascalCase`
- Functions use `snake_case`
- Constants use `SCREAMING_SNAKE_CASE`
:::

## Version Support

This documentation covers version **1.0.0** of the game engine.

- [View older versions](/docs/v0.9/api-reference)
- [Migration guide](/docs/migration/v0.9-to-v1.0)
