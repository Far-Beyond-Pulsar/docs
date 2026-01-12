---
title: "Rendering Pipeline"
description: "Understanding Pulsar's GPU-driven rendering architecture"
category: "core-concepts"
order: 4
lastUpdated: "2026-01-12"
tags: ["rendering", "gpu", "graphics", "shaders", "pipeline"]
related: ["core-concepts/ui-framework", "core-concepts/entity-component-system", "guides/custom-shaders"]
---

# Rendering Pipeline

Pulsar's rendering pipeline is designed for one thing: getting pixels on screen fast. Not just "fast enough"—fast enough to run a game editor at 120+ FPS with real-time previews, complex materials, thousands of entities visible, and GPU-intensive effects active. This document explains how we achieve that, and why the architecture is built the way it is.

Let me be upfront about something: parts of this system are still being implemented. What I'm documenting here is the current architecture and our target design. Some features are fully working, others are in progress. I'll be clear about what's what.

## Design Goals

Before we dive into technical details, let's talk about what the rendering system needs to do:

**Real-time performance** - The editor needs to run smoothly while you're working. Moving entities, tweaking materials, adjusting lighting—all of this should feel instant. We target 60 FPS minimum on modest hardware, with headroom for 120+ FPS on high-end systems.

**Editor reliability** - The renderer should never crash the editor. If a shader fails to compile or a mesh is corrupted, show an error, render a fallback, and keep running. The editor is your primary tool; it needs to be rock solid.

**Hot reloading everything** - Change a shader, see it immediately. Modify a material, instant update. Replace a mesh, no restart needed. Iteration speed is everything when you're making games.

**Accurate previews** - What you see in the editor should match what runs in your game. No surprises when you hit play. The same rendering code runs in both modes.

**GPU-driven rendering** - Modern GPUs are incredibly powerful, but only if you use them correctly. Pulsar's renderer minimizes CPU involvement and lets the GPU do what it does best: massive parallelism.

## Architecture Overview

Let's start with the big picture. Here's how rendering flows through the engine:

```
┌──────────────────────────────────────────────────────────┐
│                    Scene Graph                           │
│   Entities │ Transforms │ Visibility │ LOD States        │
└──────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────┐
│                  Culling & Sorting                       │
│   Frustum Culling │ Occlusion │ Material Batching        │
└──────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────┐
│              Command Buffer Generation                    │
│   Draw Calls │ State Changes │ Resource Bindings         │
└──────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────┐
│                   GPU Execution                          │
│   Vertex Shading │ Rasterization │ Fragment Shading      │
└──────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────┐
│                 Post-Processing                          │
│   Bloom │ Tonemapping │ FXAA │ UI Compositing           │
└──────────────────────────────────────────────────────────┘
```

Each stage has specific responsibilities, and they're designed to minimize CPU overhead while maximizing GPU utilization.

## GPU-Driven Rendering

The core philosophy is simple: the GPU should do as much work as possible. Modern GPUs have thousands of cores; we should use them.

### What Does "GPU-Driven" Mean?

In traditional rendering, the CPU does a lot of work:

```rust
// Traditional approach (we DON'T do this)
for entity in visible_entities {
    // CPU calculates final transform
    let world_transform = entity.transform * parent_transform;
    
    // CPU builds draw command
    let draw_cmd = DrawCommand {
        mesh: entity.mesh,
        material: entity.material,
        transform: world_transform,
    };
    
    // CPU submits to GPU (one at a time!)
    renderer.submit(draw_cmd);
}
```

This is slow for several reasons:

- The CPU has to touch every entity
- Draw calls are submitted one at a time
- CPU time spent here can't be spent on game logic
- It doesn't scale well to thousands of entities

GPU-driven rendering flips this around:

```rust
// Pulsar's approach
pub struct RenderScene {
    // All entity data uploaded to GPU once
    entity_buffer: GPUBuffer,
    transform_buffer: GPUBuffer,
    material_buffer: GPUBuffer,
}

impl RenderScene {
    pub fn render(&self, cx: &mut RenderContext) {
        // Single draw call renders everything
        cx.draw_indirect(
            &self.entity_buffer,
            &self.draw_commands,  // Generated on GPU!
        );
    }
}
```

Now the GPU does the heavy lifting:

- Culling happens in a compute shader
- Draw commands are generated on the GPU
- Transforms are computed in vertex shaders
- The CPU just kicks off the work and waits

This scales to tens of thousands of entities with minimal CPU cost.

### The Entity Buffer

At the heart of GPU-driven rendering is the entity buffer—a big chunk of GPU memory containing all entity data:

```rust
#[repr(C)]
pub struct EntityData {
    // Transform data
    pub position: Vec3,
    pub rotation: Quat,
    pub scale: Vec3,
    
    // Rendering data
    pub mesh_index: u32,
    pub material_index: u32,
    pub lod_level: u8,
    
    // Visibility flags
    pub flags: EntityFlags,
    
    // Bounding volume for culling
    pub bounds_min: Vec3,
    pub bounds_max: Vec3,
}

// All entities in one buffer
pub struct EntityBuffer {
    data: Vec<EntityData>,
    gpu_buffer: wgpu::Buffer,
}
```

When entities change, we update the buffer:

```rust
impl EntityBuffer {
    pub fn update_entity(&mut self, id: EntityId, data: EntityData) {
        // Update CPU copy
        self.data[id.index()] = data;
        
        // Mark region as dirty
        self.dirty_regions.mark(id.index());
    }
    
    pub fn sync_to_gpu(&mut self, queue: &wgpu::Queue) {
        // Only upload changed regions
        for region in self.dirty_regions.drain() {
            queue.write_buffer(
                &self.gpu_buffer,
                region.offset,
                &self.data[region.range],
            );
        }
    }
}
```

This approach minimizes uploads—we only send changed data to the GPU.

## Deferred vs Forward Rendering

Pulsar supports both deferred and forward rendering, because each has strengths:

### Deferred Rendering

Deferred rendering splits the process into two phases:

**Phase 1: G-Buffer Generation**

```rust
// Render all geometry to multiple render targets
pub struct GBuffer {
    // RGB: albedo, A: unused
    albedo: Texture,
    
    // RGB: normal (world space), A: unused
    normals: Texture,
    
    // R: metallic, G: roughness, B: ambient occlusion, A: unused
    material: Texture,
    
    // RGB: emissive, A: unused
    emissive: Texture,
    
    // R: depth
    depth: Texture,
}
```

During this phase, the fragment shader just writes material properties:

```wgsl
// G-Buffer fragment shader
struct FragmentOutput {
    @location(0) albedo: vec4<f32>,
    @location(1) normal: vec4<f32>,
    @location(2) material: vec4<f32>,
    @location(3) emissive: vec4<f32>,
}

@fragment
fn fs_main(in: VertexOutput) -> FragmentOutput {
    var output: FragmentOutput;
    
    // Sample textures
    output.albedo = textureSample(albedo_texture, albedo_sampler, in.uv);
    output.normal = vec4<f32>(normalize(in.normal), 1.0);
    output.material = vec4<f32>(
        material.metallic,
        material.roughness,
        material.ao,
        1.0
    );
    output.emissive = vec4<f32>(material.emissive, 1.0);
    
    return output;
}
```

**Phase 2: Lighting**

Now we render a fullscreen quad and compute lighting:

```wgsl
// Lighting fragment shader
@fragment
fn fs_lighting(in: VertexOutput) -> @location(0) vec4<f32> {
    // Read from G-Buffer
    let albedo = textureSample(gbuffer_albedo, sampler, in.uv).rgb;
    let normal = textureSample(gbuffer_normal, sampler, in.uv).xyz;
    let material = textureSample(gbuffer_material, sampler, in.uv).rgb;
    let depth = textureSample(gbuffer_depth, sampler, in.uv).r;
    
    // Reconstruct world position from depth
    let world_pos = reconstruct_position(in.uv, depth);
    
    // Calculate lighting for all lights
    var lighting = vec3<f32>(0.0);
    for (var i = 0u; i < num_lights; i++) {
        lighting += calculate_light(
            lights[i],
            world_pos,
            normal,
            albedo,
            material.r, // metallic
            material.g  // roughness
        );
    }
    
    return vec4<f32>(lighting, 1.0);
}
```

### Why Deferred Rendering?

**Many lights are cheap** - With forward rendering, each light requires another draw call or more complex shaders. With deferred rendering, lights are just more work in the lighting pass—the cost scales with screen pixels, not scene complexity.

**Consistent cost** - The geometry pass always takes the same time regardless of light count. You can profile and optimize independently.

**Easy to extend** - Want to add screen-space effects like SSAO or SSR? You already have all the data you need in the G-Buffer.

### Forward Rendering

But deferred rendering has downsides:

- Transparency is complicated (can't write to G-Buffer)
- High memory bandwidth requirement
- Limited material variation (fixed G-Buffer layout)
- No MSAA (at least not easily)

That's why Pulsar also supports forward rendering:

```wgsl
@fragment
fn fs_forward(in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample material textures
    let albedo = textureSample(albedo_texture, albedo_sampler, in.uv);
    let normal_map = textureSample(normal_texture, normal_sampler, in.uv);
    
    // Calculate normal in world space
    let normal = apply_normal_map(in.normal, in.tangent, normal_map);
    
    // Direct lighting calculation
    var lighting = vec3<f32>(0.0);
    for (var i = 0u; i < num_lights; i++) {
        lighting += calculate_light(
            lights[i],
            in.world_pos,
            normal,
            albedo.rgb,
            material.metallic,
            material.roughness
        );
    }
    
    return vec4<f32>(lighting * albedo.rgb, albedo.a);
}
```

### When to Use Each

Pulsar picks the rendering path automatically:

```rust
pub enum RenderPath {
    Deferred,   // Default for opaque objects
    Forward,    // Used for transparent objects
}

impl Material {
    pub fn render_path(&self) -> RenderPath {
        if self.blend_mode != BlendMode::Opaque {
            // Transparency requires forward rendering
            RenderPath::Forward
        } else if self.requires_msaa {
            // MSAA requires forward rendering
            RenderPath::Forward
        } else {
            // Default to deferred
            RenderPath::Deferred
        }
    }
}
```

Most objects use deferred rendering, transparent objects use forward rendering. Best of both worlds.

## Material System

Materials define how surfaces look. In Pulsar, materials are defined using a node-based system (in the editor) but compiled to efficient shaders:

### Material Definition

```rust
pub struct Material {
    // Base properties
    pub name: String,
    pub shader: Handle<Shader>,
    
    // Textures
    pub albedo: Option<Handle<Texture>>,
    pub normal: Option<Handle<Texture>>,
    pub metallic_roughness: Option<Handle<Texture>>,
    pub emissive: Option<Handle<Texture>>,
    
    // Parameters
    pub base_color: Color,
    pub metallic: f32,
    pub roughness: f32,
    pub emissive_strength: f32,
    
    // Render state
    pub blend_mode: BlendMode,
    pub cull_mode: CullMode,
    pub depth_test: bool,
}
```

### Material Batching

Drawing each material separately is slow. Pulsar batches draws by material:

```rust
pub struct RenderBatch {
    pub material: Handle<Material>,
    pub entities: Vec<EntityId>,
}

impl Renderer {
    pub fn build_batches(&self, visible: &[EntityId]) -> Vec<RenderBatch> {
        // Group entities by material
        let mut batches = HashMap::new();
        
        for &entity_id in visible {
            let entity = self.entities.get(entity_id);
            batches
                .entry(entity.material)
                .or_insert_with(Vec::new)
                .push(entity_id);
        }
        
        // Convert to batch list
        batches
            .into_iter()
            .map(|(material, entities)| RenderBatch { material, entities })
            .collect()
    }
}
```

Now we draw all entities with the same material in one batch:

```rust
for batch in batches {
    // Bind material once
    self.bind_material(&batch.material);
    
    // Draw all entities
    for entity_id in batch.entities {
        self.draw_entity(entity_id);
    }
}
```

This minimizes state changes and improves performance significantly.

### Shader Compilation

Materials are compiled to shaders at load time:

```rust
pub struct ShaderCompiler {
    // Shader template
    template: String,
    
    // Available features
    features: HashMap<String, String>,
}

impl ShaderCompiler {
    pub fn compile(&self, material: &Material) -> Result<CompiledShader> {
        let mut shader_code = self.template.clone();
        
        // Enable features based on material
        if material.albedo.is_some() {
            shader_code = self.enable_feature(&shader_code, "ALBEDO_TEXTURE");
        }
        
        if material.normal.is_some() {
            shader_code = self.enable_feature(&shader_code, "NORMAL_MAPPING");
        }
        
        if material.blend_mode != BlendMode::Opaque {
            shader_code = self.enable_feature(&shader_code, "ALPHA_BLEND");
        }
        
        // Compile shader
        self.compile_wgsl(&shader_code)
    }
}
```

This generates optimized shaders tailored to each material's features.

## Shader Pipeline

Shaders are the programs that run on the GPU. Pulsar uses WGSL (WebGPU Shading Language), which is modern, safe, and portable.

### Vertex Shaders

Vertex shaders transform vertices from model space to screen space:

```wgsl
// Vertex shader input
struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) tangent: vec4<f32>,
    @location(3) uv: vec2<f32>,
}

// Vertex shader output
struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) tangent: vec3<f32>,
    @location(3) uv: vec2<f32>,
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    // Transform to world space
    let world_pos = model_matrix * vec4<f32>(in.position, 1.0);
    out.world_position = world_pos.xyz;
    
    // Transform to clip space
    out.clip_position = view_projection * world_pos;
    
    // Transform normals and tangents
    out.normal = normalize((model_matrix * vec4<f32>(in.normal, 0.0)).xyz);
    out.tangent = normalize((model_matrix * vec4<f32>(in.tangent.xyz, 0.0)).xyz);
    
    // Pass through UVs
    out.uv = in.uv;
    
    return out;
}
```

### Fragment Shaders

Fragment shaders determine pixel colors:

```wgsl
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Sample textures
    let albedo = textureSample(albedo_texture, albedo_sampler, in.uv);
    let normal_map = textureSample(normal_texture, normal_sampler, in.uv);
    let metallic_roughness = textureSample(mr_texture, mr_sampler, in.uv);
    
    // Unpack normal map
    let normal = unpack_normal_map(normal_map, in.normal, in.tangent);
    
    // Calculate view direction
    let view_dir = normalize(camera_position - in.world_position);
    
    // Calculate lighting (PBR)
    let lighting = calculate_pbr_lighting(
        in.world_position,
        normal,
        view_dir,
        albedo.rgb,
        metallic_roughness.b,  // metallic
        metallic_roughness.g   // roughness
    );
    
    return vec4<f32>(lighting, albedo.a);
}
```

### Compute Shaders

Compute shaders handle general-purpose GPU computation. Pulsar uses them for culling:

```wgsl
@compute @workgroup_size(64)
fn cs_cull(@builtin(global_invocation_id) id: vec3<u32>) {
    let entity_index = id.x;
    
    if (entity_index >= num_entities) {
        return;
    }
    
    // Load entity data
    let entity = entities[entity_index];
    
    // Frustum culling
    let visible = is_in_frustum(entity.bounds, camera_frustum);
    
    // Write result
    visibility[entity_index] = u32(visible);
    
    // Generate draw command if visible
    if (visible) {
        let command_index = atomicAdd(&draw_count, 1u);
        draw_commands[command_index] = DrawCommand(
            entity.mesh_index,
            entity.material_index,
            entity_index
        );
    }
}
```

This runs culling entirely on the GPU—the CPU never touches individual entities.

## Render Graph

*(This section describes planned architecture currently in development)*

The render graph describes how render passes connect:

```rust
pub struct RenderGraph {
    nodes: Vec<RenderNode>,
    edges: Vec<RenderEdge>,
}

pub enum RenderNode {
    Pass(RenderPass),
    Resource(RenderResource),
}

pub struct RenderPass {
    name: String,
    execute: Box<dyn Fn(&mut RenderContext)>,
    inputs: Vec<ResourceId>,
    outputs: Vec<ResourceId>,
}
```

You build a graph describing your rendering:

```rust
let mut graph = RenderGraph::new();

// G-Buffer pass
let gbuffer = graph.add_pass("gbuffer", |cx| {
    cx.render_scene(RenderPath::Deferred);
});

// Lighting pass
let lit = graph.add_pass("lighting", |cx| {
    cx.compute_lighting(gbuffer);
});

// Post-processing
let final_image = graph.add_pass("postprocess", |cx| {
    cx.apply_bloom(lit);
    cx.apply_tonemapping(lit);
});

// UI compositing
graph.add_pass("ui", |cx| {
    cx.render_ui();
    cx.composite(final_image);
});

// Execute graph
graph.execute(&mut render_context);
```

The graph automatically handles:

- Resource lifetime management
- Pass ordering
- GPU synchronization
- Memory aliasing opportunities

## Hot Reloading

One of Pulsar's best features is hot reloading—change assets and see them immediately.

### Shader Hot Reloading

```rust
pub struct ShaderWatcher {
    watcher: FileWatcher,
    shaders: HashMap<PathBuf, Handle<Shader>>,
}

impl ShaderWatcher {
    pub fn on_file_changed(&mut self, path: &Path) {
        // Recompile shader
        match self.compile_shader(path) {
            Ok(shader) => {
                // Replace old shader
                if let Some(handle) = self.shaders.get(path) {
                    self.replace_shader(*handle, shader);
                    println!("✓ Reloaded shader: {}", path.display());
                }
            }
            Err(e) => {
                // Show error in editor, but don't crash
                self.report_error(path, e);
            }
        }
    }
}
```

When a shader fails to compile, Pulsar:
1. Shows the error in the editor
2. Highlights the problematic line
3. Keeps using the old shader
4. Lets you fix it and try again

No crashes, no restarts.

### Material Hot Reloading

Materials can be edited live:

```rust
// Material editor changes a parameter
material.roughness = 0.7;

// Immediately visible in all viewports
renderer.update_material(material_handle, material);
```

Changes propagate instantly because materials are just GPU buffer updates.

## Performance Optimization

Let's talk about making things fast.

### Culling

Don't draw what you can't see:

```rust
pub fn frustum_cull(&self, entities: &[Entity]) -> Vec<EntityId> {
    entities
        .iter()
        .filter(|e| self.camera.frustum.intersects(&e.bounds))
        .map(|e| e.id)
        .collect()
}
```

For complex scenes, we use hierarchical culling:

```rust
pub struct BoundingVolumeHierarchy {
    nodes: Vec<BVHNode>,
}

pub struct BVHNode {
    bounds: AABB,
    children: Either<Vec<usize>, Vec<EntityId>>,
}

impl BoundingVolumeHierarchy {
    pub fn cull(&self, frustum: &Frustum) -> Vec<EntityId> {
        let mut visible = Vec::new();
        self.cull_recursive(0, frustum, &mut visible);
        visible
    }
    
    fn cull_recursive(&self, node_idx: usize, frustum: &Frustum, out: &mut Vec<EntityId>) {
        let node = &self.nodes[node_idx];
        
        if !frustum.intersects(&node.bounds) {
            return; // Entire subtree culled
        }
        
        match &node.children {
            Either::Left(child_nodes) => {
                for &child in child_nodes {
                    self.cull_recursive(child, frustum, out);
                }
            }
            Either::Right(entities) => {
                out.extend(entities);
            }
        }
    }
}
```

This culls thousands of entities in microseconds.

### Level of Detail (LOD)

Distant objects can use simpler meshes:

```rust
pub struct LODGroup {
    pub lods: Vec<LODLevel>,
}

pub struct LODLevel {
    pub mesh: Handle<Mesh>,
    pub distance: f32,  // Switch distance
}

impl LODGroup {
    pub fn select_lod(&self, distance: f32) -> Handle<Mesh> {
        for lod in &self.lods {
            if distance < lod.distance {
                return lod.mesh;
            }
        }
        self.lods.last().unwrap().mesh
    }
}
```

### Instancing

Drawing identical objects is nearly free:

```rust
pub struct InstancedMesh {
    pub mesh: Handle<Mesh>,
    pub transforms: Vec<Mat4>,
}

impl Renderer {
    pub fn draw_instanced(&mut self, instanced: &InstancedMesh) {
        // Upload transforms to GPU
        self.update_buffer(&self.instance_buffer, &instanced.transforms);
        
        // Single draw call for all instances
        self.draw_indexed_instanced(
            &instanced.mesh,
            instanced.transforms.len() as u32,
        );
    }
}
```

Perfect for vegetation, debris, repeated architecture.

## Conclusion

Pulsar's rendering pipeline is built for modern GPUs and editor workloads. The key principles:

- **GPU-driven rendering** minimizes CPU overhead
- **Deferred rendering** handles many lights efficiently
- **Forward rendering** provides flexibility for special cases
- **Material batching** reduces state changes
- **Shader compilation** generates optimized code
- **Hot reloading** enables rapid iteration

Understanding these systems helps you build better games and debug rendering issues when they arise. And as more features come online, you'll have the foundation to use them effectively.
