---
title: Bevy Viewport Integration
description: Zero-copy GPU rendering with Bevy engine
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - rendering
  - bevy
  - gpu
  - viewport
  - zero-copy
related:
  - core-concepts/architecture
position: 17
icon: Box
---

> [!WARNING]
> The rending system is currently tied heavily to Bevy's renderer and ECS. While we may be remaining tied to `bevy_ecs`, the rendering engine will be made modular in the fiture. At such time this page will be moved to a new "Render Engines" section

# Bevy Viewport Integration

Pulsar integrates Bevy (a Rust game engine) for 3D rendering using zero-copy GPU texture sharing. The Bevy renderer runs in a background thread and shares textures with GPUI for display. The implementation is in `crates/ui/src/bevy_viewport.rs` and `crates/engine_backend/src/services/gpu_renderer.rs`.

## Architecture

The viewport system has several layers:

- **BevyViewport** - GPUI component that displays the render
- **BevyViewportState** - Shared state for texture handles
- **GpuRenderer** - Wrapper around Bevy renderer
- **BevyRenderer** - Actual Bevy ECS and rendering pipeline
- **GPU texture sharing** - Platform-specific shared memory

## Zero-Copy Rendering

The key innovation is zero-copy GPU texture sharing:

```
Bevy Thread              GPUI Thread
-----------              -----------
Render to DX12/Vulkan -> Share handle -> Display in DX11/Metal
     texture                                (no CPU copy!)
```

The GPU texture is shared across APIs without copying to CPU or staging buffers.

## BevyViewport Component

The main GPUI component:

```rust
pub struct BevyViewport {
    state: Arc<parking_lot::RwLock<BevyViewportState>>,
    object_fit: ObjectFit,
    focus_handle: FocusHandle,
}
```

Create a viewport:

```rust
let viewport = cx.new(|cx| BevyViewport::new(1600, 900, cx));
```

This creates a 1600x900 render target.

## Viewport State

The state is shared with the render thread:

```rust
pub struct BevyViewportState {
    canvas_source: Option<GpuCanvasSource>,
    width: u32,
    height: u32,
}
```

The `GpuCanvasSource` holds double-buffered texture handles.

## Texture Initialization

Initialize with shared handles from Bevy:

```rust
// Get shared texture handles (platform-specific)
let (handle0, handle1) = bevy_renderer.get_shared_handles();

// Initialize viewport
viewport_state.write().initialize_shared_textures(
    handle0,
    handle1,
    width,
    height
);
```

Handles are:
- **Windows** - NT handles (DXGI shared resources)
- **macOS** - IOSurface IDs
- **Linux** - dma-buf file descriptors

## Double Buffering

The viewport uses double buffering:

```
Buffer 0: Bevy renders here -> Display
Buffer 1: Bevy renders here -> Display
```

After each frame, buffers swap:

```rust
viewport_state.read().swap_buffers();
```

This prevents tearing and allows Bevy to render the next frame while the current one displays.

## GPU Canvas Source

GPUI's `GpuCanvasSource` manages texture handles:

```rust
pub struct GpuCanvasSource {
    buffer0: GpuTextureHandle,
    buffer1: GpuTextureHandle,
    active_buffer: AtomicUsize,
}
```

Swapping just toggles the active buffer index (atomic operation).

## Texture Handles

Platform-specific GPU texture handles:

```rust
pub struct GpuTextureHandle {
    pub handle: isize,  // NT handle / IOSurface ID / FD
    pub width: u32,
    pub height: u32,
}
```

GPUI opens these handles in its GPU context and displays them directly.

## Render Loop

Typical integration:

```rust
// In UI thread
let viewport = BevyViewport::new(1600, 900, cx);
let viewport_state = viewport.shared_state();

// Spawn Bevy thread
std::thread::spawn(move || {
    let mut renderer = BevyRenderer::new(1600, 900).await;
    
    // Get handles and initialize
    let (h0, h1) = renderer.get_shared_handles();
    viewport_state.write().initialize_shared_textures(h0, h1, 1600, 900);
    
    // Render loop
    loop {
        renderer.render_frame();
        viewport_state.read().swap_buffers();
        std::thread::sleep(Duration::from_millis(16)); // ~60 FPS
    }
});
```

The render loop runs independently, updating textures that GPUI displays.

## GPU Renderer

The `GpuRenderer` wraps Bevy:

```rust
pub struct GpuRenderer {
    pub bevy_renderer: Option<BevyRenderer>,
    render_width: u32,
    render_height: u32,
    display_width: u32,
    display_height: u32,
    frame_count: u64,
}
```

Create a renderer:

```rust
let renderer = GpuRenderer::new(1920, 1080);
```

This initializes Bevy in a Tokio runtime (Bevy requires async).

## Native Texture Handle

Get the current texture handle:

```rust
if let Some(handle) = renderer.get_native_texture_handle() {
    // Pass to GPUI for display
}
```

This returns the handle for the active buffer.

## Object Fit

Control how the render fits in the viewport:

```rust
viewport.object_fit(ObjectFit::Contain)  // Fit inside, maintain aspect
viewport.object_fit(ObjectFit::Cover)    // Fill, crop edges
viewport.object_fit(ObjectFit::Fill)     // Stretch to fill
```

This is useful when window size doesn't match render resolution.

## Resizing

Resize the viewport:

```rust
viewport.resize(1920, 1080);
```

This triggers:
1. Bevy recreates render targets
2. New shared handles are generated
3. Viewport reinitializes with new handles

## Performance Metrics

The renderer tracks performance:

```rust
pub struct RenderMetrics {
    pub frames_rendered: u64,
    pub bevy_fps: f32,
    pub last_frame_time: Duration,
}

let metrics = renderer.get_metrics();
tracing::debug!("Bevy FPS: {:.1}", metrics.bevy_fps);
```

This helps diagnose performance issues.

## BGRA8 Format

The system uses `BGRA8UnormSrgb` format:

```rust
// Bevy renders to BGRA8
// GPUI displays BGRA8
// No format conversion needed!
```

This is the native format for DirectX and Metal, avoiding conversions.

## Fallback Rendering

If Bevy fails to initialize, the renderer uses CPU fallback:

```rust
fn render_fallback(&self, framebuffer: &mut ViewportFramebuffer) {
    // Render a simple animated gradient
    for y in 0..height {
        for x in 0..width {
            let r = calculate_r(x, y, time);
            let g = calculate_g(x, y, time);
            let b = calculate_b(x, y, time);
            framebuffer[i] = [b, g, r, 255]; // BGRA
        }
    }
}
```

This ensures something displays even without GPU.

## Continuous Rendering

The viewport requests animation frames:

```rust
impl Render for BevyViewport {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        window.request_animation_frame();
        // ... render UI
    }
}
```

This creates a render loop at the display refresh rate (typically 60 Hz).

## Focus Handling

The viewport can be focused for input:

```rust
viewport
    .track_focus(&self.focus_handle)
    .on_key_down(|event, cx| {
        // Handle keyboard input for camera, etc.
    })
```

Focused viewports receive keyboard and mouse events.

## Platform Differences

### Windows (DirectX)

Uses NT shared handles via DXGI:

```rust
// Bevy (DX12) creates shared texture
let handle = dx12_texture.create_nt_handle();

// GPUI (DX11) opens it
let dx11_texture = dx11_device.open_shared_handle(handle);
```

### macOS (Metal)

Uses IOSurface:

```rust
// Bevy creates IOSurface-backed texture
let surface_id = metal_texture.iosurface_id();

// GPUI creates texture from IOSurface
let texture = metal_device.new_texture_from_iosurface(surface_id);
```

### Linux (Vulkan)

Uses dma-buf:

```rust
// Bevy exports dma-buf FD
let fd = vulkan_image.export_dma_buf();

// GPUI imports it
let texture = gl_context.import_dma_buf(fd);
```

## Synchronization

GPU synchronization prevents race conditions:

```rust
// Bevy signals when render completes
fence.signal();

// GPUI waits before displaying
fence.wait();
```

This ensures the texture is fully rendered before display.

## Limitations

Current implementation:
- Requires GPU (no software rendering)
- Platform-specific code for each OS
- Single viewport per window (no multiple 3D views)
- No built-in picking/selection (must implement separately)

Future improvements:
- Multiple viewports per window
- GPU picking for 3D selection
- Software rendering fallback
- Cross-API texture sharing improvements
