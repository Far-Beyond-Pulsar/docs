---
title: "Entity Component System"
description: "Understanding Pulsar's ECS architecture and why it matters"
category: "core-concepts"
order: 5
lastUpdated: "2026-01-12"
tags: ["ecs", "architecture", "entities", "components", "systems", "performance"]
related: ["core-concepts/architecture", "core-concepts/rendering-pipeline", "guides/creating-entities"]
---

# Entity Component System

Pulsar uses an Entity Component System (ECS) architecture for managing game objects. If you've worked with Unity or Unreal, this might feel different—there are no base classes, no inheritance hierarchies, no objects with built-in transform or rendering capabilities. Instead, everything is data and the functions that operate on that data.

This document explains what ECS is, why Pulsar uses it, and how to think about building games with this architecture. I'll be honest about the tradeoffs, because ECS isn't magic—it's a tool with specific strengths and weaknesses.

## What Is ECS?

Entity Component System is an architectural pattern that separates data from behavior:

**Entities** are just IDs. They have no data and no behavior. An entity is like a social security number—it uniquely identifies something, but tells you nothing about what that something is.

**Components** are pure data. They have no logic, just fields. A `Position` component might have `x`, `y`, `z` coordinates. A `Velocity` component might have `dx`, `dy`, `dz` speeds. Components describe what an entity is.

**Systems** are pure logic. They query for entities with specific components and operate on that data. A `MovementSystem` might query for entities with both `Position` and `Velocity`, then update positions based on velocities. Systems describe what happens.

Here's a concrete example:

```rust
// Entity - just an ID
let player = Entity::new();

// Components - pure data
struct Position { x: f32, y: f32, z: f32 }
struct Velocity { dx: f32, dy: f32, dz: f32 }
struct Health { current: f32, max: f32 }
struct PlayerTag; // Marker component, no data

// Add components to the entity
world.add_component(player, Position { x: 0.0, y: 0.0, z: 0.0 });
world.add_component(player, Velocity { dx: 0.0, dy: 0.0, dz: 0.0 });
world.add_component(player, Health { current: 100.0, max: 100.0 });
world.add_component(player, PlayerTag);

// System - pure logic
fn movement_system(world: &mut World) {
    // Query for entities with Position and Velocity
    for (entity, (pos, vel)) in world.query_mut::<(&mut Position, &Velocity)>() {
        pos.x += vel.dx;
        pos.y += vel.dy;
        pos.z += vel.dz;
    }
}
```

Notice what's missing: the entity itself has no methods, no inheritance, no complexity. It's just an ID. All the actual functionality lives in systems that operate on components.

## Why ECS Over Object-Oriented Design?

Let's address the elephant in the room: most game engines use object-oriented programming. Unity has `GameObject` with `Transform`, Unreal has `AActor` with `USceneComponent`. Why is Pulsar different?

### Performance: Data-Oriented Design

Traditional OOP spreads related data across memory:

```rust
// Traditional OOP approach (NOT how Pulsar works)
struct GameObject {
    id: u64,
    transform: Transform,
    velocity: Velocity,
    health: Health,
    // ... many more fields
}

// Objects stored in a Vec
let objects: Vec<Box<GameObject>> = vec![/* thousands of objects */];

// Processing requires jumping through memory
for object in &mut objects {
    // Only need position and velocity, but we load the entire object
    object.transform.position += object.velocity;
}
```

This has problems:

- **Cache misses** - Each object is far from the next in memory. CPUs load data in cache lines (64 bytes). If only 16 bytes of a 64-byte cache line are useful, you've wasted bandwidth.

- **Virtual dispatch** - If `GameObject` is polymorphic, method calls go through vtables. This prevents inlining and makes branch prediction harder.

- **All or nothing loading** - You need the entire object even if you only want one field. This pollutes cache with unused data.

ECS fixes these problems with archetype-based storage:

```rust
// ECS approach - components stored separately
struct PositionStorage {
    entities: Vec<Entity>,
    positions: Vec<Position>,
}

struct VelocityStorage {
    entities: Vec<Entity>,
    velocities: Vec<Velocity>,
}

// Iterate over tightly packed data
for i in 0..positions.len() {
    positions[i] += velocities[i];
}
```

Now related data is contiguous in memory. When the CPU loads `positions[0]`, it also loads `positions[1]`, `positions[2]`, etc. in the same cache line. Processing thousands of entities becomes dramatically faster.

**Real numbers**: On a modern CPU, the ECS approach can be 10-50x faster than traditional OOP for operations that touch many entities. This isn't theoretical—it's measured in Pulsar's benchmarks.

### Flexibility: Composition Over Inheritance

OOP often leads to complex inheritance hierarchies:

```rust
// Traditional approach (NOT how Pulsar works)
class Entity { ... }
class Actor : Entity { ... }
class Pawn : Actor { ... }
class Character : Pawn { ... }
class Player : Character { ... }
```

This creates problems:

- **Inflexible hierarchies** - What if you want a `Vehicle` that can be possessed like a `Pawn` but doesn't walk like a `Character`? Do you refactor the hierarchy? Introduce multiple inheritance?

- **The diamond problem** - Multiple inheritance creates ambiguity. Which parent's method do you call?

- **Feature coupling** - If `Character` has walking logic, every subclass gets it. Even if it doesn't make sense (flying characters, stationary characters, etc.).

ECS replaces inheritance with composition:

```rust
// ECS approach - compose features freely

// A basic enemy
let enemy = world.spawn((
    Position::default(),
    Velocity::default(),
    Health { current: 50.0, max: 50.0 },
    AIControlled,
));

// A flying enemy - just add a component
let flying_enemy = world.spawn((
    Position::default(),
    Velocity::default(),
    Health { current: 50.0, max: 50.0 },
    AIControlled,
    Flying { altitude: 10.0 },
));

// A possessed vehicle - completely different combination
let vehicle = world.spawn((
    Position::default(),
    Velocity::default(),
    PlayerControlled,
    VehiclePhysics { wheel_count: 4 },
));
```

No inheritance, no refactoring, no diamond problem. Just data.

### Modularity: Systems Are Independent

In OOP, behavior lives inside objects. This creates coupling:

```rust
// Traditional approach
impl GameObject {
    fn update(&mut self, dt: f32) {
        // Physics
        self.velocity += self.acceleration * dt;
        self.position += self.velocity * dt;
        
        // Animation
        self.animation.update(dt);
        
        // AI
        if let Some(ai) = &mut self.ai {
            ai.think(dt);
        }
        
        // Sound
        self.audio.update();
        
        // Everything happens in one giant method
    }
}
```

This is hard to maintain, test, and parallelize.

ECS separates concerns into systems:

```rust
// ECS approach - independent systems

fn physics_system(world: &mut World, dt: f32) {
    for (pos, vel, acc) in world.query_mut::<(&mut Position, &mut Velocity, &Acceleration)>() {
        vel.0 += acc.0 * dt;
        pos.0 += vel.0 * dt;
    }
}

fn animation_system(world: &mut World, dt: f32) {
    for (sprite, anim) in world.query_mut::<(&mut Sprite, &mut Animation)>() {
        anim.update(dt);
        sprite.texture = anim.current_frame();
    }
}

fn ai_system(world: &mut World, dt: f32) {
    for (ai, pos, vel) in world.query_mut::<(&mut AI, &Position, &mut Velocity)>() {
        ai.think(pos, vel, dt);
    }
}

fn audio_system(world: &mut World) {
    for audio in world.query_mut::<&mut AudioSource>() {
        audio.update();
    }
}
```

Now each system is:
- **Testable** - You can test physics without animation or AI
- **Parallelizable** - If systems touch different components, they can run concurrently
- **Reusable** - The physics system works for players, enemies, projectiles—anything with the right components

## Archetype-Based Storage

Pulsar's ECS uses archetype-based storage, which is worth understanding because it affects performance characteristics.

### What Is an Archetype?

An archetype is a unique combination of component types. Entities with the same components belong to the same archetype.

```rust
// These entities have different archetypes

// Archetype 1: (Position, Velocity)
let entity1 = world.spawn((
    Position::default(),
    Velocity::default(),
));

// Archetype 2: (Position, Velocity, Health)
let entity2 = world.spawn((
    Position::default(),
    Velocity::default(),
    Health::default(),
));

// Archetype 1 again: (Position, Velocity)
let entity3 = world.spawn((
    Position::default(),
    Velocity::default(),
));
```

`entity1` and `entity3` share an archetype. `entity2` has a different archetype because it has an extra component.

### How Archetypes Are Stored

Each archetype has its own storage:

```rust
pub struct Archetype {
    // The combination of component types this archetype represents
    pub component_types: Vec<TypeId>,
    
    // Entity IDs in this archetype
    pub entities: Vec<Entity>,
    
    // Component data, stored separately per type
    pub components: HashMap<TypeId, Box<dyn ComponentStorage>>,
}

pub struct ArchetypeStorage {
    archetypes: Vec<Archetype>,
    entity_index: HashMap<Entity, (usize, usize)>, // (archetype_idx, row)
}
```

When you query for components, Pulsar:

1. Finds all archetypes that contain the requested components
2. Iterates over entities in those archetypes
3. Returns references to the component data

```rust
// Query for (Position, Velocity)
pub fn query<'a>(&'a self) -> impl Iterator<Item = (&'a Position, &'a Velocity)> {
    self.archetypes
        .iter()
        .filter(|arch| {
            // Only archetypes that have both components
            arch.has::<Position>() && arch.has::<Velocity>()
        })
        .flat_map(|arch| {
            // Get component slices
            let positions = arch.get::<Position>();
            let velocities = arch.get::<Velocity>();
            
            // Zip them together
            positions.iter().zip(velocities.iter())
        })
}
```

### Why Archetypes Are Fast

Archetype storage has excellent cache performance:

```rust
// All positions for an archetype are contiguous
let positions: &[Position] = archetype.get::<Position>();

// CPU can prefetch and vectorize this loop
for pos in positions {
    // Process position
}
```

The CPU loads entire cache lines at once. If `Position` is 12 bytes, a 64-byte cache line contains 5 positions. When you access `positions[0]`, the CPU automatically loads `positions[1..5]` in the same cache line. This is "free" performance.

### The Cost of Archetype Changes

Adding or removing components requires moving the entity to a different archetype:

```rust
impl World {
    pub fn add_component<T: Component>(&mut self, entity: Entity, component: T) {
        // Find current archetype
        let (old_arch_idx, row) = self.entity_index[&entity];
        let old_arch = &self.archetypes[old_arch_idx];
        
        // Determine new archetype (old components + new component)
        let new_types = old_arch.component_types.clone().push(TypeId::of::<T>());
        let new_arch_idx = self.find_or_create_archetype(&new_types);
        
        // Move entity data to new archetype
        let new_row = self.archetypes[new_arch_idx].entities.len();
        
        // Copy existing component data
        for &type_id in &old_arch.component_types {
            let old_data = old_arch.get_component(row, type_id);
            self.archetypes[new_arch_idx].set_component(new_row, type_id, old_data);
        }
        
        // Add new component
        self.archetypes[new_arch_idx].set_component(new_row, TypeId::of::<T>(), component);
        
        // Update entity index
        self.entity_index.insert(entity, (new_arch_idx, new_row));
        
        // Remove from old archetype (swap-remove for O(1))
        self.archetypes[old_arch_idx].swap_remove(row);
    }
}
```

This is more expensive than just setting a field. If you're adding/removing components frequently (every frame), that's a code smell. Components should be relatively stable.

### Best Practices

**Do this:**
```rust
// Add components at spawn time
let player = world.spawn((
    Position::default(),
    Velocity::default(),
    Health::default(),
    PlayerTag,
));

// Modify component data frequently
world.get_mut::<Velocity>(player).unwrap().dx = 5.0;
```

**Avoid this:**
```rust
// Adding/removing components every frame
for entity in &players {
    if jumping {
        world.add_component(entity, Jumping);  // Bad: archetype change
    } else {
        world.remove_component::<Jumping>(entity);  // Bad: archetype change
    }
}

// Instead, use a component with state
struct JumpState {
    jumping: bool,
    velocity: f32,
}
```

## System Scheduling

Systems need to run in a specific order and, where possible, in parallel. Pulsar's scheduler handles this automatically.

### System Dependencies

Some systems must run before others:

```rust
// Physics must run before rendering
// (Rendering needs updated positions)
app.add_system(physics_system)
   .add_system(render_system.after(physics_system));

// AI must run before physics
// (Physics needs updated velocities from AI)
app.add_system(ai_system)
   .add_system(physics_system.after(ai_system));
```

The scheduler builds a dependency graph and executes systems in topological order.

### Parallel Execution

Systems that don't conflict can run in parallel:

```rust
// These systems touch different components - can run in parallel
fn physics_system(world: &mut World) {
    for (pos, vel) in world.query_mut::<(&mut Position, &Velocity)>() {
        // ...
    }
}

fn animation_system(world: &mut World) {
    for (sprite, anim) in world.query_mut::<(&mut Sprite, &Animation)>() {
        // ...
    }
}

// Pulsar detects they're independent and runs them concurrently
```

The scheduler analyzes which components each system reads/writes:

```rust
pub struct SystemInfo {
    name: String,
    reads: Vec<TypeId>,   // Components this system reads
    writes: Vec<TypeId>,  // Components this system writes
}

impl Scheduler {
    pub fn can_run_parallel(&self, sys1: &SystemInfo, sys2: &SystemInfo) -> bool {
        // Check for conflicts
        let writes_overlap = sys1.writes.iter().any(|t| sys2.writes.contains(t));
        let read_write_conflict = 
            sys1.writes.iter().any(|t| sys2.reads.contains(t)) ||
            sys2.writes.iter().any(|t| sys1.reads.contains(t));
        
        !writes_overlap && !read_write_conflict
    }
}
```

If systems can run in parallel, they do—automatically utilizing all CPU cores.

### Stages

Sometimes you need stronger ordering guarantees. Stages provide synchronization points:

```rust
app
    // Stage 1: Input
    .add_stage("input")
    .add_system_to_stage("input", keyboard_input_system)
    .add_system_to_stage("input", mouse_input_system)
    
    // Stage 2: Game Logic (runs after input)
    .add_stage("update")
    .add_system_to_stage("update", ai_system)
    .add_system_to_stage("update", physics_system)
    
    // Stage 3: Rendering (runs after update)
    .add_stage("render")
    .add_system_to_stage("render", culling_system)
    .add_system_to_stage("render", render_system);
```

Stages run sequentially, but systems within a stage can run in parallel.

## Queries and Iteration

Queries are how you access entity data. Understanding query patterns helps you write efficient systems.

### Basic Queries

```rust
// Read-only query
for (pos, vel) in world.query::<(&Position, &Velocity)>() {
    println!("Position: {:?}, Velocity: {:?}", pos, vel);
}

// Mutable query
for (pos, vel) in world.query_mut::<(&mut Position, &Velocity)>() {
    pos.0 += vel.0;
}

// Query with entity ID
for (entity, pos) in world.query::<(Entity, &Position)>() {
    println!("Entity {:?} is at {:?}", entity, pos);
}
```

### Query Filters

Sometimes you want to filter results:

```rust
// Only entities with a specific tag
for health in world.query::<&Health>().with::<PlayerTag>() {
    println!("Player health: {}", health.current);
}

// Exclude entities with a component
for pos in world.query::<&Position>().without::<Dead>() {
    // Only living entities
}

// Combine filters
for (pos, vel) in world.query::<(&Position, &Velocity)>()
    .with::<Enemy>()
    .without::<Frozen>()
{
    // Moving enemies only
}
```

### Optional Components

Sometimes a component might or might not exist:

```rust
// Option<&T> makes the component optional
for (entity, health, shield) in world.query::<(Entity, &Health, Option<&Shield>)>() {
    let total_hp = health.current + shield.map_or(0.0, |s| s.current);
    println!("Entity {:?} has {} total HP", entity, total_hp);
}
```

### Changed Detection

Avoid processing unchanged data:

```rust
// Only process entities whose Position changed
for pos in world.query::<&Position>().changed::<Position>() {
    update_spatial_hash(pos);
}
```

This is implemented with a generation counter:

```rust
pub struct ComponentStorage<T> {
    data: Vec<T>,
    changed: Vec<u64>,  // Generation number
    generation: u64,    // Current generation
}

impl<T> ComponentStorage<T> {
    pub fn set(&mut self, index: usize, value: T) {
        self.data[index] = value;
        self.changed[index] = self.generation;  // Mark as changed
    }
    
    pub fn tick(&mut self) {
        self.generation += 1;  // New frame
    }
    
    pub fn was_changed(&self, index: usize) -> bool {
        self.changed[index] == self.generation - 1
    }
}
```

## Real World Examples

Let's look at complete, realistic systems.

### Movement System

```rust
pub fn movement_system(world: &mut World, dt: f32) {
    for (pos, vel) in world.query_mut::<(&mut Position, &Velocity)>() {
        pos.0 += vel.0 * dt;
    }
}
```

Simple, fast, applies to any entity with position and velocity.

### Damage System

```rust
pub fn damage_system(world: &mut World, events: &mut Events<DamageEvent>) {
    for event in events.drain() {
        if let Ok(mut health) = world.get_mut::<Health>(event.target) {
            health.current -= event.amount;
            
            if health.current <= 0.0 {
                // Add Dead component to trigger death logic
                world.add_component(event.target, Dead);
            }
        }
    }
}
```

Notice we use events to decouple damage sources from health management.

### Cleanup System

```rust
pub fn cleanup_dead_entities(world: &mut World) {
    // Collect dead entities
    let dead: Vec<Entity> = world
        .query::<(Entity, &Dead)>()
        .map(|(entity, _)| entity)
        .collect();
    
    // Despawn them
    for entity in dead {
        world.despawn(entity);
    }
}
```

This runs at the end of each frame to remove dead entities.

### Spawning System

```rust
pub fn spawn_enemies(
    world: &mut World,
    spawn_points: &SpawnPoints,
    time: f32,
) {
    for spawn_point in &spawn_points.points {
        if time >= spawn_point.next_spawn_time {
            // Spawn enemy
            world.spawn((
                Position(spawn_point.position),
                Velocity(Vec3::ZERO),
                Health { current: 100.0, max: 100.0 },
                Enemy,
                AIControlled,
            ));
            
            // Schedule next spawn
            spawn_point.next_spawn_time = time + spawn_point.interval;
        }
    }
}
```

### Rendering System

```rust
pub fn rendering_system(
    world: &World,
    renderer: &mut Renderer,
    camera: &Camera,
) {
    // Collect renderable entities
    for (pos, mesh, material) in world.query::<(&Position, &Mesh, &Material)>() {
        renderer.draw(
            mesh,
            material,
            Transform::from_translation(pos.0),
            camera,
        );
    }
}
```

The rendering system just queries for visual components and submits draw calls.

## Integration with Other Systems

ECS doesn't exist in isolation. It integrates with Pulsar's other systems.

### ECS and GPUI

UI entities are separate from game entities:

```rust
// Game entity
let player = game_world.spawn((
    Position::default(),
    Health::default(),
));

// UI entity (managed by GPUI)
let health_bar = ui.spawn(
    HealthBar {
        target: player,  // Reference to game entity
    }
);
```

UI systems query game world data:

```rust
impl View for HealthBar {
    fn render(&self, cx: &mut RenderContext) -> Element {
        // Query game world for health
        let health = cx.game_world().get::<Health>(self.target).unwrap();
        
        let percent = health.current / health.max;
        
        div()
            .width(Pixels(200))
            .height(Pixels(20))
            .child(
                div()
                    .width(Percent(percent * 100.0))
                    .background(Color::GREEN)
            )
    }
}
```

### ECS and Plugins

Plugins can register components and systems:

```rust
pub struct PhysicsPlugin;

impl Plugin for PhysicsPlugin {
    fn build(&self, app: &mut App) {
        // Register components
        app.register_component::<RigidBody>();
        app.register_component::<Collider>();
        
        // Add systems
        app.add_system(physics_system);
        app.add_system(collision_detection_system.after(physics_system));
    }
}
```

This makes plugins composable—combine physics, networking, audio, etc.

### ECS and Serialization

Entities can be serialized for save files or networking:

```rust
// Serialize entity
let data = world.serialize_entity(entity)?;

// Deserialize entity
let new_entity = world.deserialize_entity(&data)?;
```

Pulsar handles component registration and type information automatically.

## Common Pitfalls

Let's address common mistakes:

### Anti-Pattern: God Entities

```rust
// Bad: one entity with every possible component
let player = world.spawn((
    Position::default(),
    Velocity::default(),
    Health::default(),
    Inventory::default(),
    QuestLog::default(),
    Achievements::default(),
    // ... 50 more components
));
```

This defeats the purpose of ECS. Break it up:

```rust
// Good: separate concerns
let player_character = world.spawn((
    Position::default(),
    Velocity::default(),
    Health::default(),
    PlayerTag,
));

let player_inventory = world.spawn((
    Inventory::default(),
    BelongsTo(player_character),
));

let player_quests = world.spawn((
    QuestLog::default(),
    BelongsTo(player_character),
));
```

### Anti-Pattern: Components as Messages

```rust
// Bad: using components for temporary events
world.add_component(entity, TakeDamageEvent { amount: 10.0 });
```

Use events instead:

```rust
// Good: use the event system
events.send(DamageEvent {
    target: entity,
    amount: 10.0,
});
```

### Anti-Pattern: Boilerplate in Systems

```rust
// Bad: repeating boilerplate
pub fn system1(world: &mut World) {
    for entity in &players {
        if let Ok(pos) = world.get::<Position>(entity) {
            if let Ok(health) = world.get::<Health>(entity) {
                // ...
            }
        }
    }
}
```

Use queries:

```rust
// Good: let the ECS handle it
pub fn system1(world: &mut World) {
    for (pos, health) in world.query::<(&Position, &Health)>().with::<PlayerTag>() {
        // ...
    }
}
```

## Performance Characteristics

Understanding performance helps you make good decisions:

**Fast operations:**
- Querying entities: O(n) where n = matching entities (cache-friendly)
- Modifying component data: O(1)
- Iterating over components: O(n), excellent cache performance

**Moderate operations:**
- Adding components: O(1) amortized, but requires archetype move
- Removing components: O(1) amortized, but requires archetype move
- Spawning entities: O(1) amortized

**Slow operations:**
- Getting a specific entity's component: O(1) but indirect (requires lookup)
- Destroying entities with many components: O(c) where c = component count

## Conclusion

ECS is a powerful architecture for game engines. It provides:

- **Performance** through data-oriented design and cache-friendly memory layout
- **Flexibility** through composition instead of inheritance
- **Modularity** through independent systems
- **Parallelism** through automatic dependency analysis

The learning curve exists—ECS requires thinking about data and behavior separately. But once you internalize the patterns, you'll find it's a natural way to structure game logic.

Remember the core principles:
- **Entities** are IDs
- **Components** are data
- **Systems** are logic
- **Composition** beats inheritance
- **Data locality** matters

Build your game from these primitives, and you'll have a solid foundation that scales from prototypes to shipping titles.
