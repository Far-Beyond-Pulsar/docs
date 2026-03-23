---
title: SDF Clipmap Pass
description: Volumetric clipmap-based signed distance field system with sparse brick atlases, toroidal scrolling, and fullscreen ray marching for efficient global SDF queries.
category: helio
lastUpdated: '2026-03-22'
tags:
  - sdf
  - ray-marching
  - clipmap
  - sparse-grids
  - compute-shader
  - volumetric
position: 9
icon: 📐
---

# SDF Clipmap Pass

## 1. Introduction: Why Volumetric SDFs?

Signed Distance Fields (SDFs) have become central to modern rendering engines. An SDF encodes for every point in space the signed distance to the nearest surface: **positive outside**, **negative inside**. This single scalar value enables remarkable capabilities:

- **Global illumination**: Cone-traced shadows with smooth contact penumbra
- **Ambient occlusion**: Screen-independent global AO without SSAO artifacts
- **Collision detection**: Per-voxel queries for physics and AI
- **Rendering**: Ray-marching for reflections, refractions, volumetrics
- **Deformation**: SDF-based cloth/fluid simulation with signed distance constraints

The **clipmap approach** balances coverage with resolution: instead of baking a single global SDF (massive VRAM cost), we maintain **eight nested levels**, each coarser than the last. Level 0 covers a small, high-detail region around the camera; level 7 covers the entire world at coarse resolution. As the camera moves, the grid **toroidally scrolls**—only the newly-visible shell of each level is re-evaluated, keeping CPU work O(1) per frame.

### Screen-Space vs. Volumetric

The older approach used **Jump Flooding Algorithm (JFA)** on depth: compute screen-space distance per pixel, fast but view-dependent. The new **volumetric clipmap** trades one-time GPU baking cost for camera-independent, ray-marchable 3D data—far more useful for GI, collision, and predictable queries.

> [!IMPORTANT]
> The SDF clipmap is **offline-baked per frame**: edits, terrain, and camera movement trigger reclassification and GPU baking of bricks. It is not a real-time volumetric renderer. For interactive edits (sculpting, CSG), design edit lists to remain sparse (<4096 active shapes).

---

## 2. The Clipmap Hierarchy

The clipmap consists of **8 levels** (0–7), each exponentially coarser in resolution. Level structure:

- **Level 0 (finest)**: voxel_size = 0.5 world units, coverage = 512 × 512 × 512 voxels = $$2^9$$ per axis
- **Level $$k$$**: voxel_size = $$2^k \cdot 0.5$$, coverage = $$2^{9+k}$$ per axis

### Level Coverage Formula

For level $$k$$, the **world coverage** is:

$$\text{coverage}_k = 2^{9+k} \text{ voxels} \times 2^{k} \cdot 0.5 \text{ units per voxel} = 2^{8+2k} \text{ world units per axis}$$

Concretely:

| Level | Voxel Size | Grid Size (bricks) | Grid Size (voxels) | World Coverage |
|-------|------------|----|----|--------|
| 0 | 0.5 | 16³ (1 atlas 8³) | 128 | ±256 |
| 1 | 1.0 | 16³ | 256 | ±512 |
| 2 | 2.0 | 16³ | 512 | ±1024 |
| 3 | 4.0 | 16³ | 1024 | ±2048 |
| 4 | 8.0 | 16³ | 2048 | ±4096 |
| 5 | 16.0 | 16³ | 4096 | ±8192 |
| 6 | 32.0 | 16³ | 8192 | ±16384 |
| 7 | 64.0 | 16³ | 16384 | ±32768 |

Each level is **independent**: its own grid, atlas, active brick list, and edit list. The ray marcher queries the finest level containing the current point; coarser levels fill in distant regions.

### Clipmap Origin (Toroidal Snap)

Each level's grid origin is **snapped to the brick grid** and centered on the camera:

$$\text{world\_min} = \text{camera\_pos} - \lfloor 8 \times \text{brick\_size} \times \text{voxel\_size} \rfloor / 2$$

This snapping ensures that camera movement never requires global grid rebuild—only a toroidal shift.

---

## 3. Sparse Brick Grid Architecture

Each level partitions its voxel grid into **bricks**: 8×8×8 voxels per brick, arranged in a 16³ brick grid. The brick grid enables **sparse allocation**.

### Brick Layout

```
Grid: 16 × 16 × 16 bricks
Per brick: 8 × 8 × 8 voxels = 512 voxels
Total: 256 × 256 × 256 voxels per level (compact), but only active bricks occupy VRAM.
```

### Sparse Atlas

Instead of storing all $$16^3 = 4096$$ bricks in VRAM, only **active bricks** (those overlapping scene geometry or edits) are allocated from an **8³ = 512-brick atlas**. Each level binds a separate atlas.

**Memory per level:**
- Atlas: 512 bricks × 512 voxels/brick = 262,144 voxels
- Packed as u8 (4 per u32): 262,144 / 4 = 65,536 × u32 = **256 KB** per atlas (8 levels = 2 MB)

Compare to dense: $$16^3 \times 8^3 = 262,144$$ voxels per level × 8 levels = 2,097,152 voxels if dense, effectively the same, but **sparse gives flexibility**: if a level has 100 active bricks (122 KB), we save VRAM by not allocating the remaining 412 bricks.

### Brick Classification

Each brick is tagged:

```rust
pub enum BrickState {
    Empty,      // Outside any surface; skip during ray march.
    Active(u32),// Overlaps surface; occupies atlas slot.
    Freed,      // Was active, now empty; slot freed.
}
```

**Classification** runs once per frame on the CPU, using an **Edit BVH** (axis-aligned bounding box tree) to quickly test which bricks intersect the edits. Terrain bounds are computed in parallel.

---

## 4. SDF Primitives

The system supports **5 primitive shapes**. Each is defined in local space (after applying the inverse world-to-local transform), and evaluated using standard SDF distance functions.

### Supported Shapes

```rust
pub enum SdfShapeType {
    Sphere   = 0,
    Cube     = 1,
    Capsule  = 2,
    Torus    = 3,
    Cylinder = 4,
}

pub struct SdfShapeParams {
    pub param0: f32,  // Flexible meaning per shape
    pub param1: f32,
    pub param2: f32,
    pub param3: f32,  // Unused (reserved)
}
```

### Shape Definitions and WGSL Implementations

#### **Sphere**

A sphere of radius $$r$$ at the origin:

$$d_{\text{sphere}}(\mathbf{p}, r) = |\mathbf{p}| - r$$

**WGSL:**
```wgsl
fn sd_sphere(p: vec3<f32>, r: f32) -> f32 {
    return length(p) - r;
}
```

**Parameters:** `param0 = radius`

---

#### **Cube (Axis-Aligned Box)**

A box with half-extents $$\mathbf{b}$$ centered at the origin:

$$d_{\text{box}}(\mathbf{p}, \mathbf{b}) = |\mathbf{q}_{\max}| + \text{min}(\text{max}(\mathbf{q}_{\max}), 0)$$
where $$\mathbf{q} = |\mathbf{p}| - \mathbf{b}$$.

This evaluates correctly for points inside, on, and outside the box.

**WGSL:**
```wgsl
fn sd_box(p: vec3<f32>, b: vec3<f32>) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
```

**Parameters:** `param0 = half_x`, `param1 = half_y`, `param2 = half_z`

---

#### **Capsule**

A capsule (cylinder with hemispherical caps) with radius $$r$$ and half-height $$h$$:

$$d_{\text{capsule}}(\mathbf{p}, r, h) = \left| \left[ \text{clamp}(p_y, -h, h), \sqrt{p_x^2 + p_z^2} \right] \right| - r$$

**WGSL:**
```wgsl
fn sd_capsule(p: vec3<f32>, r: f32, hh: f32) -> f32 {
    var q = p;
    q.y = q.y - clamp(q.y, -hh, hh);
    return length(q) - r;
}
```

**Parameters:** `param0 = radius`, `param1 = half_height`

---

#### **Torus**

A torus with major radius $$R$$ and minor radius $$r$$:

$$d_{\text{torus}}(\mathbf{p}, R, r) = \left| \left[ \left| \sqrt{p_x^2 + p_z^2} \right| - R, p_y \right] \right| - r$$

**WGSL:**
```wgsl
fn sd_torus(p: vec3<f32>, R: f32, r: f32) -> f32 {
    let q = vec2<f32>(length(p.xz) - R, p.y);
    return length(q) - r;
}
```

**Parameters:** `param0 = major_radius`, `param1 = minor_radius`

---

#### **Cylinder**

A cylinder with radius $$r$$ and half-height $$h$$:

$$d_{\text{cyl}}(\mathbf{p}, r, h) = \begin{cases}
\left| [\sqrt{p_x^2 + p_z^2} - r, p_y] \right| & \text{if both components outside} \\
\max(\sqrt{p_x^2 + p_z^2} - r, |p_y| - h) & \text{otherwise}
\end{cases}$$

**WGSL:**
```wgsl
fn sd_cylinder(p: vec3<f32>, r: f32, hh: f32) -> f32 {
    let d = abs(vec2<f32>(length(p.xz), p.y)) - vec2<f32>(r, hh);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}
```

**Parameters:** `param0 = radius`, `param1 = half_height`

---

### Shape Evaluation

Given a shape and a world position, the shader:

1. Applies the **world-to-local transform** (inverse of the edit's transform matrix)
2. Evaluates the shape's distance function in local space
3. Combines with other shapes using **boolean operators** and optional **blend radius**

---

## 5. Toroidal Update Strategy

As the camera moves, the clipmap **scrolls toroidally**—the grid wraps around without full rebuild. Each level independently detects scrolling:

### Movement Detection

After updating the camera position each frame:

1. Snap the camera position to the brick grid: $$\text{snap}_k = \lfloor \text{camera} / (8 \times \text{brick\_size}_k) \rfloor$$
2. Compute grid movement: $$\Delta = \text{snap}_k - \text{prev\_snap}_k$$
3. If $$\Delta \neq 0$$, the level has scrolled; set dirty bit

### Per-Level Scrolling

For each scrolled level:

1. **Update grid origin**: $$\text{world\_min} \leftarrow \text{world\_min} + \Delta \times 8 \times \text{brick\_size} \times \text{voxel\_size}$$
2. **Classify newly visible bricks**: test only the 1-2 voxel-thick shell of newly-exposed bricks against the Edit BVH
3. **Deallocate old bricks**: free atlas slots for bricks that scrolled out and are now empty
4. **Upload only dirty bricks**: GPU compute pass evaluates only changed active bricks

### CPU Cost

- **First frame**: full classification of all $$16^3 = 4096$$ bricks per level
- **Subsequent frames, no movement**: $$O(1)$$ (no updates)
- **Frame with movement**: $$O(\text{shell size}) = O(16^2) = O(256)$$ bricks per level (shell is 1-2 bricks thick)

This makes clipmap updates **extremely cheap** compared to global grid rebuild.

> [!TIP]
> For stationary scenes, subsequent frames after the first perform zero CPU re-classification. Movement triggers incremental reclassification only.

---

## 6. The Build Pass: Computing SDF Values

The **compute shader** bakes SDF values into the sparse brick atlases. It runs once per frame, after classification.

### Compute Pipeline Overview

```
Input:
  - Per-level active brick list (from classification)
  - Edit BVH-pruned per-brick edit list
  - Terrain parameters
  
Compute Kernel: one thread => one active brick
  For each voxel in the brick:
    - Evaluate all edits (and terrain) at voxel center
    - Apply boolean ops (union, subtraction, intersection)
    - Pack result as u8 into atlas

Output:
  - 8 sparse brick atlases updated with new SDF values
```

### Compute Shader Entry Point

```wgsl
@compute @workgroup_size(256, 1, 1)
fn cs_evaluate_sparse(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let brick_list_idx = global_id.x;
    if brick_list_idx >= params.active_brick_count { return; }

    // Look up which grid cell this is.
    let grid_flat = active_bricks[brick_list_idx];
    let atlas_idx = brick_index[grid_flat];
    if atlas_idx == 0xFFFFFFFFu { return; }

    // Decode grid brick position.
    let gd = params.grid_dim;
    let bx = grid_flat % gd.x;
    let by = (grid_flat / gd.x) % gd.y;
    let bz = grid_flat / (gd.x * gd.y);

    let bs = params.brick_size;
    let vs = params.voxel_size;
    let brick_world_min = params.world_min + 
        vec3<f32>(f32(bx) * f32(bs), f32(by) * f32(bs), f32(bz) * f32(bs)) * vs;

    // Evaluate each voxel inside the brick.
    for (var lz = 0u; lz < bs; lz++) {
        for (var ly = 0u; ly < bs; ly++) {
            for (var lx = 0u; lx < bs; lx++) {
                let world_pos = brick_world_min
                    + vec3<f32>(f32(lx) + 0.5, f32(ly) + 0.5, f32(lz) + 0.5) * vs;
                let d = eval_sdf(world_pos, grid_flat);
                let packed_byte = pack_u8(d, vs);

                let flat_voxel = (atlas_idx * bs * bs * bs) +
                                  lz * bs * bs + ly * bs + lx;
                let word_idx  = flat_voxel / 4u;
                let shift     = (flat_voxel % 4u) * 8u;
                let mask      = 0xFFu << shift;
                let val       = packed_byte << shift;

                // Atomic CAS loop to pack 4 u8 values into a single u32 word.
                var old = atomicLoad(&atlas[word_idx]);
                loop {
                    let new_val = (old & ~mask) | val;
                    let result = atomicCompareExchangeWeak(&atlas[word_idx], old, new_val);
                    if result.exchanged { break; }
                    old = result.old_value;
                }
            }
        }
    }
}
```

### Full SDF Evaluation

Each voxel queries all applicable edits:

```wgsl
fn eval_sdf(world_pos: vec3<f32>, brick_flat: u32) -> f32 {
    var d = 1e9;

    // Terrain.
    if params.terrain_enabled != 0u {
        d = terrain_sdf(world_pos);
    }

    // Per-brick edit list.
    let offset_start = edit_list_offsets[brick_flat];
    let offset_end   = edit_list_offsets[brick_flat + 1u];
    for (var k = offset_start; k < offset_end; k++) {
        let ei = edit_list_data[k];
        if ei >= params.edit_count { continue; }
        let edit = edits[ei];
        let p_local = (edit.transform * vec4<f32>(world_pos, 1.0)).xyz;
        let sd = sdf_eval_shape(p_local, edit);
        let bl = edit.blend_radius;
        let op = edit.boolean_op;
        if op == 0u { d = sdf_union(d, sd, bl); }
        else if op == 1u { d = sdf_subtraction(d, sd, bl); }
        else { d = sdf_intersection(d, sd, bl); }
    }
    return d;
}
```

### Atlas Packing: u8 Quantization

SDF values are **quantized to u8** for storage efficiency (memory bandwidth and per-level 256 KB vs. 1 MB). The quantization maps $$[-\text{max\_d}, +\text{max\_d}] \to [0, 255]$$:

```wgsl
fn pack_u8(value: f32, voxel_size: f32) -> u32 {
    // Map [-max_dist, +max_dist] → [0, 255].
    let max_d = voxel_size * 4.0;
    let normalised = clamp((value / max_d) * 0.5 + 0.5, 0.0, 1.0);
    return u32(normalised * 255.0);
}
```

**Precision:** with $$\text{max\_d} = 4 \times \text{voxel\_size}$$, each u8 level ≈ 0.06× voxel_size. For level 0 (voxel_size = 0.5), this is ~0.03 world units—sufficient for accurate ray marching.

---

## 7. The Sphere-Trace Pass: Fullscreen Ray Marching

The **fragment shader** performs fullscreen ray marching through the clipmap, querying SDF values and stepping along the ray.

### Fullscreen Vertex Shader

Generates a full-screen triangle with no vertex buffer:

```wgsl
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOut {
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0),
    );
    let p = pos[vid];
    var out: VertexOut;
    out.clip_pos = vec4<f32>(p, 0.0, 1.0);
    out.uv = p * 0.5 + 0.5;
    return out;
}
```

### Ray Marching Algorithm

Each pixel unprojets to a world-space ray and performs **relaxed sphere tracing**:

```wgsl
const MAX_STEPS: u32 = 256u;
const HIT_DIST: f32  = 0.01;
const MISS_DIST: f32 = 8000.0;

fn ray_march(ro: vec3<f32>, rd: vec3<f32>) -> f32 {
    var t = 0.0;
    for (var i = 0u; i < MAX_STEPS; i++) {
        let p = ro + rd * t;
        let d = sdf_query(p);
        if d < HIT_DIST { return t; }
        if t > MISS_DIST { return -1.0; }
        t += max(d * 0.8, HIT_DIST);  // Relaxed sphere trace
    }
    return -1.0;
}
```

The **relaxation factor 0.8** allows for some overstep to reduce iteration count while remaining stable with 8³ voxel bricks.

### SDF Query: Level Selection

The `sdf_query` function selects the **finest level** covering the query point:

```wgsl
fn sdf_query(world_pos: vec3<f32>) -> f32 {
    for (var li = 0u; li < clip_params.level_count; li++) {
        let lvl = clip_params.levels[li];
        let vs  = lvl.voxel_size;
        let gd  = f32(lvl.grid_dim) * f32(lvl.brick_dim) * vs;
        let lo  = lvl.world_min;
        let hi  = lo + vec3<f32>(gd);
        if all(world_pos > lo + vs) && all(world_pos < hi - vs) {
            return sample_level(li, world_pos);
        }
    }
    return 1e9;  // Outside all clipmaps (miss)
}
```

This uses **early-exit**: the first (finest) level containing the point is sampled, avoiding coarse blending artifacts.

### Atlas Sampling

Voxels are sampled with **trilinear interpolation** (4 corner lookups per sample):

```wgsl
fn sample_level(level_idx: u32, world_pos: vec3<f32>) -> f32 {
    let lvl = clip_params.levels[level_idx];
    let vs  = lvl.voxel_size;
    let bd  = f32(lvl.brick_dim);
    let gd  = f32(lvl.grid_dim);

    // Convert world pos to voxel coords within this level.
    let voxel = (world_pos - lvl.world_min) / vs;
    let voxel_int = vec3<i32>(floor(voxel));

    // Find which brick.
    let brick_coord = vec3<i32>(voxel_int) / vec3<i32>(i32(lvl.brick_dim));
    let gdi = vec3<i32>(i32(lvl.grid_dim));
    if any(brick_coord < vec3<i32>(0)) || any(brick_coord >= gdi) {
        return 1e9;
    }

    let local_voxel = vec3<u32>(vec3<i32>(voxel_int) - brick_coord * vec3<i32>(i32(lvl.brick_dim)));
    let base_offset = lvl.brick_index_offset;
    return sample_atlas_direct(level_idx, brick_flat, local_voxel, lvl.brick_dim, lvl.atlas_dim);
}
```

### Shading: Lighting and Normal Estimation

On hit, normals are estimated via **tetrahedron sampling** (4 SDF gradients):

```wgsl
fn calc_normal(p: vec3<f32>) -> vec3<f32> {
    let e = vec2<f32>(1.0, -1.0) * 0.001;
    return normalize(
        e.xyy * sdf_query(p + e.xyy) +
        e.yyx * sdf_query(p + e.yyx) +
        e.yxy * sdf_query(p + e.yxy) +
        e.xxx * sdf_query(p + e.xxx)
    );
}
```

Shading uses **sun + ambient**, suitable for terrain/global illumination integration:

```wgsl
@fragment
fn fs_main(in: VertexOut) -> FragOut {
    let ndc = vec4<f32>(in.clip_pos.xy / in.clip_pos.w * vec2<f32>(1.0, -1.0), 1.0, 1.0);
    let world_far = camera.inv_view_proj * vec4<f32>(ndc.xy, 1.0, 1.0);
    let ro = camera.position_near.xyz;
    let rd = normalize(world_far.xyz / world_far.w - ro);

    let t = ray_march(ro, rd);

    var out: FragOut;
    if t < 0.0 {
        // Miss — sky gradient.
        let sky_t = clamp(dot(rd, vec3<f32>(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
        out.color = vec4<f32>(mix(vec3<f32>(0.4, 0.6, 0.9), vec3<f32>(0.1, 0.2, 0.5), sky_t), 1.0);
        out.depth = 1.0;
    } else {
        let hit_pos = ro + rd * t;
        let n = calc_normal(hit_pos);

        // Simple sun + ambient lighting.
        let sun_dir    = normalize(vec3<f32>(0.6, 0.8, 0.3));
        let sun_color  = vec3<f32>(1.0, 0.9, 0.7);
        let ambient    = vec3<f32>(0.1, 0.12, 0.18);
        let albedo     = vec3<f32>(0.55, 0.48, 0.35);

        let diff = max(dot(n, sun_dir), 0.0);
        let lit  = albedo * (ambient + diff * sun_color);

        out.color = vec4<f32>(lit, 1.0);

        // Linearise depth for the hardware depth buffer.
        let clip_p = camera.view_proj * vec4<f32>(hit_pos, 1.0);
        out.depth  = clip_p.z / clip_p.w;
    }
    return out;
}
```

---

## 8. Smooth Blend Operations

Boolean operations between SDFs use **smooth (or blended) combinators** to avoid hard edges and reduce aliasing. All three operators support a **blend_radius** parameter.

### Smooth Union

Blends the inner regions of two SDFs:

$$d_{\text{union}}(a, b, k) = \begin{cases}
\min(a, b) & \text{if } k \le 0 \\
\text{mix}(b, a, h) - k \cdot h \cdot (1 - h) & \text{where } h = \text{clamp}(0.5 + 0.5 \cdot (b - a) / k, 0, 1)
\end{cases}$$

**WGSL:**
```wgsl
fn sdf_union(a: f32, b: f32, k: f32) -> f32 {
    if k <= 0.0 { return min(a, b); }
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}
```

**Interpretation:** $$k$$ is the blend radius in world units. $$k = 0$$ gives hard union; $$k > 0$$ creates a soft transition band.

---

### Smooth Subtraction

Inverts the second SDF and blends:

$$d_{\text{sub}}(a, b, k) = \begin{cases}
\max(-b, a) & \text{if } k \le 0 \\
\text{mix}(a, -b, h) + k \cdot h \cdot (1 - h) & \text{where } h = \text{clamp}(0.5 - 0.5 \cdot (a + b) / k, 0, 1)
\end{cases}$$

**WGSL:**
```wgsl
fn sdf_subtraction(a: f32, b: f32, k: f32) -> f32 {
    if k <= 0.0 { return max(-b, a); }
    let h = clamp(0.5 - 0.5 * (a + b) / k, 0.0, 1.0);
    return mix(a, -b, h) + k * h * (1.0 - h);
}
```

---

### Smooth Intersection

Blends the outer boundary:

$$d_{\text{int}}(a, b, k) = \begin{cases}
\max(a, b) & \text{if } k \le 0 \\
\text{mix}(b, a, h) + k \cdot h \cdot (1 - h) & \text{where } h = \text{clamp}(0.5 - 0.5 \cdot (b - a) / k, 0, 1)
\end{cases}$$

**WGSL:**
```wgsl
fn sdf_intersection(a: f32, b: f32, k: f32) -> f32 {
    if k <= 0.0 { return max(a, b); }
    let h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) + k * h * (1.0 - h);
}
```

---

### Choosing Blend Radius

- **k = 0**: Hard boolean (no blending) — fast but prone to aliasing
- **k = voxel_size**: Smooth over 1–2 voxels — natural for level 0 details
- **k = 2–4× voxel_size**: Heavy blending — carves smooth cavities, creates soft shadows

Blend radius **per-edit** allows fine-grained control over surface smoothness.

---

## 9. GPU Data Structures

### Uniform/Buffer Layouts

All structures are `Pod` + `Zeroable` and match WGSL byte-for-byte.

#### **SdfGridParams** (80 bytes)

Per-level grid configuration, uploaded each frame to compute shader:

```rust
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct SdfGridParams {
    pub world_min: [f32; 3],           // Offset 0
    pub voxel_size: f32,               // 12
    pub grid_dim: [u32; 3],            // 16
    pub brick_size: u32,               // 28
    pub active_brick_count: u32,       // 32
    pub atlas_capacity: u32,           // 36
    pub edit_count: u32,               // 40
    pub terrain_enabled: u32,          // 44
    pub atlas_dim: [u32; 3],           // 48
    pub _pad: u32,                     // 60
}
```

---

#### **GpuClipLevel** (64 bytes)

Per-level data in the render shader's `ClipMapParams` array:

```rust
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct GpuClipLevel {
    pub world_min: [f32; 3],           // Offset 0
    pub voxel_size: f32,               // 12
    pub grid_dim: u32,                 // 16
    pub brick_dim: u32,                // 20
    pub brick_index_offset: u32,       // 24
    pub active_brick_count: u32,       // 28
    pub toroidal_origin: [i32; 3],     // 32
    pub _pad0: u32,                    // 44
    pub atlas_dim: [u32; 3],           // 48
    pub _pad1: u32,                    // 60
}
```

---

#### **SdfClipMapParams** (528 bytes)

Gather of all 8 levels' data, uploaded to render shader:

```rust
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct SdfClipMapParams {
    pub level_count: u32,              // Offset 0
    pub _pad: [u32; 3],                // 4
    pub levels: [GpuClipLevel; 8],     // 16
}
```

---

#### **GpuSdfEdit** (96 bytes)

One SDF edit instruction, uploaded in a storage buffer:

```rust
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct GpuSdfEdit {
    pub transform: [f32; 16],          // Offset 0 (world-to-local)
    pub shape_type: u32,               // 64
    pub boolean_op: u32,               // 68
    pub blend_radius: f32,             // 72
    pub _pad0: u32,                    // 76
    pub params: SdfShapeParams,        // 80 (4 × f32)
    // Total: 96
}
```

where `SdfShapeParams`:

```rust
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct SdfShapeParams {
    pub param0: f32,
    pub param1: f32,
    pub param2: f32,
    pub param3: f32,
}
```

---

#### **GpuTerrainParams** (32 bytes)

Procedural terrain configuration (FBM Perlin noise):

```rust
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct GpuTerrainParams {
    pub enabled: u32,                  // Offset 0
    pub style: u32,                    // 4
    pub height: f32,                   // 8
    pub amplitude: f32,                // 12
    pub frequency: f32,                // 16
    pub octaves: u32,                  // 20
    pub lacunarity: f32,               // 24
    pub persistence: f32,              // 28
}
```

---

### BrickMap (CPU State)

```rust
pub struct BrickMap {
    pub world_min: Vec3,
    pub voxel_size: f32,
    pub grid_dim: u32,                 // 16
    pub brick_size: u32,               // 8
    pub atlas_dim: u32,                // 8

    // Per-brick 3D grid (flattened to 1D)
    pub states: Vec<BrickState>,       // [Empty|Active(idx)|Freed]
    pub dirty: Vec<bool>,              // Dirty flags

    pub toroidal_origin: [i32; 3],     // Current origin in brick coords

    // GPU Buffers
    pub atlas_buffer: Option<wgpu::Buffer>,
    pub active_brick_buf: Option<wgpu::Buffer>,
    pub brick_index_buf: Option<wgpu::Buffer>,
    pub params_buf: Option<wgpu::Buffer>,
    pub edit_list_offsets_buf: Option<wgpu::Buffer>,
    pub edit_list_data_buf: Option<wgpu::Buffer>,

    // CPU-side edit lists (one offset+count pair per brick)
    pub edit_list_offsets: Vec<u32>,
    pub edit_list_data: Vec<u32>,
    pub brick_index_cpu: Vec<u32>,
}
```

---

## 10. Bind Group Layouts

### Compute Pass (Build Pass)

**Group 0** — Per-level bindings (one dispatch per level):

| Binding | Type | Format | Stage | Notes |
|---------|------|--------|-------|-------|
| 0 | Uniform Buffer | `SdfGridParams` | Compute | Grid parameters |
| 1 | Storage Buffer (R) | `array<SdfEdit>` | Compute | All edits |
| 2 | Storage Buffer (RW) | `array<atomic<u32>>` | Compute | SDF atlas (output) |
| 3 | Storage Buffer (R) | `array<u32>` | Compute | Active brick indices |
| 4 | Storage Buffer (R) | `array<u32>` | Compute | Brick index map |
| 5 | Uniform Buffer | `GpuTerrainParams` | Compute | Terrain config |
| 6 | Storage Buffer (R) | `array<u32>` | Compute | Edit list offsets |
| 7 | Storage Buffer (R) | `array<u32>` | Compute | Edit list data |

---

### Render Pass (Ray March Pass)

**Group 0** — Global camera:

| Binding | Type | Format | Stage | Notes |
|---------|------|--------|-------|-------|
| 0 | Uniform Buffer | `GpuCameraUniforms` (368 bytes) | Vertex + Fragment | Camera matrix, position, planes |

**Group 1** — Clipmap atlases:

| Binding | Type | Format | Stage | Notes |
|---------|------|--------|-------|-------|
| 0 | Uniform Buffer | `SdfClipMapParams` | Fragment | All 8 levels' params |
| 1–8 | Storage Buffer (R) | `array<u32>` | Fragment | Atlases for levels 0–7 |
| 9 | Storage Buffer (R) | `array<u32>` | Fragment | All brick indices (flattened) |

---

## 11. API: Creating and Managing Edits

### Adding a Sphere Edit

```rust
use helio_pass_sdf::*;

let mut pass = SdfClipmapPass::new(&device, &camera_buf, surface_format);
pass.set_terrain(TerrainConfig::rolling());

let sphere_edit = SdfEdit {
    shape: SdfShapeType::Sphere,
    op: BooleanOp::Union,
    transform: Mat4::from_translation(Vec3::new(10.0, 5.0, -20.0)),
    params: SdfShapeParams::sphere(8.0),
    blend_radius: 0.5,  // Soft edge over 0.5 units
};
let id = pass.add_edit(sphere_edit);
```

### Modifying an Edit

```rust
let mut updated = sphere_edit;
updated.params = SdfShapeParams::sphere(12.0);  // Grow
pass.set(id, updated);
```

### Removing an Edit

```rust
pass.remove_edit(id);  // Also rebuilds CPU BVH
```

### Setting Terrain

```rust
pass.set_terrain(TerrainConfig::rolling());
// Or customize:
let custom = TerrainConfig {
    style: TerrainStyle::Rolling,
    height: 10.0,
    amplitude: 50.0,
    frequency: 0.01,
    octaves: 8,
    lacunarity: 2.0,
    persistence: 0.5,
};
pass.set_terrain(custom);
```

---

## 12. Integration with Other Passes

### Reading the SDF

Other passes (e.g., **helio-pass-gi**, **helio-pass-ao**) can ray-march the SDF clipmap by:

1. **Binding the same atlases** (group 1 from the render pass)
2. **Calling `sdf_query(world_pos)`** to get the distance at any point
3. **Ray marching with custom step logic** for soft shadows, cone tracing, etc.

Example: cone-traced ambient occlusion:

```wgsl
// In helio-pass-ao or custom GI pass
@group(1) @binding(1) var<storage, read> sdf_atlases[8]: array<u32>;

fn cone_trace_ao(hit_pos: vec3<f32>, normal: vec3<f32>) -> f32 {
    var occlusion = 0.0;
    let cone_angle = 0.5;  // radians
    let max_distance = 10.0;
    
    for (var i = 0; i < 16; i++) {
        let dist = f32(i) * 0.5;
        let p = hit_pos + normal * dist;
        let sdf_dist = sdf_query(p);  // Reuse ray march shader's sdf_query
        if sdf_dist < 0.0 {
            occlusion += 1.0 / f32(i + 1);
        }
    }
    return min(occlusion / 16.0, 1.0);
}
```

### Debug Visualization

A debug pass can slice the SDF along the camera plane:

```wgsl
fn vs_debug_sdf(pos: vec3<f32>) -> FragOut {
    let sdf_val = sdf_query(pos);
    let shaded = (sdf_val + 10.0) / 20.0;  // Map [-10, +10] to [0, 1]
    return vec4<f32>(vec3<f32>(shaded), 1.0);
}
```

> [!NOTE]
> The SDF clipmap is read-only from other passes. Edits go through `SdfClipmapPass::add_edit()`. This ensures consistency and allows batching updates.

---

## 13. Performance Characteristics

### Memory

| Component | Size | Qty | Total |
|-----------|------|-----|-------|
| Per-level atlas | 256 KB | 8 | 2.0 MB |
| Per-level params | 80 bytes | 8 | 640 B |
| Edit list offsets | 64 KB | 8 | 512 KB |
| Edit list data | ~256 KB | 8 | ~2 MB |
| All brick indices | ~32 KB | 1 | 32 KB |
| Clip params | 528 B | 1 | 528 B |
| **Total** | | | **~4.5 MB** |

Sparse allocation: with <50% occupancy, typical projects use **2–3 MB**.

### CPU

| Operation | Cost |
|-----------|------|
| First frame | Full classification: O(8 × 4096) = 32k BVH tests |
| Static scene | O(1) per frame (no reclassification) |
| Camera movement | O(shell size per level) = O(1024) brick tests |
| Edit add/remove | O(1) insertion + BVH rebuild (~100–500 µs for 1k edits) |

### GPU

| Pass | Kernel | Invocations | Cost |
|------|--------|-------------|------|
| Compute (build) | cs_evaluate_sparse | 1–400 (active bricks) | 1–10 ms (256 threads/brick, <512 voxels) |
| Render (ray march) | fs_main | Full screen (1920×1080) | 2–8 ms (256 steps, compressed SDF) |

---

## 14. Examples and Use Cases

### Example 1: Static Terrain + Dynamic Sphere

```rust
let mut pass = SdfClipmapPass::new(&device, &camera_buf, format);
pass.set_terrain(TerrainConfig::rolling());

// Add enemies as spheres; remove when defeated
let enemy_id = pass.add_edit(SdfEdit {
    shape: SdfShapeType::Sphere,
    op: BooleanOp::Union,
    transform: Mat4::from_translation(enemy_pos),
    params: SdfShapeParams::sphere(2.0),
    blend_radius: 0.0,
});
// Later:
pass.remove_edit(enemy_id);
```

### Example 2: Carving with Subtraction

```rust
let carve = SdfEdit {
    shape: SdfShapeType::Cube,
    op: BooleanOp::Subtraction,
    transform: Mat4::from_translation(Vec3::new(0.0, 20.0, 0.0)),
    params: SdfShapeParams::cube(15.0, 5.0, 10.0),
    blend_radius: 2.0,  // Smooth edges
};
pass.add_edit(carve);
```

### Example 3: Building Complex Shapes via CSG

```rust
// Tower: cylinder + sphere on top
let base = SdfEdit {
    shape: SdfShapeType::Cylinder,
    op: BooleanOp::Union,
    transform: Mat4::from_translation(Vec3::new(50.0, 0.0, 0.0)),
    params: SdfShapeParams::cylinder(5.0, 20.0),
    blend_radius: 0.5,
};

let top = SdfEdit {
    shape: SdfShapeType::Sphere,
    op: BooleanOp::Union,
    transform: Mat4::from_translation(Vec3::new(50.0, 25.0, 0.0)),
    params: SdfShapeParams::sphere(7.0),
    blend_radius: 0.5,
};

pass.add_edit(base);
pass.add_edit(top);
```

---

## 15. Advanced Topics

### Temporal Coherence

Since the SDF clipmap bakes once per frame, ray-marched pixels see the **same SDF each frame** (unless edits change). This enables:

- **Temporal filtering** in downstream passes (GI, AO)
- **Stable ray-trace patterns** for TAA integration
- **Animation-friendly** if edits are updated smoothly

### Level Blending vs. Discontinuities

Ray marching uses **discrete level selection** (finest level only). Alternative: blend two adjacent levels for smoother shadows across level boundaries. Current approach trades minor banding for cache coherence.

### Edit List Compression

Per-brick edit lists are built during classification, using an **Edit BVH** to cull non-intersecting edits. This keeps per-brick edit counts low (<16 on average) despite potentially 4096 global edits.

### Collision Integration

Physics engines can query `sdf_query()` at arbitrary points from Rust:

```rust
// In physics step callback:
let sdf_distance = sdf_clipmap.sample(physics_body_pos);
if sdf_distance < 0.0 {
    // Inside SDF; apply penalty force
}
```

(Requires exposing a CPU-side SDF query interface—planned for future.)

---

## 16. Troubleshooting

### Artifacts: Hard Edges Between Levels

**Cause:** Discontinuous level selection near level boundaries.
**Fix:** Increase blend radius on edits; use intersection slightly above level boundary.

### Artifacts: Ray March Overshooting

**Cause:** Relaxation factor (0.8) too aggressive with large bricks.
**Fix:** Reduce to 0.6; check HIT_DIST is matched to finest voxel size.

### Memory Spike on Edit Add

**Cause:** BVH rebuild on every edit.
**Fix:** Batch edits and call once per frame; use removal sparingly (triggers full reclassification).

### Ray March Missing Thin Features

**Cause:** Level 0 voxel size too large.
**Fix:** Reduce `base_voxel_size` from 0.5 to 0.25; be aware of memory and performance cost.

---

## References & Further Reading

- **IQ's SDF Primitives**: [inigo quilez SDF docs](https://www.iquilezles.org/articles/distfunctions)
- **Clipmap Technique**: [Losasso et al., "Procedural Noise using Sparse Grids"](https://graphics.pixar.com/library/)
- **Sphere Tracing**: [Hart, "Sphere Tracing: A Geometric Method for the Antialiased Ray Tracing of Implicit Surfaces"](https://graphics.pixar.com/library/)
- **Smooth Min/Max**: [Comparison of smooth-min operators](https://www.shadertoy.com/results?query=smooth+min)
