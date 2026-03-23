---
title: Hi-Z Build Pass
description: Hierarchical depth pyramid construction — building a conservative max-depth mip chain from the scene depth buffer for GPU occlusion culling
category: helio
lastUpdated: '2026-03-23'
tags:
  - culling
  - hierarchical-z
  - depth
  - compute
  - occlusion
position: 16
icon: '🔭'
---

The `HiZBuildPass` constructs Helio's hierarchical depth pyramid — a compact multi-resolution representation of the scene's depth buffer where each mip level stores the maximum depth within its 2×2 footprint in the level above. This pyramid is the cornerstone of Helio's GPU occlusion culling system, and understanding its design requires understanding the problem it was built to solve.

Traditional occlusion culling — testing each object in the scene to determine whether it is hidden behind other geometry — is a straightforward problem in concept and an expensive one in practice. The brute-force approach queries the depth buffer on the CPU, comparing each object's bounding volume against the depths stored for its projected screen region. At 100 000 scene objects, this means 100 000 CPU-side depth buffer reads, each incurring the latency of a GPU readback, per frame. That cost grows linearly with scene complexity and defeats every other optimisation in the pipeline. The Hi-Z pyramid moves the depth test entirely to the GPU, where it can be parallelised across all scene instances simultaneously with no CPU iteration and no GPU-to-CPU readback.

---

## 1. The Hierarchical Depth Pyramid

A Hi-Z pyramid is a standard mip chain applied to a depth texture, with one critical difference from colour mip chains: instead of averaging the four source texels, each destination texel stores their **maximum**. The resulting pyramid has the property that any texel at mip level M contains the maximum depth within a 2^M × 2^M pixel region of the base depth buffer.

This maximum-reduction property is what makes the pyramid useful for occlusion testing. When the [Occlusion Cull Pass](./occlusion-cull) projects a scene object's bounding volume into screen space, it produces a screen-space rectangle. By selecting the pyramid level whose texel size approximately matches the footprint of that rectangle, the pass can test the entire object's occlusion with a **single texture sample**. If the maximum depth anywhere in that screen region is smaller than the object's nearest depth, the object is provably fully hidden.

```
Base level (full resolution):
┌────┬────┬────┬────┐
│0.3 │0.5 │0.7 │0.9 │
├────┼────┼────┼────┤      Mip 1 (half resolution, max reduction):
│0.4 │0.6 │0.8 │0.2 │      ┌────┬────┐
├────┼────┼────┼────┤  →   │0.6 │0.9 │
│0.1 │0.2 │0.3 │0.4 │      ├────┼────┤
├────┼────┼────┼────┤      │0.3 │0.7 │
│0.2 │0.3 │0.6 │0.7 │      └────┴────┘
└────┴────┴────┴────┘
```

A bounding volume whose projected screen footprint covers the entire left half of this example (texels in column 0–1) would sample mip 1 at the left texel, reading `0.6`. If the object's minimum depth is `0.7`, the test `0.7 > 0.6` is false — the object is not occluded. If the minimum depth were `0.8`, the test `0.8 > 0.6` is true — the object is fully behind the geometry in that region and its draw call can be suppressed.

---

## 2. Why Maximum Depth

The choice of maximum (rather than minimum, average, or any other reduction) is not arbitrary. It follows directly from the semantics of the occlusion test.

An object is considered occluded only when **all** of it is behind the existing occluders. Proving this requires a conservative upper bound on the depth of every occluder within the object's screen footprint. The maximum depth value in a region is exactly that upper bound: it is the depth of the farthest visible surface within that region. If the object's nearest point (minimum projected depth) is still farther from the camera than this maximum occluder depth, then no part of the object can be closer to the camera than any occluder — the object is completely hidden.

Using minimum depth would be wrong: a minimum-depth pyramid stores the closest surface in each region. Testing against the minimum would only guarantee occlusion if the entire object were behind the closest occluder, which is a much stricter condition that misses many valid occlusion opportunities. Using average depth would be neither conservative nor correct in either direction — it could both falsely cull visible objects and fail to cull genuinely occluded ones.

> [!IMPORTANT]
> Helio's depth convention follows wgpu and Vulkan: `0.0` represents the near plane and `1.0` represents the far plane. This means that a **higher** depth value corresponds to a surface **farther** from the camera. The max-reduction pyramid therefore stores the farthest surface in each region, and the occlusion test passes (object is culled) when the object's nearest depth is **greater than** the pyramid sample — the object is farther than the farthest occluder in the region.

The R32Float texture format is chosen for the pyramid rather than the hardware Depth32Float format because the computation pass writes each mip level as a storage texture. The wgpu storage texture access mode requires an explicit format, and R32Float matches the precision of the source depth values without any loss of range. The consequence is that the initial base level of the pyramid is populated by copying (or re-reading) the depth buffer rather than reading the hardware depth attachment directly — a design detail that keeps the pipeline portable across all wgpu backends.

---

## 3. The Mip Chain

The number of pyramid levels is determined at construction time by the render target dimensions. For a viewport of width `W` and height `H`, the mip count is:

$$
\text{mip\_count} = \min\!\left(\left\lfloor \log_2(\max(W, H)) \right\rfloor + 1,\; \text{MAX\_MIP\_LEVELS}\right)
$$

The Rust implementation computes this without floating-point arithmetic using the `leading_zeros` instruction:

```rust
fn mip_levels(w: u32, h: u32) -> u32 {
    let max_dim = w.max(h);
    (u32::BITS - max_dim.leading_zeros()).max(1)
}
```

`u32::BITS - leading_zeros(n)` is equivalent to `floor(log2(n)) + 1` for all positive `n`. For a 1920×1080 viewport, `max_dim = 1920`, `leading_zeros(1920) = 21`, and `mip_count = 32 - 21 = 11`. For 4K (3840×2160), `mip_count = 12`, which exactly reaches the compile-time cap of `MAX_MIP_LEVELS = 12`.

The cap at 12 levels is deliberate. At 12 levels, the coarsest mip covers 2^12 = 4096 pixels per axis, which comfortably spans any practical render target up to 4K. Higher levels would require increasingly large workgroup dispatches for diminishing information value — a single texel at mip 12 already represents the entire viewport — and would consume additional GPU memory for minimal occlusion culling benefit.

### 3.1 The Compute Shader

The downsampling shader (`hiz_build.wgsl`) is a single entry point parameterised by a `HiZUniforms` buffer that specifies the source and destination mip dimensions:

```wgsl
struct HiZUniforms {
    src_size: vec2<u32>,
    dst_size: vec2<u32>,
}

@group(0) @binding(0) var<uniform> params:  HiZUniforms;
@group(0) @binding(1) var src_tex:          texture_2d<f32>;
@group(0) @binding(2) var dst_tex:          texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dst_coord = gid.xy;
    if any(dst_coord >= params.dst_size) { return; }

    let src_coord = dst_coord * 2u;
    let s00 = textureLoad(src_tex, vec2<i32>(src_coord), 0).r;
    let s10 = textureLoad(src_tex, vec2<i32>(min(src_coord + vec2<u32>(1u, 0u), params.src_size - 1u)), 0).r;
    let s01 = textureLoad(src_tex, vec2<i32>(min(src_coord + vec2<u32>(0u, 1u), params.src_size - 1u)), 0).r;
    let s11 = textureLoad(src_tex, vec2<i32>(min(src_coord + vec2<u32>(1u, 1u), params.src_size - 1u)), 0).r;
    textureStore(dst_tex, vec2<i32>(dst_coord), vec4<f32>(max(max(s00, s10), max(s01, s11)), 0.0, 0.0, 1.0));
}
```

Each thread is responsible for exactly one destination texel. It reads the four source texels in the 2×2 footprint corresponding to its output coordinate — `src_coord = dst_coord * 2` — and writes their maximum. The `min` clamping on the edge texels handles the case where the source dimension is odd: the last column or row is duplicated rather than read out-of-bounds, which is the correct conservative behaviour (repeating a value produces the same maximum as reading it once).

### 3.2 Workgroup Size

The `@workgroup_size(8, 8)` declaration means each workgroup consists of 64 threads arranged in an 8×8 tile. This specific size was chosen to match GPU memory access patterns and hardware execution widths simultaneously. An 8×8 tile reading from a 16×16 source region accesses memory in a spatially coherent block that is likely to fit in the texture L1 cache on most desktop GPU architectures, reducing the number of DRAM fetches per mip level. The 64-thread total workgroup size fills exactly one wavefront on AMD GCN and RDNA architectures and two warps on NVIDIA, both of which are efficient utilisation targets.

A smaller workgroup (e.g., 4×4 = 16 threads) would underutilise the hardware SIMD units, as 16 threads is less than one NVIDIA warp. A larger workgroup (e.g., 16×16 = 256 threads) would increase register pressure and potentially reduce occupancy when multiple workgroups compete for the same compute unit. The 8×8 choice sits at the practical optimum for 2D texture operations on current GPU hardware.

### 3.3 Per-Mip Bind Groups and Uniforms

The shader is bound once per mip transition using per-mip bind groups. Each bind group pairs one source mip view (binding 1, `texture_2d`) with one destination mip view (binding 2, `texture_storage_2d`), and a per-mip uniform buffer (binding 0) carrying the source and destination dimensions.

All bind groups and their corresponding uniform buffers are created at construction time in `HiZBuildPass::new()`. The uniform buffers are pre-allocated for all mip transitions and populated each frame during `prepare()`:

```rust
fn prepare(&mut self, ctx: &PrepareContext) -> HelioResult<()> {
    let w = self.width;
    let h = self.height;
    for (mip, ub) in self.mip_uniforms.iter().enumerate() {
        let mip = mip as u32;
        let src_w = (w >> mip).max(1);
        let src_h = (h >> mip).max(1);
        let dst_w = (w >> (mip + 1)).max(1);
        let dst_h = (h >> (mip + 1)).max(1);
        let uniforms = HiZUniforms {
            src_size: [src_w, src_h],
            dst_size: [dst_w, dst_h],
        };
        ctx.write_buffer(ub, 0, bytemuck::bytes_of(&uniforms));
    }
    Ok(())
}
```

The `HiZUniforms` struct is 16 bytes — two `[u32; 2]` fields — and satisfies WGSL's 16-byte uniform buffer alignment requirement without padding. The `prepare()` method is the only CPU work beyond the dispatch: `mip_count - 1` small buffer writes, each uploading 16 bytes.

---

## 4. GPU Resource Layout

The Hi-Z pyramid is a single wgpu texture with `mip_level_count` equal to the computed mip count. The full texture specification:

```rust
let hiz_texture = device.create_texture(&wgpu::TextureDescriptor {
    label:           Some("HiZ Texture"),
    size:            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    mip_level_count: mip_count,
    sample_count:    1,
    dimension:       wgpu::TextureDimension::D2,
    format:          wgpu::TextureFormat::R32Float,
    usage:           wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING,
    view_formats:    &[],
});
```

The dual usage flags `TEXTURE_BINDING | STORAGE_BINDING` are required because the two roles of the pyramid texture alternate by binding: the source mip at each step is bound as a sampled `texture_2d` (read-only via `textureLoad`), while the destination mip is bound as a storage texture (write-only via `textureStore`). wgpu requires both usage flags to be declared at texture creation time even though no single bind group uses both for the same mip.

The `R32Float` single-channel format stores one 32-bit float per texel — the maximum depth value. The full pyramid's memory footprint is geometrically bounded: a base-level mip at width `W` and height `H` consumes `4WH` bytes, and the complete mip chain adds at most 33% overhead (the geometric series `1 + 1/4 + 1/16 + ...` converges to `4/3`). For a 1920×1080 base, the full pyramid is approximately:

$$
4 \times 1920 \times 1080 \times \frac{4}{3} \approx 11 \text{ MB}
$$

At 4K (3840×2160), the pyramid occupies approximately 43 MB. This is a fixed allocation that does not change with scene complexity.

### 4.1 Per-Mip Views

Each mip level is accessed through a dedicated `wgpu::TextureView` created with `base_mip_level` set to the desired level and `mip_level_count` set to `Some(1)`. These single-mip views are the source and destination bindings for each compute dispatch. The full-pyramid view (`hiz_view`) covers all mip levels and is the view exposed to downstream passes for sampling during occlusion testing.

### 4.2 The Point-Clamp Sampler

The Hi-Z sampler uses nearest (point) filtering and clamp-to-edge addressing on all axes:

```rust
let hiz_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
    mag_filter:   wgpu::FilterMode::Nearest,
    min_filter:   wgpu::FilterMode::Nearest,
    mipmap_filter: wgpu::FilterMode::Nearest,
    address_mode_u: wgpu::AddressMode::ClampToEdge,
    address_mode_v: wgpu::AddressMode::ClampToEdge,
    ..Default::default()
});
```

The nearest filter is not a performance compromise — it is semantically required. The entire correctness of the occlusion test depends on sampling the **exact maximum** value stored in a pyramid texel. Bilinear filtering would interpolate between adjacent texels in the same mip level, producing a weighted average that is neither the maximum of the sampled texel nor any deterministic quantity. The result would be an underestimate of the true occluder depth: the blended value could fall below the actual maximum in the region, allowing genuinely occluded objects to pass the cull test. The artefact this produces is objects flickering in and out of visibility behind other geometry — incorrect and visually distracting.

Clamp-to-edge addressing prevents a related issue at the viewport boundary: without clamping, a UV coordinate slightly outside `[0, 1]` due to floating-point imprecision in the screen-space projection would wrap around and sample a depth value from the opposite side of the texture, producing a spurious near-depth sample that could suppress valid occlusion tests for objects near the viewport edge.

---

## 5. O(1) CPU Cost

The pass records a fixed number of compute dispatches — one per mip transition — that depends only on the render resolution, not on the scene contents:

```rust
fn execute(&mut self, ctx: &mut PassContext) -> HelioResult<()> {
    let mut pass = ctx.encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
        label: Some("HiZBuild"),
        timestamp_writes: None,
    });
    pass.set_pipeline(&self.pipeline);
    for (mip, bg) in self.mip_bind_groups.iter().enumerate() {
        let mip = mip as u32;
        let dst_w = (ctx.width >> (mip + 1)).max(1);
        let dst_h = (ctx.height >> (mip + 1)).max(1);
        let wg_x = dst_w.div_ceil(WORKGROUP_SIZE);
        let wg_y = dst_h.div_ceil(WORKGROUP_SIZE);
        pass.set_bind_group(0, bg, &[]);
        pass.dispatch_workgroups(wg_x, wg_y, 1);
    }
    Ok(())
}
```

For a 1920×1080 render target with 11 mip levels, this loop executes 10 iterations (mip transitions 0→1 through 9→10), each issuing one `dispatch_workgroups` call. Adding 10 000 additional scene objects does not change this loop at all. The GPU workload per dispatch shrinks exponentially with each mip level: the first dispatch covers 960×540 destination texels, the second 480×270, and so on, with the final dispatches operating on textures of just a few pixels. The total thread count across all dispatches is bounded by approximately `(4/3) × (W/8) × (H/8)` workgroups.

---

## 6. Integration

`HiZBuildPass` owns and publishes three resources that downstream passes consume:

| Resource | Type | Consumer |
|---|---|---|
| `hiz_texture` | `wgpu::Texture` — `R32Float`, full mip chain | Inspection / debug |
| `hiz_view` | `wgpu::TextureView` — all mips | `OcclusionCullPass` (binding 2) |
| `hiz_sampler` | `wgpu::Sampler` — nearest, clamp | `OcclusionCullPass` (binding 3) |

The `OcclusionCullPass` is constructed with a borrow of `hiz_view` and `hiz_sampler`, which it records directly into its bind group at construction time. No dynamic rebinding is needed per-frame because the pyramid texture is a fixed allocation that does not change unless the render resolution changes. On resize, both passes are rebuilt from scratch.

> [!NOTE]
> The pyramid is built from the depth buffer produced by the `DepthPrepassPass` of the **previous** frame. This one-frame lag is the standard approach for GPU-driven Hi-Z culling: the depth prepass completes and fills the depth buffer, the Hi-Z pyramid is constructed from it at the end of that frame, and the pyramid is then used during the **next** frame's culling passes before the new depth prepass completes. Objects that first become visible after one frame of being culled receive a free pass — the visibility bitmask defaults to all-visible on the first frame — and are correctly culled from the second frame onward. This temporal approach eliminates all GPU-to-CPU synchronisation while maintaining correct average-frame culling behaviour.

See [Occlusion Cull Pass](./occlusion-cull) for the Hi-Z sampling and visibility bitmask generation, and [Indirect Dispatch Pass](./indirect-dispatch) for how occlusion and frustum culling results are combined into the final `DrawIndexedIndirect` command buffer.
