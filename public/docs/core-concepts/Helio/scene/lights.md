---
title: Lights
description: Adding and managing lights in the Helio scene — GpuLight layout, point/spot/directional constructors, dynamic updates, and the shadow atlas relationship
category: helio
lastUpdated: '2026-03-23'
tags: [lights, shadows, pbr, point-light, spot-light, directional]
position: 3
icon: '💡'
---

# Lights

Lights in Helio are first-class scene objects with their own insertion, update, and removal API. Unlike objects, lights bypass the `objects_dirty` rebuild cycle entirely — they are uploaded to a GPU storage buffer immediately, and updates take effect on the next frame without any sort or batch reconstruction. This document covers the `GpuLight` GPU layout, the three light types with their constructor patterns, and the relationship between lights and the shadow atlas.

---

## 1. The GpuLight Struct

Every light in the scene is represented on the GPU as a 64-byte `GpuLight`:

```rust
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct GpuLight {
    /// World-space position (xyz) + effective range in metres (w)
    pub position_range:  [f32; 4],
    /// Direction (xyz, unit vector) + spot outer cone cos(angle) (w)
    pub direction_outer: [f32; 4],
    /// Linear RGB colour (xyz) + intensity (w)
    pub color_intensity: [f32; 4],
    /// Shadow atlas base layer; u32::MAX = no shadow
    pub shadow_index:    u32,
    /// LightType discriminant: 0 = directional, 1 = point, 2 = spot
    pub light_type:      u32,
    /// Spot inner cone cos(angle); unused for non-spot lights
    pub inner_angle:     f32,
    pub _pad:            u32,
}
```

The complete GPU layout occupies exactly 64 bytes with no implicit padding. The fields are carefully arranged to pack three `vec4` values followed by four scalars — a layout chosen to match the WGSL struct declaration that the deferred lighting pass reads.

Several fields pack two logical values into one `vec4` to reduce the number of uniform loads the shader must perform. `position_range` stores both the world position (XYZ) and the light's effective radius (W). `direction_outer` stores both the light direction and the spot cone outer angle. This means a point light's `direction_outer.xyz` is unused and should be zeroed; a directional light's `position_range.xyz` is unused and should be zeroed.

The `shadow_index` field is managed by `flush()`, not by the user. After you insert lights, `flush()` assigns shadow atlas layer indices to each shadow-casting light and writes them back. You set `shadow_index` to `0` (not `u32::MAX`) when you want shadows; the flush logic will assign the actual atlas layer. Set it to `u32::MAX` to explicitly disable shadows for a light.

---

## 2. Light Types

### 2.1 Point Lights

A point light radiates uniformly in all directions from a single world position. Its intensity falls off with a windowed quadratic falloff that reaches exactly zero at the declared range, preventing any visible boundary discontinuity.

```rust
fn point_light(
    position: [f32; 3],
    color_linear: [f32; 3],
    intensity: f32,           // in candela (luminous intensity)
    range: f32,               // metres; attenuation is zero at exactly this distance
    cast_shadow: bool,
) -> GpuLight {
    GpuLight {
        position_range:  [position[0], position[1], position[2], range],
        direction_outer: [0.0, 0.0, 0.0, 0.0], // unused for point lights
        color_intensity: [color_linear[0], color_linear[1], color_linear[2], intensity],
        shadow_index:    if cast_shadow { 0 } else { u32::MAX },
        light_type:      1, // point
        inner_angle:     0.0,
        _pad:            0,
    }
}
```

When `cast_shadow` is true, the shadow pass will render six cube faces for this light (one per face of the light's bounding cube), writing them into six consecutive layers of the shadow atlas. The cube face selection in the deferred shader uses the direction from the light to each fragment.

### 2.2 Spot Lights

A spot light emits a cone of light with a soft penumbra between the inner and outer cone angles. Both angles are stored as cosines rather than raw angles, which avoids `acos()` calls in the shader — the attenuation is computed directly from the dot product of the fragment direction with the light direction.

```rust
fn spot_light(
    position: [f32; 3],
    direction: [f32; 3],      // unit vector pointing in the light's emission direction
    color_linear: [f32; 3],
    intensity: f32,            // in candela
    range: f32,
    inner_angle_deg: f32,     // full-intensity cone half-angle in degrees
    outer_angle_deg: f32,     // zero-intensity cone half-angle in degrees
    cast_shadow: bool,
) -> GpuLight {
    let inner_rad = inner_angle_deg.to_radians();
    let outer_rad = outer_angle_deg.to_radians();
    GpuLight {
        position_range:  [position[0], position[1], position[2], range],
        direction_outer: [direction[0], direction[1], direction[2], outer_rad.cos()],
        color_intensity: [color_linear[0], color_linear[1], color_linear[2], intensity],
        shadow_index:    if cast_shadow { 0 } else { u32::MAX },
        light_type:      2, // spot
        inner_angle:     inner_rad.cos(),
        _pad:            0,
    }
}
```

The `inner_angle` and `direction_outer.w` store `cos(half_angle)` rather than the angle itself. Because cosine is a decreasing function, a smaller angle corresponds to a larger cosine. The `smoothstep(cos_outer, cos_inner, cos_fragment)` call in the deferred shader evaluates to 1.0 when the fragment is inside the inner cone and ramps down to 0.0 at the outer cone boundary.

The inner cone represents the region of full, unattenuated intensity — ideal for a flashlight's hot spot or a stage light's beam. The outer cone represents the edge of the light's reach, where it fades to black. A narrow gap (e.g. inner 25°, outer 30°) produces a sharp, focused spotlight. A wide gap (e.g. inner 15°, outer 45°) produces a light with a large soft penumbra resembling a real theatrical fixture.

### 2.3 Directional Lights

Directional lights model infinitely distant sources — the sun, the moon, or a distant area light in an interior. They have no position and no range; their radiance is constant across the entire scene. The shadow pass renders up to four cascaded shadow map passes for each directional light, covering increasing distances from the camera with decreasing resolution.

```rust
fn directional_light(
    direction: [f32; 3],  // unit vector pointing FROM the light TOWARD the scene
    color_linear: [f32; 3],
    illuminance_lux: f32, // intensity as lux (uniform over the entire scene)
    cast_shadow: bool,
) -> GpuLight {
    let norm = {
        let d = direction;
        let len = (d[0]*d[0] + d[1]*d[1] + d[2]*d[2]).sqrt();
        [d[0]/len, d[1]/len, d[2]/len]
    };
    GpuLight {
        position_range:  [0.0, 0.0, 0.0, 0.0], // position unused for directional
        direction_outer: [norm[0], norm[1], norm[2], 0.0],
        color_intensity: [color_linear[0], color_linear[1], color_linear[2], illuminance_lux],
        shadow_index:    if cast_shadow { 0 } else { u32::MAX },
        light_type:      0, // directional
        inner_angle:     0.0,
        _pad:            0,
    }
}
```

For reference, the illuminance of direct sunlight at noon is approximately 100,000 lux. An overcast sky produces around 10,000 lux. A well-lit office interior uses around 500 lux. Helio's deferred pass uses the `color_intensity.w` value directly as the radiance multiplier, so calibrating lights in physical units produces physically accurate relative brightnesses across light types.

---

## 3. Inserting Lights

```rust
let light_id: LightId = scene.insert_light(light_data);
```

`insert_light()` does not return a `Result` — there is no inherent failure case for inserting a light (unlike textures, there is no slot limit for lights). Internally, the new `GpuLight` value is appended to a `DenseArena` and simultaneously pushed to the GPU light storage buffer via `self.gpu_scene.lights.push(light)`. The push happens immediately, not deferred to flush. The GPU light buffer is written before the next frame's draw calls are issued.

> [!NOTE]
> The GPU light buffer update happens at push time, but the shadow atlas assignment happens inside `flush()`. If you insert a shadow-casting light and call `render()` without calling `flush()` first, the light will be visible but without a correctly assigned shadow atlas layer. In normal usage `render()` calls `flush()` automatically, so this is only a concern if you are managing the flush cycle manually.

---

## 4. Updating Lights

```rust
scene.update_light(light_id, new_light_data)?;
```

The update is O(1): it replaces the `GpuLight` value at the light's dense array index and writes the new value to the GPU light buffer. This is the correct pattern for animated lights. A flickering torch, for example, should update its `color_intensity.w` each frame with a procedural noise value:

```rust
fn animate_torch(
    scene: &mut Scene,
    torch_id: LightId,
    base_position: Vec3,
    base_intensity: f32,
    time: f32,
) -> helio::scene::Result<()> {
    let flicker = 1.0 + 0.3 * (time * 17.3).sin() * (time * 11.1).cos();
    let wobble = Vec3::new(
        0.05 * (time * 7.7).sin(),
        0.02 * (time * 13.1).cos(),
        0.05 * (time * 9.3).sin(),
    );
    let p = base_position + wobble;

    scene.update_light(torch_id, GpuLight {
        position_range:  [p.x, p.y, p.z, 8.0],
        direction_outer: [0.0; 4],
        color_intensity: [1.0, 0.6, 0.2, base_intensity * flicker],
        shadow_index:    u32::MAX, // no shadow for performance
        light_type:      1, // point
        inner_angle:     0.0,
        _pad:            0,
    })
}
```

---

## 5. Removing Lights

```rust
scene.remove_light(light_id)?;
```

Light removal uses a swap-remove strategy. The light at `light_id`'s dense index is overwritten with the last light in the array, and the array length is decremented. This O(1) operation invalidates the swapped light's position, but the `DenseArena`'s bookkeeping ensures that the swapped light's handle still resolves correctly to its new position after the swap.

The GPU light buffer mirrors this swap — the `gpu_scene.lights.swap_remove()` call writes the same final-element-to-gap pattern to the GPU buffer. The light is fully absent from the next frame's lighting calculation.

---

## 6. The Shadow Atlas Relationship

The shadow atlas is a 2D depth texture array with 256 layers. Each shadow-casting light consumes exactly six consecutive layers, regardless of type:

| Light Type | Layers Used | Layout |
|---|---|---|
| Point | 6 | One cube face per layer (+X, −X, +Y, −Y, +Z, −Z) |
| Spot | 6 | Layer 0 = perspective shadow map; layers 1–5 = identity (unused) |
| Directional | 6 | Layers 0–3 = four CSM cascades; layers 4–5 = identity (unused) |

With six layers per light, the atlas supports at most `256 / 6 = 42` simultaneous shadow-casting lights. The `flush()` method enforces this limit: lights beyond the 42nd shadow caster have their `shadow_index` forced to `u32::MAX`, disabling their shadows silently.

You do not set `shadow_index` yourself. Setting it to `0` signals that you want shadows; the actual layer assignment is managed by `flush()`. Setting it to `u32::MAX` explicitly opts out of shadows even if atlas space is available.

```rust
// flush() shadow assignment logic (from scene.rs):
let mut next_layer: u32 = 0;
let mut caster_count = 0usize;
for i in 0..light_count {
    let light = lights[i];
    if light.shadow_index == u32::MAX { continue; } // explicitly disabled
    if caster_count >= MAX_SHADOW_CASTERS {          // cap at 42
        lights[i].shadow_index = u32::MAX;           // disable excess casters
        continue;
    }
    lights[i].shadow_index = next_layer;             // assign atlas base layer
    next_layer += 6;                                 // 6 layers per light
    caster_count += 1;
}
```

> [!IMPORTANT]
> Shadow atlas capacity is shared across all lights. A scene with 50 point lights where all 50 cast shadows will silently disable shadows for the 43rd and beyond. Prioritise shadow-casting rights to the lights that contribute most to the scene's perceptual shadow quality — typically the sun (directional) and the closest large point lights. Use the `shadow_index = u32::MAX` override to explicitly disable shadows on lights where soft ambient fallback is acceptable.

---

## 7. Complete Example — Outdoor/Indoor Hybrid Scene

The following example sets up a sun light, two interior point lights, one spotlight for a sign, and one point torch without shadows.

```rust
use helio::scene::Scene;
use libhelio::GpuLight;

fn setup_scene_lights(scene: &mut Scene) {
    // ── Sun (directional, shadow-casting) ────────────────────────────────────
    let sun = GpuLight {
        position_range:  [0.0; 4],
        direction_outer: [-0.3, -1.0, -0.5, 0.0],
        color_intensity: [1.0, 0.93, 0.76, 80_000.0], // ~80klux midday sun
        shadow_index:    0,           // request shadow atlas assignment
        light_type:      0,           // directional
        inner_angle:     0.0,
        _pad:            0,
    };
    let _sun_id = scene.insert_light(sun);

    // ── Interior ceiling lights (point, shadow-casting) ───────────────────────
    for (x, z) in [(-4.0_f32, -4.0_f32), (4.0, -4.0)] {
        let ceiling_light = GpuLight {
            position_range:  [x, 3.5, z, 6.0],
            direction_outer: [0.0; 4],
            color_intensity: [1.0, 0.97, 0.90, 800.0], // 800 cd warm white
            shadow_index:    0, // shadow-casting
            light_type:      1, // point
            inner_angle:     0.0,
            _pad:            0,
        };
        let _ = scene.insert_light(ceiling_light);
    }

    // ── Neon sign spotlight ───────────────────────────────────────────────────
    // Points at -Y from a ceiling mount; tight inner cone, wider outer
    let sign_spot = GpuLight {
        position_range:  [0.0, 4.0, -8.0, 5.0],
        direction_outer: [0.0, -1.0, 0.0, 40.0_f32.to_radians().cos()], // outer 40°
        color_intensity: [0.2, 0.4, 1.0, 3000.0], // blue-white, high intensity
        shadow_index:    0, // shadow-casting
        light_type:      2, // spot
        inner_angle:     20.0_f32.to_radians().cos(),
        _pad:            0,
    };
    let _ = scene.insert_light(sign_spot);

    // ── Decorative torch (no shadows — ambient fill only) ────────────────────
    let torch = GpuLight {
        position_range:  [8.0, 1.2, 2.0, 4.0],
        direction_outer: [0.0; 4],
        color_intensity: [1.0, 0.5, 0.1, 200.0], // warm orange, low range
        shadow_index:    u32::MAX, // no shadow — saves atlas budget
        light_type:      1,
        inner_angle:     0.0,
        _pad:            0,
    };
    let _torch_id = scene.insert_light(torch);
    // Store torch_id to animate it each frame with update_light()
}
```
