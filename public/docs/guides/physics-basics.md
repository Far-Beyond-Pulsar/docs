---
title: Physics Basics with Rapier3D
description: >-
  Complete physics integration guide covering Rapier3D rigid bodies, colliders,
  raycasting, character controllers, physics debugging, and performance
  optimization
category: guides
lastUpdated: '2026-01-12'
tags:
  - physics
  - rapier3d
  - rigid-bodies
  - colliders
  - character-controller
  - simulation
related:
  - gameplay-programming
  - component-system
  - performance
position: 3
icon: Code
---

# Physics Basics with Rapier3D

This comprehensive guide teaches you how to integrate and use Rapier3D physics engine in Pulsar. You'll learn everything from basic rigid body setup to advanced character controllers, raycasting, and performance optimization.

## What You'll Learn

By the end of this tutorial, you'll understand:
- Rapier3D integration architecture
- Rigid body types and properties
- Collider shapes and physics materials
- Raycasting and spatial queries
- Character controller implementation
- Physics debugging and visualization
- Performance optimization strategies

## Prerequisites

- Basic understanding of physics concepts (mass, velocity, forces)
- Familiarity with Pulsar's ECS system
- Knowledge of 3D mathematics (vectors, rotations)
- Rust programming experience

## Part 1: Physics System Setup

### Adding Rapier3D Dependencies

Update your `Cargo.toml`:

```toml
[dependencies]
rapier3d = "0.17"
nalgebra = "0.32"
parry3d = "0.13"  # For collision detection queries

[features]
default = ["dim3", "f32"]
dim3 = ["rapier3d/dim3"]
f32 = ["rapier3d/f32"]
parallel = ["rapier3d/parallel"]
simd = ["rapier3d/simd-stable"]
```

### Physics World Initialization

Create the main physics system:

```rust
use rapier3d::prelude::*;
use nalgebra::{Vector3, Isometry3, UnitQuaternion};
use std::collections::HashMap;

pub struct PhysicsWorld {
    // Core Rapier components
    pub rigid_body_set: RigidBodySet,
    pub collider_set: ColliderSet,
    pub gravity: Vector3<f32>,
    pub integration_parameters: IntegrationParameters,
    pub physics_pipeline: PhysicsPipeline,
    pub island_manager: IslandManager,
    pub broad_phase: BroadPhase,
    pub narrow_phase: NarrowPhase,
    pub impulse_joint_set: ImpulseJointSet,
    pub multibody_joint_set: MultibodyJointSet,
    pub ccd_solver: CCDSolver,
    
    // Query pipeline for raycasts
    pub query_pipeline: QueryPipeline,
    
    // Entity mapping
    entity_to_body: HashMap<Entity, RigidBodyHandle>,
    body_to_entity: HashMap<RigidBodyHandle, Entity>,
}

impl PhysicsWorld {
    pub fn new() -> Self {
        let mut integration_parameters = IntegrationParameters::default();
        integration_parameters.dt = 1.0 / 60.0; // 60 FPS physics
        
        Self {
            rigid_body_set: RigidBodySet::new(),
            collider_set: ColliderSet::new(),
            gravity: Vector3::new(0.0, -9.81, 0.0),
            integration_parameters,
            physics_pipeline: PhysicsPipeline::new(),
            island_manager: IslandManager::new(),
            broad_phase: BroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
            query_pipeline: QueryPipeline::new(),
            entity_to_body: HashMap::new(),
            body_to_entity: HashMap::new(),
        }
    }
    
    pub fn step(&mut self) {
        // Step the physics simulation
        self.physics_pipeline.step(
            &self.gravity,
            &self.integration_parameters,
            &mut self.island_manager,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.rigid_body_set,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            &mut self.ccd_solver,
            None, // No query pipeline modifications
            &(), // No hooks
            &(), // No events
        );
        
        // Update query pipeline for raycasts
        self.query_pipeline.update(&self.rigid_body_set, &self.collider_set);
    }
}
```

### Integrating with Pulsar ECS

```rust
use pulsar_ecs::{Component, System, World, Query};

#[derive(Component)]
pub struct RigidBodyComponent {
    pub handle: RigidBodyHandle,
    pub body_type: RigidBodyType,
}

#[derive(Component)]
pub struct ColliderComponent {
    pub handle: ColliderHandle,
    pub shape: ColliderShape,
}

#[derive(Clone, Debug)]
pub enum ColliderShape {
    Box { half_extents: Vector3<f32> },
    Sphere { radius: f32 },
    Capsule { half_height: f32, radius: f32 },
    Mesh { vertices: Vec<Vector3<f32>>, indices: Vec<[u32; 3]> },
}

pub struct PhysicsSystem {
    physics_world: PhysicsWorld,
}

impl System for PhysicsSystem {
    fn update(&mut self, world: &mut World) {
        // Step physics simulation
        self.physics_world.step();
        
        // Sync physics transforms back to ECS
        self.sync_transforms(world);
    }
}

impl PhysicsSystem {
    fn sync_transforms(&mut self, world: &mut World) {
        let query = world.query::<(&RigidBodyComponent, &mut Transform)>();
        
        for (entity, (rb_component, transform)) in query {
            if let Some(body) = self.physics_world.rigid_body_set.get(rb_component.handle) {
                let position = body.translation();
                let rotation = body.rotation();
                
                transform.position = Vector3::new(position.x, position.y, position.z);
                transform.rotation = Quaternion::new(
                    rotation.w,
                    rotation.i,
                    rotation.j,
                    rotation.k,
                );
            }
        }
    }
}
```

## Part 2: Rigid Body Types

### Dynamic Bodies

Objects affected by gravity and forces:

```rust
pub fn create_dynamic_body(
    physics_world: &mut PhysicsWorld,
    position: Vector3<f32>,
    mass: f32,
) -> RigidBodyHandle {
    let rigid_body = RigidBodyBuilder::dynamic()
        .translation(position)
        .build();
    
    let handle = physics_world.rigid_body_set.insert(rigid_body);
    
    // Set mass properties
    if let Some(body) = physics_world.rigid_body_set.get_mut(handle) {
        body.set_additional_mass(mass, true);
    }
    
    handle
}

// Example: Create a physics cube
pub fn spawn_physics_cube(
    world: &mut World,
    physics_world: &mut PhysicsWorld,
    position: Vector3<f32>,
) -> Entity {
    // Create entity
    let entity = world.spawn();
    
    // Create rigid body
    let rb_handle = create_dynamic_body(physics_world, position, 1.0);
    
    // Create box collider
    let collider = ColliderBuilder::cuboid(0.5, 0.5, 0.5)
        .density(1.0)
        .friction(0.5)
        .restitution(0.3)
        .build();
    
    let collider_handle = physics_world.collider_set.insert_with_parent(
        collider,
        rb_handle,
        &mut physics_world.rigid_body_set,
    );
    
    // Add components
    world.add_component(entity, RigidBodyComponent {
        handle: rb_handle,
        body_type: RigidBodyType::Dynamic,
    });
    
    world.add_component(entity, ColliderComponent {
        handle: collider_handle,
        shape: ColliderShape::Box {
            half_extents: Vector3::new(0.5, 0.5, 0.5),
        },
    });
    
    world.add_component(entity, Transform {
        position,
        rotation: Quaternion::identity(),
        scale: Vector3::new(1.0, 1.0, 1.0),
    });
    
    entity
}
```

### Static Bodies

Non-moving objects (ground, walls):

```rust
pub fn create_static_ground(
    physics_world: &mut PhysicsWorld,
    size: Vector3<f32>,
) -> RigidBodyHandle {
    let rigid_body = RigidBodyBuilder::fixed()
        .translation(Vector3::new(0.0, -0.5, 0.0))
        .build();
    
    let handle = physics_world.rigid_body_set.insert(rigid_body);
    
    // Add ground collider
    let collider = ColliderBuilder::cuboid(size.x, 0.5, size.z)
        .friction(0.7)
        .build();
    
    physics_world.collider_set.insert_with_parent(
        collider,
        handle,
        &mut physics_world.rigid_body_set,
    );
    
    handle
}
```

### Kinematic Bodies

Animated objects not affected by forces:

```rust
pub fn create_kinematic_platform(
    physics_world: &mut PhysicsWorld,
    start_pos: Vector3<f32>,
    end_pos: Vector3<f32>,
) -> RigidBodyHandle {
    let rigid_body = RigidBodyBuilder::kinematic_position_based()
        .translation(start_pos)
        .build();
    
    let handle = physics_world.rigid_body_set.insert(rigid_body);
    
    // Add platform collider
    let collider = ColliderBuilder::cuboid(2.0, 0.2, 2.0)
        .friction(0.8)
        .build();
    
    physics_world.collider_set.insert_with_parent(
        collider,
        handle,
        &mut physics_world.rigid_body_set,
    );
    
    handle
}

// Update kinematic platform position
pub fn update_kinematic_platform(
    physics_world: &mut PhysicsWorld,
    handle: RigidBodyHandle,
    new_position: Vector3<f32>,
) {
    if let Some(body) = physics_world.rigid_body_set.get_mut(handle) {
        body.set_next_kinematic_translation(new_position);
    }
}
```

## Part 3: Collider Shapes

### Basic Shapes

```rust
// Box collider
let box_collider = ColliderBuilder::cuboid(1.0, 1.0, 1.0)
    .density(1.0)
    .build();

// Sphere collider
let sphere_collider = ColliderBuilder::ball(1.0)
    .density(1.0)
    .build();

// Capsule collider (good for characters)
let capsule_collider = ColliderBuilder::capsule_y(0.5, 0.5)
    .density(1.0)
    .build();

// Cylinder collider
let cylinder_collider = ColliderBuilder::cylinder(1.0, 0.5)
    .density(1.0)
    .build();

// Cone collider
let cone_collider = ColliderBuilder::cone(1.0, 0.5)
    .density(1.0)
    .build();
```

### Compound Shapes

Create complex shapes from multiple colliders:

```rust
pub fn create_compound_object(
    physics_world: &mut PhysicsWorld,
    position: Vector3<f32>,
) -> RigidBodyHandle {
    // Create parent body
    let rigid_body = RigidBodyBuilder::dynamic()
        .translation(position)
        .build();
    
    let handle = physics_world.rigid_body_set.insert(rigid_body);
    
    // Add multiple colliders to create a complex shape
    
    // Main body
    let body_collider = ColliderBuilder::cuboid(1.0, 0.5, 0.5)
        .translation(Vector3::new(0.0, 0.0, 0.0))
        .build();
    
    physics_world.collider_set.insert_with_parent(
        body_collider,
        handle,
        &mut physics_world.rigid_body_set,
    );
    
    // Front sphere
    let front_collider = ColliderBuilder::ball(0.3)
        .translation(Vector3::new(1.0, 0.0, 0.0))
        .build();
    
    physics_world.collider_set.insert_with_parent(
        front_collider,
        handle,
        &mut physics_world.rigid_body_set,
    );
    
    // Rear sphere
    let rear_collider = ColliderBuilder::ball(0.3)
        .translation(Vector3::new(-1.0, 0.0, 0.0))
        .build();
    
    physics_world.collider_set.insert_with_parent(
        rear_collider,
        handle,
        &mut physics_world.rigid_body_set,
    );
    
    handle
}
```

### Mesh Colliders

For complex geometry:

```rust
use parry3d::shape::TriMesh;

pub fn create_mesh_collider(
    physics_world: &mut PhysicsWorld,
    vertices: Vec<Vector3<f32>>,
    indices: Vec<[u32; 3]>,
) -> ColliderHandle {
    // Convert to Point3 for Rapier
    let points: Vec<Point3<f32>> = vertices
        .iter()
        .map(|v| Point3::new(v.x, v.y, v.z))
        .collect();
    
    // Create trimesh collider
    let collider = ColliderBuilder::trimesh(points, indices)
        .build();
    
    physics_world.collider_set.insert(collider)
}

// Convex hull for better performance
pub fn create_convex_hull_collider(
    physics_world: &mut PhysicsWorld,
    vertices: Vec<Vector3<f32>>,
) -> Option<ColliderHandle> {
    let points: Vec<Point3<f32>> = vertices
        .iter()
        .map(|v| Point3::new(v.x, v.y, v.z))
        .collect();
    
    // Create convex hull
    if let Some(collider) = ColliderBuilder::convex_hull(&points) {
        Some(physics_world.collider_set.insert(collider.build()))
    } else {
        None
    }
}
```

## Part 4: Physics Materials

### Friction and Restitution

```rust
pub struct PhysicsMaterial {
    pub friction: f32,        // 0.0 = ice, 1.0 = rubber
    pub restitution: f32,     // 0.0 = no bounce, 1.0 = perfect bounce
    pub density: f32,         // kg/m³
}

impl PhysicsMaterial {
    pub const ICE: Self = Self {
        friction: 0.1,
        restitution: 0.1,
        density: 917.0,
    };
    
    pub const RUBBER: Self = Self {
        friction: 0.9,
        restitution: 0.8,
        density: 1100.0,
    };
    
    pub const WOOD: Self = Self {
        friction: 0.5,
        restitution: 0.4,
        density: 700.0,
    };
    
    pub const STEEL: Self = Self {
        friction: 0.6,
        restitution: 0.3,
        density: 7850.0,
    };
    
    pub const GLASS: Self = Self {
        friction: 0.4,
        restitution: 0.6,
        density: 2500.0,
    };
}

pub fn apply_material(
    collider: &mut Collider,
    material: &PhysicsMaterial,
) {
    collider.set_friction(material.friction);
    collider.set_restitution(material.restitution);
    collider.set_density(material.density);
}

// Example usage
pub fn create_bouncy_ball(
    physics_world: &mut PhysicsWorld,
    position: Vector3<f32>,
) -> RigidBodyHandle {
    let rigid_body = RigidBodyBuilder::dynamic()
        .translation(position)
        .build();
    
    let handle = physics_world.rigid_body_set.insert(rigid_body);
    
    let mut collider = ColliderBuilder::ball(0.5)
        .build();
    
    apply_material(&mut collider, &PhysicsMaterial::RUBBER);
    
    physics_world.collider_set.insert_with_parent(
        collider,
        handle,
        &mut physics_world.rigid_body_set,
    );
    
    handle
}
```

### Damping

Control how quickly objects slow down:

```rust
pub fn set_damping(
    rigid_body: &mut RigidBody,
    linear_damping: f32,
    angular_damping: f32,
) {
    rigid_body.set_linear_damping(linear_damping);
    rigid_body.set_angular_damping(angular_damping);
}

// Example: Create object with high damping (moves through water)
pub fn create_underwater_object(
    physics_world: &mut PhysicsWorld,
    position: Vector3<f32>,
) -> RigidBodyHandle {
    let mut rigid_body = RigidBodyBuilder::dynamic()
        .translation(position)
        .linear_damping(2.0)  // High linear damping
        .angular_damping(1.5) // High angular damping
        .build();
    
    physics_world.rigid_body_set.insert(rigid_body)
}
```

## Part 5: Forces and Impulses

### Applying Forces

```rust
// Apply continuous force (like wind or thrust)
pub fn apply_force(
    rigid_body: &mut RigidBody,
    force: Vector3<f32>,
    wake_up: bool,
) {
    rigid_body.add_force(force, wake_up);
}

// Apply force at a point (creates torque)
pub fn apply_force_at_point(
    rigid_body: &mut RigidBody,
    force: Vector3<f32>,
    point: Vector3<f32>,
    wake_up: bool,
) {
    rigid_body.add_force_at_point(force, Point3::from(point), wake_up);
}

// Apply torque (rotational force)
pub fn apply_torque(
    rigid_body: &mut RigidBody,
    torque: Vector3<f32>,
    wake_up: bool,
) {
    rigid_body.add_torque(torque, wake_up);
}

// Example: Rocket thrust system
pub struct RocketComponent {
    pub thrust_force: f32,
    pub fuel: f32,
}

impl RocketComponent {
    pub fn apply_thrust(
        &mut self,
        rigid_body: &mut RigidBody,
        direction: Vector3<f32>,
        dt: f32,
    ) {
        if self.fuel > 0.0 {
            let force = direction.normalize() * self.thrust_force;
            rigid_body.add_force(force, true);
            self.fuel -= dt * 0.1;
        }
    }
}
```

### Applying Impulses

```rust
// Apply instant velocity change
pub fn apply_impulse(
    rigid_body: &mut RigidBody,
    impulse: Vector3<f32>,
    wake_up: bool,
) {
    rigid_body.apply_impulse(impulse, wake_up);
}

// Apply angular impulse
pub fn apply_angular_impulse(
    rigid_body: &mut RigidBody,
    angular_impulse: Vector3<f32>,
    wake_up: bool,
) {
    rigid_body.apply_torque_impulse(angular_impulse, wake_up);
}

// Example: Jump mechanic
pub fn make_jump(
    rigid_body: &mut RigidBody,
    jump_force: f32,
) {
    let impulse = Vector3::new(0.0, jump_force, 0.0);
    rigid_body.apply_impulse(impulse, true);
}

// Example: Explosion force
pub fn apply_explosion(
    physics_world: &PhysicsWorld,
    center: Vector3<f32>,
    radius: f32,
    force: f32,
) {
    for (handle, body) in physics_world.rigid_body_set.iter() {
        if !body.is_dynamic() {
            continue;
        }
        
        let body_pos = body.translation();
        let direction = body_pos - center;
        let distance = direction.magnitude();
        
        if distance < radius && distance > 0.0 {
            let falloff = 1.0 - (distance / radius);
            let impulse = direction.normalize() * force * falloff;
            
            if let Some(body_mut) = physics_world.rigid_body_set.get_mut(handle) {
                body_mut.apply_impulse(impulse, true);
            }
        }
    }
}
```

## Part 6: Raycasting and Queries

### Basic Raycasting

```rust
pub struct RaycastResult {
    pub hit: bool,
    pub point: Vector3<f32>,
    pub normal: Vector3<f32>,
    pub distance: f32,
    pub entity: Option<Entity>,
}

pub fn raycast(
    physics_world: &PhysicsWorld,
    origin: Vector3<f32>,
    direction: Vector3<f32>,
    max_distance: f32,
    filter: QueryFilter,
) -> Option<RaycastResult> {
    let ray = Ray::new(Point3::from(origin), direction);
    
    if let Some((handle, intersection)) = physics_world.query_pipeline.cast_ray(
        &physics_world.rigid_body_set,
        &physics_world.collider_set,
        &ray,
        max_distance,
        true, // solid
        filter,
    ) {
        let point = origin + direction * intersection.toi;
        
        Some(RaycastResult {
            hit: true,
            point,
            normal: intersection.normal,
            distance: intersection.toi,
            entity: physics_world.body_to_entity.get(&handle).copied(),
        })
    } else {
        None
    }
}

// Example: First-person shooter weapon raycast
pub fn fire_weapon(
    physics_world: &PhysicsWorld,
    camera_pos: Vector3<f32>,
    camera_forward: Vector3<f32>,
) -> Option<RaycastResult> {
    // Ignore the player's own collider
    let filter = QueryFilter::default();
    
    raycast(
        physics_world,
        camera_pos,
        camera_forward,
        1000.0,
        filter,
    )
}
```

### Shape Casting

```rust
pub fn spherecast(
    physics_world: &PhysicsWorld,
    origin: Vector3<f32>,
    direction: Vector3<f32>,
    radius: f32,
    max_distance: f32,
) -> Option<RaycastResult> {
    let shape = Ball::new(radius);
    let shape_pos = Isometry3::translation(origin.x, origin.y, origin.z);
    let shape_vel = direction;
    
    if let Some((handle, hit)) = physics_world.query_pipeline.cast_shape(
        &physics_world.rigid_body_set,
        &physics_world.collider_set,
        &shape_pos,
        &shape_vel,
        &shape,
        max_distance,
        true,
        QueryFilter::default(),
    ) {
        let point = origin + direction * hit.toi;
        
        Some(RaycastResult {
            hit: true,
            point,
            normal: hit.normal1,
            distance: hit.toi,
            entity: physics_world.body_to_entity.get(&handle).copied(),
        })
    } else {
        None
    }
}
```

### Overlap Queries

```rust
// Check if sphere overlaps any colliders
pub fn check_sphere_overlap(
    physics_world: &PhysicsWorld,
    center: Vector3<f32>,
    radius: f32,
) -> Vec<Entity> {
    let mut overlapping_entities = Vec::new();
    let shape = Ball::new(radius);
    let shape_pos = Isometry3::translation(center.x, center.y, center.z);
    
    physics_world.query_pipeline.intersections_with_shape(
        &physics_world.rigid_body_set,
        &physics_world.collider_set,
        &shape_pos,
        &shape,
        QueryFilter::default(),
        |handle| {
            if let Some(entity) = physics_world.body_to_entity.get(&handle) {
                overlapping_entities.push(*entity);
            }
            true // Continue searching
        },
    );
    
    overlapping_entities
}

// Example: Proximity detection for AI
pub fn find_nearby_enemies(
    physics_world: &PhysicsWorld,
    position: Vector3<f32>,
    detection_radius: f32,
) -> Vec<Entity> {
    check_sphere_overlap(physics_world, position, detection_radius)
}
```

## Part 7: Character Controller

### Kinematic Character Controller

```rust
use rapier3d::control::KinematicCharacterController;

pub struct CharacterControllerComponent {
    pub controller: KinematicCharacterController,
    pub movement_speed: f32,
    pub jump_force: f32,
    pub grounded: bool,
    pub velocity: Vector3<f32>,
}

impl CharacterControllerComponent {
    pub fn new() -> Self {
        Self {
            controller: KinematicCharacterController::default(),
            movement_speed: 5.0,
            jump_force: 10.0,
            grounded: false,
            velocity: Vector3::zeros(),
        }
    }
}

pub fn update_character_controller(
    character: &mut CharacterControllerComponent,
    rigid_body: &mut RigidBody,
    physics_world: &PhysicsWorld,
    input: &PlayerInput,
    dt: f32,
) {
    // Calculate desired movement
    let mut movement = Vector3::zeros();
    
    if input.forward {
        movement.z -= 1.0;
    }
    if input.backward {
        movement.z += 1.0;
    }
    if input.left {
        movement.x -= 1.0;
    }
    if input.right {
        movement.x += 1.0;
    }
    
    // Normalize and scale by speed
    if movement.magnitude() > 0.0 {
        movement = movement.normalize() * character.movement_speed;
    }
    
    // Apply gravity
    if !character.grounded {
        character.velocity.y -= 9.81 * dt;
    } else {
        character.velocity.y = 0.0;
    }
    
    // Jump
    if input.jump && character.grounded {
        character.velocity.y = character.jump_force;
        character.grounded = false;
    }
    
    // Combine movement and velocity
    let desired_translation = (movement + character.velocity) * dt;
    
    // Get collider
    let collider_handle = rigid_body.colliders()[0];
    let collider = physics_world.collider_set.get(collider_handle).unwrap();
    
    // Move character
    let corrected_movement = character.controller.move_shape(
        dt,
        &physics_world.rigid_body_set,
        &physics_world.collider_set,
        &physics_world.query_pipeline,
        collider.shape(),
        rigid_body.position(),
        desired_translation,
        QueryFilter::default(),
        |_| {},
    );
    
    // Apply corrected movement
    let new_position = rigid_body.translation() + corrected_movement.translation;
    rigid_body.set_translation(new_position, true);
    
    // Check if grounded
    character.grounded = corrected_movement.grounded;
}

pub struct PlayerInput {
    pub forward: bool,
    pub backward: bool,
    pub left: bool,
    pub right: bool,
    pub jump: bool,
}
```

### Advanced Character Controller with Slopes

```rust
pub struct AdvancedCharacterController {
    pub controller: KinematicCharacterController,
    pub movement_speed: f32,
    pub sprint_speed: f32,
    pub jump_force: f32,
    pub air_control: f32,
    pub max_slope_angle: f32,
    pub step_height: f32,
    pub grounded: bool,
    pub velocity: Vector3<f32>,
    pub ground_normal: Vector3<f32>,
}

impl AdvancedCharacterController {
    pub fn new() -> Self {
        let mut controller = KinematicCharacterController::default();
        controller.max_slope_climb_angle = 45.0_f32.to_radians();
        controller.min_slope_slide_angle = 45.0_f32.to_radians();
        controller.autostep = Some(CharacterAutostep {
            max_height: CharacterLength::Absolute(0.5),
            min_width: CharacterLength::Absolute(0.2),
            include_dynamic_bodies: false,
        });
        
        Self {
            controller,
            movement_speed: 5.0,
            sprint_speed: 8.0,
            jump_force: 10.0,
            air_control: 0.3,
            max_slope_angle: 45.0,
            step_height: 0.5,
            grounded: false,
            velocity: Vector3::zeros(),
            ground_normal: Vector3::y(),
        }
    }
    
    pub fn update(
        &mut self,
        rigid_body: &mut RigidBody,
        physics_world: &PhysicsWorld,
        input: &PlayerInput,
        camera_forward: Vector3<f32>,
        dt: f32,
    ) {
        // Calculate movement direction relative to camera
        let forward = Vector3::new(camera_forward.x, 0.0, camera_forward.z).normalize();
        let right = Vector3::y().cross(&forward);
        
        let mut movement = Vector3::zeros();
        if input.forward {
            movement += forward;
        }
        if input.backward {
            movement -= forward;
        }
        if input.left {
            movement -= right;
        }
        if input.right {
            movement += right;
        }
        
        // Apply speed
        let speed = if input.sprint {
            self.sprint_speed
        } else {
            self.movement_speed
        };
        
        if movement.magnitude() > 0.0 {
            movement = movement.normalize() * speed;
        }
        
        // Apply air control
        if !self.grounded {
            movement *= self.air_control;
            self.velocity.y -= 9.81 * dt;
        } else {
            self.velocity.y = 0.0;
            
            // Project movement onto slope
            if self.ground_normal.y < 1.0 {
                movement = self.project_onto_slope(movement);
            }
        }
        
        // Jump
        if input.jump && self.grounded {
            self.velocity.y = self.jump_force;
        }
        
        // Execute movement
        self.execute_movement(rigid_body, physics_world, movement, dt);
    }
    
    fn project_onto_slope(&self, movement: Vector3<f32>) -> Vector3<f32> {
        let slope_right = self.ground_normal.cross(&Vector3::y()).normalize();
        let slope_forward = slope_right.cross(&self.ground_normal).normalize();
        
        let forward_amount = movement.dot(&Vector3::new(0.0, 0.0, -1.0));
        let right_amount = movement.dot(&Vector3::new(1.0, 0.0, 0.0));
        
        slope_forward * forward_amount + slope_right * right_amount
    }
    
    fn execute_movement(
        &mut self,
        rigid_body: &mut RigidBody,
        physics_world: &PhysicsWorld,
        movement: Vector3<f32>,
        dt: f32,
    ) {
        let desired_translation = (movement + self.velocity) * dt;
        
        let collider_handle = rigid_body.colliders()[0];
        let collider = physics_world.collider_set.get(collider_handle).unwrap();
        
        let corrected_movement = self.controller.move_shape(
            dt,
            &physics_world.rigid_body_set,
            &physics_world.collider_set,
            &physics_world.query_pipeline,
            collider.shape(),
            rigid_body.position(),
            desired_translation,
            QueryFilter::default(),
            |_| {},
        );
        
        let new_position = rigid_body.translation() + corrected_movement.translation;
        rigid_body.set_translation(new_position, true);
        
        self.grounded = corrected_movement.grounded;
        if let Some(normal) = corrected_movement.ground_normal {
            self.ground_normal = normal;
        }
    }
}
```

## Part 8: Physics Debugging

### Visual Debugging System

```rust
use pulsar_render::{DebugRenderer, Color};

pub struct PhysicsDebugRenderer {
    pub enabled: bool,
    pub draw_colliders: bool,
    pub draw_aabbs: bool,
    pub draw_contacts: bool,
    pub draw_velocities: bool,
}

impl PhysicsDebugRenderer {
    pub fn render(
        &self,
        physics_world: &PhysicsWorld,
        debug_renderer: &mut DebugRenderer,
    ) {
        if !self.enabled {
            return;
        }
        
        if self.draw_colliders {
            self.render_colliders(physics_world, debug_renderer);
        }
        
        if self.draw_aabbs {
            self.render_aabbs(physics_world, debug_renderer);
        }
        
        if self.draw_contacts {
            self.render_contacts(physics_world, debug_renderer);
        }
        
        if self.draw_velocities {
            self.render_velocities(physics_world, debug_renderer);
        }
    }
    
    fn render_colliders(
        &self,
        physics_world: &PhysicsWorld,
        debug_renderer: &mut DebugRenderer,
    ) {
        for (handle, collider) in physics_world.collider_set.iter() {
            let color = if collider.is_sensor() {
                Color::rgba(0, 255, 0, 128)
            } else {
                Color::rgba(0, 255, 255, 128)
            };
            
            let position = collider.position();
            
            match collider.shape().shape_type() {
                ShapeType::Ball => {
                    if let Some(ball) = collider.shape().as_ball() {
                        debug_renderer.draw_sphere(
                            position.translation.vector.into(),
                            ball.radius,
                            color,
                        );
                    }
                }
                ShapeType::Cuboid => {
                    if let Some(cuboid) = collider.shape().as_cuboid() {
                        debug_renderer.draw_box(
                            position.translation.vector.into(),
                            position.rotation.into(),
                            cuboid.half_extents.into(),
                            color,
                        );
                    }
                }
                ShapeType::Capsule => {
                    if let Some(capsule) = collider.shape().as_capsule() {
                        debug_renderer.draw_capsule(
                            position.translation.vector.into(),
                            position.rotation.into(),
                            capsule.radius,
                            capsule.segment.a.coords.into(),
                            capsule.segment.b.coords.into(),
                            color,
                        );
                    }
                }
                _ => {}
            }
        }
    }
    
    fn render_aabbs(
        &self,
        physics_world: &PhysicsWorld,
        debug_renderer: &mut DebugRenderer,
    ) {
        for (_, collider) in physics_world.collider_set.iter() {
            let aabb = collider.compute_aabb();
            
            debug_renderer.draw_aabb(
                aabb.mins.into(),
                aabb.maxs.into(),
                Color::rgb(255, 255, 0),
            );
        }
    }
    
    fn render_contacts(
        &self,
        physics_world: &PhysicsWorld,
        debug_renderer: &mut DebugRenderer,
    ) {
        for contact_pair in physics_world.narrow_phase.contact_pairs() {
            if let Some(manifolds) = &contact_pair.manifolds {
                for manifold in manifolds {
                    for contact in &manifold.points {
                        let point: Vector3<f32> = contact.point.into();
                        let normal: Vector3<f32> = manifold.local_n1.into();
                        
                        // Draw contact point
                        debug_renderer.draw_sphere(
                            point,
                            0.05,
                            Color::rgb(255, 0, 0),
                        );
                        
                        // Draw contact normal
                        debug_renderer.draw_line(
                            point,
                            point + normal * 0.5,
                            Color::rgb(255, 0, 0),
                        );
                    }
                }
            }
        }
    }
    
    fn render_velocities(
        &self,
        physics_world: &PhysicsWorld,
        debug_renderer: &mut DebugRenderer,
    ) {
        for (_, body) in physics_world.rigid_body_set.iter() {
            if !body.is_dynamic() {
                continue;
            }
            
            let position: Vector3<f32> = body.translation().into();
            let velocity: Vector3<f32> = body.linvel().into();
            
            if velocity.magnitude() > 0.01 {
                debug_renderer.draw_arrow(
                    position,
                    position + velocity * 0.1,
                    Color::rgb(0, 255, 0),
                );
            }
        }
    }
}
```

### Physics Statistics

```rust
pub struct PhysicsStats {
    pub rigid_body_count: usize,
    pub collider_count: usize,
    pub active_bodies: usize,
    pub sleeping_bodies: usize,
    pub contact_count: usize,
    pub island_count: usize,
    pub step_time_ms: f32,
}

impl PhysicsStats {
    pub fn collect(physics_world: &PhysicsWorld) -> Self {
        let mut active_bodies = 0;
        let mut sleeping_bodies = 0;
        
        for (_, body) in physics_world.rigid_body_set.iter() {
            if body.is_sleeping() {
                sleeping_bodies += 1;
            } else {
                active_bodies += 1;
            }
        }
        
        let contact_count = physics_world.narrow_phase.contact_pairs().count();
        
        Self {
            rigid_body_count: physics_world.rigid_body_set.len(),
            collider_count: physics_world.collider_set.len(),
            active_bodies,
            sleeping_bodies,
            contact_count,
            island_count: physics_world.island_manager.num_islands(),
            step_time_ms: 0.0,
        }
    }
    
    pub fn print(&self) {
        println!("=== Physics Statistics ===");
        println!("Rigid Bodies: {}", self.rigid_body_count);
        println!("  Active: {}", self.active_bodies);
        println!("  Sleeping: {}", self.sleeping_bodies);
        println!("Colliders: {}", self.collider_count);
        println!("Contacts: {}", self.contact_count);
        println!("Islands: {}", self.island_count);
        println!("Step Time: {:.2}ms", self.step_time_ms);
        println!("========================");
    }
}
```

## Part 9: Performance Optimization

### Sleeping and Activation

```rust
// Configure sleeping thresholds
pub fn configure_sleeping(
    integration_params: &mut IntegrationParameters,
) {
    integration_params.linear_sleep_threshold = 0.01;
    integration_params.angular_sleep_threshold = 0.01;
    integration_params.time_until_sleep = 1.0; // seconds
}

// Manually put body to sleep
pub fn sleep_body(body: &mut RigidBody) {
    body.sleep();
}

// Wake body up
pub fn wake_body(body: &mut RigidBody) {
    body.wake_up(true);
}
```

### Collision Filtering

```rust
use rapier3d::geometry::CollisionGroups;

// Define collision layers
pub mod collision_layers {
    pub const PLAYER: u32 = 1 << 0;
    pub const ENEMY: u32 = 1 << 1;
    pub const PROJECTILE: u32 = 1 << 2;
    pub const ENVIRONMENT: u32 = 1 << 3;
    pub const TRIGGER: u32 = 1 << 4;
}

pub fn create_collision_groups(
    membership: u32,
    filter: u32,
) -> CollisionGroups {
    CollisionGroups::new(
        Group::from_bits_truncate(membership),
        Group::from_bits_truncate(filter),
    )
}

// Example: Projectile that only collides with enemies and environment
pub fn create_projectile_collider() -> Collider {
    let groups = create_collision_groups(
        collision_layers::PROJECTILE,
        collision_layers::ENEMY | collision_layers::ENVIRONMENT,
    );
    
    ColliderBuilder::ball(0.1)
        .collision_groups(groups)
        .build()
}
```

### Spatial Partitioning

```rust
// Use broadphase culling for large worlds
pub fn optimize_broadphase(physics_world: &mut PhysicsWorld) {
    // Rapier automatically uses efficient broadphase (SAP)
    // But we can help by organizing objects spatially
    
    // Set appropriate AABB margins for fast-moving objects
    for (_, collider) in physics_world.collider_set.iter_mut() {
        // Increase prediction for fast movers
        collider.set_collision_groups(CollisionGroups::new(
            Group::all(),
            Group::all(),
        ));
    }
}
```

### Fixed Timestep

```rust
pub struct FixedTimestepPhysics {
    accumulator: f32,
    fixed_dt: f32,
}

impl FixedTimestepPhysics {
    pub fn new(target_fps: f32) -> Self {
        Self {
            accumulator: 0.0,
            fixed_dt: 1.0 / target_fps,
        }
    }
    
    pub fn update(
        &mut self,
        physics_world: &mut PhysicsWorld,
        dt: f32,
    ) {
        self.accumulator += dt;
        
        // Step physics at fixed intervals
        while self.accumulator >= self.fixed_dt {
            physics_world.step();
            self.accumulator -= self.fixed_dt;
        }
    }
}
```

## Conclusion

You now have a comprehensive understanding of physics integration in Pulsar using Rapier3D! You've learned:

- Physics world setup and ECS integration
- Rigid body types and properties
- Collider shapes and materials
- Forces, impulses, and constraints
- Raycasting and spatial queries
- Character controller implementation
- Debug visualization
- Performance optimization

### Next Steps

1. Implement vehicle physics
2. Add rope/cloth simulation
3. Create destructible objects
4. Build advanced AI navigation
5. Implement networked physics

### Resources

- [Rapier3D Documentation](https://rapier.rs/)
- [Physics Best Practices](https://docs.pulsar-edit.dev/physics)
- [Character Controller Examples](https://github.com/pulsar-edit/examples/physics)
- [Physics Debugging Tools](https://docs.pulsar-edit.dev/debugging/physics)

Happy physics programming!
