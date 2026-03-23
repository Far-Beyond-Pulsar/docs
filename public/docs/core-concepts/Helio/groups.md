---
title: Object Groups
description: Helio's bitmask-based object group system — tagging objects with up to 64 named groups, toggling group visibility in O(1), and performing mass transforms on entire groups without iterating objects
category: helio
lastUpdated: '2026-03-23'
tags:
  - groups
  - visibility
  - scene-management
  - bitmask
  - editor
position: 4
icon: '🏷️'
---

# Object Groups

Every non-trivial scene has categories. Editor gizmos exist only in authoring tools and must vanish at runtime. Static world geometry never participates in physics simulation. VFX objects may need to be collectively culled during a cinematic. Health bars and nameplates belong to a separate rendering layer from the world geometry beneath them. The question is how a renderer should represent these categories efficiently when the number of objects per category can be thousands.

The naïve approach — iterating every object and checking a category tag — costs O(N) per category change. In a scene with ten thousand objects this is acceptable once; performed sixty times per second for a dozen categories it becomes a measurable frame-time contributor, and worse, it becomes a source of cache misses as the CPU walks a large object array for a Boolean state transition that should conceptually be constant time. Helio's group system solves this with a 64-bit bitmask: the scene maintains a single `group_hidden: GroupMask` field representing the current visibility state of all 64 possible groups, and an object is visible if its own `GroupMask` shares no bits with `group_hidden`. Hiding an entire group is a single bitwise OR into `group_hidden` — constant time regardless of scene size.

---

## 1. The `GroupId` Type

A `GroupId` is a newtype over `u8` representing the bit position of a single group within a 64-bit mask. Valid values are `0` through `63`; any value above 63 is silently clamped to 63. The type is `Copy`, `PartialEq`, `Eq`, and `Hash`, and is intended to be stored as a constant:

```rust
// Custom group for game-specific categories:
const MY_GROUP_ENEMIES: GroupId = GroupId::new(12);
const MY_GROUP_PICKUPS: GroupId = GroupId::new(13);
```

The `index()` method returns the raw `u8` bit index, and `mask()` returns the corresponding single-bit `GroupMask` — equivalent to `1u64 << index`. You will rarely need either of these methods directly; `GroupMask::from(group_id)` is the idiomatic way to convert a single group into a mask.

### Built-in Groups

Helio reserves the first eight group indices (0–7) as well-known groups with semantic names. These constants are associated constants on `GroupId`:

| Constant | Index | Intended use |
|---|---|---|
| `GroupId::EDITOR` | 0 | Editor billboards, gizmos, grid overlays — hidden at runtime |
| `GroupId::DEFAULT` | 1 | Default bucket for user-created scene objects |
| `GroupId::STATIC` | 2 | Static world geometry: floors, walls, terrain, props that never move |
| `GroupId::DYNAMIC` | 3 | Physics-simulated or keyframe-animated objects |
| `GroupId::WORLD_UI` | 4 | World-space UI: health bars, nameplates, interaction prompts |
| `GroupId::VFX` | 5 | Particle systems and visual effects |
| `GroupId::SHADOW_CASTERS` | 6 | Objects that cast shadows; can be mass-disabled for LOD props |
| `GroupId::DEBUG` | 7 | AABB overlays, nav-mesh visualisers, debug geometry |

Groups 8 through 63 are completely unassigned and available for application use. When you define custom groups, it is good practice to mirror the built-in pattern — declaring constants with `GroupId::new(index)` in your own application module rather than scattering raw integer literals throughout the codebase.

> [!NOTE]
> The built-in group names are conventions, not enforcement mechanisms. Helio does not automatically place objects into `GroupId::STATIC` based on whether their transform changes, nor does it perform special behaviour for `GroupId::SHADOW_CASTERS` beyond what you implement via `hide_group`. The names exist so that application code and editor tooling can share a common vocabulary without coordination.

---

## 2. The `GroupMask` Type

`GroupMask` is a newtype wrapping a `u64`. Bit N is set when the mask includes `GroupId(N)`. The type provides a small algebra of operations, all of which compile to a single instruction on any 64-bit target:

```rust
let static_only   = GroupMask::from(GroupId::STATIC);
let editor_static = GroupMask::from(GroupId::EDITOR)
                        .union(GroupMask::from(GroupId::STATIC));

let has_editor    = editor_static.contains(GroupId::EDITOR); // true
let has_dynamic   = editor_static.contains(GroupId::DYNAMIC); // false
let intersection  = editor_static.intersection(static_only); // GroupMask(bit 2)
```

The two sentinel values are `GroupMask::NONE` (all bits zero — ungrouped) and `GroupMask::ALL` (all 64 bits set). Objects created with `GroupMask::NONE` are permanently visible regardless of which groups are hidden, because the visibility predicate short-circuits when the object's mask is empty. This is an intentional escape hatch: objects that must never be affected by group visibility operations — such as a skybox or a persistent fullscreen overlay — should be ungrouped.

The full set of combinatorial operations mirrors Rust's standard bitset conventions:

```rust
// Additive — returns a new mask with the group's bit set:
let with_vfx = my_mask.with(GroupId::VFX);

// Subtractive — returns a new mask with the group's bit cleared:
let without_vfx = my_mask.without(GroupId::VFX);

// Query:
let visible_to_all = my_mask.is_empty();
let includes_vfx   = my_mask.contains(GroupId::VFX);
let overlaps       = my_mask.intersects(other_mask);

// Bitwise operators are also available:
let combined = mask_a | mask_b;
let filtered = mask_a & mask_b;
let inverted = !mask_a;
```

---

## 3. Assigning Groups to Objects

Group membership is specified at object creation time through the `groups` field of `ObjectDescriptor`. An object can simultaneously belong to any combination of groups:

```rust
let fence_id = scene.insert_object(ObjectDescriptor {
    mesh:      fence_mesh,
    material:  fence_mat,
    transform: Mat4::IDENTITY,
    bounds:    [0.0, 1.0, 0.0, 2.5],
    flags:     0,
    // This object is both static geometry and a shadow caster:
    groups:    GroupMask::from(GroupId::STATIC)
                   .with(GroupId::SHADOW_CASTERS),
})?;
```

Group membership can be changed after creation using three methods:

`set_object_groups(id, mask)` replaces the entire group membership mask atomically. Use this when you want precise control over the final set.

`add_object_to_group(id, group)` adds a single group to the existing mask without disturbing other memberships. This is the right choice when extending membership incrementally, for example when a pickup object becomes "highlighted" by adding it to a highlight group.

`remove_object_from_group(id, group)` removes a single group bit. When the last group bit is cleared, the object becomes ungrouped and is unaffected by all future `hide_group` calls.

All three methods update the GPU visibility buffer in place when no full instance rebuild is pending — they write a single `u32` to the visibility slot assigned to the object during the most recent `rebuild_instance_buffers` call:

```rust
// Make this object invisible to group hide operations (ungrouped):
scene.set_object_groups(fence_id, GroupMask::NONE)?;

// Add it to the VFX group without removing it from STATIC:
scene.add_object_to_group(fence_id, GroupId::VFX)?;

// Remove VFX group membership:
scene.remove_object_from_group(fence_id, GroupId::VFX)?;
```

---

## 4. Visibility Semantics

The visibility predicate is formally:

```rust
fn object_is_visible(groups: GroupMask, group_hidden: GroupMask) -> bool {
    groups.is_empty() || !groups.intersects(group_hidden)
}
```

An object is **visible** if either its group mask is empty (ungrouped — always visible) or none of its groups intersect the scene's hidden-groups mask. An object is **hidden** if it belongs to at least one group and at least one of those groups is currently hidden.

This semantics has an important consequence for multi-group objects: if an object belongs to both `GroupId::STATIC` and `GroupId::SHADOW_CASTERS`, hiding either group alone hides the object entirely. There is no concept of partial hiding based on group intersection — an object's visibility is a single Boolean determined by whether any of its bits are masked. If you need finer control, keep groups orthogonal: do not assign a single object to two groups that may be hidden independently.

> [!IMPORTANT]
> Ungrouped objects (`GroupMask::NONE`) are **always** visible. They are not hidden by `hide_group(GroupId::ALL)` or `set_group_visibility(GroupMask::ALL, false)`. If you want a group of objects to be individually controllable, they must have at least one group bit set.

---

## 5. Hiding and Showing Groups

The scene exposes four methods for controlling group visibility:

`hide_group(GroupId)` sets the corresponding bit in `group_hidden`. If the bit was already set, the call is a no-op. Otherwise it calls `flush_group_visibility()`, which walks the dense object array and updates each object's GPU visibility slot.

`show_group(GroupId)` clears the bit and triggers the same walk if the group was previously hidden.

`is_group_hidden(GroupId)` returns `true` if the group is currently hidden — useful for editor toggle buttons that need to reflect current state.

`set_group_visibility(GroupMask, bool)` hides or shows an entire set of groups at once. Only the bits present in the supplied mask are affected; unrelated groups retain their current state. This is more efficient than calling `hide_group` in a loop because it triggers `flush_group_visibility` only once:

```rust
// Hide editor and debug groups at game start:
scene.set_group_visibility(
    GroupMask::from(GroupId::EDITOR).with(GroupId::DEBUG),
    false, // visible = false → hidden
);

// Show only the debug group again for a profiling session:
scene.show_group(GroupId::DEBUG);
```

---

## 6. How Visibility Propagates to the GPU

The scene maintains a GPU-side visibility buffer — a flat array of `u32` values, one per active object, where `1` means visible and `0` means hidden. This buffer is read by the GPU-driven culling shader before dispatching draw calls. Updating it is the mechanism by which group hide/show operations take effect on the GPU without requiring a full instance buffer rebuild.

When `flush_group_visibility()` is called, it iterates through the dense object array — the actual contiguous storage used by `DenseArena` — and for each entry, evaluates `object_is_visible(r.groups, group_hidden)` and writes the result to the corresponding GPU slot via `GrowableBuffer::update`. This is an O(N) pass over the dense array, but it is bounded to a single cache-friendly linear scan with no branching except for the bitwise test. The GPU upload itself is a single `queue.write_buffer` call at the end of the scan, not one per object.

There is one important optimisation: when `objects_dirty` is true, `flush_group_visibility()` returns immediately without doing anything. A pending instance rebuild will recompute visibility from scratch when it runs — there is no point updating individual slots if the entire buffer is about to be rewritten. This means that if you hide a group and insert a new object in the same frame, you will not pay the linear scan twice.

---

## 7. Mass Transform Operations

Two methods apply a geometric transformation to every object belonging to a specified group: `move_group` and `translate_group`.

`move_group(group, delta)` accepts a `Mat4` and post-multiplies it with each matching object's current model matrix: `new_model = delta * old_model`. This allows arbitrary affine transforms — translations, rotations, non-uniform scales, and combinations thereof — to be applied uniformly across a group. The method also transforms the bounding sphere centre using `transform_point3`, keeping culling bounds consistent:

```rust
// Rotate all dynamic objects 90 degrees around the world Y axis:
scene.move_group(
    GroupId::DYNAMIC,
    Mat4::from_rotation_y(std::f32::consts::FRAC_PI_2),
);
```

`translate_group(group, delta)` is a convenience wrapper that constructs a pure translation matrix from a `Vec3` and delegates to `move_group`:

```rust
// Drop all VFX objects by 10 units (e.g., reset after a cutscene):
scene.translate_group(GroupId::VFX, Vec3::new(0.0, -10.0, 0.0));
```

Both methods iterate the dense object array, test group membership with `r.groups.contains(group)`, and perform in-place GPU buffer updates when `objects_dirty` is false. They are O(N) in the total number of scene objects, not O(K) in the number of objects in the group — there is no secondary index by group. For scenes where group-targeted transform operations are frequent and performance-critical, consider organising objects into contiguous ranges within the arena (which is not currently exposed as an explicit API) or using per-group transform hierarchies maintained in application code.

> [!NOTE]
> `move_group` and `translate_group` are provided for convenience in scenarios like cut-scene setups and editor operations. For gameplay animation of individual objects, `update_object_transform` with a pre-computed world matrix is the correct path — it is guaranteed to produce a single slot write with no iteration overhead.

---

## 8. Common Patterns

### Editor Mode

The most universal use of groups is the editor/runtime split. All editor-only objects — light billboards, transform gizmos, grid geometry, selection highlight meshes — are inserted with `GroupId::EDITOR`. At game start, a single call hides them all:

```rust
// In your editor: add helper objects
let grid_id = scene.insert_object(ObjectDescriptor {
    groups: GroupMask::from(GroupId::EDITOR),
    // ...
})?;

// At game start:
scene.hide_group(GroupId::EDITOR);
```

The renderer already does this automatically for its built-in editor light icons: `Renderer::render()` checks `is_group_hidden(GroupId::EDITOR)` and conditionally includes or suppresses the auto-generated billboard instances for each light in the scene.

### Shadow LOD

A common optimisation for open-world environments is to disable shadow casting for distant or visually insignificant props — crates, rubble, small foliage — while retaining it for large architectural elements. If all small props are tagged with `GroupId::SHADOW_CASTERS` alongside their content group:

```rust
let crate_id = scene.insert_object(ObjectDescriptor {
    groups: GroupMask::from(GroupId::STATIC).with(GroupId::SHADOW_CASTERS),
    // ...
})?;
```

Then at a certain camera distance threshold, shadow casting for that category can be toggled with a single call rather than iterating and modifying every crate object individually. This is not a depth-range cull — it is a full CPU-side visibility disable that removes the objects from shadow draw calls entirely.

### Debug Overlays

Debug geometry — AABB visualisers, navmesh overlays, physics wireframes — should always use `GroupId::DEBUG`. This makes it trivial to toggle all debug visualisation in response to a key press:

```rust
if input.key_pressed(Key::F3) {
    if scene.is_group_hidden(GroupId::DEBUG) {
        scene.show_group(GroupId::DEBUG);
    } else {
        scene.hide_group(GroupId::DEBUG);
    }
}
```

### Render Layers

Games with complex UI hierarchies or layered rendering (background layer, world layer, foreground layer, UI layer) can use custom group IDs as render layers. The visibility semantics compose naturally: an object in the UI layer that is currently "off screen" can be hidden by group without affecting any other layer:

```rust
const GROUP_UI_LAYER:         GroupId = GroupId::new(8);
const GROUP_BACKGROUND_LAYER: GroupId = GroupId::new(9);

scene.hide_group(GROUP_UI_LAYER);
// All UI objects become invisible; world objects are unaffected.
```

---

## 9. Custom Group IDs

Any group index from 8 to 63 is available for application use. The idiomatic way to define custom groups is as module-level or `impl`-block constants, mirroring how the built-ins are defined:

```rust
mod groups {
    use helio::GroupId;

    pub const ENEMIES:    GroupId = GroupId::new(8);
    pub const ALLIES:     GroupId = GroupId::new(9);
    pub const NEUTRALS:   GroupId = GroupId::new(10);
    pub const INTERACTABLE: GroupId = GroupId::new(11);
    pub const HIGHLIGHT:  GroupId = GroupId::new(12);
}
```

Defining your groups as named constants rather than bare integer literals gives you two benefits: the compiler catches typos that would silently produce the wrong bit position, and a future developer reading `hide_group(groups::ENEMIES)` understands the intent without reaching for a comment or a lookup table.

Values above 63 are silently clamped to 63 by `GroupId::new`. There is no runtime panic, but the behaviour is almost certainly not what you intended — index 63 would be shared across all uses of out-of-range values. If you need more than 56 user-defined groups (the 64 total minus the 8 reserved), consider whether some of your "groups" are better modelled as object flags (`ObjectDescriptor::flags`) or as application-level categories maintained outside the renderer.

---

## 10. Performance Reference

Understanding the cost model of each operation prevents surprises when scaling to large scenes.

Setting `group_hidden` via `hide_group`, `show_group`, or `set_group_visibility` is O(1) — it is a bitwise operation on a single `u64`. The O(N) cost is incurred immediately afterward in `flush_group_visibility`, which writes one `u32` per object to the GPU visibility buffer. For a scene with 10 000 objects this is approximately 40 KB of writes in a linear cache-friendly pass — well under a millisecond on any modern CPU, and a single `queue.write_buffer` call to the GPU.

Changing a single object's group membership via `set_object_groups`, `add_object_to_group`, or `remove_object_from_group` is O(1) when no instance rebuild is pending — one array lookup and one `GrowableBuffer::update` call.

`move_group` and `translate_group` are O(N) in the total object count regardless of group size, because there is no inverted group index. For very large scenes (100 000+ objects) where group-targeted transforms are called every frame, the iteration cost becomes visible in profiling. In such cases, prefer maintaining separate transform data in application code and calling `update_object_transform` selectively.

The instance rebuild triggered by object insertion/removal (`objects_dirty = true`) subsumes all visibility updates — `flush_group_visibility` is a no-op when a rebuild is pending, and the rebuild itself computes fresh visibility for every object in a single pass.
