---
title: SDF Constructive Solid Geometry
description: Real-time constructive solid geometry using signed distance fields, edit lists, clip maps, and ray marching in Helio
category: experiments
lastUpdated: '2026-03-18'
tags: [sdf, csg, ray-marching, constructive-solid-geometry, terrain, edit-bvh]
related:
  - core-concepts/experiments/Helio
  - core-concepts/experiments/Helio/feature-system
  - core-concepts/experiments/Helio/deferred-pipeline
position: 10
icon: Shapes
---

# SDF Constructive Solid Geometry

Helio's SDF system gives you fully dynamic, analytically defined solid geometry without a single triangle mesh. You describe the world as a composition of primitive shapes combined through boolean operations — unions, subtractions, intersections, and their smooth blended variants — and the renderer evaluates that composition on the GPU every frame by ray marching through a multi-resolution volume. The result looks and shades exactly like opaque mesh geometry: it receives the same PBR lighting, writes to the same depth buffer, and participates in the same deferred pipeline. The only difference is how the geometry is stored and evaluated.

This page is a complete reference for every concept in the `sdf` module: primitives, the edit list, clip maps, brick storage, the BVH acceleration structure, GPU passes, terrain generation, and runtime interaction.

<!-- screenshot: SDF cave carved out of terrain with smooth union blend visible between spheres -->

---

## What Is a Signed Distance Field?

A **signed distance field** (SDF) is a scalar field defined over 3-D space. At every point **p** in that space, the field stores a single number: the signed shortest distance from **p** to the nearest surface of some shape. Negative values mean **p** is *inside* the shape; positive values mean it is *outside*; zero means **p** is exactly on the surface. The set of all points where the SDF equals zero forms an *implicit surface* — a perfectly smooth surface defined by a mathematical condition rather than by a polygon mesh.

Formally, for a surface **S**, the signed distance field at point **p** is:

$$f(\mathbf{p}) = \begin{cases} -d(\mathbf{p}, \mathcal{S}) & \text{if } \mathbf{p} \text{ is inside } \mathcal{S} \\ 0 & \text{if } \mathbf{p} \in \mathcal{S} \\ +d(\mathbf{p}, \mathcal{S}) & \text{if } \mathbf{p} \text{ is outside } \mathcal{S} \end{cases}$$

where **d(p, S)** is the shortest Euclidean distance from **p** to any point on the surface. The **sign** encodes inside/outside. The **magnitude** is the distance to the nearest surface. The **zero level set** — all points where **f(p) = 0** — is the surface itself.

The power of SDFs in real-time rendering comes from two properties:

- **Boolean operations are cheap.** Combining two SDFs into a union, subtraction, or intersection is a single scalar operation per sample point. There are no mesh boolean artifacts, no T-junctions, no degenerate triangles, no topology problems.
- **Ray marching is efficient.** Because the SDF tells you the safe step distance (you can always advance a ray by at least `|sdf(p)|` without crossing the surface), a ray marcher can traverse empty space in large steps and converge on surfaces precisely, all in a compute shader.

> [!NOTE]
> SDFs represent *implicit* geometry. The surface is never explicitly enumerated as vertices or faces. This means you can add, remove, and animate primitives at runtime with no mesh rebuild step — the GPU simply re-evaluates the field on the next frame.

Helio evaluates SDFs by baking the composed field into a **3-D volume texture** on the GPU (the clip map), then ray marching through that volume in a fullscreen pass. Baking lets the ray marcher sample the composed field with a single trilinear texture fetch per step instead of re-evaluating every edit's analytical formula on every march step. This decouples edit count from march cost.

---

## Architecture Overview

The following diagram shows how data flows from the CPU-side edit list through to the final rendered pixels.

```mermaid
flowchart TD
    A["SdfEditList<br/>cpu edits"] -->|generation bump| B["SdfFeature.prepare<br/>upload to GPU"]
    B --> C["edit_buffer<br/>GpuSdfEdit array"]
    B --> D["params_buffer<br/>SdfGridParams"]
    E["EditBVH<br/>AABB tree"] -->|O log N cull| F["SdfClipUpdatePass<br/>GPU compute"]
    C --> F
    D --> F
    F -->|write SDF values| G["Clip Map<br/>4 × 3-D R8Unorm volumes"]
    G -->|trilinear sample| H["SdfRayMarchPass<br/>fullscreen"]
    I["Depth Buffer<br/>opaque geo"] -->|early exit| H
    J["Lighting BindGroup<br/>PBR"] --> H
    H --> K[Color + Depth Output]
```

The `SdfFeature` is a standard Helio [feature](./feature-system). It owns all GPU resources, registers the two render passes, and acts as the bridge between the application's runtime edit calls and the GPU pipelines.

---

## Primitive Shapes

Every piece of SDF geometry begins with a **primitive** — a simple, analytically defined solid. Helio provides the following primitive types through `SdfShapeType`:

| Variant | Description | Parameters |
|---------|-------------|------------|
| `Sphere` | Perfect sphere | `param0` = radius (metres) |
| `Cube` | Axis-aligned box in local space | `param0..2` = half-extents xyz |
| `Capsule` | Cylinder capped with hemispheres | `param0` = radius, `param1` = half-height |
| `Cylinder` | Flat-capped cylinder | `param0` = radius, `param1` = half-height |
| `Torus` | Donut / ring shape | `param0` = major radius, `param1` = minor radius |

Shape parameters are packed into the four scalar fields on `SdfShapeParams` (`param0` through
`param3`). Unused slots are ignored. Convenience constructors handle the packing for you:

```rust
use helio::sdf::{SdfShapeType, SdfShapeParams};

// A sphere of radius 3 metres
let sphere_params = SdfShapeParams::sphere(3.0);

// A cube/box with half-extents 1×2×1 (so 2m wide, 4m tall, 2m deep)
let cube_params = SdfShapeParams::cube(1.0, 2.0, 1.0);

// A capsule: 0.5m radius, 2m half-height (total height 5m including caps)
let capsule_params = SdfShapeParams::capsule(0.5, 2.0);

// A torus: 4m ring radius, 0.4m tube radius
let torus_params = SdfShapeParams::torus(4.0, 0.4);
```

> [!TIP]
> All primitive SDFs are evaluated *in local space*. Scaling, rotating, and translating the primitive is done through the `SdfEdit::transform` field, which is a full `glam::Mat4`. This means you can create an ellipsoid by applying a non-uniform scale to a sphere, or a slanted cylinder by rotating a cylinder primitive — without adding any new primitive types.

The packed `SdfShapeParams` struct is sent verbatim to the GPU inside `GpuSdfEdit`. The GPU-side
WGSL shader unpacks the values and evaluates the appropriate analytical SDF formula. Adding a new
primitive type requires only a new WGSL branch and a corresponding Rust constructor — no pipeline
rebuild or buffer layout change is needed.

### Primitive SDF Formulas

The analytical SDF for each primitive, evaluated in the primitive's local space (before the `SdfEdit::transform` is applied).

**Sphere** — centre at origin, radius **r**:

$$f_{\text{sphere}}(\mathbf{p}) = \|\mathbf{p}\| - r$$

The distance from any point to a sphere is simply the distance to its centre minus the radius. Negative inside, positive outside.

```wgsl
fn sdf_sphere(p: vec3<f32>, radius: f32) -> f32 {
    return length(p) - radius;
}
```

**Cube / Box** — centred at origin, half-extents **b = (b_x, b_y, b_z)**:

$$f_{\text{box}}(\mathbf{p}, \mathbf{b}) = \left\|\max\!\left(\lvert\mathbf{p}\rvert - \mathbf{b},\; \mathbf{0}\right)\right\| + \min\!\left(\max(|p_x|-b_x,\; |p_y|-b_y,\; |p_z|-b_z),\; 0\right)$$

The `max(|p| − b, 0)` term computes the per-axis overshoot outside the box faces and takes its length for the exterior distance. The `min(..., 0)` term handles the interior, returning the negative distance to the nearest face when **p** is inside. Together they give exact Euclidean distance both inside and outside.

```wgsl
fn sdf_box(p: vec3<f32>, b: vec3<f32>) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
```

**Capsule** — endpoints **a**, **b**, radius **r**:

$$t = \operatorname{clamp}\!\left(\frac{(\mathbf{p}-\mathbf{a})\cdot(\mathbf{b}-\mathbf{a})}{\|\mathbf{b}-\mathbf{a}\|^2},\; 0,\; 1\right)$$

$$f_{\text{capsule}}(\mathbf{p}) = \|\mathbf{p} - \bigl(\mathbf{a} + t(\mathbf{b}-\mathbf{a})\bigr)\| - r$$

**t** is the scalar projection of **(p − a)** onto the line segment **(b − a)**, clamped to [0, 1]. The SDF is the distance from **p** to the nearest point on the segment, minus the tube radius.

```wgsl
fn sdf_capsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
    let pa = p - a;  let ba = b - a;
    let t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * t) - r;
}
```

**Torus** — major radius **R** (ring), minor radius **r** (tube), centred at origin in the XZ plane:

$$f_{\text{torus}}(\mathbf{p}, R, r) = \sqrt{\!\left(\sqrt{p_x^2 + p_z^2} - R\right)^{\!2} + p_y^2} - r$$

The inner term is the signed distance from **p**'s XZ projection to the ring circle of radius **R**. Treating that value and **p.y** as a 2-D point gives the distance to the ring centreline, and subtracting **r** produces the tube surface.

```wgsl
fn sdf_torus(p: vec3<f32>, R: f32, r: f32) -> f32 {
    let q = vec2(length(p.xz) - R, p.y);
    return length(q) - r;
}
```

**Cylinder** — half-height **h**, radius **r**, centred at origin, Y-axis aligned:

$$f_{\text{cylinder}}(\mathbf{p}, h, r) = \max\!\left(\sqrt{p_x^2 + p_z^2} - r,\; |p_y| - h\right)$$

The first term is the radial distance outside the infinite cylinder; the second is the axial distance outside the two caps. Taking the max gives the correct exterior distance and a negative interior value.

```wgsl
fn sdf_cylinder(p: vec3<f32>, h: f32, r: f32) -> f32 {
    let d = vec2(length(p.xz) - r, abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)));
}
```

---

## The Edit

An `SdfEdit` is the fundamental unit of the SDF CSG system. It encodes one primitive shape, its placement in the world, and how it combines with everything that came before it in the edit list.

```rust
pub struct SdfEdit {
    /// Which primitive geometry this edit uses.
    pub shape: SdfShapeType,

    /// How this edit combines with the accumulated SDF so far.
    pub op: BooleanOp,

    /// World-space transform: position, rotation, and scale of the primitive.
    /// The GPU inverts this to evaluate the SDF in local space.
    pub transform: glam::Mat4,

    /// Packed shape-specific parameters (radius, extents, etc.).
    pub params: SdfShapeParams,

    /// Blend radius in metres for smooth operations. Zero means sharp boolean.
    pub blend_radius: f32,
}
```

Every field matters:

- **`shape` + `params`** define the geometry in the primitive's own local coordinate space.
- **`transform`** is the full 4×4 affine transform that moves, rotates, and scales the primitive into world space. Internally, the GPU stores the *inverse* transform so that world-space sample points can be efficiently mapped back to local space for SDF evaluation.
- **`op`** controls how this edit modifies the accumulated field. See [Boolean Operations](#boolean-operations) below.
- **`blend_radius`** is the smooth blend radius. At zero, boolean operations produce sharp edges exactly at the SDF zero crossing. Positive values blend the two fields together over that radius, producing organic rounded joints between shapes.

<!-- screenshot: Side-by-side comparison of sharp Union vs blended Union with blend_radius=0.8 between two spheres -->

---

## Boolean Operations

`BooleanOp` currently defines **three** set-theoretic operations:

```rust
pub enum BooleanOp {
    Union,
    Subtraction,
    Intersection,
}
```

At each sample point, the GPU holds the accumulated SDF value `a` (the field so far) and evaluates the new primitive's value `b`. The boolean operation then combines them:

| Operation | Formula | Result |
|-----------|---------|--------|
| `Union` | `min(a, b)` | The solid is the region inside *either* shape |
| `Subtraction` | `max(a, -b)` | Subtracts the primitive from the accumulated solid |
| `Intersection` | `max(a, b)` | Keeps only the region inside *both* shapes |
The sharp boolean operations have exact set-theoretic interpretations. Given accumulated field
**d1** and new primitive **d2**:

$$f_{A \cup B}(\mathbf{p}) = \min(f_A(\mathbf{p}),\; f_B(\mathbf{p}))$$

$$f_{A \setminus B}(\mathbf{p}) = \max(f_A(\mathbf{p}),\; -f_B(\mathbf{p}))$$

Negating **d2** flips its inside/outside sense; taking the max then selects points that are inside **d1** but outside **d2**.

$$f_{A \cap B}(\mathbf{p}) = \max(f_A(\mathbf{p}),\; f_B(\mathbf{p}))$$

```wgsl
fn op_union    (d1: f32, d2: f32) -> f32 { return min(d1, d2); }
fn op_subtract (d1: f32, d2: f32) -> f32 { return max(d1, -d2); }
fn op_intersect(d1: f32, d2: f32) -> f32 { return max(d1, d2); }
```

Smoothing is controlled separately through `SdfEdit::blend_radius`. In other words, the operation
kind remains `Union`, `Subtraction`, or `Intersection`; setting `blend_radius > 0.0` tells the CPU
and GPU evaluators to use a blended transition instead of the sharp form.

The current CPU implementation uses a clamped interpolation factor **h** plus a correction term,
rather than separate public `SmoothUnion` / `SmoothSubtraction` / `SmoothIntersection` enum
variants:

```rust
match op {
    BooleanOp::Union => {
        let h = (0.5 + 0.5 * (d2 - d1) / k).clamp(0.0, 1.0);
        d1 * h + d2 * (1.0 - h) - k * h * (1.0 - h)
    }
    BooleanOp::Subtraction => {
        let h = (0.5 - 0.5 * (d2 + d1) / k).clamp(0.0, 1.0);
        d1 * (1.0 - h) + (-d2) * h + k * h * (1.0 - h)
    }
    BooleanOp::Intersection => {
        let h = (0.5 - 0.5 * (d2 - d1) / k).clamp(0.0, 1.0);
        d1 * h + d2 * (1.0 - h) + k * h * (1.0 - h)
    }
}
```

At `blend_radius = 0.0`, Helio falls back to the sharp boolean forms. Positive values produce the
rounded joins and softened cuts that earlier prototypes described as "smooth union" or "smooth
subtraction", but the smoothing is now a property of the edit rather than a separate enum variant.

```rust
// Sharp union — hard edge between sphere and box
sdf.add_edit(SdfEdit {
    shape: SdfShapeType::Sphere,
    params: SdfShapeParams::sphere(2.0),
    transform: Mat4::from_translation(vec3(0.0, 0.0, 0.0)),
    op: BooleanOp::Union,
    blend_radius: 0.0,
});

// Blended union — organic blob merging with the sphere
sdf.add_edit(SdfEdit {
    shape: SdfShapeType::Cube,
    params: SdfShapeParams::cube(1.5, 1.5, 1.5),
    transform: Mat4::from_translation(vec3(2.5, 0.0, 0.0)),
    op: BooleanOp::Union,
    blend_radius: 0.8,   // blend over 0.8 metres
});

// Carve a tunnel through everything so far
sdf.add_edit(SdfEdit {
    shape: SdfShapeType::Cylinder,
    params: SdfShapeParams::cylinder(0.6, 5.0),
    transform: Mat4::from_rotation_translation(
        Quat::from_rotation_x(std::f32::consts::FRAC_PI_2),
        vec3(0.0, 0.0, 0.0),
    ),
    op: BooleanOp::Subtraction,
    blend_radius: 0.0,
});
```

> [!IMPORTANT]
> Boolean operations are **order-dependent**. The edit list is evaluated in the order edits were pushed. A `Subtraction` edit that appears before a `Union` edit subtracts from only the portion of the solid that existed before that point — not from anything added afterward. Think of it as a sequential sculpting workflow: each edit modifies the result of all preceding edits.

---

## The Edit List

`SdfEditList` is a `Vec<SdfEdit>` plus dirty tracking and a monotonically increasing generation
counter:

```rust
pub struct SdfEditList {
    edits: Vec<SdfEdit>,
    dirty: bool,
    generation: u64,
}
```

Every mutation — `add`, `set`, `remove`, or `clear` — increments `generation` and marks the list
dirty. `SdfFeature::prepare` compares `edit_list.generation()` against `last_uploaded_gen`. If they
differ, the edit list is serialised into `GpuSdfEdit` structs and uploaded to the GPU `edit_buffer`.
This lazy upload pattern means that frames where nothing changes incur zero buffer-write overhead.

> [!NOTE]
> The generation counter does not track *which* edits changed, only *whether* they changed. Any mutation triggers a full re-upload of all edits. For typical edit counts (tens to low hundreds) this is fast; the buffer is compact and a single `write_buffer` call suffices.

The `SdfFeature` delegates the edit list API through thin forwarding methods:

```rust
impl SdfFeature {
    pub fn add_edit(&mut self, edit: SdfEdit)    // push + bump generation
    pub fn remove_edit(&mut self, index: usize)  // swap-remove + bump generation
    pub fn clear_edits(&mut self)                // clear + bump generation
    pub fn edit_count(&self) -> usize            // current length
}
```

There is no explicit index stability guarantee after `remove_edit` — the implementation may swap the removed edit with the last element. If you need stable handles to specific edits (for later removal or modification), track them by content rather than by index, or maintain your own side table.

---

## Clip Map: Multi-Level LOD

Baking the SDF into a volume texture at a single resolution would either waste VRAM on coarse far-field detail or provide insufficient resolution near the camera. Helio solves this with a **geometry clip map** — a set of concentric 3-D volume textures centered on the camera, each covering double the world-space extent of the previous level at the same grid resolution.

```mermaid
graph LR
    subgraph Clip Map Levels
        L0["Level 0\nFinest\n128³ voxels\n~8m extent"]
        L1["Level 1\n128³ voxels\n~16m extent"]
        L2["Level 2\n128³ voxels\n~32m extent"]
        L3["Level 3\nCoarsest\n128³ voxels\n~64m extent"]
    end
    CAM[Camera] --> L0
    L0 --> L1
    L1 --> L2
    L2 --> L3
```

The key parameters are defined as:

```rust
pub const DEFAULT_CLIP_LEVELS: usize = 4;
// All levels use the same grid_dim (default: 128³)
// Level 0: finest voxels, smallest world-space coverage
// Each subsequent level: 2× world extent, 2× voxel size
```

Because all levels share the same `grid_dim`, the voxel size at level `L` is `voxel_size_L0 × 2^L`. Level 0 gives you the sharpest SDF detail right around the camera. Level 3 gives you coarser but longer-range SDF coverage for distant geometry and shadow marching.

At runtime, `SdfFeature.prepare` moves all clip map levels to follow the camera's world-space position. Levels that shift by more than one voxel width are marked dirty and re-evaluated by `SdfClipUpdatePass` on the next compute dispatch.

> [!NOTE]
> The clip map is camera-centered — it is not tied to a fixed world volume. This means SDF geometry far from the camera is simply not represented in the clip map and will not be ray marched. Plan your scene so that important interactive SDF elements are within the finest few levels.

### Volume Texture Format

Each level is stored as a `wgpu::Texture` with format `R8Unorm` — a single 8-bit unsigned channel. SDF values are linearly quantised:

| u8 value | Interpreted SDF |
|----------|----------------|
| 0 | Maximum negative (deep inside solid) |
| 128 | Zero crossing (surface) |
| 255 | Maximum positive (far outside solid) |

The mapping from a raw SDF value **d** to a stored byte is:

$$f_{\text{clamped}} = \operatorname{clamp}\!\left(f(\mathbf{p}),\; -d_{\max},\; +d_{\max}\right)$$

$$\text{stored} = \left\lfloor\frac{f_{\text{clamped}} - (-d_{\max})}{2\,d_{\max}} \times 255 + 0.5\right\rfloor$$

where **d_max** is the maximum representable distance for that clip level (typically half the level's world-space extent). Byte 0 maps to **−d_max** (deepest interior), byte 128 maps to the zero crossing (surface), and byte 255 maps to **+d_max** (furthest exterior).

The quantisation range is set by the level's `level_size` so that the ±1.0 normalised range spans the entire world-space extent of that level. This gives adequate precision near the surface for ray marching convergence.

---

## Brick Maps: Sparse SDF Storage

Near a complex sculpted surface, every voxel in the clip map is potentially occupied by surface detail. But in large open regions — sky, solid rock deep underground — the SDF values are either uniformly very positive or very negative. Storing those regions at full grid resolution wastes VRAM.

The `BrickMap` solves this with **sparse brick storage**:

```rust
pub const DEFAULT_BRICK_SIZE: u32 = 8;  // Each brick: 8×8×8 voxels
```

The clip map volume is subdivided into `8³`-voxel bricks. Bricks whose SDF values are entirely above or below a threshold (homogeneous regions far from any surface) are *unoccupied* and not stored in the atlas. Only bricks that contain or are near the zero-crossing surface are allocated in the GPU atlas texture.

```mermaid
graph TD
    VOL["3-D Volume\n128³ voxels"]
    subgraph Bricks ["Brick Grid (16³ bricks)"]
        OCC["● Occupied bricks\n(near surface)"]
        EMP["○ Empty bricks\n(far from surface)"]
    end
    VOL --> Bricks
    OCC -->|stored in| ATLAS["3-D Atlas\nTexture\n(packed)"]
    EMP -->|not stored| NULL["(null / constant value)"]
```

> [!TIP]
> For terrain-heavy scenes where most of the volume is solid ground or open air, sparse bricks can reduce VRAM for the SDF clip map by 60–80% compared to a dense grid. The savings are most pronounced at coarser clip map levels, which cover large homogeneous regions.

The `BrickMap` handles allocation and deallocation of atlas tiles automatically as the camera moves and clip levels shift. From the application's perspective, the storage strategy is entirely transparent — you work with edits, not bricks.

---

## Edit BVH: O(log N) Culling

As the edit list grows, naively re-evaluating every edit against every dirty clip map tile becomes expensive. With 200 edits and 1000 dirty tiles, that is 200 000 GPU thread groups just for the dispatch setup — before any actual SDF evaluation.

The `EditBVH` eliminates this with an **axis-aligned bounding box tree** over the edit list:

```rust
pub struct EditBvh {
    // Standard BVH: one AABB per edit, sorted into a binary tree
}
```

Each `SdfEdit` has a world-space AABB derived from its shape parameters and transform. The BVH is rebuilt whenever `edit_list.generation` changes. At dispatch time, `SdfClipUpdatePass` uses the BVH to find, for each dirty tile, only the edits whose AABB overlaps that tile's world-space region. Edits that cannot possibly affect the tile are never processed.

```mermaid
graph LR
    TILE["Dirty Clip Tile\n(world AABB)"]
    BVH["EditBVH\nAABB tree"]
    TILE -->|overlap query| BVH
    BVH -->|O log N| RELEVANT["Relevant edits\n(small subset)"]
    BVH -->|skipped| SKIP["Non-overlapping edits\n(majority)"]
    RELEVANT -->|dispatch| GPU["GPU SDF Evaluation"]
```

> [!IMPORTANT]
> The BVH provides **O(log N)** query time per tile, reducing total work from O(N_edits × N_tiles) to approximately O(N_tiles × log N_edits + N_overlapping_edits × N_affected_tiles). In scenes with hundreds of edits spread across the world, this is the difference between real-time and completely impractical update times.

The AABB for an edit is conservatively padded by the `smoothing` radius. A smooth union with a 2-metre blend radius inflates the AABB by 2 metres in every direction. This ensures tiles near the blend zone are never incorrectly skipped.

---

## GPU Uniform Parameters

`SdfGridParams` is the uniform struct that parameterises the SDF evaluation on the GPU. It is uploaded to `params_buffer` by `SdfFeature.prepare`:

```rust
pub struct SdfGridParams {
    /// Voxel grid dimension along each axis (default: 128).
    pub grid_dim: u32,

    /// World-space minimum corner of the current clip level (w = unused).
    pub volume_min: [f32; 4],

    /// World-space maximum corner of the current clip level (w = unused).
    pub volume_max: [f32; 4],

    /// World-space size of one voxel: (volume_max - volume_min) / grid_dim.
    pub voxel_size: f32,

    /// Number of valid entries in edit_buffer.
    pub edit_count: u32,
}
```

Both the compute pass (`SdfClipUpdatePass`) and the ray march pass (`SdfRayMarchPass`) bind `params_buffer` at their respective bind group slot 0. The `volume_min` and `volume_max` fields define the axis-aligned bounding box of the current clip level in world space; together with `voxel_size`, they let the shader convert between texel coordinates and world positions.

The `[f32; 4]` padding on `volume_min` and `volume_max` exists to satisfy WGSL's `vec4<f32>` alignment requirements. The fourth component is always zero and should be ignored.

---

## SdfClipUpdatePass: GPU Compute

The update pass is a WGSL compute shader dispatched by `SdfFeature` during the render graph's compute phase. One thread group covers one dirty clip map tile:

```
dispatch dimensions: (dirty_tile_count_x, dirty_tile_count_y, dirty_tile_count_z)
thread group size:   (BRICK_SIZE, BRICK_SIZE, BRICK_SIZE) = (8, 8, 8)
```

Each thread:
1. Computes its world-space position from the tile index, thread index, `volume_min`, and `voxel_size`.
2. Queries the `EditBVH` to obtain the subset of edits whose AABB overlaps this tile.
3. Evaluates each relevant `GpuSdfEdit` analytically (inverse-transform the world point to local space, evaluate the primitive SDF, apply the boolean operation against the accumulator).
4. Quantises the final SDF value to `u8` and writes it to the 3-D `R8Unorm` volume texture.

> [!NOTE]
> The `SdfClipUpdatePass` writes to the volume texture for the specific clip level that contains the dirty tile. The ray march pass then reads from all clip levels during marching, selecting the finest available level at each sample point.

Tiles are marked dirty when:
- The camera moves far enough to shift a clip level by more than one voxel (the newly revealed edge needs to be filled).
- `edit_list.generation` changes (any edit mutation marks all tiles overlapping affected edits as dirty via the BVH).

---

## SdfRayMarchPass: Fullscreen Rendering

The ray march pass runs after all opaque geometry has been rendered. It is a fullscreen pass — either a screen-covering triangle or quad — that executes a fragment shader for every pixel on screen.

```mermaid
flowchart LR
    A["Fragment<br/>screen pixel"] --> B{Depth buffer\ncheck}
    B -->|pixel covered by\nopaque geo| C[Discard early]
    B -->|pixel uncovered| D["Reconstruct<br/>ray from<br/>camera + UV"]
    D --> E["Sphere-trace<br/>through clip map<br/>levels 0→3"]
    E --> F{Hit?}
    F -->|no hit\nmax distance| G[Discard]
    F -->|hit| H["Estimate normal<br/>by finite diff"]
    H --> I["PBR shading<br/>via lighting<br/>bind group"]
    I --> J["Write color<br/>+ depth"]
```

### Sphere Tracing Algorithm

Given a ray **r(t) = o + t·d** (origin **o**, unit direction **d**), sphere tracing advances the ray by the SDF value at each step:

$$t_{i+1} = t_i + f\!\left(\mathbf{r}(t_i)\right)$$

This is always safe: because **f(p)** is a **lower bound** on the true distance to the surface, stepping by **f(p)** can never overshoot it. The march terminates with:

$$\text{hit if } f\!\left(\mathbf{r}(t_i)\right) < \varepsilon_{\text{surface}}$$

$$\text{miss if } t_i > t_{\max}$$

The efficiency gain over uniform ray-casting comes from the fact that far from any surface **f(p)** is large, enabling large steps through empty space. Only near surfaces (where **f(p) → 0**) does the step size shrink, concentrating samples precisely where needed.

```wgsl
const MAX_STEPS: i32 = 128;
const SURFACE_EPSILON: f32 = 0.001;

fn ray_march(ray_origin: vec3<f32>, ray_dir: vec3<f32>, t_max: f32) -> f32 {
    var t = 0.0;
    for (var i = 0; i < MAX_STEPS; i++) {
        let p = ray_origin + t * ray_dir;
        let d = scene_sdf(p);
        if d < SURFACE_EPSILON { return t; } // hit
        t += d;
        if t > t_max { break; }              // miss
    }
    return -1.0; // no hit
}
```

**Depth early-out** is the most important optimisation. The pass reads the depth value from the opaque geometry depth buffer at the current pixel. If opaque geometry is already closer than the ray march start, the pixel is discarded without stepping through the volume at all. In scenes where SDF geometry is mostly hidden behind walls or terrain, this can eliminate march work for 70–90% of pixels.

**Trilinear interpolation** is used when sampling SDF values from the 3-D volume textures. Because the GPU's texture sampler hardware handles trilinear filtering natively, each sample is a single `textureSample` call — no manual interpolation in the shader. The result is a smooth SDF that doesn't show voxel-grid artifacts during marching.

**Level selection** during marching works coarse-to-fine: the marcher advances through clip level 3 in large steps until the sample value drops below a threshold, then switches to finer levels for the precise surface crossing. This prevents wasting fine-level samples in empty space far from surfaces.

**Normal estimation** is done by computing the gradient of the SDF. Because the gradient of any SDF has unit length at the surface (**|∇f| = 1** — the *eikonal equation*), normalising the finite-difference approximation gives the surface normal directly:

$$\mathbf{N}(\mathbf{p}) = \nabla f(\mathbf{p}) \approx \operatorname{normalize}\!\left(\frac{\partial f}{\partial x}, \frac{\partial f}{\partial y}, \frac{\partial f}{\partial z}\right)$$

The standard 6-sample central-difference implementation:

```wgsl
fn estimate_normal(p: vec3<f32>) -> vec3<f32> {
    let e = vec2<f32>(0.001, 0.0);
    return normalize(vec3<f32>(
        sample_sdf(p + e.xyy) - sample_sdf(p - e.xyy),
        sample_sdf(p + e.yxy) - sample_sdf(p - e.yxy),
        sample_sdf(p + e.yyx) - sample_sdf(p - e.yyx),
    ));
}
```

An alternative is the **tetrahedron technique** (Inigo Quilez), which achieves the same quality with only 4 SDF evaluations instead of 6 by using four tetrahedral sample offsets **k₀, k₁, k₂, k₃**:

$$\mathbf{N}(\mathbf{p}) \approx \operatorname{normalize}\!\left(\sum_{i=1}^{4} k_i \cdot f(\mathbf{p} + k_i\,\varepsilon)\right)$$

where **k₀ = (1,−1,−1)**, **k₁ = (−1,−1,1)**, **k₂ = (−1,1,−1)**, **k₃ = (1,1,1)**.

```wgsl
const EPS: f32 = 0.001;
fn sdf_normal_tet(p: vec3<f32>) -> vec3<f32> {
    let k1 = vec3( 1.0, -1.0, -1.0);
    let k2 = vec3(-1.0, -1.0,  1.0);
    let k3 = vec3(-1.0,  1.0, -1.0);
    let k4 = vec3( 1.0,  1.0,  1.0);
    return normalize(
        k1 * scene_sdf(p + k1 * EPS) +
        k2 * scene_sdf(p + k2 * EPS) +
        k3 * scene_sdf(p + k3 * EPS) +
        k4 * scene_sdf(p + k4 * EPS)
    );
}
```

**PBR shading** reuses the same lighting bind group as the opaque deferred pass. SDF surfaces are shaded with the same directional lights, ambient occlusion, and environment map as mesh geometry. There is currently a single shared material for all SDF surfaces (see [Limitations](#limitations)).

---

## Terrain Generation

SDF terrain provides a procedurally generated base layer that is sculpted into the clip map volumes before any manual edits are evaluated. This means manual edits (caves, tunnels, structures) are always applied *on top of* the terrain, which acts as the starting solid.

```rust
pub enum TerrainStyle {
    Rolling,
}

pub struct TerrainConfig {
    pub style: TerrainStyle,
    pub height: f32,
    pub amplitude: f32,
    pub frequency: f32,
    pub octaves: u32,
    pub lacunarity: f32,
    pub persistence: f32,
}
```

The current terrain system exposes a single built-in style, `Rolling`, backed by a layered
fractal-noise heightfield. `height` is the base elevation offset, while `amplitude`, `frequency`,
`octaves`, `lacunarity`, and `persistence` control the FBM shape. Terrain is evaluated directly in
the clip update path alongside the edit list — there is no separate terrain bake pass.

```rust
// Setting up rolling terrain with manual cave edits layered on top
let sdf = renderer.get_feature_mut::<SdfFeature>("sdf").unwrap();

// Configure terrain as the base layer (done during feature setup)
sdf.set_terrain(TerrainConfig {
    style: TerrainStyle::Rolling,
    height: -2.0,
    amplitude: 4.0,
    frequency: 0.08,
    octaves: 5,
    lacunarity: 2.0,
    persistence: 0.5,
});

// Now add manual edits — these subtract from / add to the terrain
sdf.add_edit(SdfEdit {
    shape: SdfShapeType::Sphere,
    params: SdfShapeParams::sphere(8.0),
    transform: Mat4::from_translation(vec3(0.0, 5.0, 0.0)),
    op: BooleanOp::Subtraction,  // carve a spherical chamber
    blend_radius: 1.5,
});
```

> [!TIP]
> `TerrainConfig::rolling()` is the easiest starting point. Use `amplitude` to control relief,
> `frequency` for feature size, `octaves` for detail layering, and `persistence` / `lacunarity` to
> tune how quickly the higher-frequency noise tapers off.

---

## CPU-Side Ray Marching: `pick_surface`

`SdfFeature` includes a CPU-side ray marcher for interaction, selection, and gameplay queries. It
does **not** sample the GPU clip map back to the CPU; instead, it analytically re-evaluates the
terrain and edit list on the CPU to find where a ray hits the SDF surface:

```rust
pub fn pick_surface(
    &self,
    ray_origin: Vec3,
    ray_dir: Vec3,
    max_distance: f32,
) -> Option<PickResult>

pub struct PickResult {
    /// World-space position of the ray-surface intersection.
    pub position: Vec3,

    /// Estimated surface normal at the hit point (finite differences).
    pub normal: Vec3,

    /// Distance from ray_origin along ray_dir to the hit point.
    pub distance: f32,
}
```

Typical use cases:

- **Object placement**: cast a ray from the cursor into the scene; place a new primitive at `hit.position + hit.normal * offset`.
- **Surface selection**: determine which SDF region the player is pointing at.
- **Gameplay probes**: check whether a point in space is inside the SDF solid (fire-spread, flood-fill, footstep placement).

```rust
// Place a sphere where the player is pointing
if let Some(hit) = sdf.pick_surface(camera_pos, camera_forward, 50.0) {
    sdf.add_edit(SdfEdit {
        shape: SdfShapeType::Sphere,
        params: SdfShapeParams::sphere(1.0),
        transform: Mat4::from_translation(hit.position),
        op: BooleanOp::Union,
        blend_radius: 0.3,
    });
}
```

> [!WARNING]
> `pick_surface` runs on the CPU and analytically evaluates every edit in the list per march step.
> For large edit lists (> 100 edits) or high `max_distance` values, this can be slow enough to cause
> frame hitches if called every frame. Consider rate-limiting to once per interaction event, or
> caching the last result until the edit list changes.

---

## Configuring SdfFeature

`SdfFeature` uses a builder pattern for initial configuration. Grid size, volume bounds, and initial
terrain can be set up front; terrain can also be changed later with `set_terrain(...)`, and debug
visualization is toggled at runtime with `toggle_debug()`.

```rust
let sdf_feature = SdfFeature::new()
    // Grid dimension: higher = more detail, more VRAM, more compute.
    // Must be a power of two. Minimum: 32. Default: 128.
    .with_grid_dim(256)

    // World-space bounding volume for SDF evaluation.
    // Geometry outside this box is not evaluated.
    .with_volume_bounds(
        [-100.0, -50.0, -100.0],
        [ 100.0,  50.0,  100.0],
    )

    // Optional initial terrain
    .with_terrain(TerrainConfig::rolling());

renderer.register_feature(sdf_feature)?;
```

After registration:

```rust
let sdf = renderer.get_feature_mut::<SdfFeature>("sdf").unwrap();
sdf.toggle_debug();
```

**`with_grid_dim`** is the most impactful configuration choice. The VRAM cost per clip level scales
as `grid_dim³`. With `DEFAULT_CLIP_LEVELS = 8`:

| `grid_dim` | VRAM per level (dense) | Total (8 levels, R8Unorm) |
|------------|----------------------|--------------------------|
| 64 | 256 KB | ~2 MB |
| 128 | 2 MB | ~16 MB |
| 256 | 16 MB | ~128 MB |
| 512 | 128 MB | ~1 GB |

Sparse brick storage (see [Brick Maps](#brick-maps-sparse-sdf-storage)) reduces these figures significantly in practice, but plan for the worst case when budgeting VRAM.

**`with_volume_bounds`** sets the world-space box that the clip map may cover. The finest clip level is centered on the camera and never exceeds these bounds; the coarser levels clamp similarly. If your world is larger than the bounds, SDF geometry outside the bounds simply won't be rendered.

> [!NOTE]
> `toggle_debug()` overlays a colour-coded SDF visualisation on the rendered output: blue =
> negative (inside solid), red = positive (outside), bright green = surface crossing. This is
> invaluable for debugging unexpected holes or surfaces.

---

## Runtime Workflow

Here is the recommended end-to-end workflow for integrating the SDF CSG system into a Helio application:

```mermaid
flowchart TD
    A["Create SdfFeature<br/>with_grid_dim · with_volume_bounds"] --> B["Configure terrain<br/>set_terrain with TerrainConfig"]
    B --> C["Register with renderer<br/>renderer.register_feature"]
    C --> D["Feature.register called<br/>GPU resources allocated<br/>passes registered"]
    D --> E["Game loop starts]
    E --> F{Edit list<br/>changed?}
    F -->|yes| G["Feature.prepare<br/>upload edits to GPU<br/>rebuild BVH"]
    F -->|no| H["Feature.prepare<br/>skip upload no-op"]
    G --> I["SdfClipUpdatePass<br/>recompute dirty tiles"]
    H --> I
    I --> J["SdfRayMarchPass<br/>fullscreen render"]
    J --> K[Player interaction?]
    K -->|pick / place| L["pick_surface<br/>add_edit / remove_edit"]
    L --> F
    K -->|no| F
```

A minimal working example:

```rust
use helio::{Renderer, feature::Feature};
use helio::sdf::{SdfFeature, SdfEdit, SdfShapeType, SdfShapeParams, BooleanOp};
use glam::{Mat4, vec3, Quat};

fn setup(renderer: &mut Renderer) -> anyhow::Result<()> {
    let sdf = SdfFeature::new()
        .with_grid_dim(128)
        .with_volume_bounds([-64.0, -32.0, -64.0], [64.0, 32.0, 64.0]);

    renderer.register_feature(sdf)?;

    let sdf = renderer.get_feature_mut::<SdfFeature>("sdf").unwrap();

    // Base sphere
    sdf.add_edit(SdfEdit {
        shape: SdfShapeType::Sphere,
        params: SdfShapeParams::sphere(5.0),
        transform: Mat4::IDENTITY,
        op: BooleanOp::Union,
        blend_radius: 0.0,
    });

    // Blended blob attached to it
    sdf.add_edit(SdfEdit {
        shape: SdfShapeType::Cube,
        params: SdfShapeParams::cube(2.0, 2.0, 2.0),
        transform: Mat4::from_translation(vec3(5.5, 0.0, 0.0)),
        op: BooleanOp::Union,
        blend_radius: 1.2,
    });

    // Cylindrical bore through both
    sdf.add_edit(SdfEdit {
        shape: SdfShapeType::Cylinder,
        params: SdfShapeParams::cylinder(1.0, 10.0),
        transform: Mat4::from_rotation_translation(
            Quat::from_rotation_z(std::f32::consts::FRAC_PI_2),
            vec3(0.0, 0.0, 0.0),
        ),
        op: BooleanOp::Subtraction,
        blend_radius: 0.2,
    });

    Ok(())
}
```

---

## Integration with PBR Shading

SDF surfaces participate fully in Helio's PBR deferred shading pipeline. During `SdfRayMarchPass`, the fragment shader binds the same **lighting bind group** used by the opaque geometry passes. This bind group contains:

- The directional light cascade shadow maps
- The screen-space ambient occlusion texture
- The specular and diffuse environment maps (IBL)
- The light parameter uniform buffer

The SDF surface normal (estimated by finite differences on the volume texture) is fed into the same BRDF evaluation function as mesh normals. The result is physically consistent lighting: SDF spheres and mesh spheres lit by the same directional light look identical in terms of shading response.

> [!NOTE]
> Because the SDF ray march writes to the depth buffer with the correct hardware depth value, SDF surfaces correctly occlude and are occluded by mesh geometry. A mesh object placed inside an SDF solid will be correctly hidden; an SDF surface visible through a transparent mesh will appear at the correct depth. The two systems compose naturally.

<!-- screenshot: SDF torus with PBR shading matching an adjacent mesh sphere under the same directional light -->

---

## Performance Considerations

### Grid Dimension vs. Quality

`grid_dim` is the single most impactful performance knob. Halving `grid_dim` reduces:
- **VRAM** by 8× per clip level
- **Compute dispatch size** (SdfClipUpdatePass) by 8×
- **Ray march convergence quality** — fewer texels means coarser SDF values, which can cause the marcher to overshoot surfaces or produce aliasing on fine details

For most interactive applications, `128` is a good default. Use `64` for mobile or low-end targets. Use `256` only if you have the VRAM budget and need sub-centimetre SDF precision at close range.

### Clip Level Count

`DEFAULT_CLIP_LEVELS = 8` is the current baseline. Reducing the level count would save VRAM and
clip update work proportionally, at the cost of shorter SDF render range. Increasing it extends
coverage but costs more memory and dispatch work. The level count should match the furthest distance
at which SDF geometry appears in your scene.

### Edit Count and BVH

The BVH makes large edit lists viable, but there are still per-edit costs:
- **BVH rebuild**: O(N log N) on the CPU, triggered on every generation change. For fewer than 500 edits this is imperceptible. Beyond 1000 edits, consider batching mutations.
- **GPU evaluation**: even with BVH culling, edits that overlap many tiles still execute per-thread. Tightly scoped edits (small AABBs) are cheaper than large globally overlapping ones.

> [!TIP]
> Terrain noise is evaluated analytically per-voxel and does not count against the edit list. For large procedural worlds, prefer noise-driven terrain over hundreds of terrain-shaping edits.

### Ray March Step Count

The ray marcher adapts its step size to the SDF value at each sample: large positive values → large steps, small values → small steps. Surfaces with high curvature relative to voxel size (very small features in a coarse grid) may require more steps to converge. If you see shimmer or missed surfaces on fine features, increase `grid_dim` for the relevant clip level rather than increasing the march step limit.

---

## Limitations

Understanding the current limitations of the SDF CSG system helps you design your application to work with the system rather than against it.

**Single shared material.** All SDF surfaces currently use one shared PBR material (albedo, roughness, metallic). There is no mechanism to assign different materials to different edits. If you need coloured spheres and grey terrain in the same SDF volume, this is not currently supported.

**No skeletal or blend-shape deformation.** The transform on an `SdfEdit` is a static `Mat4`. Animating a primitive requires updating its edit (which bumps the generation and triggers a tile re-bake on the affected region). Smooth skeletal deformation of SDF geometry — as in SDF-based character rendering — is not supported.

**No direct shadow casting from SDF to mesh geometry.** SDF surfaces can receive shadows from the directional shadow cascade, but they do not cast shadows onto mesh surfaces. The shadow map pipeline only rasterises mesh geometry.

**Volume bounds are fixed at registration.** `with_volume_bounds` is a setup-time parameter. The world-space bounding box cannot be changed after the feature is registered. Design your volume bounds to cover the full playable area of your scene.

**Quantisation precision at coarse levels.** u8 quantisation over a large world extent gives coarse
distance steps in the far clip levels. This is usually invisible in rendering, but `pick_surface`
at long distances may still have sub-metre inaccuracy because it relies on the analytic CPU
evaluation and finite-difference normals. For precise interaction at range, consider limiting
`pick_surface`'s `max_distance` to the near gameplay area.

> [!WARNING]
> Do not set `grid_dim` above 256 without profiling first. At 512, the four R8Unorm clip level textures alone consume 512 MB of VRAM before any brick atlas overhead. On most desktop GPUs this will cause the driver to fall back to system memory, causing catastrophic performance degradation.

---

## Quick Reference

```mermaid
classDiagram
    class SdfFeature {
        +add_edit(SdfEdit)
        +remove_edit(usize)
        +set_edit(usize, SdfEdit)
        +clear_edits()
        +pick_surface(Vec3, Vec3, f32) Option~PickResult~
        +with_grid_dim(u32) Self
        +with_volume_bounds([f32;3], [f32;3]) Self
        +with_terrain(TerrainConfig) Self
        +toggle_debug()
    }
    class SdfEdit {
        +shape: SdfShapeType
        +op: BooleanOp
        +transform: Mat4
        +params: SdfShapeParams
        +blend_radius: f32
    }
    class SdfShapeParams {
        +sphere(f32) Self
        +cube(f32, f32, f32) Self
        +capsule(f32, f32) Self
        +cylinder(f32, f32) Self
        +torus(f32, f32) Self
    }
    class SdfClipMap {
        +levels: usize
        +level_dims: Vec~u32~
        +level_sizes: Vec~f32~
        +volume_textures: Vec~Texture~
    }
    class EditBvh {
        +rebuild(edits)
        +query_overlapping(aabb) Vec~usize~
    }
    class TerrainConfig {
        +style: TerrainStyle
        +height: f32
        +amplitude: f32
        +frequency: f32
        +octaves: u32
        +lacunarity: f32
        +persistence: f32
    }
    SdfFeature --> SdfEdit
    SdfFeature --> SdfClipMap
    SdfFeature --> EditBvh
    SdfFeature --> TerrainConfig
    SdfEdit --> SdfShapeParams
```

| Concept | Default | Config |
|---------|---------|--------|
| Grid dimension | 128³ | `with_grid_dim` |
| Clip levels | 8 | `DEFAULT_CLIP_LEVELS` |
| Brick size | 8³ | `DEFAULT_BRICK_SIZE` |
| SDF quantisation | u8 R8Unorm | fixed |
| Boolean ops | 3 variants + `blend_radius` smoothing | `BooleanOp` + `SdfEdit` |
| Terrain base layer | none | `set_terrain` |
| CPU picking | analytical | `pick_surface` |
| PBR shading | shared bind group | fixed |
