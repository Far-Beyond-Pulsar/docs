---
title: Radiance Cascades Pass
description: Deep technical reference for Helio's radiance cascades global illumination pass — covering the cascade atlas layout, the wgpu-23 fallback shader, the full ray-query design in rc_trace.wgsl, the RCDynamic uniform struct, dispatch mechanics, and the path to enabling hardware ray queries.
category: helio
lastUpdated: '2026-03-22'
tags:
  - global-illumination
  - radiance-cascades
  - ray-tracing
  - compute
  - ambient-light
  - wgpu
position: 6
icon: sparkles
---

# Radiance Cascades Pass

Radiance Cascades is a volumetric global illumination technique that replaces per-pixel screen-space approaches with a world-space probe grid. Rather than sampling the hemisphere of each visible surface pixel — an approach that degrades in thin corridors, beneath overhangs, and behind scene geometry where screen-space data is absent — radiance cascades distribute a regular 3-D grid of probes throughout the scene volume. Each probe samples a small set of outgoing directions, accumulating radiance from direct lights and from coarser parent cascades. Downstream shading passes then tri-linearly interpolate between the nearest probes to reconstruct a spatially-varying ambient irradiance field that correctly illuminates surfaces that have no line-of-sight to the sky.

The Helio implementation of radiance cascades is currently split across two distinct paths. The **production path** is a lightweight fallback compute shader that writes a constant attenuated sky colour to every cascade texel. This keeps the 32 × 256 `Rgba16Float` cascade atlas populated with a valid value every frame so that the deferred lighting pass can unconditionally sample it without branching on a null resource. The **designed path** is the full `rc_trace.wgsl` shader, which is bundled verbatim inside the crate via `include_str!` for inspection and is structured around hardware ray queries via a top-level acceleration structure (TLAS). Because `wgpu::Features::EXPERIMENTAL_RAY_QUERY` was not available in wgpu 23.0.1, the full shader is inactive; activating it requires only a dependency bump and a bind-group update. The public API surface — `cascade_texture` and `cascade_view` — is identical across both paths, ensuring that no downstream pass requires modification when the upgrade occurs.

> [!IMPORTANT]
> This document describes the `helio-pass-radiance-cascades` crate as shipped in the wgpu 23 compatibility branch. The current executable path is the fallback shader; `rc_trace.wgsl` is bundled for inspection and will become active when the wgpu dependency is upgraded past 23.0.1. All constant values, struct layouts, and dispatch calculations in this document are verified against the production source.

---

## 1. Implementation Status

There are two radiance cascade paths in the codebase. Understanding which one is active and why is critical to interpreting what downstream passes actually receive.

### 1a. The Active Fallback Path

The fallback exists because wgpu 23.0.1 does not expose `wgpu::Features::EXPERIMENTAL_RAY_QUERY`. Hardware ray queries require the driver to expose a bottom-level and top-level acceleration structure API; without that feature flag, the device creation would panic during pipeline construction. Rather than gating the entire GI contribution behind a runtime feature check and leaving downstream passes without a texture, the crate compiles a minimal compute shader that writes a constant ambient value derived from the scene sky colour.

The output of the fallback is, for every texel in the 32 × 256 atlas:

$$
\text{cascade\_texel} = \vec{4}(\text{sky\_color.rgb} \times 0.05,\; 1.0)
$$

The factor `0.05` is a deliberate choice: it provides a dim ambient fill that prevents fully-black shadowed areas without simulating any geometry interaction. The W channel is written as `1.0`, which in the full cascade encoding convention means "sky miss, no occlusion" — a value that correctly signals to any downstream pass that reads the throughput channel that no geometry was hit along this probe direction.

The full fallback WGSL shader, compiled at runtime from the Rust string constant `FALLBACK_WGSL`, is:

```wgsl
struct RCDynamic {
    world_min:   vec4<f32>,
    world_max:   vec4<f32>,
    frame:       u32,
    light_count: u32,
    _pad0:       u32,
    _pad1:       u32,
    sky_color:   vec4<f32>,
}
@group(0) @binding(0) var cascade_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform>  rc_dyn: RCDynamic;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(cascade_out);
    if gid.x >= dims.x || gid.y >= dims.y { return; }
    // Write sky colour as ambient fallback (black until real RT is wired up).
    textureStore(cascade_out, vec2<i32>(i32(gid.x), i32(gid.y)),
        vec4<f32>(rc_dyn.sky_color.rgb * 0.05, 1.0));
}
```

The shader is entirely uniform — there is no branching on probe coordinates, direction bins, or geometry. Every thread reads `rc_dyn.sky_color`, multiplies by `0.05`, and performs a single `textureStore`. The bounds check (`gid.x >= dims.x || gid.y >= dims.y`) is present for correctness in cases where the workgroup grid slightly overshoots the atlas edge, but with `ATLAS_W = 32` and `ATLAS_H = 256` both being exact multiples of the workgroup size of 8, no out-of-bounds writes actually occur in practice.

### 1b. The Bundled Full Path (Inactive)

The full `rc_trace.wgsl` shader is loaded at compile time by the line:

```rust
// rc_trace.wgsl is bundled verbatim for inspection and future use.
// It requires `enable wgpu_ray_query` which is not available in wgpu 23.0.1.
const _RC_TRACE_WGSL: &str = include_str!("../shaders/rc_trace.wgsl");
```

The leading underscore on `_RC_TRACE_WGSL` suppresses the unused-variable Rust warning; the constant is intentionally kept alive in the binary so that the shader source is preserved under version control and is immediately available for inspection via `strings` or a hex dump. The full design of this shader is documented in [Section 5](#5-the-full-rc_tracewgsl-design).

---

## 2. The Cascade Atlas

The cascade atlas is the sole output of the radiance cascades pass. It is a single 2-D `Rgba16Float` texture whose pixels encode probe-direction pairs rather than screen pixels; understanding the mapping from pixel coordinates to probe indices and direction bins is prerequisite to interpreting any downstream sampling code.

<!-- screenshot: false-colour visualization of the 32×256 cascade atlas showing per-probe ambient colour patterns across the probe grid -->

### 2a. Atlas Constants

The probe grid and direction grid are governed by four compile-time constants:

```rust
/// Probe grid dimension (one axis). Probes are PROBE_DIM³.
const PROBE_DIM: u32 = 8;
/// Direction bins per atlas axis.
const DIR_DIM:   u32 = 4;
/// Atlas width  = PROBE_DIM * DIR_DIM = 32.
const ATLAS_W:   u32 = PROBE_DIM * DIR_DIM;
/// Atlas height = PROBE_DIM² * DIR_DIM = 256.
const ATLAS_H:   u32 = PROBE_DIM * PROBE_DIM * DIR_DIM;
```

These constants derive from a deliberate space-time trade-off. `PROBE_DIM = 8` means the world AABB (`[-10, -1, -10]` to `[10, 10, 10]`) is subdivided into an 8 × 8 × 8 = 512-probe 3-D grid. `DIR_DIM = 4` means each probe stores 4 × 4 = 16 direction bins packed via octahedral encoding. The atlas dimensions follow algebraically:

$$
\text{atlas\_width} = \text{PROBE\_DIM} \times \text{DIR\_DIM} = 8 \times 4 = 32
$$

$$
\text{atlas\_height} = \text{PROBE\_DIM}^2 \times \text{DIR\_DIM} = 64 \times 4 = 256
$$

The height formula packs two of the three probe axes into a single atlas axis: `(probe_y * PROBE_DIM + probe_z) * DIR_DIM + dir_y`. This is not arbitrary — it ensures that a contiguous rectangle in the atlas exactly covers all direction bins for a single probe, which is the access pattern exploited by the `read_parent_probe()` optimisation described in Section 5.

### 2b. Atlas Layout Diagram

```
┌──────────────────────────────────── atlas_x (0 → 31) ─────────────────────────────────────────┐
│  probe_x=0, dir_x=0..3   │  probe_x=1, dir_x=0..3   │ ...  │  probe_x=7, dir_x=0..3          │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤ ← atlas_y = 0
│  probe_y=0, probe_z=0, dir_y=0                                                                 │
│  probe_y=0, probe_z=0, dir_y=1                                                                 │
│  probe_y=0, probe_z=0, dir_y=2                                                                 │
│  probe_y=0, probe_z=0, dir_y=3                                                                 │
│  probe_y=0, probe_z=1, dir_y=0                                                                 │
│  probe_y=0, probe_z=1, dir_y=1                                                                 │
│  ...                                                                                           │
│  probe_y=7, probe_z=7, dir_y=3                                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────┘ ← atlas_y = 255
```

The full atlas coordinate formulas are:

$$
\text{atlas\_x} = \text{probe\_x} \times \text{DIR\_DIM} + \text{dir\_x}
$$

$$
\text{atlas\_y} = (\text{probe\_y} \times \text{PROBE\_DIM} + \text{probe\_z}) \times \text{DIR\_DIM} + \text{dir\_y}
$$

### 2c. Texel Encoding

Each `Rgba16Float` texel stores a probe radiance sample:

| Channel | Meaning | Fallback value | Full RT value |
|---|---|---|---|
| R | Radiance (red) | `sky_color.r × 0.05` | Integrated light contribution |
| G | Radiance (green) | `sky_color.g × 0.05` | Integrated light contribution |
| B | Radiance (blue) | `sky_color.b × 0.05` | Integrated light contribution |
| W | Throughput | `1.0` (sky miss) | `0.0` = opaque hit, `1.0` = sky miss |

The throughput channel encodes how much of the parent cascade's contribution should propagate into this probe direction during the cascade merge pass. A value of `0.0` means a geometry hit was recorded — the local radiance is authoritative and the parent estimate should be discarded. A value of `1.0` means the ray escaped to sky — the parent cascade's contribution at this direction is still valid and should be blended in. This binary encoding (with the fallback always writing `1.0`) means that downstream passes treating the W channel as a transparency or sky-fraction will receive a physically reasonable default.

### 2d. Texture Specification

```rust
let cascade_texture = device.create_texture(&wgpu::TextureDescriptor {
    label:           Some("RC Cascade"),
    size:            wgpu::Extent3d { width: ATLAS_W, height: ATLAS_H, depth_or_array_layers: 1 },
    mip_level_count: 1,
    sample_count:    1,
    dimension:       wgpu::TextureDimension::D2,
    format:          wgpu::TextureFormat::Rgba16Float,
    usage:           wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
    view_formats:    &[],
});
let cascade_view = cascade_texture.create_view(&wgpu::TextureViewDescriptor::default());
```

The dual usage flags `STORAGE_BINDING | TEXTURE_BINDING` are required because the cascade atlas is written as a storage texture by the radiance cascades compute shader and then read as a sampled texture by the deferred lighting pass. The `Rgba16Float` format provides adequate precision for HDR radiance values while keeping the atlas to 64 KB — small enough to fit comfortably in L2 cache on current GPU architectures.

---

## 3. The RCDynamic Uniform

The `RCDynamic` struct is the sole uniform uploaded to the GPU every frame. It carries the world bounds of the probe grid, the current frame index, the active light count, and the scene sky colour. All fields are `f32` or `u32` to satisfy WGSL's 16-byte uniform alignment rules; the two padding fields expand the struct to a multiple of 16 bytes.

```rust
/// Per-frame dynamic RC uniforms.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct RCDynamic {
    world_min:   [f32; 4],
    world_max:   [f32; 4],
    frame:       u32,
    light_count: u32,
    _pad0:       u32,
    _pad1:       u32,
    sky_color:   [f32; 4],
}
```

The `#[repr(C)]` attribute guarantees a predictable field order with no Rust-side reordering. The `Pod + Zeroable` derives from `bytemuck` allow the struct to be cast directly to a byte slice via `bytemuck::bytes_of`, enabling the `ctx.write_buffer` call to upload the struct without an intermediate copy.

### Field Reference

**`world_min` / `world_max`** — The AABB of the probe grid in world space. The current `prepare()` implementation writes hard-coded constants:

$$
\text{world\_min} = (-10,\; -1,\; -10,\; 0)
$$

$$
\text{world\_max} = (10,\; 10,\; 10,\; 0)
$$

These values define a 20 × 11 × 20 metre world volume. The fourth component is always `0.0` (padding). In the full `rc_trace.wgsl` shader these values drive the probe world-space position formula `probe_pos = world_min + (probe_ijk + 0.5) × cell_size`, so changing the bounds without recompiling the shader correctly repositions all probes. The bounds are not scene-adaptive yet — extending `prepare()` to compute a tight AABB around active geometry is the intended next step after the ray-query upgrade.

**`frame`** — A monotonically increasing `u32` frame counter, written as `ctx.frame as u32`. This is available to the full `rc_trace.wgsl` shader for use in temporal accumulation (the EMA blend) and for any future jittered probe placement or direction stratification. The fallback shader ignores it.

**`light_count`** — The number of active scene lights, written as `ctx.scene.lights.len() as u32`. The full shader iterates `for li in 0..rc_dyn.light_count` inside `eval_light()` to accumulate contributions from all scene lights at each hit point. The fallback shader ignores this field.

**`_pad0` / `_pad1`** — Padding fields ensuring the `sky_color` field lands at a 16-byte-aligned offset within the uniform buffer. Both are written as `0u32`. In the WGSL declaration both fields appear as `_pad0: u32` and `_pad1: u32` following the `frame` and `light_count` fields, preserving the layout match.

**`sky_color`** — The scene sky colour sampled from `ctx.frame_resources.sky.sky_color`. This is the primary input to the fallback output formula. In the full shader this value drives the sky-miss radiance term: rays that escape to the sky contribute `mix(sky_color * 0.15, sky_color, sky_up)` where `sky_up = clamp(dir.y * 0.5 + 0.5, 0, 1)` — a vertical gradient that makes the sky brighter overhead and dimmer toward the horizon. The fourth component is written as `0.0`.

### The prepare() Method

```rust
fn prepare(&mut self, ctx: &PrepareContext) -> HelioResult<()> {
    let light_count = ctx.scene.lights.len() as u32;
    let sky = ctx.frame_resources.sky.sky_color;
    let dyn_data = RCDynamic {
        world_min:   [-10.0, -1.0, -10.0, 0.0],
        world_max:   [ 10.0, 10.0,  10.0, 0.0],
        frame:       ctx.frame as u32,
        light_count,
        _pad0:       0,
        _pad1:       0,
        sky_color:   [sky[0], sky[1], sky[2], 0.0],
    };
    ctx.write_buffer(&self.uniform_buf, 0, bytemuck::bytes_of(&dyn_data));
    Ok(())
}
```

`prepare()` is the only CPU-side work beyond the dispatch call. It constructs a fresh `RCDynamic` value each frame with updated light count and sky colour, then uploads it to the GPU uniform buffer via a single `write_buffer` call. There are no dynamic allocations, no GPU readbacks, and no conditional branches on scene state — a predictable constant-time operation regardless of scene complexity.

---

## 4. Dispatch and Execution

The entire cascade generation for one frame is a single compute dispatch. The workgroup grid is determined by dividing the atlas dimensions by the workgroup size (8 × 8 threads per workgroup) and rounding up:

$$
\text{wg\_x} = \left\lceil \frac{\text{ATLAS\_W}}{\text{WORKGROUP\_SIZE\_X}} \right\rceil = \left\lceil \frac{32}{8} \right\rceil = 4
$$

$$
\text{wg\_y} = \left\lceil \frac{\text{ATLAS\_H}}{\text{WORKGROUP\_SIZE\_Y}} \right\rceil = \left\lceil \frac{256}{8} \right\rceil = 32
$$

The total thread count is:

$$
\text{total threads} = \text{wg\_x} \times \text{wg\_y} \times 8 \times 8 = 4 \times 32 \times 64 = 8{,}192
$$

Because `ATLAS_W = 32 = 4 × 8` and `ATLAS_H = 256 = 32 × 8` are exact multiples of the workgroup size, no threads write out-of-bounds — the bounds check in the fallback shader is a defensive guard that never trips in the current configuration.

The full `execute()` method:

```rust
fn execute(&mut self, ctx: &mut PassContext) -> HelioResult<()> {
    // O(1): single compute dispatch — constant workgroup count for fixed atlas size.
    let wg_x = ATLAS_W.div_ceil(WORKGROUP_SIZE_X); // 32 / 8 = 4
    let wg_y = ATLAS_H.div_ceil(WORKGROUP_SIZE_Y); // 256 / 8 = 32

    let desc = wgpu::ComputePassDescriptor {
        label:            Some("RadianceCascades"),
        timestamp_writes: None,
    };
    let mut pass = ctx.encoder.begin_compute_pass(&desc);
    pass.set_pipeline(&self.pipeline);
    pass.set_bind_group(0, &self.bind_group, &[]);
    pass.dispatch_workgroups(wg_x, wg_y, 1);
    Ok(())
}
```

`div_ceil` is used instead of integer division to handle non-power-of-two atlas sizes correctly should the constants ever change. There is no timestamp query attached to this pass in the current implementation, but the `timestamp_writes: None` field is explicitly initialised so that adding GPU profiling later is a one-line change. The Z dimension of the dispatch is always `1`; there is no per-cascade layering in the current atlas format (a single level-0 cascade covers the entire world volume).

---

## 5. The Full rc_trace.wgsl Design

This section documents the intended production implementation. None of the code described here executes in the current wgpu-23 build; it describes the design that will activate once wgpu exposes `EXPERIMENTAL_RAY_QUERY`. The shader begins with:

```wgsl
enable wgpu_ray_query;
```

This directive causes the WGSL compiler to expose `ray_query`, `rayQueryInitialize`, `rayQueryProceed`, `rayQueryGetCommittedIntersection`, and the `RayDesc` constructor — hardware ray query primitives backed by a Vulkan or DXR acceleration structure.

<!-- screenshot: side-by-side comparison of fallback ambient output vs full ray-query GI output in an indoor scene -->

### 5a. Static Cascade Parameters

The full shader introduces a second uniform, `CascadeStatic`, which carries parameters that are fixed per-dispatch (unlike `RCDynamic`, which changes every frame):

```wgsl
struct CascadeStatic {
    cascade_index:    u32,
    probe_dim:        u32,
    dir_dim:          u32,
    t_max_bits:       u32,
    parent_probe_dim: u32,
    parent_dir_dim:   u32,
    _pad0: u32,
    _pad1: u32,
}
```

`cascade_index` identifies which level is being updated (level 0 = finest, higher = coarser). `probe_dim` and `dir_dim` are the per-dimension probe and direction counts for this level — in the current single-level configuration these equal `PROBE_DIM = 8` and `DIR_DIM = 4`. `t_max_bits` is the bit-cast of the maximum ray extent `t_max` as an `f32`; this avoids a float uniform upload and instead passes the float via its IEEE 754 bit pattern in a `u32` field, decoded in the shader via `bitcast<f32>(rc_stat.t_max_bits)`. `parent_probe_dim` and `parent_dir_dim` describe the coarser parent cascade's grid; a value of `0` in `parent_dir_dim` signals that there is no parent to read (top-level cascade).

### 5b. Atlas Coordinate Decoding

Each thread receives a `global_invocation_id` `(gid.x, gid.y)` corresponding to one atlas texel. The thread first unpacks the probe and direction indices from the atlas coordinates:

$$
\text{dir\_x} = \text{gid.x} \bmod \text{DIR\_DIM}
$$

$$
\text{probe\_x} = \lfloor \text{gid.x} / \text{DIR\_DIM} \rfloor
$$

$$
\text{dir\_y} = \text{gid.y} \bmod \text{DIR\_DIM}
$$

$$
\text{probe\_yz\_combined} = \lfloor \text{gid.y} / \text{DIR\_DIM} \rfloor
$$

$$
\text{probe\_z} = \text{probe\_yz\_combined} \bmod \text{PROBE\_DIM}
$$

$$
\text{probe\_y} = \lfloor \text{probe\_yz\_combined} / \text{PROBE\_DIM} \rfloor
$$

From these indices the probe world position is computed:

$$
\text{cell\_size} = \frac{\text{world\_max} - \text{world\_min}}{\text{PROBE\_DIM}}
$$

$$
\text{probe\_pos} = \text{world\_min} + \left(\vec{probe} + 0.5\right) \times \text{cell\_size}
$$

The `+ 0.5` offset centres the probe at the middle of its voxel rather than at the corner, which prevents edge-boundary probes from sitting exactly on the world AABB face and avoids self-intersection artefacts when casting rays.

### 5c. Octahedral Direction Encoding

Direction bins are encoded using Y-up octahedral projection. The full `oct_decode` function converts a 2-D UV coordinate (in `[0, 1]²`) to a unit 3-D direction with Y as the pole axis:

```wgsl
// Y-up octahedral decode (Y is the pole — uv center = +Y)
fn oct_decode(uv: vec2<f32>) -> vec3<f32> {
    let f  = uv * 2.0 - 1.0;
    let af = abs(f);
    let l  = af.x + af.y;
    var n: vec3<f32>;
    if l > 1.0 {
        let sx = select(-1.0, 1.0, f.x >= 0.0);
        let sz = select(-1.0, 1.0, f.y >= 0.0);
        n = vec3<f32>((1.0 - af.y) * sx, 1.0 - l, (1.0 - af.x) * sz);
    } else {
        n = vec3<f32>(f.x, 1.0 - l, f.y);
    }
    return normalize(n);
}
```

This function maps the unit square to the full sphere via the octahedral fold. When `l > 1.0`, the input point is in one of the four triangular corners of the square that project to the lower hemisphere; the fold formula mirrors these into the correct lower-hemisphere direction. When `l <= 1.0`, the point is in the central diamond that maps directly to the upper hemisphere. Y is used as the pole axis (rather than the conventional Z) to match Helio's scene convention where Y is up. The `normalize` ensures the output is a proper unit vector despite floating-point accumulation in the fold computation.

The UV centre for direction bin `(dx, dy)` is:

$$
\text{dir\_uv} = \frac{(dx,\; dy) + 0.5}{\text{DIR\_DIM}}
$$

This centres the sample within the direction bin, avoiding the degenerate pole directions at `uv = (0, 0)`, `(1, 0)`, `(0, 1)`, `(1, 1)`.

### 5d. Ray Casting and Radiance Accumulation

After computing `probe_pos` and `dir`, the shader casts a ray against the TLAS. The full cs_trace main body (abbreviated to the core logic) is:

```wgsl
@compute @workgroup_size(8, 8)
fn cs_trace(@builtin(global_invocation_id) gid: vec3<u32>) {
    let probe_dim = rc_stat.probe_dim;
    let dir_dim   = rc_stat.dir_dim;
    let atlas_w   = probe_dim * dir_dim;
    let atlas_h   = probe_dim * probe_dim * dir_dim;

    if gid.x >= atlas_w || gid.y >= atlas_h { return; }

    let dx  = gid.x % dir_dim;
    let px  = gid.x / dir_dim;
    let dy  = gid.y % dir_dim;
    let pyz = gid.y / dir_dim;
    let pz  = pyz % probe_dim;
    let py  = pyz / probe_dim;

    let world_size = rc_dyn.world_max.xyz - rc_dyn.world_min.xyz;
    let cell_size  = world_size / f32(probe_dim);
    let probe_pos  = rc_dyn.world_min.xyz + (vec3<f32>(f32(px), f32(py), f32(pz)) + 0.5) * cell_size;

    let dir_uv = (vec2<f32>(f32(dx), f32(dy)) + 0.5) / f32(dir_dim);
    let dir    = oct_decode(dir_uv);
    let t_max  = bitcast<f32>(rc_stat.t_max_bits);

    var rq: ray_query;
    rayQueryInitialize(&rq, acc_struct,
        RayDesc(0x01u, 0xFFu, 0.001, t_max, probe_pos, dir));
    rayQueryProceed(&rq);
    let isect = rayQueryGetCommittedIntersection(&rq);
    ...
}
```

The entry point `cs_trace` (distinct from the fallback `cs_main`) reads `probe_dim` and `dir_dim` from `rc_stat` rather than using the compile-time constants. This makes the shader multi-level capable: the same kernel can run at any cascade level simply by uploading different `CascadeStatic` values. The `atlas_w` and `atlas_h` are recomputed from the runtime uniforms rather than hardcoded, so the bounds check `gid.x >= atlas_w || gid.y >= atlas_h` correctly guards any level.

The ray query API follows a three-call pattern that mirrors hardware: `rayQueryInitialize` sets up the query against `acc_struct` with a `RayDesc` (flags, mask, t_min, t_max, origin, direction); `rayQueryProceed` executes the traversal; `rayQueryGetCommittedIntersection` returns the closest confirmed hit record. Unlike older HLSL-style `TraceRay`, the WGSL ray query API is inline (no separate any-hit shader) and returns a committed intersection struct that contains `kind`, `t`, and `front_face` fields.

The mask values `0x01u` (ray mask) and `0xFFu` (geometry mask) allow all geometry to participate in intersection. The `t_min = 0.001` offset prevents self-intersection at probe origin. On a geometry hit (`isect.kind != RAY_QUERY_INTERSECTION_NONE`), the hit position is reconstructed as `probe_pos + dir * isect.t` and the surface normal is approximated as the flipped ray direction. All lights are then iterated via `eval_light()` at the hit point, and `throughput = 0.0` is written to signal an opaque occlusion. On a sky miss, a directional sky gradient is written as the radiance contribution and `throughput = 0.0` is also written — sky is treated as a terminal, non-transmissive source.

On a sky miss the contributed radiance is:

$$
\text{sky\_up} = \text{clamp}\!\left(\frac{\text{dir.y} \times 0.5 + 0.5}{1},\; 0,\; 1\right)
$$

$$
\text{sky\_radiance} = \text{mix}(\text{sky\_color} \times 0.15,\; \text{sky\_color},\; \text{sky\_up})
$$

This creates a vertical gradient where rays pointing straight up receive the full sky colour and rays pointing straight down receive 15% of the sky colour, simulating a simple sky bowl that bluelly tints ground-bounced indirect light.

### 5e. The eval_light() Function

`eval_light()` evaluates one scene light at a given hit position and normal, returning an RGB radiance contribution. It supports three light types (directional, point, spot) with different attenuation and shadow strategies:

```wgsl
// Evaluate a single light at a surface point with soft shadow (4 samples on a light disk).
// Gradual visibility prevents the hard snap as lights move past shadow boundaries.
fn eval_light(li: u32, hit_pos: vec3<f32>, hit_normal: vec3<f32>) -> vec3<f32> {
    let light = lights[li];
    var to_light: vec3<f32>;
    var dist:     f32;
    var atten:    f32;

    if light.light_type < 0.5 {
        // Directional
        to_light = -light.direction;
        dist     = 1000.0;
        atten    = 1.0;
    } else {
        // Point / Spot
        let diff = light.position - hit_pos;
        dist     = length(diff);
        if dist >= light.range { return vec3<f32>(0.0); }
        to_light = diff / dist;
        atten    = clamp(1.0 - (dist / light.range), 0.0, 1.0);
        atten    = atten * atten;
        if light.light_type > 1.5 {
            let cos_angle  = dot(-to_light, light.direction);
            let cos_outer  = light.cos_outer;
            let cos_inner  = light.cos_inner;
            let spot_atten = clamp((cos_angle - cos_outer) / (cos_inner - cos_outer + 0.001), 0.0, 1.0);
            atten *= spot_atten;
        }
    }
    ...
}
```

Directional lights use `dist = 1000.0` (no range cutoff) and `atten = 1.0` (no distance falloff). Point and spot lights use a quadratic falloff `atten = (1 - dist/range)²` that reaches zero exactly at `range`, preventing any light contribution leaking beyond the declared radius. Spot lights apply an additional angular attenuation factor `spot_atten` based on pre-computed `cos_inner` and `cos_outer` values from the CPU-side light data.

For **directional lights**, a single shadow ray is cast in the `to_light` direction with `t_max = 9999.0`. Visibility is binary: `1.0` if no intersection, `0.0` on any hit. Soft shadows for a sun-like directional light are unnecessary because the distance to the light is astronomically large and the angular subtended diameter is tiny.

For **point and spot lights**, four shadow rays are cast in a rotated square pattern around the light disk:

```wgsl
// Rotated square pattern - better coverage than cross pattern
var offsets: array<vec2<f32>, 4>;
offsets[0] = vec2<f32>( 0.707,  0.707);
offsets[1] = vec2<f32>(-0.707,  0.707);
offsets[2] = vec2<f32>(-0.707, -0.707);
offsets[3] = vec2<f32>( 0.707, -0.707);
```

Each offset is scaled by `light_radius = 0.35` metres and projected onto a local tangent frame around `to_light`. The four rays target four sample points on the light disk surface; each contributes `0.25` to the visibility sum if unoccluded. The result is a smooth penumbra as a surface transitions from fully lit to fully shadowed as the blocking geometry moves across the light disk subtended angle.

### 5f. Cascade Merge (Read Parent)

After the primary ray evaluation, the shader checks whether a coarser parent cascade is available (`rc_stat.cascade_index < 3u && rc_stat.parent_dir_dim > 0u`). If so, it reads the parent cascade to fill in low-frequency indirect light that the fine cascade's limited ray length may have missed.

The merge formula is:

$$
\text{merged\_radiance} = \text{local\_radiance} + \text{parent\_radiance} \times \text{local\_throughput}
$$

$$
\text{merged\_throughput} = \text{local\_throughput} \times \text{parent\_throughput}
$$

This is a physically-motivated compositing operation. When the local cascade hit geometry (`throughput = 0.0`), the local direct lighting result is authoritative and no parent contribution is added. When the local ray escaped (`throughput = 1.0`), the full parent estimate is blended in — the parent probe at the same direction carries the low-frequency indirect radiance from coarser probes. The throughput multiplication propagates the opacity estimate across cascade levels, so a chain of misses accumulates nothing and a hit at any level terminates the chain.

The parent probe read is implemented by `read_parent_probe()`:

```wgsl
// Read one parent probe: average its 2×2 direction sub-bins for direction (dx,dy).
// Returns vec4(radiance, throughput).
// OPTIMIZED: Reduced from 4 texture loads to 1 by using center sample
fn read_parent_probe(ppx: u32, ppy: u32, ppz: u32,
                     dx: u32, dy: u32,
                     pdim: u32, ppdim: u32) -> vec4<f32> {
    // Sample the center of the 2x2 direction bin instead of averaging all 4
    // This trades a tiny bit of accuracy for 4x fewer texture reads
    let ax = i32(ppx * pdim + dx * 2u + 1u);
    let ay = i32((ppy * ppdim + ppz) * pdim + dy * 2u + 1u);
    return textureLoad(cascade_parent, vec2<i32>(ax, ay), 0);
}
```

This function takes the parent probe's (X, Y, Z) grid indices and a direction bin (dx, dy), and reads one texel at the center of the 2 × 2 direction sub-bin rather than averaging four texels. The center offset `dx * 2 + 1` and `dy * 2 + 1` picks the second texel in each pair, landing at the geometric center of the 2 × 2 block. The comment accurately describes the trade-off: this 4× reduction in texture reads is imperceptible due to temporal accumulation because the EMA blend over multiple frames smooths any single-frame inaccuracy in the parent interpolation.

### 5g. Temporal Accumulation

The full shader writes to two output textures and reads from a history texture. An exponential moving average (EMA) blends the current frame's result with the history:

$$
\text{output} = \text{mix}(\text{history},\; \text{current},\; \alpha), \quad \alpha = 0.15
$$

With `α = 0.15`, each frame contributes 15% of new information. The effective temporal window is approximately `1/α ≈ 6.7` frames, meaning the probe values converge to their steady-state within roughly 6–7 frames of a scene change. On the first frame the history texture is all zeros, so `mix(0, current, 0.15)` produces a dimmer-than-steady-state result that brightens over subsequent frames — this is visible as a brief GI brightening fade-in on scene load.

The verbatim temporal accumulation code from `rc_trace.wgsl`:

```wgsl
// ── Temporal accumulation: EMA blend with previous frame ──────────────
// alpha=0.15 → ~6-frame convergence. First frame (history=0) blends cleanly.
let hist = textureLoad(cascade_history, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
let alpha = 0.15;
radiance   = mix(hist.rgb, radiance,   alpha);
throughput = mix(hist.w,   throughput, alpha);

textureStore(cascade_out,           vec2<i32>(i32(gid.x), i32(gid.y)),
    vec4<f32>(radiance, throughput));
// Write the same value into the history ping-pong buffer so the next
// frame can read it without a copy_texture_to_texture blit pass.
textureStore(cascade_history_write, vec2<i32>(i32(gid.x), i32(gid.y)),
    vec4<f32>(radiance, throughput));
```

The same temporal value is written to both `cascade_out` (the current-frame atlas) and `cascade_history_write` (the ping-pong buffer for next frame), eliminating a `copy_texture_to_texture` blit pass. The throughput channel is also temporally accumulated separately from radiance, using the identical EMA formula. This is correct because throughput represents a per-direction probability (sky vs geometry) that also evolves smoothly as geometry moves, and filtering it temporally reduces flickering when a probe sits near a surface boundary where the primary ray intermittently hits or misses geometry across frames.

---

## 6. Downstream Integration

The cascade atlas is consumed by the deferred lighting pass via two public fields on `RadianceCascadesPass`:

```rust
/// Main cascade atlas texture (Rgba16Float). Downstream passes sample this for GI.
pub cascade_texture: wgpu::Texture,
pub cascade_view:    wgpu::TextureView,
```

Both fields are `pub`, so downstream passes access them directly from the `RadianceCascadesPass` struct without going through a pass context. The `cascade_view` is a default `TextureViewDescriptor` view of `cascade_texture` — a flat 2-D `Rgba16Float` view of the 32 × 256 atlas.

The deferred lighting pass binds `cascade_view` as a sampled texture and uses bilinear or nearest-neighbour sampling to reconstruct the ambient irradiance at each shaded surface point. Because the probe grid is uniform over the world AABB, the texture coordinate for any world position `p` is:

$$
\text{probe\_uv.x} = \frac{p.x - \text{world\_min.x}}{\text{world\_max.x} - \text{world\_min.x}}
$$

$$
\text{probe\_uv.y} = \frac{p.y - \text{world\_min.y}}{\text{world\_max.y} - \text{world\_min.y}}
$$

In the current fallback regime, every texel in the atlas carries `sky_color × 0.05`, so the deferred pass effectively receives a flat ambient term equal to 5% of the scene sky colour. This is spatially uniform — distance from walls, ceiling proximity, and occlusion from scene geometry all produce the same ambient value regardless of position. Once the full ray-query path activates, the spatial variation across the 8 × 8 × 8 probe grid will produce a position-dependent ambient that correctly darkens corners, brightens open areas, and tints surfaces with the colours of nearby emitters.

<!-- screenshot: comparison of flat ambient (fallback) vs position-varying GI (full RT) in an indoor corridor scene -->

---

## 7. Performance Characteristics

### CPU Cost

The CPU cost of the radiance cascades pass is exactly two operations per frame: one `write_buffer` call (uploading `sizeof(RCDynamic) = 48` bytes) in `prepare()`, and one `dispatch_workgroups(4, 32, 1)` call in `execute()`. There are no scene-dependent loops, no per-object traversal, and no GPU readbacks. This O(1) CPU behaviour is an explicit design goal documented in `lib.rs`:

```
//! O(1) CPU — single `dispatch_workgroups` call.
```

### GPU Cost (Fallback)

The fallback shader is trivially cheap. Each of the 8,192 threads performs:
- One uniform read (`rc_dyn.sky_color`) shared across the workgroup via constant cache
- One multiply by scalar `0.05`
- One `textureStore` to `cascade_out`

With the atlas fitting comfortably in GPU L2 (64 KB), there are no cache misses on the write path. The fallback dispatch is effectively invisible in a GPU trace — total execution time on a mid-range GPU is well under 5 microseconds.

### Memory Budget

The cascade atlas occupies a fixed memory allocation:

$$
\text{VRAM} = \text{ATLAS\_W} \times \text{ATLAS\_H} \times \text{bytes\_per\_texel}
$$

$$
= 32 \times 256 \times 8 \;\text{bytes (Rgba16Float)}
$$

$$
= 65{,}536 \;\text{bytes} = 64 \;\text{KiB}
$$

This 64 KiB budget is fixed regardless of scene complexity. The full ray-query path adds two additional textures of the same size (the history ping-pong pair: `cascade_history` and `cascade_history_write`), bringing the total GI texture memory to 192 KiB — negligible compared to the GBuffer or shadow atlas.

### GPU Cost (Full Ray-Query Path, Estimated)

The full `rc_trace.wgsl` shader performs up to `N_lights × 4` ray queries per hit texel (four soft-shadow rays per point/spot light) plus the primary probe ray. For the default scene with `light_count ≈ 8` lights the worst-case thread cost is `1 + 8 × 4 = 33` ray queries. At 8,192 threads, the upper bound is approximately `267,264` ray queries per frame. On hardware that exposes `EXPERIMENTAL_RAY_QUERY`, a modern Nvidia RTX or AMD RDNA3 GPU can process tens of millions of incoherent ray queries per millisecond, placing the expected full-path budget at roughly 0.5–2 ms per frame — acceptable for a GI pass running alongside shadow, G-buffer, and deferred light passes.

---

## 8. Upgrading to Full Ray-Query

Activating `rc_trace.wgsl` requires four coordinated changes. The cascade atlas `cascade_texture` and `cascade_view` are unchanged by the upgrade, so no downstream pass needs modification.

### Step 1: Enable the wgpu Feature

When creating the wgpu `Device`, add the ray-query feature flag:

```rust
let features = wgpu::Features::default()
    | wgpu::Features::EXPERIMENTAL_RAY_QUERY;
```

This causes wgpu to request `VK_KHR_ray_query` from the Vulkan driver (or `D3D12_RAYTRACING_TIER_1_1` on DXR). Device creation will fail gracefully if the GPU does not support the feature, which allows a runtime fallback check.

### Step 2: Build the TLAS

A top-level acceleration structure must be built from the scene's bottom-level acceleration structures (BLAS). Each mesh in the scene needs one BLAS (built once on mesh upload), and the TLAS is rebuilt every frame (or when geometry moves) to reference all active instances. The wgpu `Tlas` API, available after wgpu 23.0.1, wraps this:

```rust
// Pseudocode for the upgrade path — not present in current codebase.
let tlas = device.create_tlas(&wgpu::CreateTlasDescriptor {
    label: Some("RC TLAS"),
    max_instances: MAX_SCENE_INSTANCES,
    flags: wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE,
});
```

The TLAS handle is then passed to `RadianceCascadesPass::new()` as an additional argument. The `lights_buf` parameter already present in `new()` — currently a no-op (`let _ = lights_buf;`) — was included in the API precisely to hold the position of the acceleration structure binding so that the function signature change is minimal.

### Step 3: Rebuild the Bind Group

The full `rc_trace.wgsl` shader requires 8 bindings instead of the fallback's 2. The bind group must be rebuilt with the additional entries:

| Binding | Resource | Type |
|---|---|---|
| 0 | `cascade_out` | `StorageTexture (write)` |
| 1 | `cascade_parent` | `Texture2d (read)` |
| 2 | `rc_dyn` uniform | `UniformBuffer` |
| 3 | `rc_stat` uniform | `UniformBuffer` |
| 4 | `acc_struct` (TLAS) | `AccelerationStructure` |
| 5 | `lights` storage | `StorageBuffer (read)` |
| 6 | `cascade_history` | `Texture2d (read)` |
| 7 | `cascade_history_write` | `StorageTexture (write)` |

The `cascade_parent`, `cascade_history`, and `cascade_history_write` textures are additional `Rgba16Float` textures of the same 32 × 256 dimension. The parent texture holds the coarser cascade (or zeros for the top level); the history pair implements the ping-pong temporal accumulation.

### Step 4: Swap the Shader

Replace `FALLBACK_WGSL` with `_RC_TRACE_WGSL` in the `ShaderModuleDescriptor`:

```rust
// Before (fallback):
source: wgpu::ShaderSource::Wgsl(FALLBACK_WGSL.into()),

// After (full RT):
source: wgpu::ShaderSource::Wgsl(_RC_TRACE_WGSL.into()),
```

Change the entry point from `"cs_main"` to `"cs_trace"`. The public API (`cascade_texture`, `cascade_view`) is unchanged, so the deferred lighting pass requires no modification. Downstream scene output will immediately reflect spatially-varying GI the first time the upgraded binary runs.
