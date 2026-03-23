---
title: Resources
description: Uploading and managing meshes, materials, and textures in the Helio scene — PackedVertex layout, material workflows, texture bindless array, and reference-counted resource lifetimes
category: helio
lastUpdated: '2026-03-23'
tags: [mesh, material, texture, resources, pbr]
position: 1
icon: '📦'
---

# Resources

Resources are the raw GPU assets that objects draw from. In Helio the word "resource" refers to three specific kinds of data: meshes (vertex and index buffers), textures (2-D sampled images), and materials (shading parameter blocks, optionally referencing textures). Before any object can appear on screen, you must upload its constituent resources and obtain handles to them. This document covers the upload format for each resource type, the GPU memory model that underlies them, and the reference-counting system that governs their lifetimes.

---

## 1. Meshes

### 1.1 PackedVertex

All mesh geometry in Helio is submitted as arrays of `PackedVertex`. This struct is exactly 40 bytes and its field layout is chosen to minimise GPU memory bandwidth at the cost of a CPU-side packing step.

```rust
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct PackedVertex {
    pub position:       [f32; 3],  // 12 bytes — world-space XYZ, full float precision
    pub bitangent_sign: f32,        //  4 bytes — +1.0 or −1.0 for handedness reconstruction
    pub tex_coords0:    [f32; 2],  //  8 bytes — primary UV channel
    pub tex_coords1:    [f32; 2],  //  8 bytes — secondary UV (lightmap, detail, etc.)
    pub normal:         u32,        //  4 bytes — SNORM8×4 packed normal
    pub tangent:        u32,        //  4 bytes — SNORM8×4 packed tangent
}
```

The most significant detail is that `normal` and `tangent` are stored as packed SNORM8×4 values. A SNORM8 encoding maps a floating-point value in `[-1, 1]` to a signed 8-bit integer in `[-127, 127]`; four such values are packed into a single `u32`. The encoding formula is `round(x × 127.0)` clamped to the signed byte range.

The reason for this encoding is bandwidth. A conventional mesh vertex might store normals as three separate `f32` values — 12 bytes per normal. The packed SNORM8 encoding uses 4 bytes, a 3× reduction, at the cost of quantisation error of at most `1/127 ≈ 0.8%` per component. For normals used in lighting calculations this precision is entirely adequate — the visual difference between a 12-bit and an 8-bit normal is undetectable at standard monitor resolutions under typical viewing distances. At 60 FPS with one million vertices, the bandwidth saving from normals alone is over 1 GB/s on the vertex fetch path.

The fourth byte of each packed normal and tangent is unused and set to zero. The bitangent is not stored at all — it is reconstructed in the vertex shader as `cross(normal, tangent) × bitangent_sign`, which is algebraically equivalent to storing all three vectors and costs one cross product and one multiply per vertex shader invocation.

The `PackedVertex::from_components()` constructor handles the packing automatically:

```rust
let vertex = PackedVertex::from_components(
    [0.0, 1.0, 0.0],   // position
    [0.0, 0.0, 1.0],   // normal (will be SNORM8-packed)
    [0.5, 0.5],         // tex_coords (UV channel 0)
    [1.0, 0.0, 0.0],   // tangent (will be SNORM8-packed)
    1.0,                // bitangent_sign (+1.0 = right-handed)
);
```

### 1.2 MeshUpload and the Global MeshPool

To submit a mesh to the scene you wrap your vertex and index arrays in a `MeshUpload` and pass it to `insert_mesh()`:

```rust
pub struct MeshUpload {
    pub vertices: Vec<PackedVertex>,
    pub indices:  Vec<u32>,
}

let mesh_id: MeshId = scene.insert_mesh(MeshUpload {
    vertices: packed_vertices,
    indices:  triangle_indices,
});
```

Internally, `insert_mesh()` appends the new data to two global `GrowableBuffer`s that are shared across every mesh in the scene. The vertex buffer is a single contiguous `wgpu::Buffer` with usage flag `VERTEX`; the index buffer is a single contiguous buffer with usage flag `INDEX`. Every mesh is described by a `MeshSlice` that records its starting vertex and index offsets into these shared arrays.

The reason for a unified pool is `multi_draw_indexed_indirect`. This GPU command allows the driver to execute thousands of draw calls from a single command encoder submission, reading draw parameters from a GPU-resident buffer. All those draw calls share the same vertex and index buffers — a constraint that is automatically satisfied when every mesh is part of the global pool. If each mesh had its own buffers, switching between meshes would require binding new buffers between draws, which would make indirect drawing impossible and force the renderer back to O(N_draws) CPU command recording.

`MeshSlice` is the bookkeeping record for each uploaded mesh:

```rust
pub struct MeshSlice {
    pub first_vertex:  u32,  // byte offset ÷ vertex_stride into the vertex buffer
    pub vertex_count:  u32,
    pub first_index:   u32,  // byte offset ÷ 4 into the index buffer
    pub index_count:   u32,
}
```

These values populate the `first_index`, `vertex_offset`, and `index_count` fields of `GpuDrawCall`, which the cull shader reads to emit `DrawIndexedIndirect` commands.

### 1.3 Reference Counting and Removal

Every `MeshId` in the `MeshPool` carries a `ref_count` that is incremented by `insert_object()` and decremented by `remove_object()`. Calling `remove_mesh()` on a handle with a non-zero ref count returns `SceneError::ResourceInUse`. This is intentional — it is not possible to accidentally leave an object pointing at freed geometry.

```rust
// This will fail if any object still references the mesh:
match scene.remove_mesh(mesh_id) {
    Err(SceneError::ResourceInUse { .. }) => {
        // Remove all objects using this mesh first
    }
    Ok(()) => {
        // MeshRecord freed; slot available for reuse
    }
    Err(SceneError::InvalidHandle { .. }) => {
        // mesh_id was already removed or never inserted
    }
}
```

> [!NOTE]
> Removing a mesh from the `SparsePool` frees the CPU-side record but does **not** compact the GPU vertex/index buffers. The `GrowableBuffer` implementation does not support mid-buffer deletions — gaps accumulate over time until a full rebuild is triggered. For long-running applications that frequently load and unload meshes, periodically rebuilding the pool is advisable. This is not currently automated.

---

## 2. Textures

### 2.1 TextureUpload

Textures are uploaded via the `TextureUpload` struct:

```rust
pub struct TextureUpload {
    pub label:   Option<String>,
    pub width:   u32,
    pub height:  u32,
    pub format:  wgpu::TextureFormat,
    pub data:    Vec<u8>,
    pub sampler: TextureSamplerDesc,
}
```

The `data` field contains raw pixel data in the specified `format`. For an `Rgba8UnormSrgb` texture of size 512×512, `data` must be exactly `512 × 512 × 4 = 1,048,576` bytes. The scene uploads this data to the GPU immediately inside `insert_texture()` using `create_texture_with_data`, so you can drop the `Vec<u8>` after the call returns.

The `TextureUpload::rgba8()` convenience constructor handles the sRGB/linear format selection:

```rust
let texture_id = scene.insert_texture(TextureUpload::rgba8(
    "albedo_rock",           // label
    512, 512,                // width, height
    true,                    // srgb = true for colour textures
    pixel_data,              // Vec<u8>
    TextureSamplerDesc::default(), // repeat + linear filtering
))?;
```

### 2.2 The Bindless Texture Array

Helio uses a **bindless** texture design. All textures inserted into the scene are stored in a global array of `MAX_TEXTURES = 256` slots. The shader accesses any texture by its integer slot index rather than by a distinct binding. The WGSL declarations look like:

```wgsl
@group(2) @binding(0) var textures: binding_array<texture_2d<f32>, 256>;
@group(2) @binding(1) var samplers: binding_array<sampler,          256>;
```

This requires two wgpu feature flags: `TEXTURE_BINDING_ARRAY` and `SAMPLED_TEXTURE_AND_STORAGE_BUFFER_ARRAY_NON_UNIFORM_INDEXING`. Both are required by Helio's device creation helper `required_wgpu_features()`.

The benefit of bindless is that no draw-call-level texture binding is needed. The G-buffer pass, for example, samples the base colour texture of each fragment by reading the `material_id` from the instance buffer, then the `tex_base_color` index from the material buffer, then indexing the `textures` array. This entire lookup happens in the fragment shader without any CPU-side bind group changes between draw calls.

The `TextureId` returned by `insert_texture()` carries the slot index:

```rust
let id: TextureId = scene.insert_texture(upload)?;
let slot: u32 = id.slot(); // Use this in GpuMaterial::tex_base_color
```

Slots are assigned from the `SparsePool` which recycles freed slots. When a texture at slot 5 is removed and a new texture is inserted, it may receive slot 5 again — but with a different generation counter, so the old `TextureId` is no longer valid.

### 2.3 The texture_binding_version Counter

Any time a texture is inserted or removed, the scene increments its `texture_binding_version` counter. Render passes that build bind groups containing the texture array use this counter as a key. When the version advances, the bind group must be recreated because the underlying array has changed. Passes check this like:

```rust
if self.texture_version_key != scene.texture_binding_version() {
    self.bind_group = recreate_texture_bind_group(scene);
    self.texture_version_key = scene.texture_binding_version();
}
```

This is why inserting textures frequently in the middle of a running scene is expensive — it forces bind group recreation. The intended usage pattern is to upload all textures at load time and keep them alive for the duration of the scene.

### 2.4 Texture Removal

```rust
// Fails if ref_count > 0 (material still references this texture)
scene.remove_texture(texture_id)?;
```

A texture's ref count is managed by the material system: inserting a material that references a texture increments that texture's ref count; removing the material decrements it. You must remove the material first.

---

## 3. Materials

### 3.1 Two Material Paths

Helio provides two material insertion functions depending on whether you need texture references. `insert_material(GpuMaterial)` is the simpler path for programmatic materials with no texture maps. `insert_material_asset(MaterialAsset)` is the full PBR path that associates a `GpuMaterial` with up to seven texture slots.

### 3.2 GpuMaterial

The `GpuMaterial` struct is 96 bytes and is uploaded verbatim to the GPU material buffer:

```rust
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct GpuMaterial {
    pub base_color:          [f32; 4],  // RGBA linear colour, multiplied against base_color texture
    pub emissive:            [f32; 4],  // RGB emissive tint + unused w
    pub roughness_metallic:  [f32; 4],  // x=roughness, y=metallic, z=IOR, w=specular_tint
    pub tex_base_color:      u32,       // bindless slot index; NO_TEXTURE = u32::MAX
    pub tex_normal:          u32,
    pub tex_roughness:       u32,
    pub tex_emissive:        u32,
    pub tex_occlusion:       u32,
    pub workflow:            u32,       // 0 = metallic-roughness, 1 = specular-gloss
    pub flags:               u32,       // bit 0 = double-sided, bit 1 = alpha-blend, bit 2 = alpha-test
    pub _pad:                u32,
}

impl GpuMaterial {
    pub const NO_TEXTURE: u32 = u32::MAX;
}
```

When all texture slots are set to `NO_TEXTURE`, the shader uses only the constant `base_color`, `roughness_metallic`, and `emissive` values. This is the correct setup for solid-colour props, debug geometry, or any asset that has no texture art.

### 3.3 MaterialAsset

For textured PBR materials, use `MaterialAsset`:

```rust
pub struct MaterialAsset {
    pub gpu:      GpuMaterial,    // constant parameters (multiplied against textures)
    pub textures: MaterialTextures, // optional texture references
}

pub struct MaterialTextures {
    pub base_color:         Option<MaterialTextureRef>,
    pub normal:             Option<MaterialTextureRef>,
    pub roughness_metallic: Option<MaterialTextureRef>,
    pub emissive:           Option<MaterialTextureRef>,
    pub occlusion:          Option<MaterialTextureRef>,
    pub specular_color:     Option<MaterialTextureRef>,
    pub specular_weight:    Option<MaterialTextureRef>,
    pub normal_scale:       f32,   // strength multiplier for the normal map (default 1.0)
    pub occlusion_strength: f32,   // multiplier for the AO map (default 1.0)
    pub alpha_cutoff:       f32,   // threshold for alpha-test mode (default 0.5)
}
```

Each `MaterialTextureRef` combines a `TextureId` with a UV channel index and an optional `TextureTransform`:

```rust
pub struct MaterialTextureRef {
    pub texture:    TextureId,
    pub uv_channel: u32,           // 0 = tex_coords0, 1 = tex_coords1
    pub transform:  TextureTransform,
}

pub struct TextureTransform {
    pub offset:           [f32; 2], // UV offset (default [0, 0])
    pub scale:            [f32; 2], // UV scale (default [1, 1])
    pub rotation_radians: f32,      // clockwise rotation in UV space (default 0)
}
```

The `TextureTransform` is encoded into the GPU material texture slot as a 2×2 rotation matrix and an offset, so the GPU can apply tiling, panning, and rotation in a single 2-component multiply-add per UV lookup. This is the standard KHR_texture_transform extension from glTF.

### 3.4 Material Reference Counting

When you call `insert_material_asset(asset)`, the scene validates that every `TextureId` in the texture slots is currently live, then increments the `ref_count` of each referenced texture. When you call `remove_material(id)`, it decrements those counts. This cascade of reference management is automatic — you never call texture ref functions directly.

The chain looks like this:

```
insert_material_asset(asset)
  → validate each TextureId exists
  → bump_texture_refs(+1) for each slot with a TextureId
  → store MaterialRecord { gpu, textures, ref_count: 0 }

insert_object(desc with material_id)
  → material.ref_count += 1

remove_object(id)
  → material.ref_count -= 1

remove_material(id)
  → check material.ref_count == 0 → fail if not
  → bump_texture_refs(−1) for each slot
  → overwrite GPU slot with tombstone values
```

### 3.5 Updating Materials

You can update a live material's GPU parameters without touching its texture slots, or replace both together:

```rust
// Update only the constant parameters (roughness, tint, etc.):
scene.update_material(material_id, new_gpu_material)?;

// Replace the full asset including texture references
// (properly handles ref count adjustments for old and new textures):
scene.update_material_asset(material_id, new_asset)?;
```

`update_material_asset()` is careful to increment the new texture refs before decrementing the old ones, so an update to the same material slot is safe even if the old and new assets share texture handles.

---

## 4. Complete Example — Textured Rock Prop

The following example uploads a PNG texture, creates a metallic-roughness PBR material with it, uploads a cube mesh, and creates a renderable object.

```rust
use helio::scene::Scene;
use helio::mesh::{MeshUpload, PackedVertex};
use helio::material::{
    MaterialAsset, MaterialTextures, MaterialTextureRef, TextureUpload,
    TextureSamplerDesc, TextureTransform,
};
use libhelio::GpuMaterial;
use glam::Mat4;

fn load_rock_prop(scene: &mut Scene) -> anyhow::Result<()> {
    // ── 1. Upload albedo texture ───────────────────────────────────────────────
    let albedo_pixels = load_png_rgba("assets/rock_albedo.png")?;
    let albedo_id = scene.insert_texture(TextureUpload::rgba8(
        "rock_albedo",
        1024, 1024,
        true,                          // sRGB colour texture
        albedo_pixels,
        TextureSamplerDesc::default(), // Repeat + trilinear
    ))?;

    // ── 2. Upload normal map ───────────────────────────────────────────────────
    let normal_pixels = load_png_rgba("assets/rock_normal.png")?;
    let normal_id = scene.insert_texture(TextureUpload::rgba8(
        "rock_normal",
        1024, 1024,
        false, // Normal maps are linear, not sRGB
        normal_pixels,
        TextureSamplerDesc::default(),
    ))?;

    // ── 3. Upload roughness+metallic map ──────────────────────────────────────
    let orm_pixels = load_png_rgba("assets/rock_roughness_metallic.png")?;
    let orm_id = scene.insert_texture(TextureUpload::rgba8(
        "rock_orm",
        1024, 1024,
        false, // Linear data
        orm_pixels,
        TextureSamplerDesc::default(),
    ))?;

    // ── 4. Create PBR material ─────────────────────────────────────────────────
    let gpu = GpuMaterial {
        base_color:         [1.0, 1.0, 1.0, 1.0], // white tint (texture provides colour)
        emissive:           [0.0; 4],
        roughness_metallic: [1.0, 0.0, 1.5, 0.04], // full roughness scale, non-metal
        tex_base_color:     albedo_id.slot(),
        tex_normal:         normal_id.slot(),
        tex_roughness:      orm_id.slot(),
        tex_emissive:       GpuMaterial::NO_TEXTURE,
        tex_occlusion:      GpuMaterial::NO_TEXTURE,
        workflow:           0, // metallic-roughness
        flags:              0,
        _pad:               0,
    };
    let material_id = scene.insert_material_asset(MaterialAsset {
        gpu,
        textures: MaterialTextures {
            base_color: Some(MaterialTextureRef {
                texture:    albedo_id,
                uv_channel: 0,
                transform:  TextureTransform {
                    offset:           [0.0, 0.0],
                    scale:            [2.0, 2.0], // tile 2× in each direction
                    rotation_radians: 0.0,
                },
            }),
            normal: Some(MaterialTextureRef::new(normal_id)),
            roughness_metallic: Some(MaterialTextureRef::new(orm_id)),
            ..MaterialTextures::default()
        },
    })?;

    // ── 5. Upload unit cube mesh ───────────────────────────────────────────────
    let (vertices, indices) = generate_unit_cube_mesh();
    let mesh_id = scene.insert_mesh(MeshUpload { vertices, indices });

    // ── 6. Place the rock ─────────────────────────────────────────────────────
    let transform = Mat4::from_translation(glam::Vec3::new(5.0, 0.0, -3.0));
    scene.insert_object(helio::scene::ObjectDescriptor {
        mesh:      mesh_id,
        material:  material_id,
        transform,
        bounds:    [5.0, 0.5, -3.0, 1.0], // world-space bounding sphere
        flags:     0,
        groups:    helio::groups::GroupMask::from(helio::groups::GroupId::STATIC),
    })?;

    Ok(())
}

// ── Cleanup order must respect ref counts ────────────────────────────────────
fn unload_rock_prop(
    scene: &mut Scene,
    mesh_id: helio::handles::MeshId,
    material_id: helio::handles::MaterialId,
    albedo_id: helio::handles::TextureId,
    normal_id: helio::handles::TextureId,
    orm_id: helio::handles::TextureId,
    object_id: helio::handles::ObjectId,
) -> anyhow::Result<()> {
    // Object must go first to release mesh and material refs
    scene.remove_object(object_id)?;
    // Material must go before textures (releases texture refs)
    scene.remove_material(material_id)?;
    // Now textures can be freed
    scene.remove_texture(albedo_id)?;
    scene.remove_texture(normal_id)?;
    scene.remove_texture(orm_id)?;
    // Finally the mesh
    scene.remove_mesh(mesh_id)?;
    Ok(())
}
```

> [!WARNING]
> The cleanup order matters. Always remove objects before materials, and materials before textures. The scene enforces this via `ResourceInUse` errors, but following the correct order avoids those error paths entirely.
