---
title: Simple Cube Pass
description: Minimal single-draw geometry pass rendering a hardcoded unit cube at full brightness — a self-contained sanity-check baseline that requires no scene state
category: helio
lastUpdated: '2026-03-23'
tags:
  - debug
  - baseline
  - simple
  - geometry
position: 22
icon: '📦'
---

`SimpleCubePass` renders a single hardcoded unit cube using only a camera uniform buffer. It owns its own vertex and index buffers, clears its own color and depth targets, and produces a visible, unambiguous result regardless of scene state. Nothing from the material system, scene graph, light array, or deferred pipeline is required. This makes it the canonical sanity-check baseline for Helio — the first pass to insert when bringing up a new platform, a new wgpu version, or a new GPU, and the first pass to reach for when any downstream pass produces a blank screen or corrupted output.

---

## 1. The Diagnostic Baseline

When a renderer produces no output, the failure space is enormous. The wgpu device may not have been created with the correct features. The surface format may be unsupported by the driver. The render pipeline may have failed to compile silently. The vertex buffer upload may have produced an empty buffer. The depth attachment format may be mismatched. The render pass may never have been submitted to the queue. Any one of these failures produces an identical symptom: a blank or black frame. Diagnosing which failure occurred requires systematically eliminating variables.

`SimpleCubePass` collapses that variable space to almost nothing. Its geometry is never uploaded from a scene — it is baked into CPU arrays at compile time and uploaded to `wgpu::Buffer` objects once at construction. Its shader is ten lines of WGSL that cannot fail for any reason beyond a fundamental driver WGSL parsing bug. Its only runtime input is a camera uniform buffer providing the view-projection matrix. If the pass renders a cube, the following facts are simultaneously confirmed: the wgpu device and instance are functional, the surface format is correct and pipeline-compatible, the vertex and index buffers were successfully allocated and uploaded, the depth buffer format `Depth32Float` is supported, the bind group layout validation passed, and the GPU command encoder and queue submission path are working end to end.

If the pass does not render a cube, one of those invariants has been violated — and because the pass has no scene dependencies, the failure must be in the infrastructure itself rather than in content. This is the precise diagnostic value of a minimal baseline pass.

---

## 2. Design Philosophy — Maximum Isolation

The deliberate minimalism of `SimpleCubePass` is not laziness — it is the property that gives the pass its diagnostic value. Every dependency introduced would create a new failure mode that could produce a blank frame without implicating the infrastructure. A material system dependency means a missing material asset could produce no output. A light buffer dependency means an uninitialised light array could yield black geometry. A scene graph dependency means a missing root node could produce an empty draw list.

The pass therefore depends on exactly one external resource: the camera uniform buffer. Everything else — vertex positions, normals, face colors, index data, pipeline state, depth attachment — is created and owned by the pass itself at construction time. `prepare()` does nothing and returns `Ok(())` immediately because there is no per-frame data to upload; all geometry is constant after `new()` returns.

The single external coupling is carefully scoped. The shader reads only the first 192 bytes of the camera buffer — the `view`, `proj`, and `view_proj` matrices — which form a safe prefix of the full 368-byte `CameraUniform` struct used by other passes. The bind group layout declares this as a plain uniform buffer with no minimum binding size constraint, so even a buffer of exactly 192 bytes satisfies validation. The pass can be inserted at any position in any render graph, or used as the sole pass in a single-pass graph, and will behave identically.

> [!IMPORTANT]
> `SimpleCubePass` clears both the color and depth targets on every frame using `LoadOp::Clear`. It does not read or depend on any previous render pass's output. This means it is always safe to insert as the first pass — or as the only pass — without considering prior attachment state.

---

## 3. The Cube Geometry

The cube is represented as 24 vertices and 36 indices. A simpler approach would use 8 vertices — one per corner — and share them across faces. That representation is sufficient for a solid-color cube, but fails when faces must carry distinct per-vertex attributes. A vertex at a corner of three faces has three different outward normals (one per face) and three different colors; a single vertex slot can hold only one value for each attribute. The 24-vertex layout resolves this by allocating four independent vertices per face, duplicating spatial positions as needed, so that each vertex's normal and color are unambiguously associated with exactly one face.

The six faces each receive a distinct color, and the colors are chosen as complementary pairs along each axis. The +X face is red `[1.0, 0.25, 0.25]` and the -X face is cyan `[0.25, 1.0, 1.0]`; +Y is green `[0.25, 1.0, 0.25]` and -Y is magenta `[1.0, 0.25, 1.0]`; +Z is blue `[0.3, 0.5, 1.0]` and -Z is yellow `[1.0, 1.0, 0.25]`. The complementary pairing is intentional: opposite faces can never be simultaneously visible, so there is no risk of the two faces in a pair blending in the viewer's memory. At a glance, a red face confirms the camera is looking at positive X, cyan confirms negative X, and so on. The colors are intentionally not full-intensity primaries — the minimum channel value of 0.25 keeps the dimmer channel above zero, making the colors readable on both dark and light backgrounds without producing harsh pure-primary hues.

The +X face illustrates the winding convention and vertex layout in full. All vertices share the same outward normal `[1, 0, 0]` and the same red color:

```rust
// +X face — four vertices, CCW winding viewed from outside (from +X direction)
v([ 0.5, -0.5, -0.5], [1., 0., 0.], r),  // v0: bottom-left
v([ 0.5,  0.5, -0.5], [1., 0., 0.], r),  // v1: top-left
v([ 0.5,  0.5,  0.5], [1., 0., 0.], r),  // v2: top-right
v([ 0.5, -0.5,  0.5], [1., 0., 0.], r),  // v3: bottom-right
```

The four vertices form a quad. The quad is split into two triangles using the index pattern `[b, b+1, b+2, b, b+2, b+3]`, where `b = face × 4` is the base vertex index for that face. For the +X face, `b = 0`, yielding indices `[0, 1, 2, 0, 2, 3]` — the upper-left triangle `(v0, v1, v2)` and the lower-right triangle `(v0, v2, v3)`. Both triangles are wound counter-clockwise when viewed from outside the cube face, which is the convention expected by the pipeline's `front_face: CCW, cull_mode: Back` settings.

The index generation loop is unconditional and produces all 36 indices in a single pass:

```rust
fn cube_indices() -> [u16; 36] {
    let mut idx = [0u16; 36];
    for face in 0..6u16 {
        let b = face * 4;
        let o = (face * 6) as usize;
        idx[o]     = b;     idx[o + 1] = b + 1; idx[o + 2] = b + 2;
        idx[o + 3] = b;     idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    idx
}
```

> [!NOTE]
> The normal vectors are stored in the vertex buffer and declared in the WGSL vertex input struct at `@location(1)`, but the shader never reads them. They are present for structural compatibility with tools and validation layers that expect vertex buffers in the standard Helio format (position + normal + color), and are retained so the vertex stride remains a consistent 36 bytes.

---

## 4. Vertex Layout

Each vertex occupies exactly 36 bytes — three `[f32; 3]` fields packed contiguously with no padding, as guaranteed by `#[repr(C)]` on the `CubeVertex` struct. The pipeline vertex buffer layout declares this explicitly:

```rust
wgpu::VertexBufferLayout {
    array_stride: 36,
    step_mode:    wgpu::VertexStepMode::Vertex,
    attributes:   &[
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset:  0, shader_location: 0 }, // position
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset: 12, shader_location: 1 }, // normal
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset: 24, shader_location: 2 }, // color
    ],
}
```

| Attribute | Shader Location | Offset | Size | Format |
|---|---|---|---|---|
| `position` | 0 | 0 bytes | 12 bytes | `Float32x3` |
| `normal` | 1 | 12 bytes | 12 bytes | `Float32x3` |
| `color` | 2 | 24 bytes | 12 bytes | `Float32x3` |

All three attributes use full 32-bit floats with no packed formats and no 16-bit compression. For a 24-vertex debug cube the memory cost is negligible — the entire vertex buffer is 864 bytes — so there is no reason to sacrifice debuggability for compactness. Packed formats such as `Snorm8x4` would complicate inspection of raw buffer contents in a GPU debugger; `Float32x3` values are immediately readable as decimal floats in any capture tool.

The total buffer sizes are small enough to fit entirely in L1 cache on any modern GPU. The vertex buffer is 864 bytes and the index buffer is 72 bytes (36 `u16` values). Both are created with `DeviceExt::create_buffer_init` at construction time and never modified or reallocated.

---

## 5. The Shader

The WGSL shader is intentionally minimal. The vertex stage multiplies each position by the precomputed view-projection matrix and passes the vertex color through to the fragment stage unchanged. The fragment stage outputs that interpolated color with a fixed alpha of 1.0. There are no texture samples, no lighting calculations, no normal map lookups, and no uniform data beyond the camera matrices.

```wgsl
struct Camera {
    view:      mat4x4<f32>,   // bytes   0–63
    proj:      mat4x4<f32>,   // bytes  64–127
    view_proj: mat4x4<f32>,   // bytes 128–191
}

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal:   vec3<f32>,
    @location(2) color:    vec3<f32>,
}

struct VertexOutput {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0)       color:    vec3<f32>,
}

@vertex
fn vs_main(v: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.clip_pos = camera.view_proj * vec4(v.position, 1.0);
    out.color    = v.color;  // normal is declared but never read
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4(in.color, 1.0);  // pure vertex color, no lighting
}
```

The use of `view_proj` rather than `proj * view * model` is a deliberate simplification. The cube has no model matrix — it sits at the world origin, unit scale, no rotation — so the model matrix is identity and can be omitted entirely. Multiplying a `vec4` by a single precomputed `mat4x4` is the minimum possible transform cost.

The absence of lighting is also deliberate. Evaluating even a simple Lambertian term would require a light direction uniform, which would either come from a separate bind group resource (adding a dependency) or be hardcoded in the shader (obscuring what the pass is actually testing). The face colors are not meant to be physically realistic — they are orientation indicators. A pass that proves rendering infrastructure is working does not need to prove that a lighting model evaluates correctly; that is the job of the full deferred pipeline.

The `Camera` struct in the shader declares only the first 192 bytes of the real `CameraUniform` (which is 368 bytes and contains additional fields including inverse matrices, camera position, jitter, and previous-frame data). This is safe in wgpu: bind group layout validation checks that the bound buffer is at least as large as the declared struct, but does not require the buffer to end at that boundary. Any buffer of 192 bytes or more will satisfy the validation, and the full 368-byte `CameraUniform` buffer used by other passes trivially satisfies it. The shader reads exactly the three matrices it needs — `view`, `proj`, and `view_proj` — and accesses nothing beyond offset 191.

> [!TIP]
> The shader uses `view_proj` for the transform, not `proj` or `view` individually. If you inspect the shader in a GPU capture and the cube appears stretched or at the wrong depth, the camera buffer contents should be inspected first — specifically whether `view_proj` at bytes 128–191 has been correctly written before the draw is submitted.

---

## 6. Lazy Bind Group Reconstruction

The pass holds two fields related to the camera bind group: `bind_group: Option<wgpu::BindGroup>` and `bind_group_key: Option<usize>`. The key stores the raw pointer address of the `wgpu::Buffer` that was used to create the current bind group.

At the start of `execute()`, before any render pass commands, the current camera buffer address is compared against the stored key:

```rust
let camera_ptr = ctx.scene.camera as *const _ as usize;
if self.bind_group_key != Some(camera_ptr) {
    self.bind_group = Some(ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
        label:   Some("SimpleCube BG"),
        layout:  &self.bgl,
        entries: &[wgpu::BindGroupEntry {
            binding:  0,
            resource: ctx.scene.camera.as_entire_binding(),
        }],
    }));
    self.bind_group_key = Some(camera_ptr);
}
```

This pattern handles the case where the camera buffer is reallocated — for example, if an external system resizes the camera uniform buffer between frames. Because `wgpu::Buffer` is heap-allocated and its address is stable for the lifetime of the buffer object, a change in address is a reliable signal that the buffer was dropped and recreated. When the address matches, the check costs exactly one `usize` comparison per frame with no GPU interaction whatsoever.

The first frame always triggers a creation because `bind_group_key` starts as `None`. From the second frame onward, assuming the camera buffer is not reallocated (the common case), the bind group is reused with zero allocation cost.

> [!NOTE]
> This same pointer-address caching pattern is used in other Helio passes, including the deferred lighting pass, for resources that can be reallocated between frames. It is a consistent convention across the codebase rather than a one-off optimisation.

---

## 7. Pipeline State

The render pipeline is configured for standard opaque forward geometry. Back-face culling is enabled with counter-clockwise front-face winding, which is consistent with the vertex data's outward-wound quads. Depth testing uses `CompareFunction::Less` with depth writes enabled, writing to a `Depth32Float` attachment. The color target uses no blend state — `blend: None` — meaning the fragment output replaces the attachment pixel directly with no alpha compositing.

```rust
primitive: wgpu::PrimitiveState {
    topology:   wgpu::PrimitiveTopology::TriangleList,
    front_face: wgpu::FrontFace::Ccw,
    cull_mode:  Some(wgpu::Face::Back),
    ..Default::default()
},
depth_stencil: Some(wgpu::DepthStencilState {
    format:              wgpu::TextureFormat::Depth32Float,
    depth_write_enabled: true,
    depth_compare:       wgpu::CompareFunction::Less,
    stencil:             wgpu::StencilState::default(),
    bias:                wgpu::DepthBiasState::default(),
}),
```

The color attachment format is `surface_format`, passed as a constructor argument. This is the actual swapchain format reported by `wgpu::Surface::get_capabilities()` and selected by the application. By using the real surface format rather than a hardcoded assumption, the pass correctly handles the full range of formats that different platforms and drivers report — including `Bgra8Unorm`, `Rgba8Unorm`, and their `Srgb` variants.

The clear color is `Color { r: 0.01, g: 0.01, b: 0.02, a: 1.0 }` — near-black with a slight blue tint. This is not an arbitrary choice: a pure black clear `(0.0, 0.0, 0.0)` is indistinguishable from a frame that was never cleared at all, or from a completely transparent surface. The faint blue tint makes a correctly-cleared frame visually distinct from a missing clear, even on monitors with poor black-level reproduction. The depth attachment is cleared to 1.0, representing the far plane, so all geometry passes the initial depth test before any writes occur.

| State | Value |
|---|---|
| Topology | `TriangleList` |
| Front face | `CCW` |
| Cull mode | `Back` |
| Depth format | `Depth32Float` |
| Depth compare | `Less` |
| Depth write | Enabled |
| Blend | None (opaque) |
| Color format | `surface_format` (runtime) |
| Color clear | `(0.01, 0.01, 0.02, 1.0)` |
| Depth clear | `1.0` |

---

## 8. Using SimpleCubePass for Diagnosis

The pass is most useful as a targeted probe for specific infrastructure failures. Each scenario below describes a concrete failure mode that `SimpleCubePass` can confirm or rule out.

**Device and instance validation.** Replace the active render graph with a graph containing only `SimpleCubePass`. If a cube appears, the wgpu instance, adapter, device, surface, and queue are all functional. If it does not appear, the failure is in the infrastructure layer — device creation, adapter selection, or surface configuration — rather than in any pass logic.

**Surface format validation.** The pass is constructed with the live `surface_format` value. If `device.create_render_pipeline()` returns without error and the cube renders, the surface format is correctly identified and supported by the current driver. If pipeline creation panics, the format is unsupported or the surface capabilities were read incorrectly.

**Depth buffer verification.** The pass clears depth to 1.0 and writes depth values for every cube fragment. If subsequent passes in a multi-pass graph exhibit z-fighting or incorrect depth test results, inserting `SimpleCubePass` before them and inspecting its depth attachment in a GPU capture (such as RenderDoc) confirms whether depth is being cleared to the correct value and whether the `Depth32Float` format is behaving as expected.

**Shader compilation check.** The WGSL is ten lines with no extensions, no complex types, and no feature dependencies. If `create_shader_module()` fails for `simple_cube.wgsl`, there is a fundamental problem with the WGSL compiler in the current wgpu version or driver — a finding that immediately scopes the investigation away from application logic.

**Performance floor measurement.** `SimpleCubePass` performs exactly one render pass begin, one depth clear, one color clear, one indexed draw call of 36 indices, and one render pass end. Its GPU time is the absolute minimum overhead for a single-draw render pass on the current device. Any other pass whose measured GPU time is less than this baseline by more than its expected geometric cost has an unexpected overhead source worth investigating.

> [!TIP]
> In RenderDoc, the `SimpleCube` label is applied to the render pass, the pipeline, the vertex buffer, and the index buffer. Searching for "SimpleCube" in the resource list immediately surfaces all relevant GPU objects for inspection.

---

## 9. Minimal RenderGraph Example

The following is the complete code required to bring up a working Helio renderer that displays a cube. This is the "hello triangle" equivalent for Helio — the starting point for any new platform bring-up or wgpu version upgrade:

```rust
use helio_v3::{RenderGraph, Renderer};
use helio_pass_simple_cube::SimpleCubePass;

let pass = SimpleCubePass::new(&device, surface_format);
let mut graph = RenderGraph::new();
graph.add_pass(pass);
renderer.set_graph(graph);
```

The pass is constructed with references to the `wgpu::Device` and the `wgpu::TextureFormat` of the swapchain surface. After `new()` returns, the pass owns its vertex buffer, index buffer, bind group layout, and render pipeline — all fully initialised and ready to draw. `RenderGraph::add_pass` moves the pass into the graph. `renderer.set_graph` activates the graph, and from the next frame forward every call to `renderer.render()` will produce a frame showing the cube.

When the cube is confirmed visible, the diagnostic phase is complete. The graph can then be replaced with the full production pipeline, confident that all infrastructure it depends on is functional.

> [!NOTE]
> `SimpleCubePass::prepare()` is a no-op that returns `Ok(())` immediately. The pass does not need to be driven by any scene preparation step, and it does not call `queue.write_buffer()` on any frame. The camera buffer is read-only from the pass's perspective — it writes the bind group reference once (on first use or after buffer reallocation) and reads the buffer contents on the GPU side only.
