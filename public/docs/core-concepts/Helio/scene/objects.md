---
title: Objects
description: Inserting, updating, and removing renderable objects in the Helio scene — ObjectDescriptor fields, transform updates, bounding sphere culling, and how automatic GPU instancing works
category: helio
lastUpdated: '2026-03-23'
tags: [objects, instancing, transforms, culling, gpu-driven]
position: 2
icon: '🧊'
---

# Objects

A renderable object in Helio is the binding of a mesh and a material to a location in the world. It is not a heavy entity with its own CPU representation — it is a 128-byte `GpuInstanceData` struct written to a GPU storage buffer alongside a bounding sphere used by the culling pass and a sort key used to produce instanced draw calls automatically. This document covers the full lifecycle of an object from insertion through transform updates to removal, and explains the GPU instancing mechanism that makes large static scenes cost-free to render.

---

## 1. ObjectDescriptor

Every call to `insert_object()` takes an `ObjectDescriptor`:

```rust
#[derive(Debug, Clone, Copy)]
pub struct ObjectDescriptor {
    pub mesh:      MeshId,       // handle from insert_mesh()
    pub material:  MaterialId,   // handle from insert_material() or insert_material_asset()
    pub transform: Mat4,         // column-major world transform (glam::Mat4)
    pub bounds:    [f32; 4],     // bounding sphere: [cx, cy, cz, radius] in WORLD SPACE
    pub flags:     u32,          // bit 0 = casts_shadow, bit 1 = receives_shadow
    pub groups:    GroupMask,    // group membership for visibility control
}
```

The `transform` is a column-major 4×4 matrix in world space, identical to the convention used by `glam::Mat4`. The matrix transforms from the mesh's local space (where vertices were specified) into world space. A pure translation is `Mat4::from_translation(position)`, a rotation is `Mat4::from_rotation_y(angle)`, and they compose with the standard matrix multiply `translation * rotation`.

The `bounds` field is a bounding sphere in **world space**, not local space. The sphere must enclose the entire mesh after the world transform is applied. If your mesh occupies a unit cube centred at the origin in local space and the world transform scales it by two and translates it to `(10, 0, 5)`, the correct bounds are `[10.0, 0.0, 5.0, 1.73]` — centre at the translated position and radius `sqrt(3)` to cover the diagonal of the scaled cube.

> [!WARNING]
> Incorrect bounding spheres are one of the most common performance bugs in GPU-driven pipelines. If the bounds are too small, the culling pass will discard visible objects, causing flickering or missing geometry. If they are too large, the culling pass will admit objects that are actually offscreen, wasting fillrate. Always compute bounds in world space and verify them against the actual mesh extents under your transform.

The `flags` field is a bitfield. Bit 0 controls shadow casting: setting it to `1` means the shadow pass will include this object's geometry when building the shadow atlas. Bit 1 controls shadow receiving. Most objects should have both bits set. Editor helpers and debug overlays should have both bits clear.

---

## 2. Automatic GPU Instancing

When you insert two objects with the same mesh handle and material handle, Helio will automatically batch them into a single `DrawIndexedIndirect` command with `instance_count = 2`. You do not call any instancing API — the batching happens inside `rebuild_instance_buffers()` at flush time.

The mechanism works through a sort. When `objects_dirty` is true, `rebuild_instance_buffers()` sorts all registered objects by `(mesh_id, material_id)`. Objects that share both values are contiguous in the sorted order. The algorithm then scans the sorted list, grouping consecutive entries with the same key into one `GpuDrawCall`:

```
Objects:  [A(mesh=1,mat=2), B(mesh=1,mat=2), C(mesh=3,mat=4), D(mesh=1,mat=2)]
Sorted:   [A(1,2), B(1,2), D(1,2), C(3,4)]
DrawCalls: [DrawCall{mesh=1, mat=2, first_instance=0, instance_count=3},
            DrawCall{mesh=3, mat=4, first_instance=3, instance_count=1}]
```

The `first_instance` field tells the GPU the base index into the `GpuInstanceData` storage buffer for this draw's instances. The vertex shader reads per-instance data using the hardware `instance_index` builtin. The GPU iterates over `instance_count` consecutive instances in the buffer, fetching a different transform and material ID for each one, without any CPU involvement.

This pattern emerges automatically from how you describe your scene. If you insert 500 trees all using `tree_mesh_id` and `bark_material_id`, they consolidate to one draw call. If you additionally insert 500 grass tufts with a different mesh, those form a second draw call. The scene with 1000 objects and many shared meshes produces far fewer draw calls than there are objects.

> [!IMPORTANT]
> The sort key is `(mesh_id, material_id)`. Two objects with the same mesh but different materials will **not** be batched — they produce separate draw calls. For maximum batching efficiency, share both the mesh and the material across as many objects as possible. Colour variation can be achieved through object flags or per-instance data extensions rather than separate material instances.

---

## 3. Inserting Objects

```rust
let object_id: ObjectId = scene.insert_object(ObjectDescriptor {
    mesh:      mesh_id,
    material:  material_id,
    transform: Mat4::from_translation(Vec3::new(10.0, 0.0, 5.0)),
    bounds:    [10.0, 0.5, 5.0, 1.5],
    flags:     0b11, // casts + receives shadows
    groups:    GroupMask::from(GroupId::STATIC),
})?;
```

`insert_object()` does the following: it validates both the mesh and material handles, increments their ref counts, builds a `GpuInstanceData` record, appends it to the `DenseArena`, and sets `objects_dirty = true`. No GPU write happens yet. The actual GPU upload is deferred to the next `flush()`, which allows you to insert thousands of objects in a loop without triggering thousands of individual GPU buffer writes.

The error cases are `InvalidHandle` for an unrecognised mesh or material, which indicates the asset loading pipeline produced a bad handle or the resource was removed before `insert_object()` was called.

---

## 4. Updating Object Transforms

When you need to move, rotate, or scale a live object, call `update_object_transform()`:

```rust
let new_transform = Mat4::from_translation(Vec3::new(10.0, 1.0, 5.0));
scene.update_object_transform(object_id, new_transform)?;
```

The implementation has two paths depending on the dirty state. If `objects_dirty` is true — meaning a full rebuild is already pending — the new transform is written into the CPU-side `ObjectRecord` and will be included in the upcoming rebuild. No separate GPU write is needed. If `objects_dirty` is false — meaning the GPU layout is stable from a previous flush — the function additionally writes the 128-byte instance data slot directly to the GPU instance buffer at the exact position corresponding to this object:

```rust
if !self.objects_dirty {
    let slot = record.draw.first_instance as usize;
    self.gpu_scene.instances.update(slot, record.instance);
}
```

The `instances.update()` call is a 128-byte `queue.write_buffer()` targeting a specific offset in the instance buffer. On a desktop GPU, writing 128 bytes via `write_buffer` has essentially zero overhead compared to the cost of the draw call that reads it. This means animated objects — characters, vehicles, swinging doors — cost approximately one 128-byte CPU-to-GPU write per frame per animated object, regardless of how many triangles the mesh has.

`update_object_transform` also recomputes the normal matrix. The normal matrix is the inverse-transpose of the upper-left 3×3 submatrix of the model matrix, which is needed to correctly transform surface normals when the model matrix includes non-uniform scaling. For a transform with uniform scale only (rotation + uniform scale + translation), the normal matrix is equal to the rotation part of the model matrix — the inverse-transpose of a rotation is itself. But for a mesh that is stretched or squashed, the normal matrix differs from the rotation and the vertex shader must use it to avoid shading artefacts.

---

## 5. Updating Object Material

Switching a live object's material is possible but has a broader impact than a transform update:

```rust
scene.update_object_material(object_id, new_material_id)?;
```

The function increments the new material's ref count, decrements the old material's ref count, patches the `GpuInstanceData::material_id` field, and crucially sets `objects_dirty = true`. This is necessary because the material change may change the sort key `(mesh_id, material_id)` of this object. If the object was previously batched with other objects sharing its old material, those batches must be rebuilt. The full `rebuild_instance_buffers()` on the next flush will re-sort the objects and produce new batch groupings.

Material changes should be treated as relatively rare events — transitions between states, not per-frame updates. If you need fine-grained material variation within a single batch (e.g. each tree has a slightly different tint), encode the variation in the `flags` field or use a material that reads per-instance data from a secondary buffer, rather than creating one material per object.

---

## 6. Updating Object Bounds

```rust
scene.update_object_bounds(object_id, [new_cx, new_cy, new_cz, new_radius])?;
```

Bounds do not affect the sort key, so updating them does not set `objects_dirty`. When the GPU layout is stable, this performs an in-place write of both the `GpuInstanceData::bounds` field and the associated `GpuInstanceAabb` (the axis-aligned bounding box derived from the sphere, used by the hierarchical culling pass). Both writes are 16-byte targeted `write_buffer` operations.

You should call this whenever the transform changes and the bounding sphere's world-space centre needs to move with it. Note that `move_group()` automatically updates bounds for all grouped objects — you only need to call `update_object_bounds` directly when you change a single object's transform via `update_object_transform`.

---

## 7. Removing Objects

```rust
scene.remove_object(object_id)?;
```

Removal decrements the mesh and material ref counts, removes the `ObjectRecord` from the `DenseArena` using a swap-remove (the last object in the dense array fills the vacated slot), and sets `objects_dirty = true`. The `ObjectId` is invalidated: its generation counter no longer matches any live record, so any subsequent use of the handle will return `InvalidHandle`.

After the next flush, the GPU instance buffer will be rebuilt without this object. Until then, the object remains visible on screen — changes take effect at flush boundary, not immediately.

---

## 8. GpuInstanceData Layout

The following is the complete 128-byte layout written to the GPU instance buffer for every live object:

| Field | Type | Bytes | Description |
|---|---|---|---|
| `model` | `[f32; 16]` | 64 | Column-major model matrix (local → world) |
| `normal_mat` | `[f32; 12]` | 48 | Inverse-transpose of model upper-left 3×3, padded to 3 × `vec4` |
| `bounds` | `[f32; 4]` | 16 | World-space bounding sphere: XYZ = centre, W = radius |
| `mesh_id` | `u32` | 4 | Index into the mesh pool (for mesh parameter lookup in shaders) |
| `material_id` | `u32` | 4 | Index into the material buffer (for shading parameter lookup) |
| `flags` | `u32` | 4 | Bit 0 = casts_shadow, bit 1 = receives_shadow |
| `_pad` | `u32` | 4 | Alignment padding |
| **Total** | | **128** | |

The 48-byte normal matrix is stored as three `vec4` columns (each padded with a zero W component) to respect the WGSL 16-byte alignment requirement for `mat3x4`. The vertex shader reconstructs the TBN frame from the instance's normal matrix and the per-vertex tangent/normal, then uses it to transform lighting vectors from tangent space to world space.

```wgsl
// WGSL instance data struct (must match GpuInstanceData byte-for-byte)
struct GpuInstance {
    model_0:     vec4<f32>,  // column 0 of model matrix
    model_1:     vec4<f32>,  // column 1
    model_2:     vec4<f32>,  // column 2
    model_3:     vec4<f32>,  // column 3 (translation)
    normal_0:    vec4<f32>,  // column 0 of normal matrix (w unused)
    normal_1:    vec4<f32>,  // column 1
    normal_2:    vec4<f32>,  // column 2
    bounds:      vec4<f32>,  // xyz = sphere centre, w = radius
    mesh_id:     u32,
    material_id: u32,
    flags:       u32,
    _pad:        u32,
}
```

---

## 9. Complete Example — 1000 Trees

The following example places 1000 trees with the same mesh and material. Because they all share `(mesh_id, material_id)`, they collapse to a single draw call with `instance_count = 1000`.

```rust
use helio::scene::{Scene, ObjectDescriptor};
use helio::mesh::{MeshUpload, PackedVertex};
use helio::groups::{GroupId, GroupMask};
use glam::{Mat4, Vec3};
use rand::Rng;

fn populate_forest(scene: &mut Scene, rng: &mut impl Rng) {
    // Upload shared mesh and material once
    let mesh_id = scene.insert_mesh(load_tree_mesh());
    let material_id = scene.insert_material(bark_material());

    let static_group = GroupMask::from(GroupId::STATIC);

    for _ in 0..1000 {
        let x = rng.gen_range(-200.0_f32..200.0);
        let z = rng.gen_range(-200.0_f32..200.0);
        let scale = rng.gen_range(0.8_f32..1.4);
        let yaw = rng.gen_range(0.0_f32..std::f32::consts::TAU);

        let transform = Mat4::from_scale_rotation_translation(
            Vec3::splat(scale),
            glam::Quat::from_rotation_y(yaw),
            Vec3::new(x, 0.0, z),
        );

        // Bounding sphere: tree is ~3m tall, ~1m wide at scale=1
        let radius = scale * 1.8; // conservative sphere covering trunk + crown
        let cy = scale * 1.5;     // centre at half-tree-height

        scene.insert_object(ObjectDescriptor {
            mesh:      mesh_id,
            material:  material_id,
            transform,
            bounds:    [x, cy, z, radius],
            flags:     0b11, // casts + receives shadows
            groups:    static_group,
        }).expect("valid handles");
    }

    // After this loop, scene.objects_dirty = true.
    // On the next flush(), rebuild_instance_buffers() will sort all 1000
    // tree objects by (mesh_id, material_id), find they are all identical,
    // and emit exactly ONE GpuDrawCall with instance_count = 1000.
    // The GPU executes one DrawIndexedIndirect → 1000 trees drawn.
}
```

> [!TIP]
> In the steady state (no new trees added or removed), all 1000 trees cost exactly 0 CPU operations per frame beyond the `flush()` dirty-flag check. The GPU receives the same draw call buffer every frame; only the camera uniform changes. This is the defining advantage of the indirect rendering model over traditional forward draw call submission.
