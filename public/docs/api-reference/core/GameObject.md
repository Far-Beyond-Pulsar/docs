---
title: "GameObject"
description: "Entity-based game object system for the ECS architecture"
category: "api-reference/core"
order: 2
lastUpdated: "2026-01-12"
tags: ["api", "core", "ecs", "entity", "gameobject"]
related: ["api-reference/core/Component", "api-reference/core/Engine", "guides/ecs-basics"]
---

# GameObject

The `GameObject` (also known as Entity) represents an individual object in the game world. It's a lightweight identifier that serves as a container for components in the Entity-Component-System (ECS) architecture.

## Module

```rust
use game_engine::GameObject;
// or
use game_engine::prelude::*;
```

## Overview

A GameObject is:
- A unique identifier (typically a `u64` or `EntityId`)
- A container for components
- Part of a scene hierarchy
- Managed by the ECS World

GameObjects themselves have no behavior - all functionality comes from attached components.

## Creating GameObjects

### `Commands::spawn`

Spawns a new GameObject with components.

```rust
pub fn spawn<B: Bundle>(&mut self, bundle: B) -> EntityCommands
```

**Parameters:**
- `bundle` - A bundle of components to attach

**Returns:** `EntityCommands` for further configuration

**Example:**

```rust
fn spawn_player(mut commands: Commands) {
    let player = commands.spawn((
        Transform::default(),
        Mesh::from_primitive(Primitive::Cube),
        Material::default(),
        Player { health: 100 },
    ));
}
```

### `Commands::spawn_empty`

Spawns a GameObject without any components.

```rust
pub fn spawn_empty(&mut self) -> EntityCommands
```

**Returns:** `EntityCommands` for adding components later

**Example:**

```rust
fn spawn_empty_entity(mut commands: Commands) {
    let entity = commands.spawn_empty()
        .insert(Transform::default())
        .insert(Name::new("Dynamic Entity"));
}
```

## Component Manipulation

### `insert`

Adds a component to a GameObject.

```rust
pub fn insert<C: Component>(&mut self, component: C) -> &mut Self
```

**Parameters:**
- `component` - The component to add

**Returns:** `&mut Self` for method chaining

**Example:**

```rust
// Add single component
entity.insert(Velocity { x: 10.0, y: 0.0 });

// Chain multiple inserts
entity.insert(Health { current: 100, max: 100 })
      .insert(Armor { defense: 25 });
```

### `insert_bundle`

Adds multiple components at once using a bundle.

```rust
pub fn insert_bundle<B: Bundle>(&mut self, bundle: B) -> &mut Self
```

**Parameters:**
- `bundle` - A tuple or struct of components

**Returns:** `&mut Self` for method chaining

**Example:**

```rust
entity.insert_bundle((
    Transform::default(),
    Velocity::ZERO,
    RigidBody::Dynamic,
));
```

### `remove`

Removes a component from a GameObject.

```rust
pub fn remove<C: Component>(&mut self) -> &mut Self
```

**Returns:** `&mut Self` for method chaining

**Example:**

```rust
// Remove a specific component type
entity.remove::<Velocity>();

// Chain removals
entity.remove::<Health>()
      .remove::<Armor>();
```

### `get`

Gets a reference to a component if it exists.

```rust
pub fn get<C: Component>(&self) -> Option<&C>
```

**Returns:** `Option<&C>` - Reference to the component or None

**Example:**

```rust
fn check_health(query: Query<Entity>) {
    for entity in query.iter() {
        if let Some(health) = entity.get::<Health>() {
            println!("Health: {}", health.current);
        }
    }
}
```

### `get_mut`

Gets a mutable reference to a component.

```rust
pub fn get_mut<C: Component>(&mut self) -> Option<Mut<C>>
```

**Returns:** `Option<Mut<C>>` - Mutable reference or None

**Example:**

```rust
fn damage_system(mut query: Query<Entity>) {
    for mut entity in query.iter_mut() {
        if let Some(mut health) = entity.get_mut::<Health>() {
            health.current -= 10;
        }
    }
}
```

## Hierarchy Operations

### `set_parent`

Sets the parent GameObject, creating a hierarchy.

```rust
pub fn set_parent(&mut self, parent: Entity) -> &mut Self
```

**Parameters:**
- `parent` - The parent GameObject

**Returns:** `&mut Self` for method chaining

**Example:**

```rust
fn create_player_weapon(mut commands: Commands) {
    let player = commands.spawn((
        Transform::default(),
        Player::default(),
    )).id();
    
    commands.spawn((
        Transform::from_xyz(1.0, 0.0, 0.0),
        Weapon::default(),
    )).set_parent(player);
}
```

### `remove_parent`

Removes this GameObject from its parent.

```rust
pub fn remove_parent(&mut self) -> &mut Self
```

**Returns:** `&mut Self` for method chaining

**Example:**

```rust
// Detach child from parent
entity.remove_parent();
```

### `add_child`

Adds a child GameObject to this entity.

```rust
pub fn add_child(&mut self, child: Entity) -> &mut Self
```

**Parameters:**
- `child` - The child GameObject

**Returns:** `&mut Self` for method chaining

**Example:**

```rust
fn attach_shield(
    mut commands: Commands,
    player_query: Query<Entity, With<Player>>,
) {
    let player = player_query.single();
    
    let shield = commands.spawn((
        Transform::from_xyz(0.0, 0.5, 0.0),
        Shield::default(),
    )).id();
    
    commands.entity(player).add_child(shield);
}
```

### `children`

Gets all child GameObjects.

```rust
pub fn children(&self) -> Option<&Children>
```

**Returns:** `Option<&Children>` - List of child entities or None

**Example:**

```rust
fn list_children(query: Query<(Entity, &Children)>) {
    for (entity, children) in query.iter() {
        println!("Entity {:?} has {} children", entity, children.len());
        for child in children.iter() {
            println!("  - Child: {:?}", child);
        }
    }
}
```

## Lifecycle Management

### `despawn`

Destroys the GameObject and all its components.

```rust
pub fn despawn(&mut self)
```

**Example:**

```rust
fn cleanup_dead_entities(
    mut commands: Commands,
    query: Query<(Entity, &Health)>,
) {
    for (entity, health) in query.iter() {
        if health.current <= 0 {
            commands.entity(entity).despawn();
        }
    }
}
```

### `despawn_recursive`

Destroys the GameObject and all its children recursively.

```rust
pub fn despawn_recursive(&mut self)
```

**Example:**

```rust
fn cleanup_player_and_equipment(
    mut commands: Commands,
    query: Query<Entity, With<Player>>,
) {
    for entity in query.iter() {
        // Despawns player and all equipped items
        commands.entity(entity).despawn_recursive();
    }
}
```

## Query Methods

### Querying GameObjects

Use the `Query` system parameter to find GameObjects with specific components.

```rust
fn movement_system(query: Query<(&Transform, &Velocity)>) {
    for (transform, velocity) in query.iter() {
        // Process entities with both Transform and Velocity
    }
}
```

### With Filters

```rust
// Only entities with Player component
fn player_system(query: Query<&Transform, With<Player>>) {
    // ...
}

// Entities without Player component
fn npc_system(query: Query<&Transform, Without<Player>>) {
    // ...
}

// Multiple filters
fn alive_players(
    query: Query<&Health, (With<Player>, Without<Dead>)>
) {
    // ...
}
```

### Changed Detection

```rust
fn detect_changes(query: Query<&Transform, Changed<Transform>>) {
    for transform in query.iter() {
        println!("Transform changed: {:?}", transform);
    }
}
```

## Complete Usage Examples

### Creating a Player Character

```rust
use game_engine::prelude::*;

#[derive(Component)]
struct Player {
    speed: f32,
    jump_force: f32,
}

#[derive(Component)]
struct Health {
    current: i32,
    max: i32,
}

fn setup_player(mut commands: Commands, asset_server: Res<AssetServer>) {
    // Spawn player with all necessary components
    let player = commands.spawn((
        // Transform component for position/rotation/scale
        Transform::from_xyz(0.0, 1.0, 0.0),
        
        // Visual representation
        Mesh::from_asset(asset_server.load("player.obj")),
        Material::from_color(Color::BLUE),
        
        // Physics
        RigidBody::Dynamic,
        Collider::Capsule {
            radius: 0.5,
            height: 2.0,
        },
        
        // Game logic components
        Player {
            speed: 5.0,
            jump_force: 10.0,
        },
        Health {
            current: 100,
            max: 100,
        },
        
        // Metadata
        Name::new("Player"),
    )).id();
    
    // Add weapon as child
    commands.spawn((
        Transform::from_xyz(0.5, 0.0, 0.0),
        Mesh::from_asset(asset_server.load("sword.obj")),
        Material::default(),
        Name::new("Weapon"),
    )).set_parent(player);
}
```

### Dynamic Entity Creation

```rust
fn spawn_projectile(
    mut commands: Commands,
    query: Query<(&Transform, &Player)>,
    input: Res<Input<MouseButton>>,
) {
    if input.just_pressed(MouseButton::Left) {
        for (transform, player) in query.iter() {
            // Calculate projectile spawn position
            let position = transform.translation + transform.forward() * 1.0;
            
            commands.spawn((
                Transform::from_translation(position),
                Velocity {
                    linear: transform.forward() * 20.0,
                    angular: Vec3::ZERO,
                },
                Projectile {
                    damage: 25,
                    lifetime: 5.0,
                },
                Mesh::from_primitive(Primitive::Sphere { radius: 0.1 }),
                Material::from_color(Color::RED),
            ));
        }
    }
}
```

### Entity Pooling Pattern

```rust
#[derive(Component)]
struct Inactive;

fn spawn_from_pool(
    mut commands: Commands,
    inactive_query: Query<Entity, With<Inactive>>,
) {
    if let Some(entity) = inactive_query.iter().next() {
        // Reuse existing entity
        commands.entity(entity)
            .remove::<Inactive>()
            .insert(Transform::default())
            .insert(Velocity::ZERO);
    } else {
        // Create new entity
        commands.spawn((
            Transform::default(),
            Velocity::ZERO,
            // ... other components
        ));
    }
}

fn return_to_pool(
    mut commands: Commands,
    query: Query<Entity, With<Expired>>,
) {
    for entity in query.iter() {
        commands.entity(entity)
            .remove::<Expired>()
            .insert(Inactive);
    }
}
```

## Common Patterns

### Entity Builder Pattern

```rust
struct PlayerBuilder {
    health: i32,
    speed: f32,
    position: Vec3,
}

impl PlayerBuilder {
    fn new() -> Self {
        Self {
            health: 100,
            speed: 5.0,
            position: Vec3::ZERO,
        }
    }
    
    fn with_health(mut self, health: i32) -> Self {
        self.health = health;
        self
    }
    
    fn with_speed(mut self, speed: f32) -> Self {
        self.speed = speed;
        self
    }
    
    fn at_position(mut self, position: Vec3) -> Self {
        self.position = position;
        self
    }
    
    fn spawn(self, commands: &mut Commands) -> Entity {
        commands.spawn((
            Transform::from_translation(self.position),
            Player { speed: self.speed },
            Health {
                current: self.health,
                max: self.health,
            },
        )).id()
    }
}

// Usage
fn setup(mut commands: Commands) {
    PlayerBuilder::new()
        .with_health(150)
        .with_speed(7.5)
        .at_position(Vec3::new(10.0, 0.0, 0.0))
        .spawn(&mut commands);
}
```

## Anti-Patterns

::: warning
**Don't store Entity references in components**

```rust
// ❌ Bad: Entity reference can become invalid
#[derive(Component)]
struct BadFollower {
    target: Entity, // Might become stale!
}

// ✅ Good: Use hierarchy or marker components
#[derive(Component)]
struct FollowTarget;

fn follow_system(
    followers: Query<&mut Transform, With<Follower>>,
    targets: Query<&Transform, With<FollowTarget>>,
) {
    // Query-based approach is safer
}
```
:::

::: warning
**Avoid excessive component types**

```rust
// ❌ Bad: Too granular
#[derive(Component)] struct PositionX(f32);
#[derive(Component)] struct PositionY(f32);
#[derive(Component)] struct PositionZ(f32);

// ✅ Good: Grouped logically
#[derive(Component)]
struct Position {
    x: f32,
    y: f32,
    z: f32,
}
```
:::

## Performance Considerations

::: tip
**Component Storage**
- Entities with the same component types are stored contiguously in memory
- Group related components together for better cache locality
- Use marker components for filtering instead of Option fields
:::

::: tip
**Hierarchy Performance**
- Deep hierarchies can impact transform updates
- Limit hierarchy depth when possible
- Use flat structures for large numbers of similar entities
:::

::: tip
**Despawning**
- Prefer `despawn()` over `despawn_recursive()` when children aren't needed
- Batch despawns in a single system to reduce overhead
- Consider entity pooling for frequently spawned/despawned objects
:::

## See Also

- [Component](./Component) - Component trait and built-in components
- [World](./World) - Entity storage and management
- [Query](./Query) - Querying entities and components
- [ECS Basics Guide](../../guides/ecs-basics)

## Version History

| Version | Changes |
|---------|---------|
| 1.0.0 | Stable GameObject API |
| 0.9.0 | Added hierarchy operations |
| 0.8.0 | Initial entity system |
