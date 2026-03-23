---
title: TAA Pass
description: Temporal Anti-Aliasing — Halton-jittered sub-pixel accumulation with YCoCg variance clamping and velocity reprojection for the highest quality anti-aliasing in Helio
category: helio
lastUpdated: '2026-03-23'
tags:
  - anti-aliasing
  - taa
  - temporal
  - halton
  - post-process
  - reprojection
position: 15
icon: '✨'
---

The `TaaPass` is Helio's highest-quality anti-aliasing solution. It implements Temporal Anti-Aliasing: each frame the projection matrix is shifted by a sub-pixel jitter offset drawn from a Halton low-discrepancy sequence, and the resulting image is blended with a history buffer that accumulates the outputs of previous frames. Over 16 frames, the 16 different jitter positions jointly produce a fully supersampled image without the per-frame cost of rendering multiple samples. History samples are validated using velocity-based reprojection and protected against ghosting through YCoCg variance clamping of the 3×3 neighbourhood. This document covers the complete algorithm, the Halton sequence design, the YCoCg colour space transform, the Catmull-Rom history filter, and the ping-pong texture design.

---

## 1. The Temporal Supersampling Principle

Every spatial anti-aliasing technique — MSAA, FXAA, SMAA — tries to reconstruct a better-sampled image from the information available in a single frame. No matter how sophisticated the reconstruction, a single-sample-per-pixel rasteriser cannot recover information that was never captured: the sub-pixel geometry that causes the staircase is simply absent from the sample record.

Temporal accumulation takes a fundamentally different approach. Rather than trying to synthesise missing information, it gathers real geometric information across multiple frames by moving the sample point. If the camera or object is stationary, the pixel at screen position `(x, y)` in frame `N` and the pixel at `(x, y)` in frame `N-1` represent two different sub-pixel samples of the same surface point. By accumulating these samples over many frames, TAA effectively increases the sample density from 1 sample per pixel to `N` samples per pixel — producing an image that is equivalent to rendering at several times the resolution and then downsampling.

The critical mechanism that makes this work is the **sub-pixel jitter**. Without jitter, every frame samples the same sub-pixel position, and the accumulated average is identical to a single frame. With jitter, each frame shifts the projection matrix by a fraction of a pixel, causing the rasteriser to sample from a different position within each pixel footprint. The jitter pattern must be chosen carefully: a well-distributed set of positions provides good coverage of the pixel area, while a random or poorly-chosen sequence may oversample some regions and undersample others.

The central challenge of TAA is handling **disocclusion and motion**. When an object moves between frames, the historical sample at screen position `(x, y)` no longer corresponds to the surface currently visible at `(x, y)` — it corresponds to whatever surface was visible there last frame, which may now be behind the moving object. Naively blending such stale history into the current frame produces **ghosting**: a faint trailing echo of the object at its previous positions. TAA must detect and suppress this ghosting while still retaining enough temporal history to provide effective supersampling.

---

## 2. Halton Jitter

### 2.1 Low-Discrepancy Sequences

The Halton sequence is a classic **low-discrepancy sequence** — a deterministic sequence of points that covers a multi-dimensional domain more uniformly than pseudo-random sampling. For a single dimension, the Halton sequence in base `b` is constructed by reflecting the base-`b` representation of the natural numbers across the decimal point:

$$
H_b(n) = \sum_{k=0}^{\infty} d_k(n) \cdot b^{-(k+1)}
$$

where `d_k(n)` is the k-th digit of `n` written in base `b`. For base 2: `H_2(1) = 0.5`, `H_2(2) = 0.25`, `H_2(3) = 0.75`, `H_2(4) = 0.125`, and so on — the sequence is the Van der Corput sequence in binary. For base 3: `H_3(1) ≈ 0.333`, `H_3(2) ≈ 0.667`, `H_3(3) ≈ 0.111`, and so on.

A 2-D Halton sequence uses two coprime bases for the X and Y dimensions respectively. Helio uses bases 2 and 3: Halton(2, 3). Because the two bases are coprime, their sequences are decorrelated — the x-coverage does not clump in y, and vice versa. Compared to a regular grid, the Halton sequence has the crucial advantage that its first `N` points form a better-distributed set than an `N`-point regular grid for any `N` that is not a power-of-two.

### 2.2 The 16-Entry Table

Helio hard-codes the first 16 entries of the Halton(2, 3) sequence:

```rust
const HALTON_JITTER: [[f32; 2]; 16] = [
    [0.500000, 0.333333],
    [0.250000, 0.666667],
    [0.750000, 0.111111],
    [0.125000, 0.444444],
    [0.625000, 0.777778],
    [0.375000, 0.222222],
    [0.875000, 0.555556],
    [0.062500, 0.888889],
    [0.562500, 0.037037],
    [0.312500, 0.370370],
    [0.812500, 0.703704],
    [0.187500, 0.148148],
    [0.687500, 0.481481],
    [0.437500, 0.814815],
    [0.937500, 0.259259],
    [0.031250, 0.592593],
];
```

These values are in the range `(0, 1)`. They are centred around zero in the `prepare()` method before upload by subtracting 0.5 from each component:

```rust
let jitter = [raw[0] - 0.5, raw[1] - 0.5];
```

After centering, the jitter values lie in `(-0.5, 0.5)` — exactly the sub-pixel range. A value of `+0.5` shifts the sample one full pixel in the positive direction; `-0.5` shifts it one full pixel in the negative direction; `0.0` samples the nominal pixel centre.

The frame index into the table cycles with period 16:

```rust
let jitter_idx = (ctx.frame % 16) as usize;
```

After 16 frames, the sequence repeats exactly. This means the accumulated average converges to a full 16× supersample after the 16th frame and remains stable thereafter — there is no drift or progressive degradation.

### 2.3 Applying the Jitter

The jitter is uploaded to the GPU as part of the `TaaUniform` struct each frame in `prepare()`. The shader receives it as `taa.jitter_offset` — a `vec2<f32>` in normalised screen-space coordinates `(-0.5/width, 0.5/height)` to `(0.5/width, 0.5/height)`. The jitter is applied to the projection matrix on the CPU side before rendering the scene geometry, so that all G-buffer passes and the deferred lighting pass automatically inherit the sub-pixel shift. The TAA shader itself does not apply jitter to the current frame; it receives an already-jittered image. The jitter offset is uploaded to the TAA uniform so the shader can **remove** it from the UV when reading the current frame (see Section 7).

---

## 3. Velocity-Based Reprojection

When the camera moves or objects in the scene animate, the historical sample at screen position `(x, y)` came from a different 3-D surface point than the one currently visible at `(x, y)`. Blending this stale sample directly with the current frame would introduce ghosting. TAA resolves this by tracking **screen-space velocity**: for each pixel, the G-buffer's velocity channel stores the 2-D vector from the pixel's current position to the position where the same surface point was located in the previous frame.

In the TAA shader, the history UV is computed by subtracting this velocity from the current UV:

```wgsl
let velocity    = textureSample(velocity_tex, point_sampler, in.uv).xy;
let history_uv  = in.uv - velocity;
```

If the velocity is zero (camera and object are stationary), `history_uv == in.uv` and the history sample aligns exactly with the current frame. If the camera pans to the right, all pixels acquire a negative-x velocity; subtracting this from the UV moves the history sample to the left, correctly projecting back to where each surface point was visible last frame.

Pixels whose reprojected history UV falls outside `[0, 1]²` are disoccluded — they were not visible at all last frame (they were behind the edge of the screen or behind another object). These pixels receive no temporal blending and display the current frame directly:

```wgsl
if history_uv.x < 0.0 || history_uv.x > 1.0 || history_uv.y < 0.0 || history_uv.y > 1.0 {
    return vec4<f32>(current_color, 1.0);
}
```

The velocity texture is bound with the **point sampler** (`point_sampler` at binding 5), declared as `wgpu::TextureSampleType::Float { filterable: false }`. Velocity is a non-filterable texture type because bilinearly filtering velocity vectors across an object boundary — where a foreground pixel has one velocity and the background has a different velocity — would produce a physically meaningless averaged velocity that projects the history sample to an incorrect location.

---

## 4. YCoCg Variance Clamping

### 4.1 The Ghosting Problem

Even with reprojection, ghosting cannot be fully eliminated by velocity alone. On transparent objects, particles, surfaces near depth discontinuities, and any object undergoing deformation rather than rigid motion, the velocity buffer may not accurately reflect the actual surface displacement. The history sample, even after reprojection, may correspond to a pixel value that is significantly different from what should be at that location — and blending it in darkens or brightens the current frame unphysically.

The solution is **neighbourhood variance clamping**. The intuition is: the current frame contains new, authoritative information about what each pixel should look like right now. If the history sample falls far outside the range of colours observed in the current frame's local neighbourhood, it is almost certainly stale — a ghost — and should be pulled back toward the plausible range before blending.

### 4.2 YCoCg Colour Space

The neighbourhood comparison is performed in **YCoCg** rather than RGB. YCoCg is a colour space derived from RGB by a simple reversible linear transform:

```wgsl
fn rgb_to_ycocg(rgb: vec3<f32>) -> vec3<f32> {
    let y  = dot(rgb, vec3<f32>( 0.25,  0.5,  0.25));
    let co = dot(rgb, vec3<f32>( 0.5,   0.0, -0.5 ));
    let cg = dot(rgb, vec3<f32>(-0.25,  0.5, -0.25));
    return vec3<f32>(y, co, cg);
}
```

The three components are: `Y` (luma), `Co` (orange-cyan chrominance), and `Cg` (green-magenta chrominance). The inverse transform is:

```wgsl
fn ycocg_to_rgb(ycocg: vec3<f32>) -> vec3<f32> {
    let y = ycocg.x; let co = ycocg.y; let cg = ycocg.z;
    return vec3<f32>(y + co - cg, y + cg, y - co - cg);
}
```

The reason YCoCg is preferred over RGB for variance clamping is that the YCoCg bounding box more closely approximates the true convex hull of the colour distribution in the neighbourhood. In RGB, the three channels are highly correlated — a yellow pixel has high R, high G, and low B; the "bounding box" in RGB space over-extends into green-blue regions that no actual pixel in the neighbourhood occupies. YCoCg decorrelates luma from chrominance, and the resulting bounding box is tighter, causing the clamp to suppress ghosting more aggressively without incorrectly discarding valid history samples.

### 4.3 Statistical Variance Bounding Box

Helio computes the variance bounding box from the 3×3 neighbourhood of the current pixel using first and second moments:

```wgsl
var m1 = vec3<f32>(0.0);   // first moment (sum)
var m2 = vec3<f32>(0.0);   // second moment (sum of squares)

for (var x = -1; x <= 1; x++) {
    for (var y = -1; y <= 1; y++) {
        let neighbor_ycocg = rgb_to_ycocg(
            textureSample(current_frame, linear_sampler, in.uv + offset).rgb
        );
        m1 += neighbor_ycocg;
        m2 += neighbor_ycocg * neighbor_ycocg;
    }
}

let mean     = m1 / 9.0;
let variance = (m2 / 9.0) - (mean * mean);
let std_dev  = sqrt(max(variance, vec3<f32>(0.0)));
```

The bounding box is constructed as `mean ± 1.25 × std_dev`:

```wgsl
let box_min = mean - 1.25 * std_dev;
let box_max = mean + 1.25 * std_dev;
```

The factor `1.25` is a deliberate tuning constant. A factor of `1.0` (one standard deviation) is very aggressive: it clips frequently and produces a sharper image but can cause flickering at the clip boundary. A factor of `2.0` is conservative: it accepts more history and reduces flickering but allows more ghosting. The value `1.25` sits between these extremes, providing good ghosting suppression while keeping flickering at bay. This value can be adjusted at the shader level to trade ghosting for stability.

The history sample is then clamped into this box before blending:

```wgsl
let history_ycocg      = rgb_to_ycocg(history_color);
let clamped_history    = ycocg_to_rgb(clamp(history_ycocg, box_min, box_max));
```

> [!NOTE]
> The 3×3 neighbourhood tap uses the **linear sampler** (`linear_sampler`), which means each of the nine samples is bilinearly filtered from the current frame. At non-edge pixels this is equivalent to point sampling (the sample lands on a texel centre). At edge pixels the bilinear interpolation slightly softens the neighbourhood statistics, which has the secondary effect of reducing the variance bounding box's sensitivity to individual pixel outliers — a mild robustness benefit.

---

## 5. Catmull-Rom History Sampling

Bilinear filtering of the history texture would introduce a subtle blurring artefact: at each frame, the history is bilinearly interpolated during reprojection, introducing a small amount of low-pass filtering. Accumulated over many frames, this would visibly soften the temporal accumulation buffer, making the TAA output appear blurrier than SMAA. Helio uses a **Catmull-Rom bicubic filter** for history sampling instead, which achieves sharper reconstruction with negative side lobes that partially compensate for the low-pass character of bilinear filtering.

The Catmull-Rom filter uses a separable 4×4 kernel. For computational efficiency, the implementation exploits the observation that a 4×4 bicubic filter can be factored into a set of bilinear texture samples at precisely chosen fractional offsets, reducing the 16-tap theoretical cost to 9 bilinear samples:

```wgsl
fn sample_catmull_rom(tex: texture_2d<f32>, samp: sampler, uv: vec2<f32>) -> vec3<f32> {
    let sample_pos = uv * dimensions;
    let tex_pos = floor(sample_pos - 0.5) + 0.5;
    let f = sample_pos - tex_pos;

    // Catmull-Rom basis polynomials evaluated at fractional offset f
    let w0  = f * (-0.5 + f * (1.0 - 0.5 * f));
    let w1  = 1.0 + f * f * (-2.5 + 1.5 * f);
    let w2  = f * (0.5 + f * (2.0 - 1.5 * f));
    let w3  = f * f * (-0.5 + 0.5 * f);

    // Merge w1+w2 into a single bilinear tap to reduce sample count
    let w12 = w1 + w2;
    let offset12 = w2 / w12;  // fractional offset within the merged tap
    // ...nine bilinear samples to reconstruct the 4×4 bicubic result
}
```

The `w0..w3` polynomials are the Catmull-Rom basis evaluated at the fractional texel offset `f`. The weight-merging trick (`w12 = w1 + w2`, `offset12 = w2 / w12`) observes that the two central basis functions overlap and can be sampled as a single bilinear fetch at the weighted centroid of their combined support. This reduces the 4×4 = 16 integer-addressed samples to 9 bilinearly-filtered samples, each of which covers two adjacent texels.

> [!TIP]
> The Catmull-Rom reconstruction is applied to the **history** buffer, not to the current frame. The current frame is sampled with a simple bilinear fetch, which is appropriate because the current frame's pixels are already correctly positioned — no reprojection offset needs to be applied. The history buffer's reprojection offset is fractional, so the Catmull-Rom filter is where it matters most.

---

## 6. History Ping-Pong

### 6.1 Two-Texture Design

`TaaPass` owns two full-resolution textures: `output_texture` and `history_texture`. Their roles alternate conceptually with each frame, though in the current implementation they are fixed-role:

- **`output_texture`** — written by the TAA draw call each frame. This is the blend of the current jittered frame and the clamped history. It has `RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC` usage.
- **`history_texture`** — read by the TAA shader as the temporal accumulation buffer from the previous frame. It has `TEXTURE_BINDING | RENDER_ATTACHMENT | COPY_DST` usage.

After each frame's TAA draw completes, the pass copies the output texture into the history texture using a GPU blit:

```rust
ctx.encoder.copy_texture_to_texture(
    self.output_texture.as_image_copy(),
    self.history_texture.as_image_copy(),
    wgpu::Extent3d { width: ctx.width, height: ctx.height, depth_or_array_layers: 1 },
);
```

This copy is recorded into the same command encoder as the draw call. It executes on the GPU in the same submission, after the render pass completes but before the next pass begins. From the CPU's perspective it is a single constant-time `copy_texture_to_texture` call; the GPU handles the actual pixel copy asynchronously.

### 6.2 Why a Copy Rather Than Pointer Swap

A more memory-efficient design would swap the roles of the two textures each frame — the output from frame `N` becomes the history for frame `N+1` without any copy. This is the classical "ping-pong" pattern. Helio uses a copy rather than a swap because the TAA bind group is created at construction time with fixed texture view pointers: `history_view` is permanently bound at group binding 1. Swapping the texture roles would require reconstructing the bind group each frame — a `wgpu::BindGroup` cannot be mutated after creation. The GPU copy is cheaper than a bind group rebuild on most hardware, especially since modern GPUs can execute the blit at full memory bandwidth in a fraction of a frame's time budget.

> [!IMPORTANT]
> The `history_texture` and `output_texture` use the same pixel format as the input `current_view` (passed as `format` in the constructor). This format must be a floating-point or at minimum a 16-bit format to avoid precision loss during accumulation. Using an 8-bit `Rgba8Unorm` format for the TAA history would introduce quantisation banding after a few accumulation steps, as repeated rounding errors accumulate over the 16-frame window.

---

## 7. The TaaUniform and Jitter Removal

Each frame the `prepare()` method uploads a `TaaUniform` to the GPU:

```rust
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct TaaUniform {
    feedback_min: f32,    // 0.88
    feedback_max: f32,    // 0.97
    jitter:       [f32; 2],
}
```

The struct is 16 bytes and satisfies WGSL's uniform buffer alignment requirements without padding. `feedback_min` and `feedback_max` are constants in the current implementation; in a more sophisticated system they could be adjusted dynamically based on detected motion or scene type.

The `jitter` field carries the centred Halton offset for the current frame. Its primary purpose in the shader is jitter removal. The current frame was rendered with a sub-pixel shift applied to the projection matrix, which means each pixel in `current_frame` samples from a slightly offset position compared to where a non-jittered render would have placed the sample. When the shader computes the 3×3 neighbourhood for variance clamping, it samples `current_frame` at `in.uv`, which already incorporates the jitter shift. No explicit jitter compensation is needed for the neighbourhood because all nine taps share the same jitter offset — the neighbourhood statistics are spatially coherent.

However, the `jitter_offset` is available in the `TaaUniform` for implementations that need to align the current-frame sample exactly with the history sample during blending. In the current shader the current frame is sampled at `in.uv` without removing the jitter, relying on the velocity reprojection and variance clamp to provide implicit alignment through the history fetch. More advanced implementations remove the jitter from the current-frame UV to produce a pixel-centre-aligned sample before blending, which reduces subpixel shimmer at the cost of one additional UV calculation.

---

## 8. Blend Factor and Motion Adaptation

The ratio of current-to-history in the final blend is controlled by `feedback_min` and `feedback_max`. The blend factor is computed as a function of the pixel's screen-space velocity magnitude:

```wgsl
let velocity_len  = length(velocity);
let blend_factor  = mix(taa.feedback_max, taa.feedback_min, saturate(velocity_len * 100.0));
let result        = mix(current_color, clamped_history, blend_factor);
```

When velocity is zero (stationary camera and objects), `blend_factor = feedback_max = 0.97`. The result is 3% current frame and 97% history — strong temporal accumulation. Over 16 frames, a stationary pixel effectively draws 97% of its value from history, producing a running weighted average that converges to the full 16× supersampled result.

When velocity is high, `blend_factor` falls toward `feedback_min = 0.88`. At `velocity_len = 0.01` (one percent of screen width per frame, a rapid pan), `saturate(velocity_len × 100) = 1.0` and `blend_factor = 0.88`. The result is 12% current frame and 88% history — noticeably less accumulation, which reduces ghosting behind fast-moving objects at the cost of reduced supersampling quality on those pixels.

The `× 100` velocity scale factor means that one percent of screen width per frame is treated as the maximum-velocity case. This is tuned for typical game camera motion; scenes with extremely rapid camera movement (cutscenes, vehicle interiors) may benefit from reducing this scale to push more pixels toward `feedback_min` during fast motion.

| `velocity_len` | `blend_factor` | Temporal weight | Effect |
|---|---|---|---|
| 0.0 (stationary) | 0.97 | 97% history | Maximum supersampling quality |
| 0.005 | ~0.925 | ~92.5% history | Moderate motion |
| 0.01+ | 0.88 | 88% history | Fast motion, reduced ghosting |

---

## 9. O(1) Guarantee

The `execute()` method records exactly one render pass (one draw call) followed by one `copy_texture_to_texture`:

```rust
// Draw: fullscreen TAA resolve → output_texture
{
    let mut pass = ctx.encoder.begin_render_pass(&desc);
    pass.set_pipeline(&self.pipeline);
    pass.set_bind_group(0, &self.bind_group, &[]);
    pass.draw(0..3, 0..1);
}

// Copy: output_texture → history_texture (advance accumulation buffer)
ctx.encoder.copy_texture_to_texture(
    self.output_texture.as_image_copy(),
    self.history_texture.as_image_copy(),
    wgpu::Extent3d { width: ctx.width, height: ctx.height, depth_or_array_layers: 1 },
);
```

The `prepare()` method uploads exactly 16 bytes via `queue.write_buffer`. There are no dynamic allocations, no CPU-side loops over scene objects, and no GPU readbacks. The GPU cost per frame is proportional to the screen resolution, not the scene complexity.

---

## 10. Trade-offs and Limitations

TAA is not universally superior to SMAA. Several situations exist where TAA's temporal accumulation is a liability rather than an asset.

**Ghosting on fast motion** is the most visible TAA artefact. When an object moves faster than the velocity vectors can accurately track — particularly near depth discontinuities where velocity changes sharply between adjacent pixels — the variance clamp cannot fully reject the stale history sample, and a faint ghost trails behind the object. This is most objectionable on thin or sharp geometry like power lines, grass, and text.

**Flickering on disocclusion** occurs when newly revealed background pixels initially have no valid history. They display at `feedback_max` of the current frame colour, but as the next few frames accumulate, they may flicker as the history converges. The variance clamp mitigates this by accepting the current frame when the history is far outside the neighbourhood distribution, but a full disocclusion detection scheme (comparing reprojected depth against current depth) would provide cleaner convergence.

**Interaction with motion blur** requires care. If the renderer applies motion blur as a post-process after TAA, the motion blur will smear the already-temporally-accumulated output, potentially compounding ghosting. The recommended order is: deferred lighting → TAA → motion blur → tone mapping → FXAA (if a second AA pass is desired for the final frame). TAA should precede any temporal-context-dependent effect.

**Text and UI** should not pass through TAA. Sub-pixel text rendering relies on the exact pixel positions of character edges; jittering the projection matrix displaces these edges by sub-pixel amounts that differ each frame, causing the text to shimmer subtly as the jitter cycles. UI elements should be composited after TAA on a non-jittered surface.

---

## 11. Rust API

### 11.1 Construction

```rust
pub fn new(
    device:        &wgpu::Device,
    width:         u32,
    height:        u32,
    current_view:  &wgpu::TextureView,
    velocity_view: &wgpu::TextureView,
    depth_view:    &wgpu::TextureView,
    format:        wgpu::TextureFormat,
) -> TaaPass
```

All resource views are bound at construction time. `current_view` is the pre-TAA HDR colour buffer published as `FrameResources::pre_aa`. `velocity_view` is the screen-space velocity channel from the G-buffer. `depth_view` must be a view with `TextureAspect::DepthOnly` pointing at the scene depth buffer. `format` is the pixel format used for both the `output_texture` and `history_texture`.

### 11.2 Integration

```rust
let taa = TaaPass::new(
    &device,
    render_width,
    render_height,
    &pre_aa_view,
    &gbuffer_velocity_view,
    &depth_view,
    hdr_format,
);
renderer.add_pass(taa);
```

After TAA, `taa.output_view` contains the anti-aliased frame. If further post-processing (tone mapping, bloom, lens flare) is applied after TAA, they should read from `output_view`. To expose the TAA output to downstream passes, implement `publish()` on a wrapper that sets `frame.pre_aa = Some(&self.taa.output_view)` — this allows a tone mapping or sharpening pass to consume the TAA result transparently.

On window resize, a new `TaaPass` must be constructed at the new resolution. The history texture will start uninitialised, causing the first few frames to blend the current frame against garbage data; in practice this manifests as a brief flash on resize that disappears as soon as the first frame's output is copied to history. A clean transition can be achieved by clearing `history_texture` to the current frame's content on resize before recording any TAA draw calls.

### 11.3 Bind Group Layout Reference

| Binding | Resource | Type | Description |
|---|---|---|---|
| 0 | `current_frame` | `Texture2D<f32>` (filterable) | Pre-TAA HDR colour buffer for this frame |
| 1 | `history_frame` | `Texture2D<f32>` (filterable) | TAA accumulation history from previous frame |
| 2 | `velocity_tex` | `Texture2D<f32>` (non-filterable) | Screen-space motion vectors from G-buffer |
| 3 | `depth_tex` | `TextureDepth2D` | Scene depth buffer (depth-only aspect) |
| 4 | `linear_sampler` | `Sampler (Filtering)` | Bilinear filter for colour and history sampling |
| 5 | `point_sampler` | `Sampler (NonFiltering)` | Nearest-neighbour for velocity sampling |
| 6 | `taa` | `Uniform<TaaUniform>` | Per-frame feedback weights and jitter offset |

The bind group is created at construction time and never rebuilt — the bound resources remain constant for the lifetime of the pass. The `taa` uniform buffer at binding 6 is updated each frame via `queue.write_buffer` in `prepare()`, which writes through the existing buffer binding without requiring a bind group rebuild.
