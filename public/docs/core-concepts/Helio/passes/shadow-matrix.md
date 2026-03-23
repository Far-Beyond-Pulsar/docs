---
title: Shadow Matrix Pass
description: GPU compute pass that derives light-space view-projection matrices for all shadow-casting lights in a single dispatch — enabling dynamic shadows with zero CPU matrix math per light
category: helio
lastUpdated: '2026-03-23'
tags:
  - shadows
  - compute
  - gpu-driven
  - matrices
  - csm
position: 19
icon: '🌑'
---

The `ShadowMatrixPass` is a single-dispatch compute pass that derives every light-space view-projection matrix needed for shadow rendering — covering point light cube faces, spot light perspective projections, and directional light CSM cascades — entirely on the GPU. The CPU's only contribution per frame is writing two integers to a uniform buffer.

---

## 1. Why GPU-Driven Matrix Computation

Shadow rendering requires a complete view-projection matrix for every face of every shadow-casting light. For a scene with 32 point lights, that is 192 matrices — each requiring a look-at multiply followed by a perspective multiply, plus the upload of 192 × 64 = 12,288 bytes of matrix data to GPU memory every frame. On the CPU, these are sequential floating-point operations interleaved with `write_buffer` calls, meaning the GPU cannot begin shadow rendering until the CPU has finished all 192 constructions and the data has transferred across the PCIe bus.

The GPU-driven alternative eliminates both costs. The lights buffer is already GPU-resident from the previous scene upload. The camera uniform is already GPU-resident from the camera pass. With those two resources in place, a single compute dispatch derives all matrices in parallel — one thread per light — with no CPU arithmetic and no per-matrix data transfer. The only upload is the 16-byte `ShadowMatrixUniforms` struct containing `light_count` and `shadow_atlas_size`, written once in `prepare()`.

This is the same architectural philosophy as GPU-driven indirect draw calls: move decision-making and data construction to the chip that will consume the results. A compute shader running at thousands of threads-per-second completes the full matrix set in microseconds, well within the time the GPU would have spent waiting for a CPU-issued transfer to arrive.

> [!IMPORTANT]
> The `shadow_matrix_buf` written by this pass is GPU-resident for its entire lifetime. `ShadowPass` reads it directly as a storage buffer — no readback, no staging buffer, no synchronisation barrier beyond the implicit command encoder ordering.

---

## 2. Shadow Face Geometry

The number and type of view-projection matrices required for a light is determined by its geometry. A shadow map is a depth image rendered from the light's point of view; its projection matrix must exactly contain all geometry that could cast a shadow visible to the camera. Getting this projection wrong produces either missing shadow coverage (clipped occluders) or wasted resolution (overfit frustum).

**Point lights** illuminate a full sphere. There is no single frustum that can capture all directions simultaneously, so shadow sampling uses a cube map lookup — the direction from the light to the shadow receiver selects one of six faces. Each face corresponds to a 90° field-of-view perspective projection along one of the six cardinal axes: +X, −X, +Y, −Y, +Z, −Z. The FOV of exactly 90° is not arbitrary: adjacent cube faces share a 90° boundary, so the six projections tile the full sphere without overlap or gap. The far plane is set to `max(range, 0.1) × 2.5`. The 2.5× factor is derived from the geometry of the cube face corners: the corners of a unit cube face are at distance √3 ≈ 1.732 from the center, so a point at `range` distance along a face diagonal is at `range × √3` from the light. The 2.5× factor provides full coverage with a small safety margin.

**Spot lights** require a single perspective projection. The light cone's outer angle directly determines the field of view:

$$
\text{FOV} = 2 \cdot \arccos(\cos\theta_{\text{outer}})
$$

This is clamped to $$[45°, 179°]$$ to prevent degenerate near-zero and near-180° projections. The far plane equals `range` — the physical extent of the light's influence — rather than the 2.5× extension used for point lights, because a spot's cone already constrains the shadow volume.

**Directional lights** have no position; they cast parallel rays from infinite distance. The shadow volume is not anchored to a light position but to the camera's view frustum — only geometry inside the frustum can produce visible shadows. This requires a fundamentally different algorithm: Cascaded Shadow Maps (CSM). The CSM algorithm is detailed in Section 3.

---

## 3. Cascaded Shadow Maps — Sphere-Fit and Texel Snapping

A directional light covers the entire scene, but allocating a single shadow map for the full camera frustum wastes almost all of its texels. At a typical view distance of 1,400 metres, a 2048×2048 atlas tile covers roughly one texel per 68 cm of world space in the worst case. Near the camera, where shadow detail is most perceptible, that resolution is entirely inadequate. Cascaded Shadow Maps solve this by dividing the camera frustum into depth slices, each covered by an independent shadow map at a resolution matched to its distance from the camera.

Helio uses four cascades with hard-coded world-space far planes of `(16, 80, 300, 1400)` metres. The first cascade covers the immediate surroundings to 16 m at high resolution; the fourth covers the scene out to 1,400 m with acceptable coarser sampling for distant geometry.

### 3.1 Frustum Slice Construction

For each cascade, the shader determines which slice of the camera frustum to cover. The full frustum is unprojected from NDC space to world space by multiplying the 8 NDC corners through `camera.inv_view_proj` with a homogeneous divide:

$$
\vec{p}_{\text{world},i} = \frac{M_{\text{inv\_vp}} \cdot \vec{c}_{\text{ndc},i}}{(M_{\text{inv\_vp}} \cdot \vec{c}_{\text{ndc},i}).w}
$$

The average distance of the four near-face corners from the camera position gives `near_dist`; the four far-face corners give `far_dist`. These are used to compute parametric interpolation parameters for each cascade:

$$
t_0 = \text{clamp}\!\left(\frac{d_{\text{prev}} - d_{\text{near}}}{d_{\text{far}} - d_{\text{near}}},\ 0,\ 1\right), \quad
t_1 = \text{clamp}\!\left(\frac{d_{\text{split},i} - d_{\text{near}}}{d_{\text{far}} - d_{\text{near}}},\ 0,\ 1\right)
$$

The eight world-space corners of the frustum slice are then built by linearly interpolating between corresponding near and far frustum corners at $$t_0$$ and $$t_1$$:

$$
\vec{c}_j^{\text{near}} = \text{lerp}(\vec{p}_j^{\text{near}},\ \vec{p}_j^{\text{far}},\ t_0), \quad
\vec{c}_j^{\text{far}}  = \text{lerp}(\vec{p}_j^{\text{near}},\ \vec{p}_j^{\text{far}},\ t_1)
$$

### 3.2 Sphere Fitting

The 8 slice corners are axis-aligned in world space but arbitrarily oriented relative to the light direction. A tight bounding box aligned to the light space would need to be recomputed every time the camera rotates, causing the shadow map to resize and shear — a visible artefact. The sphere-fit approach eliminates this by using the smallest sphere that contains all 8 corners. A sphere has no orientation dependence, so its projection into any orthographic view is always a square of fixed size.

The centroid of the 8 corners defines the sphere center; the radius is the maximum distance from the centroid to any corner:

$$
\vec{c} = \frac{1}{8}\sum_{i=0}^{7} \vec{c}_i, \qquad r = \max_{i} \left\|\vec{c}_i - \vec{c}\right\|
$$

The orthographic projection is then $$[-r, +r] \times [-r, +r]$$ in light space, with a depth range of $$[0.1, \text{SCENE\_DEPTH} \times 2]$$ — the 2× factor allows the light view to look down through geometry that extends below the shadow receiver.

### 3.3 Texel Snapping

Even with sphere fitting, translating the camera causes the centroid to move continuously through the shadow map, sweeping the texel footprint across world space. Each frame, the same world-space point maps to a slightly different texel, producing a shimmering artefact visible as a subtle crawling pattern on shadow edges. The fix is to constrain the centroid to a discrete grid aligned to the texel size.

The texel size in world space is:

$$
s_{\text{texel}} = \frac{2r}{N_{\text{atlas}}}
$$

where $$N_{\text{atlas}} = 2048$$ is the atlas tile resolution. The radius itself is first snapped to a texel boundary — `radius_snap = ceil(r / s_texel) * s_texel` — to prevent the grid spacing from changing between frames. Then the centroid is transformed into the (unsnapped) light view space, and its X and Y coordinates are rounded to the nearest multiple of $$s_{\text{texel}}$$:

$$
x_{\text{snap}} = \text{round}\!\left(\frac{x_\text{ls}}{s_\text{texel}}\right) \cdot s_\text{texel}, \quad
y_{\text{snap}} = \text{round}\!\left(\frac{y_\text{ls}}{s_\text{texel}}\right) \cdot s_\text{texel}
$$

The snap offset is then converted back to world space by projecting along the light view's right and up axes, and the corrected centroid is used to build the final view matrix. With this correction in place, the shadow map is stationary relative to the world grid whenever the camera translates without rotating — shimmering disappears entirely.

```wgsl
let texel_size   = (2.0 * radius) / ATLAS_TEXELS;
let radius_snap  = ceil(radius / texel_size) * texel_size;

// Transform centroid into light space and snap
let light_view_raw  = mat4_look_at_rh(centroid - dir * SCENE_DEPTH, centroid, up);
let centroid_ls     = (light_view_raw * vec4f(centroid, 1.0)).xyz;
let snapped_x       = round(centroid_ls.x / texel_size) * texel_size;
let snapped_y       = round(centroid_ls.y / texel_size) * texel_size;

// Back-project snap offset to world space
let right_ws    = normalize(vec3f(light_view_raw[0][0], light_view_raw[1][0], light_view_raw[2][0]));
let up_ws       = normalize(vec3f(light_view_raw[0][1], light_view_raw[1][1], light_view_raw[2][1]));
let snap_offset = right_ws * (snapped_x - centroid_ls.x)
                + up_ws    * (snapped_y - centroid_ls.y);

let stable_centroid = centroid + snap_offset;
let light_view      = mat4_look_at_rh(stable_centroid - dir * SCENE_DEPTH, stable_centroid, up);
let proj            = mat4_orthographic_rh(
    -radius_snap, radius_snap, -radius_snap, radius_snap, 0.1, SCENE_DEPTH * 2.0
);
shadow_mats[base + cascade_idx].mat = proj * light_view;
```

> [!NOTE]
> The slot layout for directional lights allocates 6 entries in `shadow_mats` — the same as a point light — for uniform buffer stride. Slots 4 and 5 are filled with identity matrices. This ensures `ShadowPass` can index any light type with the formula `shadow_index + face` without a branch on light type.

The cascade split distances used throughout the algorithm match the `CSM_SPLITS` constant in the shader and the `split_distance` fields in `CascadeConfig`:

| Cascade | Far Plane | Description |
|---|---|---|
| 0 | 16 m | High-detail near field |
| 1 | 80 m | Mid-range coverage |
| 2 | 300 m | Extended environment |
| 3 | 1400 m | Full scene horizon |

---

## 4. Dirty Tracking and FNV Hashing

The bind group includes two buffers beyond the core inputs: `shadow_dirty` (binding 4) and `shadow_hashes` (binding 5). Their purpose is change detection — a future optimisation where `ShadowPass` re-renders only those shadow maps whose view-projection matrices have actually changed, skipping the depth render for static lights in a static scene.

The design is as follows. `shadow_dirty` is a bitset with one bit per light; the CPU sets a light's bit when the light moves, changes intensity, or is added. `shadow_hashes` stores FNV-1a hashes of each light's 6 computed matrices; the shader can compare the new hash against the stored hash to confirm whether a recompute produced a different result. If neither the dirty bit nor the hash changed, `ShadowPass` can skip that light's shadow render entirely.

The shader uses FNV-1a (Fowler–Noll–Vo, variant 1a) because it is the cheapest non-trivial hash on GPU: it requires only XOR and multiply, processes the input byte-by-byte through bitcast, and produces a 32-bit result with adequate distribution for this use case. The algorithm operates on the IEEE 754 bit representation of each float in the matrix:

```wgsl
fn fnv_hash_mat(m: mat4x4f) -> u32 {
    var hash: u32 = 2166136261u;  // FNV offset basis
    for (var col = 0u; col < 4u; col++) {
        for (var row = 0u; row < 4u; row++) {
            let bits = bitcast<u32>(m[col][row]);
            hash ^= (bits & 0xFFu);        hash = hash * 16777619u;
            hash ^= ((bits >> 8u)  & 0xFFu); hash = hash * 16777619u;
            hash ^= ((bits >> 16u) & 0xFFu); hash = hash * 16777619u;
            hash ^= ((bits >> 24u) & 0xFFu); hash = hash * 16777619u;
        }
    }
    return hash;
}
```

The outer `fnv_hash_mats_6` function folds the hashes of all 6 matrix slots for a light into a single 32-bit value by applying the same FNV accumulation over the per-matrix hashes.

> [!NOTE]
> As the shader comment documents, dirty tracking is not active in the current implementation: `shadow_dirty` is never written by the CPU, so the shader computes all matrices unconditionally every frame. The infrastructure — the bind group entries, the hash buffers, and the hashing functions — is fully in place for the optimisation. The comment reads: *"dirty tracking removed because shadow_dirty is never written and would skip all non-directional lights."*

---

## 5. Bind Group Layout

All six bindings occupy a single bind group, reflecting the pass's narrow purpose: it reads lights and camera, writes matrices and hashes, and needs no textures, samplers, or multi-group indirection.

| Binding | Name | Buffer Type | Stage | Purpose |
|---|---|---|---|---|
| 0 | `lights` | `storage<read>` | Compute | Source light data — position, direction, range, type, shadow index |
| 1 | `shadow_mats` | `storage<read_write>` | Compute | Output: one `mat4x4f` per shadow face, indexed by `shadow_index + face` |
| 2 | `camera` | `uniform` | Compute | Camera matrices and position — used by CSM cascade unprojection |
| 3 | `params` | `uniform` | Compute | `ShadowMatrixUniforms`: `light_count`, `shadow_atlas_size` |
| 4 | `shadow_dirty` | `storage<read>` | Compute | Bitset of dirty-flagged lights (future optimisation; currently unused) |
| 5 | `shadow_hashes` | `storage<read_write>` | Compute | FNV-1a hashes of each light's 6 matrices for change detection |

The `params` uniform corresponds to the Rust-side `ShadowMatrixUniforms` struct:

```rust
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ShadowMatrixUniforms {
    light_count:       u32,
    shadow_atlas_size: u32,  // hardcoded 4096 in prepare()
    _pad:              [u32; 2],
}
```

The `shadow_atlas_size` field is present in the uniform for forward compatibility — a shader variant could use it to compute texel sizes without the `ATLAS_TEXELS` constant. In the current implementation it is always `4096`.

---

## 6. The Dispatch — O(1) CPU

The fundamental property of this pass is that CPU cost is constant regardless of light count. The `prepare()` method writes a 16-byte uniform. The `execute()` method issues one compute dispatch. Both operations are independent of scene complexity.

```rust
fn prepare(&mut self, ctx: &PrepareContext) -> HelioResult<()> {
    let u = ShadowMatrixUniforms {
        light_count:       ctx.scene.lights.len() as u32,
        shadow_atlas_size: 4096,
        _pad:              [0; 2],
    };
    ctx.queue.write_buffer(&self.uniform_buf, 0, bytemuck::bytes_of(&u));
    Ok(())
}

fn execute(&mut self, ctx: &mut PassContext) -> HelioResult<()> {
    let count = ctx.scene.light_count;
    if count == 0 { return Ok(()); }

    let wg = count.div_ceil(WORKGROUP_SIZE);  // WORKGROUP_SIZE = 64
    let mut pass = ctx.encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
        label: Some("ShadowMatrix"),
        timestamp_writes: None,
    });
    pass.set_pipeline(&self.pipeline);
    pass.set_bind_group(0, &self.bind_group, &[]);
    pass.dispatch_workgroups(wg, 1, 1);
    Ok(())
}
```

The dispatch geometry is $$\lceil N / 64 \rceil \times 1 \times 1$$ workgroups. Each workgroup contains 64 threads; each thread handles exactly one light. Threads with index ≥ `light_count` return immediately — the overhead is at most 63 idle threads in the final workgroup, negligible at any light count. With 64 lights the dispatch is exactly one workgroup; with 192 lights (32 point lights × 6 faces, represented as 32 lights each writing 6 matrices) it is three workgroups.

The matrix count per dispatch is:

$$
N_{\text{matrices}} = \sum_{\text{lights}} \begin{cases} 6 & \text{point} \\ 4 + 2_{\text{identity}} & \text{directional} \\ 1 & \text{spot} \end{cases}
$$

Each thread writes between 1 and 6 `mat4x4f` values (64 bytes each) to the `shadow_mats` storage buffer. The worst case is an all-point-light scene, where each thread writes 384 bytes. At 64 lights, the total write is 24,576 bytes — all within a single dispatch that completes before the shadow pass begins.

> [!TIP]
> The early-out `if count == 0 { return Ok(()) }` prevents an unnecessary compute pass encoder when no lights are active. This matters at scene startup, during cutscene sequences with ambient-only lighting, and in degenerate test scenes.

---

## 7. Integration with the Render Graph

`ShadowMatrixPass` runs at a fixed position before `ShadowPass` in the render graph. The dependency is straightforward: `ShadowPass` uses `shadow_mats` to set up one depth render per shadow face, so the buffer must be fully written before any shadow face begins. The command encoder ensures this by sequencing the compute pass before the shadow render passes in submission order — no explicit barrier or pipeline layout transition is required because wgpu's storage buffer model handles the visibility.

The frame resources involved:

| Resource | Producer | Consumer |
|---|---|---|
| `lights_buf` | Scene upload (CPU) | `ShadowMatrixPass`, `DeferredLightPass` |
| `camera_buf` | Camera pass (CPU) | `ShadowMatrixPass`, `DeferredLightPass`, `GBufferPass` |
| `shadow_matrix_buf` | **`ShadowMatrixPass`** | `ShadowPass`, `DeferredLightPass` |
| `shadow_dirty_buf` | CPU (future) | `ShadowMatrixPass` (currently unused) |
| `shadow_hashes_buf` | `ShadowMatrixPass` | `ShadowMatrixPass` (read next frame, future) |

The `ShadowConfig` consumed by `DeferredLightPass` (Section 4.3 of the deferred light pass documentation) is not involved here — it controls PCF/PCSS filtering parameters at shading time, not the view-projection matrices used for shadow map generation.

```
Frame N timeline:
 ┌──────────────────────────────────────────────────────────────────────┐
 │  CPU: write_buffer(lights)          │  queue.write_buffer(uniforms)  │
 │  CPU: write_buffer(camera)          │  (16 bytes, light_count only)  │
 └─────────────────────┬──────────────┴──────────────────────┬─────────┘
                        ↓ submit                              ↓ prepare()
 ┌──────────────────────────────────────────────────────────────────────┐
 │  GPU: ShadowMatrixPass  →  ShadowPass  →  GBufferPass  →  DeferredLightPass │
 │        (compute)            (depth)        (raster)         (fullscreen)      │
 └──────────────────────────────────────────────────────────────────────┘
```

The shadow matrix buffer flows horizontally: computed once by `ShadowMatrixPass` and read by both `ShadowPass` (to orient the depth renders) and `DeferredLightPass` (to transform shadow receiver positions into each light's clip space for PCF lookup). This shared consumer pattern is why the buffer is GPU-resident for the frame's lifetime rather than re-uploaded per-pass.
