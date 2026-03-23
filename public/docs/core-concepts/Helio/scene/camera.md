---
title: Camera
description: The Helio Camera struct — view and projection matrix setup, perspective helpers, TAA sub-pixel jitter, and how camera data flows to GPU uniform buffers each frame
category: helio
lastUpdated: '2026-03-23'
tags: [camera, view, projection, taa, jitter, uniforms]
position: 6
icon: '📷'
---

# Camera

The camera defines the relationship between the 3-D scene and the 2-D image that appears on screen. In Helio, the camera is not a scene entity — it has no handle and no reference count. It is instead a value-type struct that you construct each frame and pass to `scene.update_camera()`. The scene converts it to a `GpuCameraUniforms` block and uploads it to the camera uniform buffer, where it is consumed by every pass in the render graph that needs view or projection data.

Understanding the camera's internal representation and the data it produces is important not just for positioning the viewpoint, but for troubleshooting artefacts in temporal anti-aliasing, understanding shadow cascade placement, and writing custom passes that need access to view-space geometry.

---

## 1. The Camera Struct

```rust
#[derive(Debug, Clone, Copy)]
pub struct Camera {
    pub view:    Mat4,       // World-to-view transform
    pub proj:    Mat4,       // View-to-clip projection
    pub position: Vec3,      // World-space camera position
    pub near:    f32,        // Near plane distance (positive metres)
    pub far:     f32,        // Far plane distance (positive metres)
    pub jitter:  [f32; 2],  // Sub-pixel TAA jitter offset in NDC
}
```

The `view` matrix transforms world-space coordinates into view (camera) space — the coordinate system where the camera sits at the origin, faces −Z, and has +Y pointing up. The `proj` matrix transforms view-space coordinates into clip space, where the visible frustum maps to the cube `[-1, 1]³` (with Z reversed in wgpu's convention: 0 at the near plane, 1 at the far plane).

The `position` field is stored separately from the view matrix even though it could be extracted from `view`'s inverse. The separate field avoids a matrix inversion each frame in the deferred lighting shader where `position` is needed to compute the view direction per pixel. It is also more numerically stable for large world coordinates where the view matrix's translation components may lose precision in single-precision arithmetic.

---

## 2. Constructors

### 2.1 from_matrices

The `from_matrices` constructor gives you full control over both matrices. Use this when you are generating matrices from an external source (a physics engine, an animation system, or an existing camera transform):

```rust
let camera = Camera::from_matrices(
    view,     // Mat4 — world-to-view (from look_at or other source)
    proj,     // Mat4 — view-to-clip
    position, // Vec3 — camera world-space position
    near,     // f32
    far,      // f32
);
// jitter defaults to [0.0, 0.0]
```

### 2.2 perspective_look_at

For the standard case of a perspective camera looking at a target, `perspective_look_at` builds both matrices internally:

```rust
pub fn perspective_look_at(
    position:       Vec3,   // camera world position
    target:         Vec3,   // point the camera looks at
    up:             Vec3,   // up direction hint (typically Vec3::Y)
    fov_y_radians:  f32,    // vertical field of view in radians
    aspect:         f32,    // viewport width / height
    near:           f32,    // near plane distance
    far:            f32,    // far plane distance
) -> Self
```

The view matrix is `Mat4::look_at_rh(position, target, up)` and the projection is `Mat4::perspective_rh(fov_y, aspect, near, far)`. Both use the right-handed coordinate convention.

```rust
let camera = Camera::perspective_look_at(
    Vec3::new(0.0, 5.0, 15.0),     // position: 15m back, 5m up
    Vec3::ZERO,                      // looking at origin
    Vec3::Y,                         // Y is up
    60.0_f32.to_radians(),           // 60° vertical FOV
    1280.0 / 720.0,                  // 16:9 aspect ratio
    0.1,                             // near plane at 10cm
    2000.0,                          // far plane at 2km
);
```

---

## 3. Updating the Camera

```rust
scene.update_camera(camera);
```

`update_camera()` constructs the full `GpuCameraUniforms` struct and uploads it to the camera uniform buffer. It also stores `camera.proj * camera.view` as `prev_view_proj` for the next frame — this is the previous frame's view-projection matrix required by temporal anti-aliasing to reproject history samples.

The update is O(1): one matrix multiply, one struct construction, and one 368-byte `write_buffer` call. You should call `update_camera()` once per frame before `render()`. The `Renderer` wrapper handles this implicitly if you use its `render()` method; if you are managing your own render graph, call it explicitly.

---

## 4. GpuCameraUniforms Layout

The 368-byte GPU camera uniform is used by every pass in the default render graph:

| Field | Type | Bytes | Description |
|---|---|---|---|
| `view` | `mat4x4<f32>` | 64 | World → view transform |
| `proj` | `mat4x4<f32>` | 64 | View → clip (projection) |
| `view_proj` | `mat4x4<f32>` | 64 | World → clip (precomputed `proj × view`) |
| `view_proj_inv` | `mat4x4<f32>` | 64 | Clip → world (for depth reconstruction) |
| `position_near` | `vec4<f32>` | 16 | XYZ = camera world position, W = near plane |
| `forward_far` | `vec4<f32>` | 16 | XYZ = camera forward direction, W = far plane |
| `jitter_frame` | `vec4<f32>` | 16 | XY = TAA jitter, ZW = frame counter |
| `prev_view_proj` | `mat4x4<f32>` | 64 | Previous frame view_proj (TAA reprojection) |
| **Total** | | **368** | |

The `view_proj_inv` matrix is particularly important for the deferred lighting pass, which reconstructs world-space positions from depth values using the formula `world_pos = (view_proj_inv × vec4(ndc_xy, depth, 1)).xyz / w`. Without this precomputed inverse, each pixel in the lighting pass would require an on-the-fly 4×4 matrix inversion, which is prohibitively expensive at 2 million pixels per frame.

The `forward_far` field stores the camera's world-space forward direction (extracted from the view matrix as `-view[2].xyz`) alongside the far plane. This is used by the sky rendering pass and by any effect that needs to cast rays in the view direction.

---

## 5. TAA Jitter

The `jitter` field shifts the projection matrix by a sub-pixel offset in NDC space. Temporal Anti-Aliasing (TAA) exploits this: by shifting the sample position a fraction of a pixel each frame and accumulating history, the TAA pass can reconstruct an effectively super-sampled image from multiple sub-pixel samples.

The jitter offset is specified in NDC units, where `[0, 0]` means no shift and `[2/width, 2/height]` means a shift of exactly one pixel. The standard approach is to use the Halton(2, 3) sequence:

```rust
fn halton(index: u32, base: u32) -> f32 {
    let mut f = 1.0_f32;
    let mut r = 0.0_f32;
    let mut i = index;
    while i > 0 {
        f /= base as f32;
        r += f * (i % base) as f32;
        i /= base;
    }
    r
}

fn taa_jitter(frame: u64, width: u32, height: u32) -> [f32; 2] {
    let index = (frame % 8) as u32 + 1; // 8-sample Halton sequence, 1-indexed
    let jx = (halton(index, 2) - 0.5) * (2.0 / width as f32);
    let jy = (halton(index, 3) - 0.5) * (2.0 / height as f32);
    [jx, jy]
}

// Apply jitter to the camera each frame
let mut camera = Camera::perspective_look_at(/* ... */);
camera.jitter = taa_jitter(frame_count, viewport_width, viewport_height);
scene.update_camera(camera);
```

> [!IMPORTANT]
> When TAA jitter is active, all geometry appears sub-pixel shifted on screen compared to the unjittered position. This is intentional — the TAA pass undoes the jitter when reprojecting history samples. However, if you render UI elements or 2-D overlays after the deferred pass and before the TAA pass, those elements will be incorrectly shifted. UI should either be rendered after TAA or use a separate camera with `jitter = [0.0, 0.0]`.

If you are not using TAA, set `jitter = [0.0, 0.0]` (the default from `from_matrices`). This is automatically handled by `perspective_look_at`.

---

## 6. Aspect Ratio and Window Resize

When the window resizes, the projection matrix must be recalculated with the new aspect ratio. Helio's `Renderer::set_render_size(width, height)` rebuilds the render graph, but it does not update the camera's projection — that is your responsibility, since the camera is an external value not owned by the renderer.

The correct pattern is to recalculate the projection matrix on every frame using the current viewport dimensions:

```rust
fn update_camera_for_viewport(
    scene: &mut Scene,
    viewport_width: u32,
    viewport_height: u32,
    camera_position: Vec3,
    camera_target: Vec3,
    frame_count: u64,
) {
    let aspect = viewport_width as f32 / viewport_height as f32;
    let mut camera = Camera::perspective_look_at(
        camera_position,
        camera_target,
        Vec3::Y,
        60.0_f32.to_radians(),
        aspect,    // always use current viewport aspect
        0.1,
        2000.0,
    );
    camera.jitter = taa_jitter(frame_count, viewport_width, viewport_height);
    scene.update_camera(camera);
}
```

Recalculating the projection matrix every frame is essentially free — it is five multiplications and a reciprocal — so there is no reason to cache or conditionally update it.

---

## 7. Complete Examples

### 7.1 First-Person Camera

```rust
use glam::{Mat4, Quat, Vec3};

struct FpsCamera {
    position: Vec3,
    yaw:      f32,   // rotation around Y axis
    pitch:    f32,   // rotation around X axis
}

impl FpsCamera {
    fn to_helio_camera(&self, aspect: f32, frame: u64, width: u32, height: u32) -> helio::scene::Camera {
        let rotation = Quat::from_euler(
            glam::EulerRot::YXZ,
            self.yaw,
            self.pitch,
            0.0,
        );
        let forward = rotation * Vec3::NEG_Z;
        let target = self.position + forward;

        let mut cam = helio::scene::Camera::perspective_look_at(
            self.position,
            target,
            Vec3::Y,
            90.0_f32.to_radians(), // 90° for a first-person shooter feel
            aspect,
            0.05,    // 5cm near plane — closer for hand/weapon rendering
            3000.0,
        );
        cam.jitter = taa_jitter(frame, width, height);
        cam
    }
}
```

### 7.2 Orbital Camera

```rust
use glam::Vec3;

struct OrbitalCamera {
    target:   Vec3,
    distance: f32,
    azimuth:  f32,  // horizontal angle
    elevation: f32, // vertical angle
}

impl OrbitalCamera {
    fn to_helio_camera(&self, aspect: f32) -> helio::scene::Camera {
        let x = self.distance * self.elevation.cos() * self.azimuth.sin();
        let y = self.distance * self.elevation.sin();
        let z = self.distance * self.elevation.cos() * self.azimuth.cos();
        let position = self.target + Vec3::new(x, y, z);

        helio::scene::Camera::perspective_look_at(
            position,
            self.target,
            Vec3::Y,
            45.0_f32.to_radians(),
            aspect,
            0.1,
            1000.0,
        )
    }
}
```

### 7.3 Orthographic Projection

For tools, top-down views, or 2-D games, use a custom orthographic projection matrix:

```rust
use glam::Mat4;

fn ortho_camera(
    left: f32, right: f32,
    bottom: f32, top: f32,
    near: f32, far: f32,
    position: Vec3,
) -> helio::scene::Camera {
    // Look straight down (+Y up, −Z into the screen)
    let view = Mat4::look_at_rh(position, position + Vec3::NEG_Z, Vec3::Y);
    // glam's perspective_rh expects clip-Z in [0,1] (wgpu convention)
    let proj = Mat4::orthographic_rh(left, right, bottom, top, near, far);

    helio::scene::Camera::from_matrices(view, proj, position, near, far)
}
```

> [!TIP]
> When using orthographic projection, make sure the `near` and `far` values still define a sensible depth range for the scene. A common mistake is to set `near = 0.0`, which maps the near plane to depth 0.0 and causes the sky guard in the deferred lighting pass (`if depth >= 1.0 { discard; }`) to work correctly, but any geometry placed exactly at `z = far` will have depth exactly 1.0 and be discarded. Use a small positive near value (at least `0.01`) and set far generously.
