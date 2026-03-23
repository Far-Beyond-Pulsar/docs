---
title: "Debug Pass"
description: "Runtime line-drawing visualization pass — decompose boxes, spheres, and axes into line segments with zero GPU cost when idle. Full-featured LineList topology with 65,536 vertex budget and read-only depth testing."
category: helio
lastUpdated: '2026-03-22'
tags:
  - debug-visualization
  - runtime-drawing
  - line-rendering
  - wgsl
  - development-tools
  - zero-cost-empty
position: 11
icon: bug
---

The `DebugPass` is a specialized lightweight render pass designed for runtime visualization of debug geometry — lines, wireframe shapes, editor gizmos, and diagnostic overlays. It decomposes all debug primitives (boxes, spheres, axes) into line segments that are rendered in a single O(1) draw call. The pass is completely **zero-cost when idle**: if no debug geometry is queued, the GPU skips all work and CPU cost is negligible.

The pass demonstrates Helio's design philosophy: opt-in complexity where visualization needs don't penalise production code paths.

---

## 1. Why Runtime Debug Visualization Matters

Traditional workflows rely on **compile-time visualisation**: modify shader code, recompile, and see the result. This is slow. Modern graphics debugging requires **runtime toggles** — flip an enum, see deferred-shading G-buffers, shadow maps, light contributions, or custom per-pixel data without recompilation.

The Debug Pass provides the infrastructure: a simple CPU-side API to submit arbitrary line segments each frame, with the GPU rendering them on top of the opaque scene. Spatial debugging benefits immediately — bounding boxes, frustum culling results, navmesh edges, and spatial partitions become directly visible at runtime without touching a shader. Deferred visualization lets you overlay G-buffer contents — normals, UVs, roughness maps — atop the final image, and light volume debugging makes shadow cascade boundaries and light influence radii straightforward to inspect. The same infrastructure serves editor tooling: transform gizmos, scene-graph hierarchy indicators, and manipulator widgets all consume the same line-submission API, as does performance profiling work that visualises draw call boundaries or virtual geometry cluster extents.

### Zero-Overhead-When-Empty Design

The pass uses a **conditional draw pattern**:

```rust
if self.vertex_count == 0 {
    return Ok(()); // Skip GPU work entirely
}
pass.draw(0..self.vertex_count, 0..1);
```

There is no "always-run" setup cost. If the application submits no debug geometry, the CPU performs no buffer upload and creates no render pass, and the GPU receives no command buffer entry, no pipeline bind, and no vertex fetch. This is why debug visualisation can be left enabled during shipped release builds — the cost is literally zero if the player doesn't request debug output.

> [!TIP]
> Thread debug drawing calls through a compile-time feature gate if you want to erase all debug code from release builds. The zero-cost-when-empty design means you don't *have* to — but sometimes binary size matters.

---

## 2. The Line Primitive Model

All debug geometry in Helio is **fundamentally decomposed into line segments**. This design choice prioritises simplicity and compatibility.

### Why Lines Over Triangles?

A wireframe box could be rendered as a triangle mesh — 12 edges × 2 triangles each = 24 triangles, 36 unique vertices with shared edges, and an index buffer — or as a line list: 12 edges × 2 vertices each = 24 vertices, no indexing required. For dynamic debug geometry submitted once per frame, the line list is unambiguously superior. There is no vertex deduplication to manage, no index buffer overhead, and line rendering preserves sharp edges without the face-visibility artifacts that arise when only some triangles of a wireframe face the camera.

### The LineList Topology

The pass uses **`PrimitiveTopology::LineList`**, which groups vertices in consecutive pairs: `(v[0], v[1])`, `(v[2], v[3])`, `(v[4], v[5])`, and so on. Each pair forms a line segment, and the vertex buffer is tightly packed with no gaps or sentinel values. To draw a wireframe box, for instance, 24 vertices cover all 12 edges — 4 vertical, 4 on the top face, and 4 on the bottom:

```
Box at origin with half-extents (1, 1, 1):
   4 vertical edges (4 × 2 = 8 verts)
   4 top edges (4 × 2 = 8 verts)
   4 bottom edges (4 × 2 = 8 verts)
Total: 24 vertices
```

A sphere might be rendered as **latitude + longitude lines**: 8 latitude rings × 16 segments each (256 vertices for a coarse-quality debug sphere).

> [!NOTE]
> Users typically don't construct `DebugVertex` arrays manually. Helio provides **debug shape helper functions** that take parameters (centre, size, colour) and return a `Vec<DebugVertex>` with the line vertices already decomposed. Examples: `debug_box()`, `debug_sphere()`, `debug_axes()`.

---

## 3. The Vertex Layout and Memory Stride

Each debug vertex is exactly **32 bytes**. This size is deliberate — it aligns perfectly with memory bus widths on modern GPUs, maximising fetch efficiency.

### The DebugVertex Structure

The exact layout from [crates/helio-pass-debug/src/lib.rs](crates/helio-pass-debug/src/lib.rs):

```rust
/// A single debug vertex — position + colour.
///
/// Matches the vertex input layout in `debug_draw.wgsl`:
///   location(0) position: vec3<f32>
///   location(1) color:    vec4<f32>
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct DebugVertex {
    pub position: [f32; 3],  // Bytes 0–11 (12 bytes)
    pub _pad:     f32,       // Bytes 12–15 (4 bytes) — aligns color to 16-byte boundary
    pub color:    [f32; 4],  // Bytes 16–31 (16 bytes)
}
```

### Memory Layout Diagram

```
╔════════════════════════════════════════════╗  32 bytes per vertex (256-bit aligned)
║  position.x    (f32)  Bytes 0–3           ║
║  position.y    (f32)  Bytes 4–7           ║
║  position.z    (f32)  Bytes 8–11          ║
║  _pad          (f32)  Bytes 12–15         ║  ← Padding: WGSL alignment rule
╠════════════════════════════════════════════╣
║  color.r       (f32)  Bytes 16–19         ║
║  color.g       (f32)  Bytes 20–23         ║
║  color.b       (f32)  Bytes 24–27         ║
║  color.a       (f32)  Bytes 28–31         ║
╚════════════════════════════════════════════╝
```

The padding field `_pad` is **not wasted**. WGSL uniform and storage buffer member rules require `vec3` to be padded to `vec4` width when stored inside a struct. Although debug vertices are uploaded via a **vertex buffer** (not a uniform buffer), this 32-byte alignment is optimal for GPU fetch efficiency regardless, so the padding is retained in the CPU-side struct to maintain an explicit, auditable memory layout.

### Uploading Vertex Data

Each frame, the application calls:

```rust
let debug_verts = vec![
    DebugVertex { position: [0.0, 0.0, 0.0], _pad: 0.0, color: [1.0, 0.0, 0.0, 1.0] },
    DebugVertex { position: [1.0, 0.0, 0.0], _pad: 0.0, color: [1.0, 0.0, 0.0, 1.0] },
    // ... more vertices
];
debug_pass.update_lines(&queue, &debug_verts);
```

The `update_lines()` method uses `bytemuck::cast_slice()` to reinterpret the `DebugVertex` array as a byte slice and writes it directly to the GPU buffer via `queue.write_buffer()`. This is O(n) in vertex count but happens on the CPU before the render pass executes, so it does not block GPU execution.

---

## 4. The WGSL Shaders

The complete shader from [crates/helio-pass-debug/shaders/debug_draw.wgsl](crates/helio-pass-debug/shaders/debug_draw.wgsl).

### Shader Structure

The pass uses two entry points: one vertex shader and one fragment shader. The uniforms and I/O structures are minimal by design.

```wgsl
struct Camera {
    view_proj: mat4x4<f32>,
    position: vec3<f32>,
    time: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexIn {
    @location(0) position: vec3<f32>,
    @location(1) color: vec4<f32>,
}

struct VertexOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip_position = camera.view_proj * vec4<f32>(input.position, 1.0);
    out.color = input.color;
    return out;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
    return input.color;
}
```

### Shader Explanation

The vertex shader `vs_main` receives world-space position and per-vertex colour from the debug vertex buffer, transforms the position to clip space using the camera's view-projection matrix, and passes the colour through unchanged. No perspective interpolation is needed for solid-colour lines — every vertex in a given line segment already carries its intended colour, and the GPU's linear interpolation across the segment produces the correct flat appearance. Every vertex follows the same path regardless of which line segment or primitive type it belongs to, keeping the shader trivially predictable and the pipeline state minimal.

The fragment shader `fs_main` is equally direct: it receives the interpolated colour value and outputs it without any shading, blending, or post-processing. This simplicity is intentional. Debug visualisation should be completely transparent — what you see on screen is exactly what you submitted. There are no hidden light interactions, no complex pipeline state, and no surprises.

> [!IMPORTANT]
> The fragment shader does **not** discard any fragments. All fragments generated by line rasterisation write to the colour target. This is correct for debug lines — they are opaque.

---

## 5. Debug Shape APIs

The `DebugPass` itself only defines the GPU infrastructure. The CPU-side API for constructing debug geometry typically lives in a `libhelio::debug` module. This separation of concerns is deliberate: the pass is a **low-level primitive** — upload line vertices, render them — while the helper functions provide **ergonomic shape submission** that insulates callers from the vertex layout entirely.

### Typical Shape Helper Pattern

```rust
pub fn debug_line(from: Vec3, to: Vec3, color: [f32; 4]) -> [DebugVertex; 2] {
    [
        DebugVertex { position: from.to_array(), _pad: 0.0, color },
        DebugVertex { position: to.to_array(), _pad: 0.0, color },
    ]
}

pub fn debug_box(center: Vec3, half_extents: Vec3, color: [f32; 4]) -> Vec<DebugVertex> {
    let mut verts = Vec::new();
    let [hx, hy, hz] = [half_extents.x, half_extents.y, half_extents.z];
    let c = center;

    // 8 corner positions
    let corners = [
        c + Vec3::new(-hx, -hy, -hz),
        c + Vec3::new(hx, -hy, -hz),
        c + Vec3::new(hx, hy, -hz),
        c + Vec3::new(-hx, hy, -hz),
        c + Vec3::new(-hx, -hy, hz),
        c + Vec3::new(hx, -hy, hz),
        c + Vec3::new(hx, hy, hz),
        c + Vec3::new(-hx, hy, hz),
    ];

    // 12 edges
    let edges = [
        (0, 1), (1, 2), (2, 3), (3, 0), // bottom face
        (4, 5), (5, 6), (6, 7), (7, 4), // top face
        (0, 4), (1, 5), (2, 6), (3, 7), // vertical edges
    ];

    for (a, b) in edges {
        verts.push(DebugVertex { position: corners[a].to_array(), _pad: 0.0, color });
        verts.push(DebugVertex { position: corners[b].to_array(), _pad: 0.0, color });
    }
    verts
}

pub fn debug_sphere(center: Vec3, radius: f32, color: [f32; 4]) -> Vec<DebugVertex> {
    // Generate latitude rings and longitude meridians
    let mut verts = Vec::new();
    let lat_rings = 8;
    let lon_segments = 16;
    
    for lat in 0..lat_rings {
        let lat_angle = (lat as f32 / lat_rings as f32) * std::f32::consts::PI;
        for lon in 0..lon_segments {
            let lon_angle = (lon as f32 / lon_segments as f32) * 2.0 * std::f32::consts::PI;
            let next_lon = ((lon + 1) as f32 / lon_segments as f32) * 2.0 * std::f32::consts::PI;

            let p1 = center + radius * Vec3::new(
                lat_angle.sin() * lon_angle.cos(),
                lat_angle.cos(),
                lat_angle.sin() * lon_angle.sin(),
            );
            let p2 = center + radius * Vec3::new(
                lat_angle.sin() * next_lon.cos(),
                lat_angle.cos(),
                lat_angle.sin() * next_lon.sin(),
            );

            verts.push(DebugVertex { position: p1.to_array(), _pad: 0.0, color });
            verts.push(DebugVertex { position: p2.to_array(), _pad: 0.0, color });
        }
    }
    verts
}

pub fn debug_axes(position: Vec3, scale: f32) -> Vec<DebugVertex> {
    let mut verts = Vec::new();
    let end_x = position + Vec3::X * scale;
    let end_y = position + Vec3::Y * scale;
    let end_z = position + Vec3::Z * scale;
    
    // X axis — red
    let red = [1.0, 0.0, 0.0, 1.0];
    verts.push(DebugVertex { position: position.to_array(), _pad: 0.0, color: red });
    verts.push(DebugVertex { position: end_x.to_array(), _pad: 0.0, color: red });
    
    // Y axis — green
    let green = [0.0, 1.0, 0.0, 1.0];
    verts.push(DebugVertex { position: position.to_array(), _pad: 0.0, color: green });
    verts.push(DebugVertex { position: end_y.to_array(), _pad: 0.0, color: green });
    
    // Z axis — blue
    let blue = [0.0, 0.0, 1.0, 1.0];
    verts.push(DebugVertex { position: position.to_array(), _pad: 0.0, color: blue });
    verts.push(DebugVertex { position: end_z.to_array(), _pad: 0.0, color: blue });
    
    verts
}
```

### Typical Usage Pattern

Per-frame submission in your render loop:

```rust
let mut debug_verts = Vec::new();

// Accumulate geometry from various subsystems
debug_verts.extend(debug_box(player_pos, Vec3::ONE * 0.5, [1.0, 1.0, 0.0, 1.0]));
debug_verts.extend(debug_sphere(light_pos, light_range, [1.0, 1.0, 1.0, 0.5]));
debug_verts.extend(debug_axes(camera_pos, 5.0));

// Submit to GPU
debug_pass.update_lines(&queue, &debug_verts);

// Clear for next frame (optional — update_lines overwrites)
// debug_pass.clear();

// Render (happens in the pass's execute() call)
renderer.render(&camera, &surface)?;
```

---

## 6. The 65,536 Vertex Budget

The pass enforces a hard limit:

```rust
const MAX_DEBUG_VERTS: u32 = 65536;

pub fn update_lines(&mut self, queue: &wgpu::Queue, verts: &[DebugVertex]) {
    let count = verts.len().min(MAX_DEBUG_VERTS as usize);
    // ...
    self.vertex_count = count as u32;
}
```

The value 65,536 is chosen with care rather than set arbitrarily. Being an exact power of two (2¹⁶), it cooperates naturally with GPU memory allocators, which strongly prefer power-of-two block sizes. At 32 bytes per vertex the buffer occupies exactly 2 MiB — a size that fits comfortably within L2 cache on most hardware, keeping upload and fetch performance predictable across frames. At 2 vertices per line segment, this budget covers 32,768 simultaneous line segments, which is sufficient for virtually any real debugging scenario: full navmesh edge visualisation, dense spatial partition grids, and overlapping physics collision shapes all typically fit well within this ceiling. Staying under 65,536 vertices also ensures reliable compatibility with mobile GPUs, which impose tighter per-draw-call vertex limits than desktop hardware.

When the submitted vertex count exceeds the budget, excess vertices are **silently clamped** — the first 65,536 vertices are rendered and the remainder are discarded:

```rust
let count = verts.len().min(MAX_DEBUG_VERTS as usize); // Silently clamps
```

This silent clamping is intentional. Debug visualisation is non-critical, and a partial but valid render is far preferable to a crash or a GPU validation error. If the geometry you care most about appears first in the submission order, it will always be visible.

> [!WARNING]
> If you're hitting the 65k limit regularly, it likely means you're debugging with too much geometry. Consider filtering the debug output: only draw AABBs for nearby objects, or visualise alternating grid cells instead of the whole grid.

---

## 7. Depth Testing Without Writing

The pass reads the depth buffer but never writes to it:

```rust
depth_stencil: Some(wgpu::DepthStencilState {
    format:              wgpu::TextureFormat::Depth32Float,
    depth_write_enabled: false,  // ← Read-only depth
    depth_compare:       wgpu::CompareFunction::LessEqual,
    stencil:             wgpu::StencilState::default(),
    bias:                wgpu::DepthBiasState::default(),
}),
```

### Why Read-Only Depth?

Disabling depth writes while keeping depth testing active is a deliberate semantic distinction. Debug lines need to **occlude correctly** — a line segment behind a wall should not bleed through the wall's surface — so depth testing must remain enabled. But debug lines must **not affect** the depth values seen by subsequent passes. The depth buffer encodes the scene's spatial structure; a debug overlay must observe that structure without altering it. If debug lines wrote depth, they could silently corrupt post-processing effects, shadow comparisons, or any pass that depends on the scene's geometry depth remaining intact.

The depth compare function is **`LessEqual`** rather than strict `Less`. The distinction matters in practice: a debug box drawn to exactly match a physics collision shape will sit at the same depth as the rendered surface, and `LessEqual` resolves those ties in favour of visibility. With strict `Less`, coincident debug geometry would z-fight unpredictably and be unreliable as a diagnostic tool.

### Visual Behavior

When a debug line runs behind opaque geometry at a depth greater than the geometry's depth value, the line is visually occluded — it does not appear on screen. This correctly respects the scene's spatial structure. A bounding box around an object occluded behind a wall will only show the portions of the box that protrude in front of the wall, giving an accurate picture of the object's actual world-space position relative to visible geometry.

> [!TIP]
> To visualise hidden geometry (inside-out boxes, occluded shapes), you can optionally render debug lines in a second pass with depth testing **disabled** and blending enabled. This would be a separate graphics pass, but the pattern is straightforward.

---

## 8. set_debug_mode() — G-Buffer Visualization

The Debug Pass itself doesn't have a `set_debug_mode()` method. Instead, **`set_debug_mode()` is on the `DeferredLightPass`** (see [deferred-light.md](deferred-light.md)), because deferred lighting is where G-buffer contents become visual. This placement is architecturally correct: the G-buffer channels — albedo, normals, UVs, world-space position — are only meaningful once a pass exists that can read and display them, and that pass is the deferred lighting pass, not the debug line overlay.

The debug modes enable visualization of surface properties. Each mode replaces the standard lighting output with a raw visualization of one G-buffer channel or derived quantity, making it straightforward to verify that geometry is writing correct data at each stage of the pipeline:

| Mode | Visualization |
|---|---|
| `0` | Normal rendering (default) |
| `1` | Albedo (base colour) — shows only the colour without lighting |
| `2` | Texture coordinates (UV unwrap visualization) — colours in xY per-UV-unit |
| `3` | Geometric normals — displays surface normal vectors as RGB |
| `4` | World-space position — encodes world coordinates as colour |
| `5` | Custom (configurable, often used for emission/glow) |
| `10` | Shadow map heatmap — bright where lights cast shadows, dark where unlit |
| `11` | Light-space depth — visualises depth from light's perspective in cascade |

To enable G-buffer visualization:

```rust
renderer.set_debug_mode(3); // Show geometric normals
// ... render ...
renderer.set_debug_mode(0); // Back to normal
```

> [!NOTE]
> The `debug_mode` configuration is **global to the renderer**, not per-object or per-pass. Changing it rebuilds the render graph, so only call `set_debug_mode()` when you need to toggle visualization, not every frame.

---

## 9. Bind Group Layout

The Debug Pass uses a single bind group (group 0):

| Binding | Name | Type | Visibility | Purpose |
|---|---|---|---|---|
| `0` | `camera` | Uniform Buffer | Vertex | View-projection matrix + camera position + time |

### Camera Uniform Structure

```rust
pub struct Camera {
    pub view_proj: Mat4,  // 64 bytes (4×4 matrix of f32)
    pub position: Vec3,   // 12 bytes (x, y, z)
    // (Implicit WGSL padding: 4 bytes)
    pub time: f32,        // 4 bytes (elapsed time)
}
// Total: 16-byte aligned, 84 bytes (padded to 96 for alignment)
```

This structure is identical to the camera uniform used by all other passes in Helio. Sharing the same layout means each pass receives consistent coordinates and time-based values without any per-pass translation or reformatting — the same `wgpu::Buffer` handle is bound to group 0 in every pass.

---

## 10. Integration with the Render Pass Pipeline

The Debug Pass is **currently not integrated into the default render graph** (`build_default_graph()`). Instead, it is typically created and managed **separately by the application**. This is intentional: not every application or editor host needs debug geometry infrastructure, and keeping it opt-in avoids burdening the default graph with pass creation, buffer allocation, and bind group setup that would be wasted when debugging is inactive.

### Expected Position in the Pipeline

If integrated, the Debug Pass should run **after `BillboardPass`** and before any post-processing:

```
DepthPrepass
    ↓
GBufferPass
    ↓
DeferredLightPass
    ↓
BillboardPass (camera-facing quads with alpha blending)
    ↓
DebugPass ← HERE: render wireframes, gizmos, overlays
    ↓
FxaaPass (optional anti-aliasing)
    ↓
Output to surface
```

Placing the Debug Pass after BillboardPass ensures that debug lines composite on top of billboards visually, since later passes occupy the front of the draw order. The read-only depth test ensures they still correctly respect the opaque scene depth established by the geometry and billboard passes that preceded them.

### Manual Integration Example

```rust
let mut renderer = Renderer::new(device.clone(), queue.clone(), config);

// Create the debug pass manually
let debug_pass = DebugPass::new(
    &device,
    renderer.camera_buffer(),
    config.surface_format,
);

// Add it to the graph
// (This requires access to the graph; typically you store it locally)
renderer.add_pass(Box::new(debug_pass));
```

---

## 11. FXAA Interaction

If the render graph includes an **FxaaPass** (Fast Approximate Anti-Aliasing), it runs **after** the Debug Pass:

```
DebugPass (renders lines to HDR target)
    ↓
FxaaPass (samples HDR target, applies edge-detection + blurring)
    ↓
Output
```

Because FXAA operates on the combined output of everything rendered before it, debug lines are treated as scene edges and receive the same anti-aliasing treatment as geometry. In practice this means **debug lines are slightly blurred by FXAA** — the filter detects the high-contrast line edges and softens them. This is usually imperceptible at normal line widths and rarely affects usability, but if you need perfectly sharp editor gizmos, consider rendering a second debug pass after the FXAA stage or disabling FXAA in editor builds entirely.

> [!TIP]
> In a shipping game, FXAA on debug lines is never seen (debug code isn't compiled in). In an editor, the subtle blur is usually not a usability issue.

---

## 12. Zero-Cost When Empty

When `vertex_count == 0`, the pass is a complete no-op:

```rust
impl RenderPass for DebugPass {
    fn execute(&mut self, ctx: &mut PassContext) -> HelioResult<()> {
        if self.vertex_count == 0 {
            return Ok(()); // Exit immediately, no GPU work
        }

        let color_attachment = /* ... */;
        let depth_attachment = /* ... */;
        // ... create render pass ...
        pass.draw(0..self.vertex_count, 0..1);
        Ok(())
    }
}
```

The early return is unconditional and cheap — a single integer comparison against zero executed in the render pass manager before any GPU resource is touched. No render pass object is constructed, no command buffer entries are recorded, no pipeline or bind group binds are issued, and `update_lines()` is likewise short-circuited when `count == 0`, so no buffer upload occurs either. The GPU receives zero commands related to the Debug Pass for that frame. This design makes conditional debug submission both natural and cost-free:

```rust
if cfg!(debug_assertions) || should_show_debug {
    debug_verts.extend(/* geometry */);
}
debug_pass.update_lines(&queue, &debug_verts);
// In release builds, the pass is 100% no-op if debug_verts is empty
```

> [!IMPORTANT]
> Remember to **clear the buffer at the end of each frame** if you use persistent geometry. The pass does **not** automatically clear — it only overwrites the buffer with new data. If you call `update_lines()` once and then never call it again, the old geometry persists indefinitely.

---

## Summary

The Debug Pass is a carefully designed **minimal-overhead debug visualization layer**. By decomposing all geometry into line segments, using a tight 32-byte vertex layout, and implementing true zero-cost-when-empty semantics, it enables developers to maintain sophisticated runtime debugging without performance penalties. Combined with G-buffer visualization modes in the deferred light pass and shape helper functions for ergonomic submission, it forms a complete debugging toolkit for Helio-based applications.
