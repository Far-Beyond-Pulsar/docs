---
title: FXAA Pass
description: Fast Approximate Anti-Aliasing — single-pass luma-based edge smoothing post-process in Helio
category: helio
lastUpdated: '2026-03-23'
tags:
  - anti-aliasing
  - fxaa
  - post-process
  - luma
position: 13
icon: '✨'
---

# FXAA Pass

The `FxaaPass` is Helio's lowest-cost anti-aliasing solution. It implements a single fullscreen post-process based on NVIDIA's FXAA 3.11 algorithm, detecting and smoothing aliased edges by analysing per-pixel luma contrast — all without any geometry knowledge, depth buffer access, or temporal history. This document covers the complete algorithm, the shader constants, the bind group layout, and the design trade-offs that make FXAA the right choice in specific rendering contexts.

---

## 1. The Aliasing Problem

Every rasterised edge in a rendered image is, fundamentally, a lie. A triangle boundary is an infinitely thin mathematical curve; the GPU approximates it by deciding, for each pixel, whether the pixel centre falls inside or outside the triangle. The result is a binary yes-or-no decision per pixel — and the staircase that emerges along diagonal and curved edges is spatial aliasing. At low resolutions or when the camera is in motion, this staircase manifests as a harsh, shimmering fringe that draws the eye away from the scene itself.

The hardware solution to aliasing is multi-sample anti-aliasing (MSAA), which evaluates geometry coverage at multiple sub-pixel sample points and blends the resulting coverage mask into the final colour. MSAA is effective, but it carries a steep cost in deferred renderers: the G-buffer must be resolved before lighting, or the lighting pass must operate on a multi-sample target — a significant memory and bandwidth penalty at each cascade of render targets. At 4× MSAA on a 4K render target, the G-buffer alone consumes four times the VRAM. This is the motivation for post-process anti-aliasing: obtain comparable softening of jagged edges at a fraction of the bandwidth by operating on the final composited image rather than on intermediate geometry buffers.

FXAA occupies the fastest, lightest end of the post-process AA spectrum. It reads only the colour buffer — no velocity vectors, no depth, no history — and applies a gradient-based edge softening filter in a single fullscreen pass. The quality is modest by modern standards, and fine geometric detail can be blurred along edges, but the GPU cost is essentially a single bilinear texture sample per pixel on non-edge regions, rising to about twelve samples per pixel on detected edges. For applications that need a quick AA solution without temporal machinery, FXAA is the right tool.

---

## 2. The FXAA 3.11 Algorithm

### 2.1 Luma Extraction

FXAA operates entirely in luma space. Rather than comparing RGB colour differences — which would require three comparisons and would treat equal-brightness colour transitions as edges — the algorithm collapses each pixel to a single scalar luminance value using the ITU-R BT.601 luma coefficients:

```wgsl
fn rgb2luma(rgb: vec3<f32>) -> f32 {
    return dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
}
```

The BT.601 weighting reflects human perceptual sensitivity: the eye is most sensitive to green (0.587), moderately sensitive to red (0.299), and least sensitive to blue (0.114). By working in luma space, FXAA finds edges that are perceptually visible rather than merely numerically present in the colour channels. This is important because a red-to-cyan transition at constant brightness, for example, produces zero luma contrast and should not be processed as an edge — the jaggedness of a hue boundary is far less perceptually objectionable than a brightness boundary.

### 2.2 Edge Detection

For each fragment, the shader samples the luma of the centre pixel and its four cardinal neighbours (up, down, left, right) using integer-addressed `textureLoad` calls. It then computes the luma range across this 5-tap neighbourhood:

$$
\text{luma\_range} = \text{luma\_max} - \text{luma\_min}
$$

The shader provides an early exit for pixels that are not on an edge. The threshold is adaptive — it scales with the local brightness so that dim areas (where perceptual contrast is lower) require a proportionally larger difference to be treated as an edge:

```wgsl
if luma_range < max(EDGE_THRESHOLD_MIN, luma_max * EDGE_THRESHOLD_MAX) {
    return vec4<f32>(rgb_center, 1.0);
}
```

The two governing constants are:

| Constant | Value | Role |
|---|---|---|
| `EDGE_THRESHOLD_MIN` | `0.0312` | Absolute minimum luma difference. Prevents AA on perfectly dark regions where floating-point noise could otherwise fire the filter. |
| `EDGE_THRESHOLD_MAX` | `0.125` | Relative threshold. An edge must represent at least 12.5% of the local maximum brightness to qualify. |

This dual-threshold design ensures that the expensive per-edge processing is skipped for the vast majority of pixels in a typical scene, keeping the average per-pixel cost extremely low.

### 2.3 Edge Direction

When a pixel survives the early-exit test, the shader computes whether the dominant edge is horizontal or vertical. It does this by calculating a Sobel-like gradient in both directions using the centre pixel and its eight neighbours (including corners):

```wgsl
let edge_horizontal = abs(-2.0 * luma_left + luma_left_corners) +
                     abs(-2.0 * luma_center + luma_down_up) * 2.0 +
                     abs(-2.0 * luma_right + luma_right_corners);
let edge_vertical   = abs(-2.0 * luma_up + luma_up_corners) +
                     abs(-2.0 * luma_center + luma_left_right) * 2.0 +
                     abs(-2.0 * luma_down + luma_down_corners);

let is_horizontal = edge_horizontal >= edge_vertical;
```

The larger gradient magnitude indicates the direction perpendicular to the edge — a horizontal edge has a large vertical gradient, and vice versa. This classification determines which pair of neighbours (the two pixels that straddle the edge) will be used for the subsequent blend offset.

### 2.4 Subpixel Blend and Bilinear Sampling

With the edge direction established, the shader computes a subpixel offset. The local average luma across the two edge-straddling pixels is compared against the centre luma; if the centre is brighter than the average, it is shifted toward the darker side, and vice versa. The shift magnitude is governed by the `SUBPIXEL_QUALITY` constant (`0.75`), which controls how aggressively the pixel is moved into the adjacent pixel's territory.

The critical design insight is that the final colour is read using `textureSample` with the adjusted UV coordinate rather than with an explicit blend weight. Because the GPU hardware bilinear sampler interpolates linearly between the four surrounding pixels when sampling at a fractional coordinate, requesting a sample at an offset position automatically produces a weighted mix of the original pixel and its neighbour. FXAA thus converts an edge detection problem into a texture sampling problem — and texture sampling is a single hardware instruction.

```wgsl
return vec4<f32>(textureSample(input_tex, input_sampler, uv_offset).rgb, 1.0);
```

The sampler is configured with `FilterMode::Linear` for both minification and magnification, and `AddressMode::ClampToEdge` to prevent wrapping artefacts at screen boundaries. This bilinear filtering is not incidental — it is load-bearing. Without a linear-filtered sampler the algorithm would produce integer-stepped rather than smoothly blended output, defeating its purpose entirely.

> [!NOTE]
> The FXAA 3.11 reference implementation includes a multi-iteration edge search that walks up and down the edge to find its endpoints and determine whether the current pixel is near the centre or near an endpoint of an edge segment. Helio's implementation uses a simplified single-step subpixel shift (`ITERATIONS = 12` is declared for completeness but the walk loop is elided in favour of the direct gradient-scaled shift). This is a deliberate quality-versus-cost trade-off: the full edge-endpoint walk adds six to twelve bilinear samples per edge pixel and is typically omitted in real-time implementations where SMAA or TAA provides higher-quality results.

---

## 3. Shader Structure

### 3.1 The Oversized Triangle

Like the deferred lighting pass, FXAA uses an oversized-triangle technique to cover the screen with a single draw call and no vertex buffer. The vertex shader generates positions analytically from the built-in `vertex_index`:

```wgsl
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    let x = f32((vertex_index << 1u) & 2u);
    let y = f32(vertex_index & 2u);
    out.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    out.uv = vec2<f32>(x, y);
}
```

The bit manipulation maps `vertex_index` 0, 1, 2 to NDC positions `(-1, 1)`, `(3, 1)`, `(-1, -3)` respectively, generating a right-triangle whose legs are four units long. The unit square `[-1, 1]²` is entirely contained within this triangle; the GPU clips the oversized portions before rasterisation, so only screen-covering fragments are shaded. The UVs are in the range `[0, 2]` and are clipped to `[0, 1]` by the viewport — passing a contiguous `[0,1]` UV field to the fragment shader without any special encoding.

The benefit of the single triangle over a screen quad is the elimination of the diagonal seam. A quad requires two triangles sharing a diagonal edge; fragment shader threads near that diagonal experience divergent execution because they span both triangle boundaries, breaking SIMD warp coherence. The single triangle avoids this entirely, producing uniform warp execution across the entire screen.

### 3.2 Fragment Shader Constants

| Constant | Value | Effect |
|---|---|---|
| `EDGE_THRESHOLD_MIN` | `0.0312` | Minimum luma delta to detect any edge |
| `EDGE_THRESHOLD_MAX` | `0.125` | Relative luma threshold (12.5% of local max) |
| `SUBPIXEL_QUALITY` | `0.75` | Fraction of a texel to shift the sampling UV |
| `ITERATIONS` | `12` | Declared iteration limit for edge endpoint walk |

---

## 4. Bind Group Layout

The pass uses a single bind group with two bindings, both visible to the fragment stage only:

```rust
// Binding 0 — input_tex: the pre-AA colour buffer
wgpu::BindGroupLayoutEntry {
    binding: 0,
    visibility: wgpu::ShaderStages::FRAGMENT,
    ty: wgpu::BindingType::Texture {
        sample_type: wgpu::TextureSampleType::Float { filterable: true },
        view_dimension: wgpu::TextureViewDimension::D2,
        multisampled: false,
    },
    count: None,
},
// Binding 1 — input_sampler: bilinear, clamp-to-edge
wgpu::BindGroupLayoutEntry {
    binding: 1,
    visibility: wgpu::ShaderStages::FRAGMENT,
    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
    count: None,
},
```

The `filterable: true` constraint on the texture is mandatory: FXAA's final colour read uses `textureSample`, which requires the GPU to perform bilinear filtering on the texture. If the input texture were declared as non-filterable — as velocity or depth textures must be — the WGSL validator would reject the shader at pipeline creation time.

The sampler is created once in the constructor and owned by the pass:

```rust
device.create_sampler(&wgpu::SamplerDescriptor {
    min_filter:       wgpu::FilterMode::Linear,
    mag_filter:       wgpu::FilterMode::Linear,
    mipmap_filter:    wgpu::FilterMode::Nearest,
    address_mode_u:   wgpu::AddressMode::ClampToEdge,
    address_mode_v:   wgpu::AddressMode::ClampToEdge,
    ..Default::default()
})
```

The `mipmap_filter` mode does not matter in practice because the input texture has only one mip level, but `Nearest` is the cheapest option.

### 4.1 Lazy Bind Group Recreation

The bind group is not created at construction time. `FxaaPass::new()` sets both `bind_group` and `bind_group_key` to `None`. On the first call to `execute()`, and again whenever the input texture view changes, the bind group is created lazily:

```rust
let input_key = input_view as *const _ as usize;
if self.bind_group_key != Some(input_key) {
    self.bind_group = Some(ctx.device.create_bind_group(&wgpu::BindGroupDescriptor {
        // ...
    }));
    self.bind_group_key = Some(input_key);
}
```

The "key" is the raw memory address of the `TextureView`. If the upstream pass recreates its output texture (because, for example, the window was resized), the pointer changes and the bind group is automatically invalidated and rebuilt on the next frame. This is a zero-overhead check — a single pointer comparison — that avoids both the stale-resource bug of caching the view unconditionally and the unnecessary GPU allocation of rebuilding the bind group every frame.

---

## 5. Input and Output Resources

FXAA reads from `ctx.frame.pre_aa`, a `TextureView` published by the pass preceding it in the render graph. This convention means FXAA can sit at any point in the post-process chain — the upstream pass is responsible for publishing its output under the `pre_aa` slot, and FXAA consumes whatever is there without any coupling to the specific pass type that produced it. If `pre_aa` is not published, the pass returns an `Err(InvalidPassConfig)` immediately, which surfaces clearly rather than producing a silent black frame.

The output is written to `ctx.target`, which in the default pipeline is the swap-chain surface texture view — the image that will be presented to the display. There is no intermediate texture; FXAA writes its final result directly to the presentation target.

> [!IMPORTANT]
> `FxaaPass` does not implement `publish()`. It writes to `ctx.target` and exposes no resources to downstream passes. In the default pipeline, FXAA is the terminal post-process stage.

---

## 6. O(1) Guarantee

The `execute()` method records exactly one render pass containing exactly one draw call:

```rust
let mut pass = ctx.begin_render_pass(&desc);
pass.set_pipeline(&self.pipeline);
pass.set_bind_group(0, self.bind_group.as_ref().unwrap(), &[]);
pass.draw(0..3, 0..1);
```

CPU cost is constant regardless of scene size. The per-frame work consists of one pointer comparison (bind group key check), one render pass begin, one pipeline bind, one bind group bind, and one draw call. The GPU work is proportional to the screen resolution — specifically, to the number of pixels that pass the luma contrast threshold — but this is a property of the viewport dimensions, not the scene.

---

## 7. Choosing Between FXAA, SMAA, and TAA

Helio provides three post-process anti-aliasing options. They occupy very different positions on the quality-cost-complexity spectrum, and the right choice depends on the application's constraints.

**FXAA** is the appropriate choice when GPU budget is the primary constraint and temporal stability is acceptable. It reads only the colour buffer, performs a single pass, and adds negligible VRAM overhead — there are no intermediate textures. The quality trade-off is visible softening of fine detail along edges, and a tendency to blur sub-pixel geometry features. FXAA is a good default for secondary viewports, thumbnails, or platforms where the GPU is memory-bandwidth-constrained.

**SMAA** provides visibly higher quality by treating edges as morphological patterns rather than luma gradients. It correctly identifies the crossing angle of an edge, computes geometrically accurate blend weights, and avoids the overall-softening artefact that is characteristic of FXAA's gradient approach. The cost is three draw calls rather than one, plus two intermediate textures (`edge_texture` at `Rg16Float` and `blend_texture` at `Rgba8Unorm`, both full-resolution). Critically, SMAA has no temporal component — it operates entirely within the current frame, producing no ghosting on moving objects. This makes it the best choice for scenes with fast-moving geometry or animated UI elements where TAA's accumulation buffer would smear detail.

**TAA** produces the highest quality anti-aliasing by accumulating colour information across multiple frames. Each frame is rendered with a sub-pixel jitter applied to the projection matrix; the jitter sequence covers a carefully chosen set of sub-pixel positions over 16 frames, and the historical accumulation reconstructs the fully converged image. The result is superior edge smoothness, effective elimination of subpixel shimmer on fine geometry, and free supersampling of stable regions. The cost is temporal ghosting: on rapidly moving objects, the historical accumulation lags behind the current frame position, producing a smearing trail. TAA also requires velocity vectors from the G-buffer and adds a GPU-side copy operation every frame to advance the history buffer.

| Property | FXAA | SMAA | TAA |
|---|---|---|---|
| Draw calls per frame | 1 | 3 | 1 + 1 copy |
| Intermediate VRAM | None | 2 textures (~2× frame) | 2 textures (~2× frame) |
| Temporal history | None | None | 16-frame accumulation |
| Ghosting on motion | None | None | Visible on fast objects |
| Sub-pixel shimmer | Partially reduced | Well reduced | Eliminated |
| G-buffer dependency | None | None | Velocity + depth |
| Best use case | Budget-constrained; secondary viewports | Animated UI; fast motion; no temporal budget | Static or slow scenes; highest visual fidelity |

---

## 8. Rust API

### 8.1 Construction

```rust
pub fn new(
    device: &wgpu::Device,
    target_format: wgpu::TextureFormat,
) -> FxaaPass
```

`FxaaPass::new` creates the shader module, sampler, bind group layout, and render pipeline. The pipeline is created once and cached for the lifetime of the pass. `target_format` must match the format of `ctx.target` at execution time; if these differ the colour attachment write will silently produce incorrect results or the render pass will fail validation.

### 8.2 Integration with the Render Graph

In the default pipeline, FXAA is installed as the final pass:

```rust
let fxaa = FxaaPass::new(&device, surface_format);
renderer.add_pass(fxaa);
```

The pass upstream of FXAA — typically `DebugPass` or whichever pass occupies the final compositing slot — must call `frame.pre_aa = Some(&self.output_view)` in its `publish()` implementation. If you are inserting a custom pass between the existing pipeline and FXAA, ensure your pass publishes `pre_aa` correctly; otherwise FXAA's `execute()` will return `Err(InvalidPassConfig)`.

To resize the pass when the window resizes, there is no explicit resize method — the bind group is recreated lazily on the next frame after the upstream pass publishes a new `pre_aa` pointer. However, the pipeline's `target_format` is baked at construction time; if the surface format changes (which is rare but possible on format renegotiation), a new `FxaaPass` must be constructed.
