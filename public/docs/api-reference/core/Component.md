---
title: Component
description: Component trait and built-in components for the ECS architecture
category: api-reference/core
lastUpdated: '2026-01-12'
tags:
  - api
  - core
  - ecs
  - component
  - data
related:
  - api-reference/core/GameObject
  - api-reference/core/Engine
  - guides/custom-components
position: 3
icon: Box
---

# Component

Components are pure data containers that define the characteristics and state of GameObjects. In the ECS architecture, components hold data while systems provide behavior.

## Module

```rust
use game_engine::Component;
// or
use game_engine::prelude::*;
```

## Overview

A Component is:
- A type implementing the `Component` trait
- Pure data with no behavior
- Attached to GameObjects (Entities)
- Queried by Systems for processing

Components enable composition over inheritance, allowing flexible and reusable game object designs.

## Component Trait

### Trait Definition

```rust
pub trait Component: Send + Sync + 'static {
    // Optional: Custom storage type
    type Storage: ComponentStorage = TableStorage;
}
```

**Requirements:**
- `Send` - Can be transferred between threads
- `Sync` - Can be accessed from multiple threads
- `'static` - No non-static references

**Example:**

```rust
use game_engine::prelude::*;

#[derive(Component)]
struct Health {
    current: i32,
    max: i32,
}

#[derive(Component)]
struct Velocity {
    x: f32,
    y: f32,
    z: f32,
}
```

## Built-in Components

### Transform

Position, rotation, and scale in 3D space.

```rust
#[derive(Component)]
pub struct Transform {
    pub translation: Vec3,
    pub rotation: Quat,
    pub scale: Vec3,
}
```

**Methods:**

```rust
// Constructors
Transform::from_xyz(x: f32, y: f32, z: f32) -> Self
Transform::from_translation(translation: Vec3) -> Self
Transform::from_rotation(rotation: Quat) -> Self
Transform::from_scale(scale: Vec3) -> Self

// Transformations
transform.translate(delta: Vec3)
transform.rotate(rotation: Quat)
transform.scale_by(factor: f32)
transform.look_at(target: Vec3, up: Vec3)

// Direction vectors
transform.forward() -> Vec3
transform.right() -> Vec3
transform.up() -> Vec3

// Matrix conversion
transform.compute_matrix() -> Mat4
```

**Example:**

```rust
fn setup_entity(mut commands: Commands) {
    commands.spawn((
        Transform::from_xyz(0.0, 5.0, 10.0)
            .with_rotation(Quat::from_rotation_y(PI / 4.0))
            .with_scale(Vec3::splat(2.0)),
    ));
}

fn move_forward(mut query: Query<&mut Transform>) {
    for mut transform in query.iter_mut() {
        let forward = transform.forward();
        transform.translate(forward * 0.1);
    }
}
```

### Mesh

Visual geometry for rendering.

```rust
#[derive(Component)]
pub struct Mesh {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
    pub primitive: PrimitiveTopology,
}
```

**Constructors:**

```rust
Mesh::from_primitive(primitive: Primitive) -> Self
Mesh::from_asset(handle: Handle<MeshAsset>) -> Self
Mesh::from_vertices(vertices: Vec<Vertex>, indices: Vec<u32>) -> Self
```

**Primitives:**

```rust
enum Primitive {
    Cube,
    Sphere { radius: f32, subdivisions: u32 },
    Cylinder { radius: f32, height: f32 },
    Plane { size: f32 },
    Capsule { radius: f32, height: f32 },
}
```

**Example:**

```rust
fn spawn_primitives(mut commands: Commands) {
    // Cube
    commands.spawn((
        Transform::from_xyz(0.0, 0.0, 0.0),
        Mesh::from_primitive(Primitive::Cube),
    ));
    
    // Sphere
    commands.spawn((
        Transform::from_xyz(5.0, 0.0, 0.0),
        Mesh::from_primitive(Primitive::Sphere {
            radius: 1.0,
            subdivisions: 32,
        }),
    ));
}
```

### Material

Visual appearance properties.

```rust
#[derive(Component)]
pub struct Material {
    pub color: Color,
    pub metallic: f32,
    pub roughness: f32,
    pub emissive: Color,
    pub albedo_texture: Option<Handle<Texture>>,
    pub normal_texture: Option<Handle<Texture>>,
}
```

**Constructors:**

```rust
Material::default() -> Self
Material::from_color(color: Color) -> Self
Material::from_texture(texture: Handle<Texture>) -> Self
```

**Example:**

```rust
fn create_materials(mut commands: Commands, assets: Res<AssetServer>) {
    // Solid color
    commands.spawn((
        Transform::default(),
        Mesh::from_primitive(Primitive::Cube),
        Material::from_color(Color::rgb(1.0, 0.0, 0.0)),
    ));
    
    // Textured
    commands.spawn((
        Transform::default(),
        Mesh::from_primitive(Primitive::Sphere { 
            radius: 1.0, 
            subdivisions: 32 
        }),
        Material {
            albedo_texture: Some(assets.load("textures/earth.png")),
            roughness: 0.8,
            metallic: 0.2,
            ..default()
        },
    ));
}
```

### Camera

Viewport and projection configuration.

```rust
#[derive(Component)]
pub struct Camera {
    pub projection: Projection,
    pub viewport: Viewport,
    pub order: i32,
}

pub enum Projection {
    Perspective {
        fov: f32,
        near: f32,
        far: f32,
    },
    Orthographic {
        scale: f32,
        near: f32,
        far: f32,
    },
}
```

**Example:**

```rust
fn setup_camera(mut commands: Commands) {
    commands.spawn((
        Transform::from_xyz(0.0, 5.0, 10.0)
            .looking_at(Vec3::ZERO, Vec3::Y),
        Camera {
            projection: Projection::Perspective {
                fov: 60.0_f32.to_radians(),
                near: 0.1,
                far: 1000.0,
            },
            viewport: Viewport::default(),
            order: 0,
        },
    ));
}
```

### Name

Human-readable identifier for entities.

```rust
#[derive(Component)]
pub struct Name(String);

impl Name {
    pub fn new(name: impl Into<String>) -> Self
    pub fn as_str(&self) -> &str
}
```

**Example:**

```rust
fn spawn_named_entities(mut commands: Commands) {
    commands.spawn((
        Transform::default(),
        Name::new("Player"),
    ));
    
    commands.spawn((
        Transform::default(),
        Name::new("Enemy #1"),
    ));
}

fn list_entities(query: Query<(Entity, &Name)>) {
    for (entity, name) in query.iter() {
        println!("Entity {:?}: {}", entity, name.as_str());
    }
}
```

### RigidBody

Physics body type and properties.

```rust
#[derive(Component)]
pub enum RigidBody {
    Static,
    Dynamic,
    Kinematic,
}
```

**Example:**

```rust
fn setup_physics(mut commands: Commands) {
    // Dynamic (affected by forces)
    commands.spawn((
        Transform::from_xyz(0.0, 10.0, 0.0),
        RigidBody::Dynamic,
        Collider::Sphere { radius: 0.5 },
        Mass(1.0),
    ));
    
    // Static (immovable)
    commands.spawn((
        Transform::default(),
        RigidBody::Static,
        Collider::Box {
            half_extents: Vec3::new(10.0, 0.5, 10.0),
        },
    ));
}
```

### Collider

Physics collision shape.

```rust
#[derive(Component)]
pub enum Collider {
    Box { half_extents: Vec3 },
    Sphere { radius: f32 },
    Capsule { radius: f32, height: f32 },
    Mesh { mesh: Handle<Mesh> },
}
```

**Example:**

```rust
fn create_colliders(mut commands: Commands) {
    // Box collider
    commands.spawn((
        Transform::default(),
        Collider::Box {
            half_extents: Vec3::new(1.0, 1.0, 1.0),
        },
    ));
    
    // Sphere collider
    commands.spawn((
        Transform::default(),
        Collider::Sphere { radius: 0.5 },
    ));
}
```

## Creating Custom Components

### Basic Component

```rust
use game_engine::prelude::*;

#[derive(Component)]
struct Health {
    current: i32,
    max: i32,
}

impl Health {
    fn new(max: i32) -> Self {
        Self {
            current: max,
            max,
        }
    }
    
    fn damage(&mut self, amount: i32) {
        self.current = (self.current - amount).max(0);
    }
    
    fn heal(&mut self, amount: i32) {
        self.current = (self.current + amount).min(self.max);
    }
    
    fn is_alive(&self) -> bool {
        self.current > 0
    }
    
    fn percentage(&self) -> f32 {
        self.current as f32 / self.max as f32
    }
}

// Usage in systems
fn damage_system(mut query: Query<&mut Health, With<Enemy>>) {
    for mut health in query.iter_mut() {
        health.damage(10);
    }
}
```

### Component with Default

```rust
#[derive(Component, Default)]
struct Player {
    speed: f32,
    jump_force: f32,
}

impl Default for Player {
    fn default() -> Self {
        Self {
            speed: 5.0,
            jump_force: 10.0,
        }
    }
}
```

### Component with Validation

```rust
#[derive(Component)]
struct Speed {
    value: f32,
}

impl Speed {
    const MAX: f32 = 100.0;
    const MIN: f32 = 0.0;
    
    fn new(value: f32) -> Self {
        Self {
            value: value.clamp(Self::MIN, Self::MAX),
        }
    }
    
    fn set(&mut self, value: f32) {
        self.value = value.clamp(Self::MIN, Self::MAX);
    }
}
```

### Component with Relations

```rust
#[derive(Component)]
struct Inventory {
    items: Vec<Entity>,
    capacity: usize,
}

impl Inventory {
    fn new(capacity: usize) -> Self {
        Self {
            items: Vec::with_capacity(capacity),
            capacity,
        }
    }
    
    fn add_item(&mut self, item: Entity) -> bool {
        if self.items.len() < self.capacity {
            self.items.push(item);
            true
        } else {
            false
        }
    }
    
    fn remove_item(&mut self, item: Entity) -> bool {
        if let Some(index) = self.items.iter().position(|&i| i == item) {
            self.items.swap_remove(index);
            true
        } else {
            false
        }
    }
}
```

## Component Lifecycle Hooks

Components can react to lifecycle events using system hooks:

### On Add

```rust
fn on_health_added(
    query: Query<(Entity, &Health), Added<Health>>,
) {
    for (entity, health) in query.iter() {
        println!("Health component added to {:?}: {}", entity, health.current);
    }
}
```

### On Change

```rust
fn on_transform_changed(
    query: Query<(Entity, &Transform), Changed<Transform>>,
) {
    for (entity, transform) in query.iter() {
        println!("Transform changed for {:?}", entity);
    }
}
```

### On Remove

Requires tracking with a separate system:

```rust
#[derive(Component)]
struct Removed<T: Component>(PhantomData<T>);

fn track_removed_health(
    mut commands: Commands,
    mut removed: RemovedComponents<Health>,
) {
    for entity in removed.iter() {
        println!("Health removed from {:?}", entity);
    }
}
```

## Component Storage

### Table Storage (Default)

Optimal for components on many entities:

```rust
#[derive(Component)]
#[component(storage = "Table")]
struct Transform {
    // ...
}
```

**Characteristics:**
- Dense memory layout
- Fast iteration
- Good cache locality
- Default storage type

### Sparse Set Storage

Optimal for components on few entities or frequently added/removed:

```rust
#[derive(Component)]
#[component(storage = "SparseSet")]
struct Rare {
    // ...
}
```

**Characteristics:**
- Fast add/remove
- Slower iteration
- Good for marker components

## Query Patterns

### Basic Query

```rust
fn simple_query(query: Query<&Transform>) {
    for transform in query.iter() {
        // Process each transform
    }
}
```

### Multiple Components

```rust
fn multi_query(query: Query<(&Transform, &Velocity, &mut Health)>) {
    for (transform, velocity, mut health) in query.iter_mut() {
        // Process entities with all three components
    }
}
```

### With Filters

```rust
// With marker component
fn player_query(query: Query<&Transform, With<Player>>) {
    for transform in query.iter() {
        // Only entities with Player component
    }
}

// Without marker component
fn npc_query(query: Query<&Transform, Without<Player>>) {
    for transform in query.iter() {
        // Only entities without Player component
    }
}

// Multiple filters
fn specific_query(
    query: Query<&Health, (With<Player>, Without<Dead>)>
) {
    for health in query.iter() {
        // Alive players only
    }
}
```

### Changed Detection

```rust
fn changed_query(
    query: Query<&Transform, Changed<Transform>>
) {
    for transform in query.iter() {
        // Only entities with changed Transform
    }
}
```

### Optional Components

```rust
fn optional_query(
    query: Query<(&Transform, Option<&Velocity>)>
) {
    for (transform, velocity) in query.iter() {
        if let Some(vel) = velocity {
            // Has velocity
        } else {
            // No velocity
        }
    }
}
```

## Complete Usage Example

```rust
use game_engine::prelude::*;

// Define custom components
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

#[derive(Component)]
struct Velocity {
    linear: Vec3,
    angular: Vec3,
}

#[derive(Component)]
struct Enemy {
    aggro_range: f32,
    attack_damage: i32,
}

// Spawn system
fn spawn_player(mut commands: Commands, assets: Res<AssetServer>) {
    commands.spawn((
        // Built-in components
        Transform::from_xyz(0.0, 1.0, 0.0),
        Mesh::from_asset(assets.load("player.obj")),
        Material::from_color(Color::BLUE),
        RigidBody::Dynamic,
        Collider::Capsule {
            radius: 0.5,
            height: 2.0,
        },
        
        // Custom components
        Player {
            speed: 5.0,
            jump_force: 10.0,
        },
        Health {
            current: 100,
            max: 100,
        },
        Velocity {
            linear: Vec3::ZERO,
            angular: Vec3::ZERO,
        },
        
        // Metadata
        Name::new("Player"),
    ));
}

// Movement system
fn player_movement(
    keyboard: Res<Input<KeyCode>>,
    mut query: Query<(&Player, &mut Velocity), With<Player>>,
) {
    for (player, mut velocity) in query.iter_mut() {
        let mut direction = Vec3::ZERO;
        
        if keyboard.pressed(KeyCode::W) {
            direction.z -= 1.0;
        }
        if keyboard.pressed(KeyCode::S) {
            direction.z += 1.0;
        }
        if keyboard.pressed(KeyCode::A) {
            direction.x -= 1.0;
        }
        if keyboard.pressed(KeyCode::D) {
            direction.x += 1.0;
        }
        
        velocity.linear = direction.normalize_or_zero() * player.speed;
    }
}

// Health system
fn damage_system(
    mut query: Query<(&mut Health, Entity)>,
    mut commands: Commands,
) {
    for (mut health, entity) in query.iter_mut() {
        if health.current <= 0 {
            commands.entity(entity).despawn_recursive();
        }
    }
}

// Enemy AI system
fn enemy_ai(
    player_query: Query<&Transform, With<Player>>,
    mut enemy_query: Query<(&Transform, &Enemy, &mut Velocity), Without<Player>>,
) {
    if let Ok(player_transform) = player_query.get_single() {
        for (enemy_transform, enemy, mut velocity) in enemy_query.iter_mut() {
            let to_player = player_transform.translation - enemy_transform.translation;
            let distance = to_player.length();
            
            if distance < enemy.aggro_range {
                // Move towards player
                velocity.linear = to_player.normalize() * 3.0;
            } else {
                velocity.linear = Vec3::ZERO;
            }
        }
    }
}
```

## Performance Considerations

::: tip
**Component Size**
- Keep components small and focused
- Large components slow down queries that don't need all fields
- Split large components into smaller logical pieces
:::

::: tip
**Query Efficiency**
- More specific queries are faster (use filters)
- Changed detection adds minimal overhead
- Optional components slow down queries slightly
:::

::: tip
**Memory Layout**
- Components with same types are stored together
- Querying fewer component types is faster
- Use marker components for filtering
:::

## Common Patterns

### Marker Components

```rust
#[derive(Component)]
struct Player;

#[derive(Component)]
struct Enemy;

#[derive(Component)]
struct Dead;
```

### Component Groups

```rust
#[derive(Bundle)]
struct PhysicsBundle {
    transform: Transform,
    velocity: Velocity,
    rigidbody: RigidBody,
    collider: Collider,
    mass: Mass,
}
```

### Computed Components

```rust
fn update_health_percentage(
    mut query: Query<(&Health, &mut HealthBar), Changed<Health>>
) {
    for (health, mut health_bar) in query.iter_mut() {
        health_bar.percentage = health.current as f32 / health.max as f32;
    }
}
```

## Anti-Patterns

::: warning
**Don't put behavior in components**

```rust
// ❌ Bad: Logic in component
#[derive(Component)]
struct BadHealth {
    current: i32,
    max: i32,
}

impl BadHealth {
    fn update(&mut self, delta: f32) {
        // Don't put game logic here!
    }
}

// ✅ Good: Logic in systems
fn health_system(mut query: Query<&mut Health>) {
    // Game logic in systems
}
```
:::

::: warning
**Avoid component dependencies**

```rust
// ❌ Bad: Assumes another component exists
#[derive(Component)]
struct BadWeapon {
    // Assumes Health component exists
}

// ✅ Good: Query both components
fn weapon_system(query: Query<(&Weapon, &Health)>) {
    // Explicit dependencies
}
```
:::

## See Also

- [GameObject](./GameObject) - Entity creation and management
- [Query](./Query) - Querying entities and components
- [Bundle](./Bundle) - Component bundles
- [Custom Components Guide](../../guides/custom-components)

## Version History

| Version | Changes |
|---------|---------|
| 1.0.0 | Stable Component API |
| 0.9.0 | Added storage types |
| 0.8.0 | Initial component system |
