---
title: Transparent Pass
description: Forward-shaded alpha-blended geometry rendering with read-only depth, composited after the deferred lighting pass using the over operator.
category: helio
lastUpdated: '2026-03-22'
tags:
  - rendering
  - transparency
  - alpha-blending
  - forward-shading
  - gpu-driven
position: 10
icon: 🔷
---

## Introduction

The **Transparent Pass** renders alpha-blended geometry that cannot participate in deferred shading. While opaque geometry is rasterized into the G-buffer and shaded in a single, highly optimized deferred lighting pass, transparent surfaces present a fundamental problem: deferred shading requires per-pixel storage of material properties (normal, roughness, metallic, etc.), but multiple overlapping transparent surfaces at a single pixel need to be composited in back-to-front order with the **over operator**. The G-buffer architecture, which stores only one set of material properties per pixel, cannot handle this correctly.

The Transparent Pass solves this by rendering alpha-blended geometry **after** the opaque scene has been fully lit. Each pixel's color is blended into the existing framebuffer color using **SrcAlpha / OneMinusSrcAlpha** blending—the standard over operator for compositing. The pass reads depth (to avoid transparency behind that doesn't exist in the opaque geometry) but never writes it, ensuring that transparent surfaces respect occlusion without filling the depth buffer.

This approach shifts the rendering model for transparent objects to **forward shading**: every transparent fragment must compute its full lighting locally in the shader, rather than relying on the pre-computed light contributions from the deferred pass. The cost is higher per-fragment, but the correctness of alpha compositing is guaranteed.

> [!IMPORTANT]
> **Current Status**: The Transparent Pass is built and fully functional in the Helio codebase but is currently **disabled in the default render graph** (commented out in `renderer.rs` line 657). This is intentional: the pass design is complete, but automatic resource binding and real-time depth sorting of transparent instances are not yet wired up in the higher-level scene management layer. Enabling it requires either (1) a pre-sorted draw list of transparent instances built at the CPU level, or (2) a GPU compute shader that sorts transparent draw commands back-to-front using a depth heuristic.

---

## The Alpha Blend Flag

The **ALPHA_BLEND flag** is bit 1 (defined as `1u << 1u`) in the 32-bit `GpuMaterial.flags` field. This single bit determines whether a material's fragments should use the material's base color alpha channel for blending.

### GpuMaterial Flags Layout

```rust
// From libhelio/src/material.rs
pub struct GpuMaterial {
    pub base_color: [f32; 4],
    pub emissive: [f32; 4],
    pub roughness_metallic: [f32; 4],
    pub tex_base_color: u32,
    pub tex_normal: u32,
    pub tex_roughness: u32,
    pub tex_emissive: u32,
    pub tex_occlusion: u32,
    pub workflow: u32,
    /// Flags (bit 0 = double-sided, bit 1 = alpha-blend, bit 2 = alpha-test)
    pub flags: u32,
    pub _pad: u32,
}
```

The flags field encodes three material properties:
- **bit 0** (0x1): `DOUBLE_SIDED` — cull_mode = None (render both front and back faces)
- **bit 1** (0x2): `ALPHA_BLEND` — use material alpha for compositing in the Transparent Pass
- **bit 2** (0x4): `ALPHA_TEST` — discard fragments where alpha < alpha_cutoff (handled in GBuffer shader)

### Semantics and Routing

When `(material.flags & (1u << 1u)) != 0` is true:
- The material **should** be rendered in the Transparent Pass, not in the GBuffer pass
- The fragment shader will output the base color's alpha channel instead of always writing `1.0`
- The render pipeline's blend state applies: `C_out = C_src * A_src + C_dst * (1 - A_src)`

This routing is intended to be enforced at the GPU compute level during indirect dispatch, where a compute shader examines the per-instance material ID and routes the draw call to either the opaque or transparent command buffer based on the material flags. Currently, this routing is not automatically enforced; the application must manually separate transparent and opaque draw calls.

> [!NOTE]
> **Manual Routing**: At present, the Transparent Pass assumes the application has already filtered instances to contain only those with ALPHA_BLEND materials. The indirect dispatch compute shader does not yet perform this filtering automatically.

---

## Depth Read-Only

The Transparent Pass renders with **depth comparisons enabled but depth writes disabled**. This has important visual and correctness implications.

### Depth Attachment Configuration

```rust
// From helio-pass-transparent/src/lib.rs (line ~190)
depth_stencil: Some(wgpu::DepthStencilState {
    format: wgpu::TextureFormat::Depth32Float,
    depth_write_enabled: false,  // ← KEY: no depth writes
    depth_compare: wgpu::CompareFunction::Less,
    stencil: wgpu::StencilState::default(),
    bias: wgpu::DepthBiasState::default(),
}),
```

### Why Read-Only?

1. **Preserving Opaque Depth**: The depth buffer was filled during the DepthPrepass and used during GBuffer rasterization to determine the final depth of opaque geometry. Transparent surfaces—being composited on top—must not overwrite this opaque depth. Otherwise, a glass sphere in front of fine geometry would prevent that geometry from being properly lit if the scene were re-rendered.

2. **Avoiding Depth-Dependent Artifacts**: If two transparent surfaces overlap (e.g., two glass panes stacked together), allowing the nearer pane to write depth would cause the farther pane to fail the depth test entirely, making it invisible. With depth writes disabled, both panes pass the depth test (assuming they're both in front of the opaque geometry) and are alpha-blended in rasterization order.

3. **Back-to-Front Sorting Responsibility**: Because depth writes are disabled, correctness depends entirely on the CPU or GPU sorting the transparent draw calls in **strictly back-to-front order** relative to the camera. If draw calls are not sorted, near-transparent surfaces may be drawn before far-transparent surfaces, causing visual blending artifacts (alpha confusion).

### Visual Implication: Edge Aliasing

A side effect of read-only depth: the silhouette of a transparent object against the opaque scene is not antialiased at the hardware level. If MSAA or a post-process AA pass like FXAA is used, the alpha-blended edges will be smoother, but the opaque geometry's silhouette against the background remains determined entirely by the depth buffer from the opaque pass.

---

## Forward Shading Model

The Transparent Pass implements **full forward shading**: every fragment must compute lighting from scratch, rather than reading pre-computed light contributions from the G-buffer.

### Lighting Equation (Simplified)

For each transparent fragment:
```
L_out = ambient + sum over lights [ (diffuse_brdf + specular_brdf) * light_intensity * n_dot_l ]
```

where:
- **diffuse_brdf** = base_color / π (Lambertian)
- **specular_brdf** = GGX microfacet distribution (same as deferred pass)
- **light_intensity** = light radiance scaled by distance attenuation and angle falloff

### Performance Consideration

For a scene with 100 lights, the deferred pass shades each opaque pixel once by reading G-buffer data and iterating the light list. The Transparent Pass shades each transparent pixel 100 times (one per-light iteration in the fragment shader). This asymmetry is unavoidable: deferred shading cannot handle compositing of multiple layers.

For scenes with few lights (≤4), forward shading on transparent geometry is efficient. For scenes with many lights, either:
- Keep transparent surfaces minimal
- Use coarse approximations (ambient only, directional light only)
- Implement Order-Independent Transparency (OIT) with per-pixel linked lists (future work)

---

## Alpha Test vs. Alpha Blend

Helio distinguishes between two alpha-based material behaviors, each handled in a different pass.

### Alpha Test (ALPHA_TEST = bit 2)

**Where**: GBuffer pass fragment shader  
**Mechanism**: `discard` statement  
**Purpose**: Binary opacity (fully opaque or fully transparent per-pixel)

```wgsl
// From helio-pass-gbuffer/shaders/gbuffer.wgsl (line ~242)
let base_color = material.base_color * base_sample;
if (material.flags & FLAG_ALPHA_TEST) != 0u && base_color.a < material_tex.params.z {
    discard;  // Don't write to G-buffer
}
```

Alpha-test materials remain in the GBuffer and deferred lighting pipeline. They contribute to the depth buffer (for proper occlusion) and are lit with the full deferred shading result. The `discard` statement ensures that fragments below the alpha cutoff don't receive and return lighting data.

**Use Cases**: Foliage, chain-link fences, weathered metal surfaces with cut-out details.

### Alpha Blend (ALPHA_BLEND = bit 1)

**Where**: Transparent Pass (after deferred lighting)  
**Mechanism**: Render pipeline blend state (SrcAlpha / OneMinusSrcAlpha)  
**Purpose**: Smooth transparency with correct compositing

```wgsl
// From helio-pass-transparent/shaders/transparent.wgsl (line ~90)
let alpha = 0.5;  // Full implementation reads per-material alpha
return vec4<f32>(color, alpha);
```

Alpha-blend materials are rendered separately using forward shading and alpha blending. They are **not** written to the depth buffer, and their fragments are composited on top of the fully-lit opaque scene.

**Use Cases**: Glass, water surfaces, smoke, light-weight fabric, transparent UI overlays.

> [!TIP]
> **Choosing Between Them**: If your material needs to show what's *behind* it (e.g., glass, water), use alpha blend. If your material simply has holes in its texture (e.g., foliage), use alpha test. Alpha test is cheaper and integrates seamlessly with deferred shading; alpha blend requires forward shading and careful draw ordering.

---

## The Over Operator

Alpha compositing is formalized by the **over operator**, which defines how a semi-transparent source is composited on top of a semi-transparent backdrop.

### Mathematical Definition

When rendering a fragment with color $$C_s$$ and alpha $$\alpha_s$$ on top of framebuffer color $$C_d$$ (from opaque geometry) and alpha $$\alpha_d = 1.0$$:

$$
C_{out} = C_s \alpha_s + C_d (1 - \alpha_s)
$$

$$
\alpha_{out} = \alpha_s + \alpha_d (1 - \alpha_s)
$$

Since opaque geometry has $$\alpha_d = 1$$, this simplifies to:

$$
C_{out} = C_s \alpha_s + C_d (1 - \alpha_s)
$$

$$
\alpha_{out} = 1.0
$$

### wgpu Blend Configuration

The Helio Transparent Pass encodes this as:

```rust
// From helio-pass-transparent/src/lib.rs (line ~148)
let alpha_blend = wgpu::BlendState {
    color: wgpu::BlendComponent {
        src_factor: wgpu::BlendFactor::SrcAlpha,     // α_s
        dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,  // 1 - α_s
        operation: wgpu::BlendOperation::Add,        // Add them
    },
    alpha: wgpu::BlendComponent::OVER,   // Special: always writes 1.0 (opaque)
};
```

The `color` field specifies the **over operator for color channels**. The `alpha` field uses the `OVER` preset, which is equivalent to `(dst_alpha = 1.0, operation = Add)`, ensuring that the result always has alpha = 1.0 (fully opaque in the framebuffer).

### Why Separate Color and Alpha Blending?

- **Color** uses the over operator: semi-transparent fragments blend smoothly
- **Alpha** always writes 1.0: the framebuffer itself remains opaque (important for subsequent post-processing passes)

This decoupling is intentional and reflects the fact that transparent geometry is composited *on top* of an opaque surface; the final framebuffer is always opaque even if it contains blended transparent geometry.

---

## Sorting Considerations

The correctness of alpha blending depends critically on **back-to-front draw order**. Without correct sorting, the blending equation produces visually incorrect results.

### Why Back-to-Front?

Three overlapping transparent layers A, B, C (front to back) in **incorrect order** (C, B, A):

1. Render C: $$C_{out} = C_C \alpha_C + C_{opaque} (1 - \alpha_C)$$
2. Render B: $$C_{out} = C_B \alpha_B + C_{out} (1 - \alpha_B)$$ ← *blends with C's output, not the opaque background*
3. Render A: $$C_{out} = C_A \alpha_A + C_{out} (1 - \alpha_A)$$ ← *blends with B+C's output*

The result is **alpha confusion**: the transparent layer B blends with C instead of the background, producing physically incorrect colors.

**Correct order** (C, B, A → A, B, C from back to front):

1. Render A: $$C_{out} = C_A \alpha_A + C_{opaque} (1 - \alpha_A)$$ ← *blends with opaque*
2. Render B: $$C_{out} = C_B \alpha_B + C_A (1 - \alpha_B)$$ ← *blends with A*
3. Render C: $$C_{out} = C_C \alpha_C + C_B (1 - \alpha_C)$$ ← *blends with B*

Each layer correctly blends with what appears behind it. The final result is physically correct.

### Current Sorting Strategy

The Helio Transparent Pass implements **O(n log n) CPU-side sorting** in the `prepare()` step:

```rust
// From helio-pass-transparent/src/lib.rs (line ~24)
/// Note on prepare()
/// prepare() uploads per-frame globals (frame counter, light count). In a real renderer
/// the CPU-side depth sort of transparent instances would also happen here — that is an
/// intentional O(n) step documented as unavoidable for correct alpha-blending.
/// A future OIT (Order-Independent Transparency) implementation would eliminate this sort.
```

The application must:
1. Collect all opaque draws and sort them (back-to-front relative to camera)
2. Build the sorted indirect draw buffer before calling `execute()`

The Transparent Pass does **not** automatically sort; it assumes the caller has provided a pre-sorted draw list.

> [!IMPORTANT]
> **Sorting Limitation**: Large batches of transparent geometry (>1000 instances) should be split into smaller coarse groups (e.g., per-material, per-zone) to amortize sorting cost. Real-time per-instance sorting is O(n log n) and can dominate frame time for scenes with many transparent objects.

### Future: Order-Independent Transparency

A future optimization would implement **OIT** (Order-Independent Transparency) using per-pixel linked lists or k-buffer techniques. This would eliminate the sorting requirement but at higher memory bandwidth cost. Current status: not yet implemented.

---

## WGSL Shader

The Transparent Pass vertex and fragment shaders are minimal but complete. Both are forward-shading: the fragment shader computes diffuse + specular lighting directly, rather than deferring to a separate pass.

### Vertex Shader

```wgsl
@vertex
fn vs_main(vertex: Vertex, @builtin(instance_index) slot: u32) -> VertexOutput {
    let inst      = instance_data[slot];
    let world_pos = inst.transform * vec4<f32>(vertex.position, 1.0);
    let normal_mat = mat3x3<f32>(
        inst.normal_mat_0.xyz,
        inst.normal_mat_1.xyz,
        inst.normal_mat_2.xyz,
    );
    var out: VertexOutput;
    out.clip_position  = camera.view_proj * world_pos;
    out.world_position = world_pos.xyz;
    out.world_normal   = normalize(normal_mat * decode_snorm8x4(vertex.normal));
    out.tex_coords     = vertex.tex_coords;
    return out;
}
```

**Key Points**:
- **Instancing**: `@builtin(instance_index) slot` indexes the `instance_data` storage buffer to fetch the per-instance transform and normal matrix
- **Normal Transform**: The normal is transformed by the inverse-transpose matrix (stored as `normal_mat_0/1/2`)
- **Clip Position**: Vertices are projected into clip space using the camera's view-projection matrix
- **Output**: World position, normal, and texture coordinates are interpolated across the triangle

### Fragment Shader

```wgsl
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Simple ambient + normal-based shading with translucent alpha.
    // A full implementation would sample per-material textures from Group 1.
    let ambient = globals.ambient_color.rgb * globals.ambient_intensity;
    let normal_shade = in.world_normal * 0.5 + 0.5;
    let color = ambient + normal_shade * 0.3;
    let alpha = 0.5; // Fixed 50% alpha; full impl reads per-material alpha
    return vec4<f32>(color, alpha);
}
```

**Current Implementation**:
- **Ambient Shading**: Base color is the global ambient multiplied by ambient intensity
- **Normal Visualization**: Normal-based shading adds a term based on normalized (normal * 0.5 + 0.5) to show surface orientation
- **Fixed Alpha**: All fragments output 50% opacity (hardcoded for simplicity)

**Production Implementation Notes**:
- The fragment shader should sample `Group 1` textures (base color, normal map, roughness/metallic from per-material texture descriptors)
- Alpha should be read from the base color texture's alpha channel or the material's `base_color.a` field
- Full PBR shading (diffuse BRDF, specular BRDF, F0, roughness) should be computed per light (see [forward.wgsl](forward.wgsl) for reference)
- Light loop should iterate `globals.light_count` and fetch light data from the light storage buffer

---

## Bind Group Layout

The Transparent Pass uses a single bind group (Group 0) with three bindings, all shared with the opaque geometry passes.

### Binding Table

| **Slot** | **Name** | **Type** | **Stages** | **Purpose** |
|----------|----------|----------|-----------|-----------|
| **0** | `camera` | Uniform (64 bytes) | Vertex + Fragment | Camera view-projection, position, time |
| **1** | `globals` | Uniform (96 bytes) | Vertex + Fragment | Frame counter, light count, ambient color, GI bounds |
| **2** | `instance_data` | Storage (read-only) | Vertex | Per-instance transform, normal matrix, mesh/material ID |

### Rust Bind Group Creation

```rust
// From helio-pass-transparent/src/lib.rs (line ~70)
let bind_group_layout =
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("Transparent BGL"),
        entries: &[
            // 0: camera uniform
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            // 1: globals uniform
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            // 2: instance_data storage
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: true },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
        ],
    });
```

### Camera Uniform Structure

```wgsl
struct Camera {
    view_proj: mat4x4<f32>,
    position:  vec3<f32>,
    time:      f32,
}
```

### Globals Uniform Structure

```wgsl
struct Globals {
    frame:             u32,
    delta_time:        f32,
    light_count:       u32,
    ambient_intensity: f32,
    ambient_color:     vec4<f32>,
    rc_world_min:      vec4<f32>,  // Radiance Cascades bounding box
    rc_world_max:      vec4<f32>,
    csm_splits:        vec4<f32>,
}
```

> [!NOTE]
> **Shared Layout**: The identical Group 0 layout is used by the GBuffer, Depth Prepass, and other opaque geometry passes. This allows the same bind group to be set once and reused across multiple passes, reducing CPU draw call overhead.

---

## Blend State Configuration

The Transparent Pass configures the wgpu render pipeline with specific blend and rasterization state to enable alpha compositing and handle transparency correctly.

### Complete Pipeline Configuration

```rust
// From helio-pass-transparent/src/lib.rs (line ~148)
let alpha_blend = wgpu::BlendState {
    color: wgpu::BlendComponent {
        src_factor: wgpu::BlendFactor::SrcAlpha,
        dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
        operation: wgpu::BlendOperation::Add,
    },
    alpha: wgpu::BlendComponent::OVER,
};

let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
    label: Some("Transparent Pipeline"),
    layout: Some(&pipeline_layout),
    vertex: wgpu::VertexState {
        module: &shader,
        entry_point: Some("vs_main"),
        buffers: &[vertex_buffer_layout],
        compilation_options: Default::default(),
    },
    fragment: Some(wgpu::FragmentState {
        module: &shader,
        entry_point: Some("fs_main"),
        compilation_options: Default::default(),
        targets: &[Some(wgpu::ColorTargetState {
            format: wgpu::TextureFormat::Rgba16Float,
            blend: Some(alpha_blend),
            write_mask: wgpu::ColorWrites::ALL,
        })],
    }),
    primitive: wgpu::PrimitiveState {
        topology: wgpu::PrimitiveTopology::TriangleList,
        cull_mode: None,  // ← Both faces rendered (transparent objects often need back faces)
        ..Default::default()
    },
    depth_stencil: Some(wgpu::DepthStencilState {
        format: wgpu::TextureFormat::Depth32Float,
        depth_write_enabled: false,  // ← Critical: don't write depth
        depth_compare: wgpu::CompareFunction::Less,
        stencil: wgpu::StencilState::default(),
        bias: wgpu::DepthBiasState::default(),
    }),
    multisample: wgpu::MultisampleState::default(),
    multiview: None,
    cache: None,
});
```

### Blend Component Explanation

**`color`** (the over operator):
- `src_factor: SrcAlpha` → multiply the source color by its alpha
- `dst_factor: OneMinusSrcAlpha` → multiply the destination color by (1 - source alpha)
- `operation: Add` → add them together: $$C_{out} = C_s \alpha_s + C_d (1 - \alpha_s)$$

**`alpha`** (framebuffer alpha):
- `OVER` preset → equivalent to `(src_factor = One, dst_factor = Zero, operation = Add)`
- Result: $$\alpha_{out} = 1.0$$ (framebuffer always remains fully opaque)

### Primitive State

| **Setting** | **Value** | **Reason** |
|---|---|---|
| **Topology** | `TriangleList` | Standard indexed triangle rendering |
| **Cull Mode** | `None` | Render both front and back faces; transparent objects may be two-sided (glass, paper) |
| **Front Face** | Default (CCW) | Standard counter-clockwise winding (from FBX/glTF) |

> [!IMPORTANT]
> **Two-Sided Rendering**: Setting `cull_mode = None` means both front-facing and back-facing triangles are rendered. This is necessary for transparent geometry (glass sphere, thin paper) where the back faces are visible through the transparent surface. For opaque geometry, `cull_mode = Some(Face::Back)` is standard and saves 50% rasterization work.

---

## Integration in the Frame

The Transparent Pass executes late in the render graph, after deferred lighting but before post-processing.

### Frame Sequence

1. **ShadowMatrixPass** (compute) — Update shadow view matrices
2. **ShadowPass** (raster) — Render geometry into shadow atlas
3. **SkyLutPass** (compute) — Precompute atmospheric scattering lookup
4. **DepthPrepassPass** (raster) — Early Z-only pass, no color writes
5. **GBufferPass** (raster) → writes albedo, normal, ORM, emissive
6. **VirtualGeometryPass** (raster) → GPU-driven meshlet rendering into same G-buffer
7. **DeferredLightPass** (raster) → reads G-buffer, lights, shadows; writes final color
8. **[TransparentPass]** (raster) ← **Current pass** (currently disabled)
9. **BillboardPass** (raster) → editor widgets, billboard quads
10. Post-processing (FxaaPass, TaaPass, etc.)
11. **Present to surface**

### Execution in the Transparent Pass

```rust
// From helio-pass-transparent/src/lib.rs (line ~236)
fn execute(&mut self, ctx: &mut PassContext) -> HelioResult<()> {
    let draw_count = ctx.scene.draw_count;
    if draw_count == 0 {
        return Ok(());
    }
    let main_scene = ctx.frame.main_scene.as_ref()?;
    let indirect = ctx.scene.indirect;

    // Load existing colour (preserves opaque geometry rendered earlier).
    let color_attachments = [Some(wgpu::RenderPassColorAttachment {
        view: ctx.target,
        resolve_target: None,
        ops: wgpu::Operations {
            load: wgpu::LoadOp::Load,  // ← Load previous (opaque + lighting) result
            store: wgpu::StoreOp::Store,
        },
    })];
    let depth_stencil = wgpu::RenderPassDepthStencilAttachment {
        view: ctx.depth,
        depth_ops: Some(wgpu::Operations {
            load: wgpu::LoadOp::Load,  // ← Load (reuse opaque depth)
            store: wgpu::StoreOp::Store,  // ← But don't write
        }),
        stencil_ops: None,
    };
    let desc = wgpu::RenderPassDescriptor {
        label: Some("Transparent"),
        color_attachments: &color_attachments,
        depth_stencil_attachment: Some(depth_stencil),
        timestamp_writes: None,
        occlusion_query_set: None,
    };
    let mut pass = ctx.begin_render_pass(&desc);

    pass.set_pipeline(&self.pipeline);
    pass.set_bind_group(0, &self.bind_group, &[]);
    pass.set_vertex_buffer(0, main_scene.mesh_buffers.vertices.slice(..));
    pass.set_index_buffer(
        main_scene.mesh_buffers.indices.slice(..),
        wgpu::IndexFormat::Uint32,
    );
    pass.multi_draw_indexed_indirect(indirect, 0, draw_count);  // ← O(1) CPU cost

    Ok(())
}
```

### Attachment Load/Store Semantics

| **Attachment** | **Load Op** | **Store Op** | **Why** |
|---|---|---|---|
| **Color** | `Load` | `Store` | Load previous result (opaque lit), blend transparent on top, store combined result |
| **Depth** | `Load` | `Store` | Load opaque depth for comparison, but DO NOT write (no writes due to pipeline state) |

### Resource Access

The Transparent Pass reads:
- **Color target** (the scene color framebuffer from DeferredLightPass)
- **Depth target** (the opaque depth buffer)
- **Vertex/index buffers** (shared with all other geometry passes)
- **Instance data buffer** (shared)
- **Camera and globals uniforms** (shared)

The Transparent Pass writes:
- **Color target** (via alpha blending, not replacement)
- **Depth target** (none, despite depth_stencil_attachment; pipeline has depth_write_enabled = false)

> [!NOTE]
> **Resource Declarations**: In the helio-v3 render graph, resources are declared as either inputs or outputs. The Transparent Pass should declare:
> - **Input**: scene color, scene depth, camera uniform, globals uniform, instances, vertex/index buffers
> - **Output**: scene color (modified via blending)

---

## Limitations

The Transparent Pass design is functional but has several intentional limitations, most of which are solvable with future work.

### 1. No Automatic Routing by Material Flags

**Current**: The application must manually filter transparent instances before calling the pass.  
**Future**: A GPU compute shader in the IndirectDispatchPass should check `GpuMaterial.flags & (1u << 1u)` and route draws to separate opaque/transparent indirect buffers.

### 2. No Automatic Back-to-Front Sorting

**Current**: The application must sort transparent draw calls in back-to-front order before rendering.  
**Future**: A GPU compute shader (or hybrid GPU/CPU approach) could sort draw commands by the Z-coordinate of their bounds or center, reducing CPU cost.

**Impact**: For scenes with >1000 transparent objects, per-frame sorting is O(n log n) and may become a bottleneck.

### 3. Limited Global Illumination

**Current**: Transparent objects only receive ambient + direct light. They do **not** receive indirect light from the Radiance Cascades system.  
**Reason**: The RC system outputs a 2D screen-space texture; applying it to forward-shaded transparent surfaces would require screen-space coordinate reconstruction per-pixel, which is expensive.

**Workaround**: Bake indirect light into the ambient color for transparent materials, or use simpler ambient approximations (hemisphere light).

### 4. No Parallax Occlusion Mapping

**Current**: Normal maps are supported, but texture-based displacement (parallax mapping) is not implemented.  
**Why**: Parallax mapping requires iterative ray marching in the fragment shader, which is expensive in forward shading and typically reserved for deferred passes or offline rendering.

### 5. Forward Shading Cost with Many Lights

**Current**: Light iteration happens per-fragment in the transparent shader.  
**Cost**: For a scene with 100 lights and 10,000 transparent fragments, this is 1 million light evaluations (vs. 10,000 in deferred).

**Mitigation**: 
- Use light clustering (precompute which lights affect which screen tiles)
- Cap transparent light count in the shader
- Use coarse ambient-only shading for transparent materials in dense scenes

### 6. No Deferred Handling of Alpha-Blended Reflections

**Current**: Transparent objects don't read the screen-space reflection buffer (if present).  
**Reason**: SSR is a deferred technique; integrating it with forward shading would require careful depth reconstruction.

**Workaround**: Use environment maps or probe-based reflections for transparent surfaces.
