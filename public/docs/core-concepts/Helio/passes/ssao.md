---
title: SSAO Pass
description: Screen-Space Ambient Occlusion — hemisphere kernel sampling in view space to approximate geometric occlusion at contact points and crevices
category: helio
lastUpdated: '2026-03-23'
tags:
  - ssao
  - ambient-occlusion
  - post-process
  - screen-space
  - pbr
position: 21
icon: '🌑'
---

# SSAO Pass

The `SsaoPass` approximates ambient occlusion entirely from the depth buffer and G-buffer normals, without any knowledge of scene geometry beyond what has already been rasterised. It samples a hemisphere of 64 view-space positions around each pixel's surface normal, projects them back to screen coordinates, and measures how many of those positions are occluded by nearby geometry — that ratio, raised to a contrast power and inverted, yields a scalar occlusion factor that the deferred lighting pass multiplies against the ambient irradiance term. The entire computation runs in a single fullscreen draw call with no geometry involved, making it an efficient O(pixels × kernel\_size) post-process.

---

## 1. The Ambient Occlusion Problem in PBR

Physically-based rendering separates the outgoing radiance at a surface point into direct illumination from light sources and indirect illumination from the environment. The indirect term is commonly approximated as a constant ambient term — a scalar or colour multiplied by the albedo — applied uniformly to every visible surface point. This approximation is computationally inexpensive and works acceptably in open environments, but it makes a physically incorrect assumption: it treats every surface point as having an unoccluded view of the entire hemisphere above it.

Real geometry is not like this. Corners, crevices, the space beneath a table, the contact seam between two objects touching the floor — all of these positions receive less ambient irradiance because a significant portion of their hemisphere is blocked by surrounding geometry. In the real world this manifests as the characteristic soft darkening you see in the crease between a finger and a palm, or along the base of a wall meeting a floor. The amount of ambient irradiance arriving at a point is proportional to the unoccluded solid angle above that point's tangent plane, scaled by the cosine weighting of a Lambertian receiver.

The formal definition of the ambient occlusion factor $$A$$ at a surface point $$\mathbf{p}$$ with normal $$\hat{n}$$ is:

$$
A(\mathbf{p}) = \frac{1}{\pi} \int_{\Omega} V(\mathbf{p},\,\omega)\,(\hat{n} \cdot \omega)\,d\omega
$$

where $$V(\mathbf{p}, \omega)$$ is a binary visibility function — 1 if direction $$\omega$$ is unoccluded, 0 if blocked — and the integral is taken over the hemisphere $$\Omega$$ aligned with $$\hat{n}$$. The factor $$A$$ lies in $$[0, 1]$$: a value of 1 means fully unoccluded (open sky), a value approaching 0 means almost entirely surrounded. In the deferred lighting pass, the ambient contribution for a pixel is computed as:

$$
L_\text{ambient} = A \cdot I_\text{ambient} \cdot C_\text{ambient} \cdot \text{albedo}
$$

where $$I_\text{ambient}$$ and $$C_\text{ambient}$$ come from `GpuGlobals`. SSAO provides a real-time estimate of $$A$$ by Monte-Carlo sampling this hemisphere integral using the depth buffer as a proxy for scene geometry.

---

## 2. The Cryteck SSAO Algorithm

The algorithm used here is a direct descendant of the technique introduced by Crytek in Cryengine 2 (2007), which was the first real-time SSAO implementation deployed in a shipping title. The core insight is that rather than ray-marching against scene geometry — which would require a BVH or similar acceleration structure — it is sufficient to sample random positions in the hemisphere above the surface normal, project each to screen space, and compare the projected depth against what the depth buffer records at that screen location. If the depth buffer at the projected location is shallower than the sample's depth (i.e., some geometry lies in front of the sample position), the sample is considered occluded.

The algorithm runs entirely in view space rather than world space for a subtle but important reason. The hemisphere must be oriented relative to the surface normal at each pixel, and in view space the projection matrix is known and fixed — projecting a view-space position to a screen UV is a straightforward matrix multiply and perspective divide. World-space sampling would require either carrying the view-projection matrix (which SSAO already has) or working through an additional coordinate transformation with no benefit. View space also keeps the hemisphere radius in a physically meaningful unit: `radius = 0.5` means the occlusion test extends 0.5 metres around each point, independent of camera orientation.

The occlusion factor is computed per-pixel as:

$$
A_\text{raw} = \frac{1}{N} \sum_{i=0}^{N-1} \text{occluded}(i) \cdot \text{rangeCheck}(i)
$$

$$
A = \left(1 - A_\text{raw}\right)^{\,\text{power}}
$$

The `rangeCheck` term prevents distant geometry from contributing occlusion, which would produce incorrect halos around nearby objects (see Section 7 for the `smoothstep` formulation). The final `pow` with `power = 2.0` increases contrast, darkening crevices more aggressively than the raw ratio alone.

---

## 3. The Hemisphere Kernel

The 64-sample kernel is generated once at pass construction by `generate_kernel()` and uploaded to a `storage<read>` buffer on the GPU. Using a fixed, deterministic kernel — as opposed to regenerating it each frame — is a deliberate design choice: the noise texture (Section 4) handles per-pixel randomisation, and a fixed kernel guarantees consistent convergence behaviour across frames.

The kernel samples are generated using a linear congruential generator (LCG) with the recurrence:

$$
s_{n+1} = 1{,}664{,}525 \cdot s_n + 1{,}013{,}904{,}223 \pmod{2^{32}}
$$

seeded with $$s_0 = 1{,}234{,}567$$. Each sample draws three LCG values, maps them to floats in $$[0, 1]$$ by dividing by `u32::MAX`, then maps $$x$$ and $$y$$ to $$[-1, 1]$$ and $$z$$ to $$[0, 1]$$. This places all samples in the upper hemisphere in tangent space — $$z \geq 0$$ ensures samples never point into the surface.

After normalisation to the unit hemisphere, each sample is scaled by a non-linear factor:

$$
\text{scale}(i) = 0.1 + 0.9 \cdot \left(\frac{i}{64}\right)^2
$$

This accelerating distribution concentrates the first samples (i=0) at 10% of the hemisphere radius and the last samples near the full radius. The geometric consequence is that the kernel is dense near the surface origin and sparse at the outer boundary — exactly the regime where near-contact occlusion is most pronounced. A uniform distribution would waste a significant fraction of its 64 samples on the outer shell where geometry is less likely to be in contact.

```rust
fn generate_kernel() -> Vec<[f32; 4]> {
    let mut state: u32 = 1_234_567;
    let mut lcg = |s: &mut u32| -> f32 {
        *s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        *s as f32 / u32::MAX as f32
    };
    (0..KERNEL_SIZE)
        .map(|i| {
            let x = lcg(&mut state) * 2.0 - 1.0;
            let y = lcg(&mut state) * 2.0 - 1.0;
            let z = lcg(&mut state);                        // z ∈ [0,1]: upper hemisphere
            let v = Vec3::new(x, y, z).normalize();
            let scale = 0.1 + 0.9 * (i as f32 / KERNEL_SIZE as f32).powi(2);
            [v.x * scale, v.y * scale, v.z * scale, 0.0]
        })
        .collect()
}
```

Each sample is stored as `[f32; 4]` with `w = 0` to satisfy the 16-byte alignment requirement of `storage` buffers. The kernel size `KERNEL_SIZE = 64` is a compile-time constant — it must match the `samples` field of `SsaoUniform` uploaded each frame.

---

## 4. The Noise Texture and TBN Randomisation

Applying the same 64 kernel samples with the same orientation to every pixel on screen produces unmistakable structured banding artifacts. The repeating hemisphere pattern appears as concentric rings or a regular radial spoke pattern, especially visible on flat surfaces and around object silhouettes. This is not subtle — at 64 samples the artifact is severe enough to make the technique unusable without some form of per-pixel variation.

The standard solution is to rotate the hemisphere kernel differently at every pixel. Helio uses a small 4×4 tiling noise texture: each texel stores a random 2D vector, and that vector is used to build a per-pixel tangent frame (TBN matrix) via Gram-Schmidt orthogonalisation. Because the noise texture tiles across the screen, every 4×4 block of pixels gets a different kernel rotation, breaking the structured repetition into a high-frequency noise pattern that is far less visually distracting — and, critically, amenable to future blur passes.

The noise texture is `Rgba8Unorm` at 4×4 resolution, generated by `generate_noise()` with LCG seed $$s_0 = 9{,}876{,}543$$:

```rust
fn generate_noise() -> Vec<u8> {
    let mut state: u32 = 9_876_543;
    let mut lcg = |s: &mut u32| -> u8 {
        *s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (*s >> 24) as u8
    };
    (0..NOISE_DIM * NOISE_DIM)
        .flat_map(|_| {
            let r = lcg(&mut state);
            let g = lcg(&mut state);
            [r, g, 128u8, 255u8]   // B=128 → z=0, keeps rotation in the XY plane
        })
        .collect()
}
```

The blue channel is fixed at 128 (decoded to approximately 0.0 after the `* 2.0 - 1.0` mapping), which ensures the random rotation vector lies in the horizontal plane of tangent space. A rotation vector with a non-zero Z component would tilt the hemisphere out of alignment with the surface normal, introducing bias into the occlusion estimate.

The noise texture is sampled in the fragment shader with `noise_uv = in.uv * ssao.noise_scale`, where `noise_scale = [width / 4, height / 4]`. This causes the texture to tile exactly `width/4` times horizontally and `height/4` times vertically, so the 4×4 tile fills the screen perfectly at integer boundaries.

The TBN matrix is constructed via Gram-Schmidt orthogonalisation in the shader:

```wgsl
// Decode noise to [-1,1] and strip the z component (always ~0)
let random_vec = noise_sample.xyz * 2.0 - 1.0;

// Gram-Schmidt: remove the normal component from random_vec to get tangent
let tangent   = normalize(random_vec - normal * dot(random_vec, normal));
let bitangent = cross(normal, tangent);
let tbn       = mat3x3<f32>(tangent, bitangent, normal);
```

The resulting `tbn` matrix maps from tangent space (hemisphere-relative) to view space. Multiplying each kernel sample by `tbn` reorients the hemisphere so that its Z axis aligns with the view-space surface normal, with a random rotation in the tangent plane provided by the noise texture.

> [!NOTE]
> The noise texture is declared with `TextureSampleType::Float { filterable: false }` and bound with a `NonFiltering` sampler. Filtering would interpolate between rotation vectors, corrupting the per-pixel randomisation that the tiling is meant to provide.

---

## 5. Depth Reconstruction

At the start of the fragment shader, each pixel's view-space position is reconstructed from the depth buffer rather than read from a dedicated position G-buffer. This avoids the bandwidth and memory cost of a 128-bit-per-pixel Rgba32Float render target while achieving identical precision for the distances involved in SSAO.

The reconstruction function `reconstruct_view_pos(uv, depth)` takes a UV coordinate in $$[0,1]^2$$ and a hardware depth value, transforms them into NDC space, then multiplies by `inv_view_proj` and performs a perspective divide:

```wgsl
fn reconstruct_view_pos(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let ndc      = vec4<f32>(uv * 2.0 - 1.0, depth, 1.0);
    let view_pos = camera.inv_view_proj * ndc;
    return view_pos.xyz / view_pos.w;
}
```

The UV $$\rightarrow$$ NDC mapping `uv * 2.0 - 1.0` maps $$[0,1]^2$$ to $$[-1,1]^2$$. Note that no Y flip is applied here because the UV coordinate passed in comes from the interpolated `out.uv` of the fullscreen triangle vertex shader, which is already in top-left convention matching the G-buffer sampling convention — the flip is implicit in how the triangle UVs are set up.

The depth sentinel check runs before any reconstruction to avoid unnecessary work on sky pixels:

```wgsl
let depth = textureSampleLevel(gbuf_depth, noise_sampler, in.uv, 0.0);
if depth >= 1.0 { return vec4<f32>(1.0); }  // no occlusion for sky
```

Returning 1.0 for sky pixels is correct: those pixels receive no ambient occlusion, and the deferred pass will multiply the ambient term by 1.0 (no change). This is consistent with the pass clearing the SSAO render target to white before drawing.

---

## 6. The Full Fragment Shader Algorithm

The fragment shader runs the complete SSAO estimate in a single pass. It reads four textures (depth, normal, and the noise texture), builds the per-pixel TBN matrix, iterates over `ssao.samples` kernel entries, and accumulates an occlusion count:

```wgsl
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    // 1. Depth + sky guard
    let depth = textureSampleLevel(gbuf_depth, noise_sampler, in.uv, 0.0);
    if depth >= 1.0 { return vec4<f32>(1.0); }

    // 2. Decode view-space normal
    let normal_sample = textureSampleLevel(gbuf_normal, noise_sampler, in.uv, 0.0);
    let normal = normalize(normal_sample.xyz * 2.0 - 1.0);

    // 3. Reconstruct view-space fragment position
    let frag_pos = reconstruct_view_pos(in.uv, depth);

    // 4. Sample noise and tile across screen
    let noise_uv   = in.uv * ssao.noise_scale;
    let noise_s    = textureSampleLevel(noise_tex, noise_sampler, noise_uv, 0.0);
    let random_vec = noise_s.xyz * 2.0 - 1.0;

    // 5. Build TBN (Gram-Schmidt)
    let tangent   = normalize(random_vec - normal * dot(random_vec, normal));
    let bitangent = cross(normal, tangent);
    let tbn       = mat3x3<f32>(tangent, bitangent, normal);

    // 6. Accumulate occlusion
    var occlusion = 0.0;
    for (var i = 0u; i < ssao.samples; i++) {
        // Orient sample into view space
        let sample_pos  = tbn * sample_kernel[i].xyz;
        let offset_pos  = frag_pos + sample_pos * ssao.radius;

        // Project to screen UV
        var offset_ndc  = camera.proj * vec4<f32>(offset_pos, 1.0);
        offset_ndc     /= offset_ndc.w;
        let offset_uv   = offset_ndc.xy * 0.5 + 0.5;

        // Sample depth at projected location, reconstruct view position
        let s_depth        = textureSampleLevel(gbuf_depth, noise_sampler, offset_uv, 0.0);
        let sample_view    = reconstruct_view_pos(offset_uv, s_depth);

        // Range check: suppress contribution from geometry far from the current pixel
        let range_check = smoothstep(0.0, 1.0, ssao.radius / abs(frag_pos.z - sample_view.z));

        // Occluded if depth at projected UV is at least as close as the offset position
        if sample_view.z >= offset_pos.z + ssao.bias {
            occlusion += range_check;
        }
    }

    // 7. Invert and apply power curve
    let ao = 1.0 - (occlusion / f32(ssao.samples));
    return vec4<f32>(pow(ao, ssao.power));
}
```

The range check on step 6 is the most important guard against over-darkening. Without it, a pixel on a thin wall could be heavily darkened by geometry on the far side of the wall — depth values on the opposite face are shallower than the sample positions, but those samples are measuring completely unrelated geometry. The `smoothstep` produces a weight of 0 when `frag_pos.z` and `sample_view.z` differ by more than `radius`, and a weight of 1 when they differ by much less than `radius`. The result is that only geometry within the hemisphere's radial distance contributes meaningful occlusion.

---

## 7. The SsaoUniform Parameters

The `SsaoUniform` struct is 32 bytes and re-uploaded every frame in `prepare()`. Its fields are:

```wgsl
struct SsaoUniform {
    radius:      f32,         // Hemisphere radius in view-space metres
    bias:        f32,         // Depth bias to prevent self-occlusion acne
    power:       f32,         // Contrast exponent applied to the AO factor
    samples:     u32,         // Number of kernel samples to evaluate (≤ KERNEL_SIZE)
    noise_scale: vec2<f32>,   // Tiling factor: [viewport_width/4, viewport_height/4]
    _pad:        vec2<f32>,   // 16-byte struct alignment padding
}
```

The corresponding Rust struct:

```rust
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SsaoUniform {
    radius:      f32,
    bias:        f32,
    power:       f32,
    samples:     u32,
    noise_scale: [f32; 2],
    _pad:        [f32; 2],
}
```

The `radius` parameter (default 0.5 m) controls the physical scale of the occlusion test. It should be set to a value consistent with the scale of objects in the scene. In a scene where the smallest meaningful surface detail is centimetres wide, a 0.5 m radius correctly captures contact AO at furniture legs, wall-floor seams, and character feet. Setting `radius` too small (below ~0.1 m) causes the SSAO to degenerate into a high-frequency texture-like pattern; setting it too large (above ~2.0 m) makes large architectural elements falsely darken in the open.

The `bias` parameter (default 0.025) is a depth offset added to each sample's expected depth before the occlusion comparison `sample_view.z >= offset_pos.z + bias`. It exists because surface normals stored in the G-buffer are only a smooth approximation of the underlying geometry — at grazing angles, a reconstructed view-space position sitting exactly on the surface will find that many of its hemisphere samples project back onto the same surface at a slightly shallower depth, incorrectly counting as occluded. The bias pushes the threshold deeper, eliminating this self-occlusion acne at the cost of missing very shallow occlusion. A bias of 0.025 m is a standard empirical value; scenes with very fine geometry may require a smaller value, while large-scale outdoor scenes can tolerate larger bias values to reduce acne on rough terrain.

The `power` parameter (default 2.0) applies a gamma-like contrast curve to the final occlusion factor. Since the raw ratio $$A_\text{raw} \in [0,1]$$, a power > 1 pushes mid-range values darker without clipping the extremes. A power of 2.0 is a mild darkening appropriate for indoor scenes; exterior scenes with more open ambient lighting may prefer values closer to 1.0 to avoid over-darkening.

The `noise_scale` field is not directly user-tunable — it is computed in `prepare()` as `[width as f32 / NOISE_DIM as f32, height as f32 / NOISE_DIM as f32]` and must be recomputed whenever the viewport is resized. With `NOISE_DIM = 4`, the scale at 1920×1080 is `[480.0, 270.0]`, meaning the 4×4 noise tile repeats 480 times horizontally and 270 times vertically.

> [!IMPORTANT]
> The `samples` field in `SsaoUniform` must not exceed `KERNEL_SIZE = 64`, as the kernel storage buffer contains exactly 64 entries. Setting `samples > 64` would read out-of-bounds from the storage buffer. The default of 64 uses the full kernel.

---

## 8. Bind Group Layout

The pass uses three bind groups with clearly separated concerns. Group 0 carries the per-frame camera and globals data shared with other passes. Group 1 provides the G-buffer read-only inputs. Group 2 contains all SSAO-specific state: the tunable uniform, the kernel, and the noise texture.

### Bind Group 0 — Camera and Globals

| Binding | Name | Type | Visibility | Size |
|---|---|---|---|---|
| 0 | `ssao_camera_buf` | `uniform` | VERTEX \| FRAGMENT | 272 bytes |
| 1 | `globals_buf` | `uniform` | FRAGMENT | 80 bytes |

The `SsaoCameraUniform` struct carries the four standard matrices plus camera position:

```rust
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SsaoCameraUniform {
    view:          [[f32; 4]; 4],   // world → view
    proj:          [[f32; 4]; 4],   // view → clip
    view_proj:     [[f32; 4]; 4],   // world → clip (precomputed)
    inv_view_proj: [[f32; 4]; 4],   // clip → world (depth reconstruction)
    position:      [f32; 3],        // camera world position
    _pad0:         f32,
}
```

The `GpuGlobals` struct (binding 1, 80 bytes) carries frame-level scalars including the ambient intensity and colour used downstream:

```rust
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GpuGlobals {
    frame:             u32,
    delta_time:        f32,
    light_count:       u32,
    ambient_intensity: f32,
    ambient_color:     [f32; 4],
    rc_world_min:      [f32; 4],
    rc_world_max:      [f32; 4],
    csm_splits:        [f32; 4],
}
```

### Bind Group 1 — G-Buffer

| Binding | Name | Type | Format |
|---|---|---|---|
| 0 | `gbuf_albedo` | `texture_2d` | `Rgba8Unorm`, Float filterable |
| 1 | `gbuf_normal` | `texture_2d` | `Rgba16Float`, Float filterable |
| 2 | `gbuf_orm` | `texture_2d` | `Rgba8Unorm`, Float filterable |
| 3 | `gbuf_emissive` | `texture_2d` | `Rgba16Float`, Float filterable |
| 4 | `gbuf_depth` | `texture_depth_2d` | `Depth32Float` |

The SSAO shader reads only `gbuf_normal` and `gbuf_depth` from this group. The full G-buffer layout is bound here rather than a subset to keep the bind group layout compatible with the shared pipeline layout used by other passes.

### Bind Group 2 — SSAO-Specific

| Binding | Name | Type | Notes |
|---|---|---|---|
| 0 | `ssao_uniform_buf` | `uniform` | 32 bytes, updated each frame |
| 1 | `sample_kernel_buf` | `storage<read>` | 64 × 16 bytes = 1 024 bytes, static |
| 2 | `noise_tex` | `texture_2d` (Float non-filterable) | 4×4 `Rgba8Unorm`, tiling rotation vectors |
| 3 | `noise_sampler` | `sampler` (NonFiltering) | `Repeat` address mode for tiling |

---

## 9. Output Texture and Frame Integration

The SSAO pass writes a single `R8Unorm` texture at full viewport resolution. The 8-bit single-channel format is intentional: ambient occlusion is a scalar in $$[0,1]$$ representing an irradiance multiplier, and the spatial variation of AO is smooth enough (governed by surface curvature and contact geometry) that 8-bit precision produces no perceptible banding. At 1920×1080, the output texture occupies:

$$
1920 \times 1080 \times 1 = 2{,}073{,}600 \text{ bytes} \approx 2 \text{ MB}
$$

compared to 8 MB for an `Rgba8Unorm` target or 32 MB for an `Rgba32Float` target. The savings are proportionally larger at 4K.

The texture is created with `RENDER_ATTACHMENT | TEXTURE_BINDING` usage flags. `RENDER_ATTACHMENT` allows the SSAO pass to write to it as a colour target; `TEXTURE_BINDING` allows the deferred lighting pass to read it as a shader texture in a subsequent bind group.

The `publish()` method makes the texture visible to downstream passes via the shared `FrameResources` structure:

```rust
fn publish(&self, frame: &mut FrameResources) {
    frame.ssao = Some(&self.ssao_view);
}
```

The deferred lighting pass reads `frame.ssao` and multiplies the ambient contribution:

```wgsl
let ao = textureSampleLevel(ssao_tex, ssao_sampler, in.uv, 0.0).r;
let ambient = globals.ambient_intensity * globals.ambient_color.rgb * albedo.rgb * ao;
```

The `execute()` method clears the render target to white (`[1.0, 1.0, 1.0, 1.0]`, which encodes to 0xFF in `R8Unorm`) before the draw call. This ensures sky pixels — which the fragment shader exits early without writing — default to 1.0 (no occlusion), preserving their full ambient contribution in the deferred pass.

The `resize()` method destroys and recreates both `ssao_texture` and `ssao_view` at the new dimensions, and recomputes `noise_scale` via the next `prepare()` call. No other state changes are required on resize.

---

## 10. Quality Trade-offs and Future Work

Sixty-four samples per pixel is a deliberate balance point. Below 32 samples the noise texture cannot adequately mask the undersampling artifacts and the result looks grainy rather than smooth. Above 64 samples the AO quality improves only marginally — the hemisphere is already well-characterised — while the fragment shader cost grows linearly. On modern desktop GPUs the pass costs approximately 0.5–1.5 ms at 1080p with 64 samples; at 4K the cost scales with pixel count to roughly 2–6 ms.

The most impactful quality improvement would be a bilateral blur pass applied to the raw SSAO output before `publish()`. A two-pass (horizontal then vertical) 7×9 kernel separable bilateral filter, with edge weights derived from the depth buffer to avoid blurring across geometry boundaries, removes the 4×4 noise tile pattern entirely and produces the smooth, soft AO typical of commercial engines. This is the standard pipeline: SSAO → bilateral blur → multiply with ambient. The current implementation omits this step, leaving the 4-pixel noise tile visible in close-up renders.

Temporal accumulation (TAA-style SSAO) is a more powerful alternative to spatial blur. By jittering the kernel orientation each frame using the `frame` counter from `GpuGlobals` — varying the seed to `generate_kernel` by frame — and then blending the current frame's output with a history buffer using reprojected UVs, 8 or 16 samples per frame can achieve quality equivalent to 64–128 samples per frame with no spatial blur required. This requires motion vectors (which Helio's TAA pass already produces), a history texture, and a temporal blend weight — a natural future extension given the existing infrastructure.

The current `prepare()` implementation zeroes the camera matrices in `SsaoCameraUniform` rather than uploading the live scene camera. This is a known limitation — the camera uniform binding and its GPU buffer exist and are correctly structured, but the upload from the active scene camera is not yet wired. As a result, the depth reconstruction in the fragment shader produces degenerate view-space positions and the SSAO output is currently non-functional in practice. When wired, the fix requires extracting view, proj, and inv\_view\_proj from the scene camera at the start of `prepare()` and calling `queue.write_buffer()` on `ssao_camera_buf`. No shader changes are needed.

> [!TIP]
> For scenes where ambient occlusion quality is not critical, `samples` can be reduced to 16 or 32 in `SsaoUniform` without modifying the kernel buffer. The kernel is always 64 entries; the shader simply stops iterating early. This is a free runtime quality knob.

A horizon-based ambient occlusion (HBAO) reformulation would improve quality at the same sample count by using screen-space ray marching along a small number of directions and computing the maximum elevation angle in each direction rather than hemisphere point sampling. HBAO is more physically accurate (it approximates the full horizon integral rather than sampling random points) and produces better results at 8–16 samples per direction. The current architecture — a fullscreen draw with a single bind group set — would support this with only shader changes, as the bind group layout and output format would remain identical.
