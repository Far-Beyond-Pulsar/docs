---
title: Groups & Mass Operations
description: Helio's 64-bit bitmask group system for categorising scene objects — toggling visibility of entire groups in O(1), applying mass transforms, and managing editor vs runtime content
category: helio
lastUpdated: '2026-03-23'
tags: [groups, visibility, mass-operations, bitmask, editor]
position: 4
icon: '🏷️'
---

# Groups & Mass Operations

The group system solves a fundamental problem in large scene management: how do you efficiently hide, show, or move categories of objects when the scene contains tens of thousands of items? The answer is a 64-bit bitmask. Every object carries a `GroupMask` — a compact `u64` where each bit position represents membership in a named group. Group-level operations test or set bits rather than iterating individual objects, making the operations themselves O(1) while the downstream visibility pass remains linear but minimal.

---

## 1. The Problem Groups Solve

In a scene with 50,000 objects, consider what it costs to hide all editor overlays at runtime. A naive implementation iterates every object, checks if it is an editor overlay, and writes a visibility flag. That is 50,000 flag reads and potentially 50,000 flag writes per hide operation. If you do this on every frame transition between editor and play mode, the cost is measurable.

The bitmask solution changes the structure of the problem. Rather than tagging objects one at a time, you set a single bit in the global `group_hidden` mask. The GPU receives the updated visibility values only when it needs to render the next frame, and only the objects whose group bits intersect `group_hidden` need their GPU visibility slot updated. The hide operation itself — the bit flip — is O(1). The downstream visibility pass is O(N_objects) in the worst case, but it is also skipped entirely when `objects_dirty` is already true, because the full rebuild will compute correct visibility from scratch.

The design goal is that in a static scene (no topology changes), hiding an entire category of objects costs one `group_hidden` bit flip plus one O(N) pass over the GPU visibility buffer. In a scene undergoing a full rebuild, it costs nothing extra because rebuild computes visibility from scratch anyway.

---

## 2. GroupId and GroupMask

`GroupId` is a newtype over `u8` holding a bit index in the range 0–63. Values outside this range are clamped to 63 at construction time.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct GroupId(u8);

impl GroupId {
    pub const fn new(index: u8) -> Self {
        if index > 63 { GroupId(63) } else { GroupId(index) }
    }
    pub const fn index(self) -> u8 { self.0 }
    pub const fn mask(self) -> GroupMask { GroupMask(1u64 << self.0) }
}
```

`GroupMask` is a `u64` bitmask. Bit N is set when the object belongs to `GroupId(N)`.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct GroupMask(pub u64);
```

The eight built-in groups cover the most common categories encountered in games and interactive applications:

| Constant | Index | Intended use |
|---|---|---|
| `GroupId::EDITOR` | 0 | Editor helpers: billboards, gizmos, grid overlays |
| `GroupId::DEFAULT` | 1 | Standard user-created scene objects |
| `GroupId::STATIC` | 2 | World geometry that never moves (floors, walls, terrain) |
| `GroupId::DYNAMIC` | 3 | Simulated, animated, or player-driven objects |
| `GroupId::WORLD_UI` | 4 | World-space UI: health bars, nameplates, markers |
| `GroupId::VFX` | 5 | Visual effects and particle system proxies |
| `GroupId::SHADOW_CASTERS` | 6 | Objects that cast shadows — can mass-disable for props |
| `GroupId::DEBUG` | 7 | Debug visualisers: AABBs, nav-mesh overlays, profiling geo |

Groups 8–63 are available for application-defined categories. Create them via `GroupId::new(index)`. Examples of reasonable application-defined groups include LOD categories, dungeon-room membership for streaming, or faction colouring in a strategy game.

---

## 3. GroupMask Operations

`GroupMask` provides a complete algebra for composing and testing group sets. All operations are `const` functions that compile to one or two integer instructions.

```rust
// Build masks from constants and combine
let editor_only = GroupMask::from(GroupId::EDITOR);
let static_and_default = GroupMask::from(GroupId::STATIC) | GroupMask::from(GroupId::DEFAULT);
let everything = GroupMask::ALL;
let nothing = GroupMask::NONE;

// Add and remove groups from a mask
let with_vfx    = static_and_default.with(GroupId::VFX);
let without_vfx = with_vfx.without(GroupId::VFX);

// Test membership
let is_static = with_vfx.contains(GroupId::STATIC);   // true
let overlaps  = with_vfx.intersects(editor_only);       // false

// Bitwise algebra (same as with/without but for whole masks)
let combined    = mask_a | mask_b;
let intersection = mask_a & mask_b;
let complement  = !mask_a;
```

The identity axioms hold: `mask.with(g).without(g) == mask`, `GroupMask::NONE | mask == mask`, `GroupMask::ALL & mask == mask`. These allow confident algebraic reasoning about group combinations without worrying about edge cases.

---

## 4. Setting Object Group Membership

You can assign groups at insertion time via `ObjectDescriptor::groups`, or modify them on live objects.

**Replace the entire mask:**
```rust
// Replace the complete group membership of an object
scene.set_object_groups(object_id, GroupMask::from(GroupId::STATIC))?;
```

**Add one group additively:**
```rust
// Add the SHADOW_CASTERS group without removing existing groups
scene.add_object_to_group(object_id, GroupId::SHADOW_CASTERS)?;
```

**Remove one group:**
```rust
// Remove the DEBUG group, keeping all other memberships
scene.remove_object_from_group(object_id, GroupId::DEBUG)?;
```

**Query current membership:**
```rust
let mask: GroupMask = scene.object_groups(object_id)?;
let in_static = mask.contains(GroupId::STATIC);
```

All four operations are O(1). When the GPU layout is stable (no pending rebuild), they additionally write the new visibility value to the GPU visibility buffer immediately, targeting the specific slot for this object. The visibility write is one 4-byte `write_buffer` call.

> [!NOTE]
> Changing group membership does **not** set `objects_dirty`. The sort key for instancing depends on `(mesh_id, material_id)`, not on group membership. You can freely change which groups an object belongs to without triggering an expensive full rebuild of the instance buffer.

---

## 5. Group Visibility Control

The group visibility system works through a global `group_hidden` bitmask stored in the scene. An object is visible if and only if it is ungrouped (`groups == GroupMask::NONE`) or none of its groups are currently hidden:

```rust
// Internal visibility predicate (from scene.rs):
fn object_is_visible(groups: GroupMask, group_hidden: GroupMask) -> bool {
    groups.is_empty() || !groups.intersects(group_hidden)
}
```

Ungrouped objects (`GroupMask::NONE`) are always visible — they are the default for objects that should never be toggled. An object is hidden if `groups & group_hidden != 0`, that is, if the object belongs to at least one group that is currently hidden.

An object in multiple groups is hidden if **any** of those groups is hidden. This is an OR condition, not AND. An object in both `EDITOR` and `VFX` groups will be hidden when either `hide_group(EDITOR)` or `hide_group(VFX)` is called. It will only be visible when both groups are shown.

```rust
// Hide all objects in a group (one bit flip + O(N) visibility pass)
scene.hide_group(GroupId::EDITOR);

// Show them again
scene.show_group(GroupId::EDITOR);

// Query current state
let is_hidden = scene.is_group_hidden(GroupId::EDITOR);

// Hide or show multiple groups at once
let editor_and_debug = GroupMask::from(GroupId::EDITOR) | GroupMask::from(GroupId::DEBUG);
scene.set_group_visibility(editor_and_debug, false); // hide both
scene.set_group_visibility(editor_and_debug, true);  // show both
```

`set_group_visibility(mask, visible)` only modifies the bits in `mask`, leaving all other groups in their current state. This makes it safe to hide editor content without accidentally changing the visibility of groups you haven't thought about.

---

## 6. Mass Transforms

Two functions apply a world-space transform to every object in a group simultaneously.

`move_group(group, delta)` post-multiplies `delta` onto every matching object's model matrix:

```rust
// Rotate the entire DYNAMIC group 90° around Y (post-multiply)
scene.move_group(
    GroupId::DYNAMIC,
    Mat4::from_rotation_y(std::f32::consts::FRAC_PI_2),
)?;
```

`translate_group(group, delta)` is a convenience wrapper that constructs a translation matrix from a `Vec3`:

```rust
// Move all VFX objects 5 units upward
scene.translate_group(GroupId::VFX, Vec3::new(0.0, 5.0, 0.0));
```

Both operations are O(N_in_group) — they iterate the entire dense object array and apply the transform to every object whose group mask contains the target group. Internally they call the same in-place update logic as `update_object_transform`: if the GPU layout is stable, they write each changed instance slot directly to the GPU buffer. If a rebuild is pending, they update the CPU records and the rebuild will include the new transforms.

`move_group` also updates the bounding sphere centre. The sphere radius is kept unchanged; only the `xyz` component of `bounds` is transformed by the delta matrix. This approximation is exact for translations and rotations, and approximate for scales — if you apply a scale via `move_group`, you should also update the bounds radius manually to prevent culling errors.

---

## 7. Editor Workflow

The canonical editor pattern is:

```rust
// At load time: tag all editor helpers with GroupId::EDITOR
for billboard_id in editor_billboards {
    scene.set_object_groups(billboard_id, GroupMask::from(GroupId::EDITOR))?;
}
for gizmo_id in editor_gizmos {
    scene.set_object_groups(gizmo_id, GroupMask::from(GroupId::EDITOR))?;
}

// At runtime (game start): hide everything in the EDITOR group
scene.hide_group(GroupId::EDITOR);

// Re-entering editor mode:
scene.show_group(GroupId::EDITOR);
```

After `hide_group(GroupId::EDITOR)`, the GPU visibility buffer is updated to write `0` for every editor object. The culling pass reads these visibility values and emits zero-instance draw calls for any hidden batch. The GPU processes zero-instance calls in essentially no time — they produce no fragments. The CPU cost is a single bit flip plus an O(N_editor) visibility write, which is once at mode transition, not every frame.

---

## 8. Multi-Group Objects

An object can belong to multiple groups simultaneously. The mask is a `u64` bitfield, so membership in 64 groups costs exactly zero bytes beyond the 8 bytes the mask already occupies.

A practical use case: in a game with instanced foliage that should cast shadows but should not appear in editor-only modes, the foliage objects would belong to both `STATIC` and `SHADOW_CASTERS`. If the application later decides to disable all shadow casting from foliage for performance, `hide_group(SHADOW_CASTERS)` will hide those objects from the shadow pass — but because the GPU visibility buffer is what the shadow pass reads, and the G-buffer pass has its own visibility semantics, this requires co-ordination between passes. In practice the simplest model is to use groups for game-layer toggles (editor vs runtime, active vs dormant, inside vs outside) and use the `flags` field on objects for rendering-pipeline concerns like shadow casting.

```rust
// Object belongs to STATIC and SHADOW_CASTERS simultaneously
scene.insert_object(ObjectDescriptor {
    groups: GroupMask::from(GroupId::STATIC) | GroupMask::from(GroupId::SHADOW_CASTERS),
    ..
})?;

// This object will be hidden when EITHER group is hidden
scene.hide_group(GroupId::SHADOW_CASTERS); // object hidden
scene.show_group(GroupId::SHADOW_CASTERS); // only visible again if STATIC is not hidden
```

---

## 9. Complete Examples

### 9.1 Editor Content Management

```rust
use helio::scene::Scene;
use helio::groups::{GroupId, GroupMask};

fn enter_play_mode(scene: &mut Scene) {
    // One call hides all editor-only content
    scene.hide_group(GroupId::EDITOR);
    scene.hide_group(GroupId::DEBUG);
}

fn enter_editor_mode(scene: &mut Scene) {
    scene.show_group(GroupId::EDITOR);
    // DEBUG remains hidden unless explicitly shown — groups are independent
}
```

### 9.2 Mass Transform Animation

```rust
fn update_conveyor_belt(scene: &mut Scene, delta_seconds: f32) {
    // CONVEYOR_BELT is a custom GroupId defined at application level
    const CONVEYOR_BELT: GroupId = GroupId::new(10);
    let belt_speed = 2.0; // metres per second along +X
    let delta = glam::Vec3::new(belt_speed * delta_seconds, 0.0, 0.0);
    scene.translate_group(CONVEYOR_BELT, delta);
    // All objects on the belt are translated in one O(N_belt) pass
}
```

### 9.3 Layered Visibility

```rust
fn show_only_level_geometry(scene: &mut Scene) {
    // Hide everything that is not permanent world geometry
    scene.hide_group(GroupId::EDITOR);
    scene.hide_group(GroupId::VFX);
    scene.hide_group(GroupId::WORLD_UI);
    scene.hide_group(GroupId::DYNAMIC);
    // STATIC and DEFAULT remain visible
}

fn restore_full_visibility(scene: &mut Scene) {
    let all = GroupMask::ALL;
    // Show every group at once
    scene.set_group_visibility(all, true);
}
```

> [!TIP]
> `GroupMask::ALL` in `set_group_visibility` will show every group that was hidden, including groups you may have intentionally hidden for other reasons (like the editor group at runtime). Prefer to show only the specific groups you hid, rather than resetting the entire mask.
