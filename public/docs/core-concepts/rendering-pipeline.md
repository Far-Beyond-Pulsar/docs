---
title: Rendering System
description: How Pulsar renders 3D scenes
category: core-concepts
lastUpdated: '2026-01-12'
tags:
  - rendering
  - graphics
  - bevy
  - 3d
related:
  - core-concepts/architecture
  - core-concepts/ui-framework
position: 4
icon: Palette
---

# Rendering System

Pulsar's 3D viewport uses **Bevy's rendering modules** to display game scenes in real-time. This document explains how the rendering system works and how it integrates with the editor.

## Overview

Pulsar doesn't implement its own custom rendering pipeline. Instead, it uses Bevy's proven rendering modules:

- `bevy_render` - Core rendering infrastructure
- `bevy_pbr` - Physically Based Rendering (PBR) materials
- `bevy_core_pipeline` - Rendering pipeline stages
- `bevy_asset` - Asset loading and management

This leverages Bevy's mature, well-tested rendering code while keeping Pulsar focused on the editor experience.

## Why Bevy's Renderer?

**Proven technology** - Bevy's renderer powers many shipped games and has been battle-tested.

**PBR materials** - Modern physically-based rendering with metallic/roughness workflows out of the box.

**Cross-platform** - Works on Windows, Linux (when supported), and macOS (when supported) via wgpu.

**Active development** - Benefits from Bevy community improvements and optimizations.

**No wheel reinvention** - Lets Pulsar developers focus on editor features rather than low-level graphics code.

## Architecture

The rendering system in Pulsar consists of:

```mermaid
graph TD
    A[UI Layer GPUI<br/>3D Viewport Panel] --> B[BevyRenderer<br/>engine_backend<br/>Integrates Bevy]
    B --> C[Bevy Rendering Modules<br/>bevy_render, bevy_pbr, wgpu]
    C --> D[GPU via wgpu<br/>Vulkan / DirectX / Metal]

    style A fill:#4CAF50,stroke:#333,stroke-width:2px,color:#fff
    style B fill:#2196F3,stroke:#333,stroke-width:2px,color:#fff
    style C fill:#FF9800,stroke:#333,stroke-width:2px,color:#fff
    style D fill:#9C27B0,stroke:#333,stroke-width:2px,color:#fff
```

### BevyRenderer

The `BevyRenderer` struct in `engine_backend` wraps Bevy's rendering components:

```rust
pub struct BevyRenderer {
    // Bevy App running the renderer
    app: App,

    // Render thread handle
    render_thread: Option<std::thread::JoinHandle<()>>,

    // Framebuffer for displaying in editor
    framebuffer: Arc<Mutex<Framebuffer>>,
}
```

The renderer runs on its own thread, rendering scenes and writing output to a framebuffer that the GPUI viewport displays.

## Rendering GameObjects

Pulsar's simple GameObject system integrates with Bevy's renderer:

```rust
pub struct GameObject {
    pub id: u64,
    pub position: [f32; 3],
    pub velocity: [f32; 3],
    pub rotation: [f32; 3],
    pub scale: [f32; 3],
    pub active: bool,
}
```

GameObjects are converted to Bevy entities for rendering:

```mermaid
sequenceDiagram
    participant GT as Game Thread
    participant BR as BevyRenderer
    participant Bevy as Bevy Renderer
    participant GPU as GPU
    participant FB as Framebuffer
    participant GPUI as GPUI Viewport

    GT->>GT: Update GameObject transforms (60 TPS)
    GT->>BR: Send GameObject data
    BR->>Bevy: Sync to Bevy entities
    Bevy->>Bevy: Apply PBR materials
    Bevy->>GPU: Submit render commands
    GPU->>FB: Write rendered output
    FB-->>GPUI: Display framebuffer
    GPUI-->>GPUI: Composite UI overlay

    Note over GT,GPUI: Continuous rendering loop
```

**Rendering flow:**

1. GameThread updates GameObject transforms (60 TPS)
2. BevyRenderer syncs GameObject data to Bevy entities
3. Bevy renders the entities with PBR materials
4. Output is written to a shared framebuffer
5. GPUI viewport displays the framebuffer

## Materials

Pulsar uses Bevy's PBR material system:

```rust
// Bevy's PBR material
pub struct StandardMaterial {
    pub base_color: Color,
    pub base_color_texture: Option<Handle<Image>>,
    pub emissive: Color,
    pub emissive_texture: Option<Handle<Image>>,
    pub perceptual_roughness: f32,
    pub metallic: f32,
    pub metallic_roughness_texture: Option<Handle<Image>>,
    pub normal_map_texture: Option<Handle<Image>>,
    pub occlusion_texture: Option<Handle<Image>>,
    // ... more properties
}
```

Materials support:

- **Albedo/Base Color** - Surface color with optional texture
- **Metallic/Roughness** - PBR workflow parameters
- **Normal Maps** - Surface detail without additional geometry
- **Emissive** - Self-illuminating surfaces
- **Ambient Occlusion** - Contact shadow approximation

## Lighting

Bevy provides multiple light types:

**Directional Lights** - Sun-like lights with parallel rays

**Point Lights** - Omni-directional lights with falloff

**Spot Lights** - Cone-shaped lights

All use physically-based attenuation and support shadow mapping.

## Camera System

The viewport uses Bevy's camera:

```rust
pub struct Camera3d {
    // Projection (perspective or orthographic)
    pub projection: Projection,

    // Clear color
    pub clear_color: ClearColorConfig,
}
```

Camera controls in the viewport allow:

- **Orbit** - Rotate around a focal point
- **Pan** - Translate the view horizontally/vertically
- **Zoom** - Move closer/farther from the scene
- **First-person** - WASD fly-through (when enabled)

## Render Thread

The render thread runs independently from the UI thread:

```mermaid
graph LR
    A[Render Thread<br/>Bevy App Loop<br/>Execute Systems<br/>Submit GPU Commands<br/>~60 FPS]
    B[UI Thread<br/>GPUI<br/>Handle Input<br/>Display Framebuffer<br/>Editor UI]
    C[Game Thread<br/>Update GameObjects<br/>Fixed 60 TPS]
    D[Shared Framebuffer<br/>Zero-Copy Buffer<br/>DXGI Shared Texture]

    C -->|GameObject Data| A
    A -->|Rendered Output| D
    D -->|Display| B
    B -->|User Input| C

    style A fill:#FF9800,stroke:#333,stroke-width:2px,color:#fff
    style B fill:#4CAF50,stroke:#333,stroke-width:2px,color:#fff
    style C fill:#2196F3,stroke:#333,stroke-width:2px,color:#fff
    style D fill:#9C27B0,stroke:#333,stroke-width:2px,color:#fff
```

**Render Thread:**
- Runs Bevy's App update loop
- Executes rendering systems
- Submits GPU commands
- Writes output to framebuffer
- Runs at target FPS (60 by default)

**UI Thread (GPUI):**
- Displays the framebuffer
- Handles user input
- Updates GameObjects via GameThread
- Manages editor UI

This separation ensures the editor UI stays responsive even if rendering is slow or stalled.

## Zero-Copy Rendering

Pulsar uses zero-copy techniques to minimize overhead:

**Shared Texture** (Windows) - Uses DXGI shared textures so GPUI and Bevy can access the same GPU memory without copying.

**Memory-Mapped Buffer** (Other platforms) - Uses persistent mapped buffers for efficient CPU↔GPU transfer.

This eliminates framebuffer copies and reduces latency between render and display.

## Performance

The rendering system is optimized for editor workflows:

**Default Scene** - The GameThread creates a default scene with multiple objects so you see something immediately when opening a project.

**Fixed Tick Rate** - GameThread runs at 60 TPS regardless of render FPS.

**Metrics** - The renderer exposes performance metrics:
- Frame time (ms)
- FPS
- GPU time (via profiler)
- Draw call count

These appear in the viewport overlay or problems panel.

## The Compositor

> [!IMPORTANT]
> The compositor is the heart of Pulsar's rendering architecture - it layers Bevy's 3D output with GPUI's UI to create the final window.

Pulsar uses a **3-layer D3D11 compositor** that combines multiple rendering sources into the final frame:

```mermaid
graph TD
    A[Layer 0: Black Background] --> D[D3D11 Compositor]
    B[Layer 1: Bevy 3D<br/>D3D12 Shared Texture] --> D
    C[Layer 2: GPUI UI<br/>Alpha Blended] --> D
    D --> E[Final Window<br/>Swap Chain Present]

    style A fill:#000,stroke:#333,stroke-width:2px,color:#fff
    style B fill:#FF9800,stroke:#333,stroke-width:2px,color:#fff
    style C fill:#4CAF50,stroke:#333,stroke-width:2px,color:#fff
    style D fill:#2196F3,stroke:#333,stroke-width:2px,color:#fff
    style E fill:#9C27B0,stroke:#333,stroke-width:2px,color:#fff
```

### Composition Process

**Layer 0 (Bottom): Black Background**
- Solid black clear color
- Base layer for composition

**Layer 1 (Middle): Bevy 3D Rendering**
- Opaque 3D scene from Bevy renderer
- Shared via D3D12→D3D11 zero-copy texture
- Uses `NativeTextureHandle` for interop
- Rendered continuously at ~60 FPS

**Layer 2 (Top): GPUI UI**
- Editor UI, buttons, panels, overlays
- Alpha-blended on top of Bevy layer
- Lazy rendering (only when UI changes)
- Shared via DXGI shared texture handle

### Zero-Copy GPU Texture Sharing

The compositor achieves zero-copy by using GPU-native texture sharing:

```rust
// Bevy (D3D12) exports a shared texture handle
let bevy_handle: NativeTextureHandle = bevy_renderer.get_current_native_handle();

// Compositor (D3D11) opens the shared handle
unsafe {
    let mut bevy_texture: Option<ID3D11Texture2D> = None;
    device.OpenSharedResource(HANDLE(bevy_handle as *mut _), &mut bevy_texture)?;

    // Create shader resource view for rendering
    let srv = device.CreateShaderResourceView(&bevy_texture, None)?;
}
```

> [!NOTE]
> No CPU copies occur - textures are shared directly in GPU memory. The compositor simply references textures from both renderers.

### Rendering Pipeline

```mermaid
sequenceDiagram
    participant Bevy as Bevy Renderer<br/>(D3D12)
    participant Comp as Compositor<br/>(D3D11)
    participant GPUI as GPUI<br/>(GPUI Window)
    participant Window as Final Window

    loop Every Frame
        Bevy->>Bevy: Render 3D scene (60 FPS)
        Bevy->>Comp: Export shared texture handle

        alt GPUI needs update
            GPUI->>GPUI: Render UI
            GPUI->>Comp: Export shared texture handle
            Comp->>Comp: Copy GPUI texture to persistent buffer
        end

        Comp->>Comp: Clear to black
        Comp->>Comp: Draw Bevy layer (opaque)
        Comp->>Comp: Draw GPUI layer (alpha blend)
        Comp->>Window: Present to swap chain
    end
```

### Performance Characteristics

**Decoupled Rendering:**
- Bevy renders continuously (~60 FPS)
- GPUI renders on-demand (UI changes only)
- Compositor always runs at display refresh rate

**Lazy GPUI Rendering:**
```rust
if window_state.needs_render {
    gpui_app.draw_windows();  // Only when UI changed
    window_state.needs_render = false;
}
// Bevy texture is always composited (continuous 3D viewport)
```

> [!TIP]
> This decoupled approach means a static UI doesn't waste GPU cycles re-rendering, while the 3D viewport stays smooth.

### Device Error Recovery

The compositor handles GPU device errors gracefully:

```rust
// Periodic device health check
if DEVICE_CHECK_COUNTER % 300 == 0 {
    let device_reason = device.GetDeviceRemovedReason();
    if device_reason.is_err() {
        // Clear cached textures, will reinitialize
        window_state.bevy_texture = None;
        window_state.bevy_srv = None;
    }
}
```

> [!WARNING]
> GPU driver crashes or device resets will clear compositor state. Textures will be recreated on the next frame.

### Platform Support

> [!CAUTION]
> The D3D11 compositor is **Windows-only**. Linux and macOS support is planned but not yet implemented.

**Windows (Current):**
- Full D3D11 composition with zero-copy sharing
- D3D12 (Bevy) → D3D11 (Compositor) interop
- DXGI shared texture handles

**Linux/macOS (Planned):**
- Vulkan-based compositor
- Metal-based compositor (macOS)
- Cross-platform texture sharing via wgpu

## Integration with GPUI

The 3D viewport is a GPUI view that provides its framebuffer to the compositor:

```rust
impl Render for LevelEditorView {
    fn render(&mut self, _cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .size_full()
            .child(
                // GPUI renders to shared texture
                // Compositor displays the combined result
                viewport_surface()
            )
    }
}
```

GPUI handles the UI overlay (gizmos, buttons, statusbar) while Bevy handles 3D scene rendering. The compositor combines them transparently.

## Limitations

**Editor-only rendering** - The current integration is optimized for the editor viewport, not standalone game builds.

**No custom shaders yet** - Uses Bevy's standard PBR pipeline. Custom shaders are planned.

**Platform limitations** - Full support is currently Windows-focused due to zero-copy implementation. Cross-platform support being restored.

## Future Plans

**Custom shader support** - Allow users to write custom shaders for materials.

**Post-processing** - Bloom, tone-mapping, color grading, etc.

**Advanced lighting** - Light probes, reflection probes, volumetric lighting.

**LOD system** - Level-of-detail for performance optimization.

**Scene editor** - Visual manipulation of GameObjects in the viewport.

## Wrapping Up

Pulsar leverages Bevy's rendering system rather than implementing custom graphics code. This provides:

- Proven, battle-tested rendering
- Modern PBR materials
- Cross-platform support (via wgpu)
- Active development and improvements

The integration keeps the renderer separate from the editor UI, ensuring stability and responsiveness.

For more details:
- [Architecture](./architecture) - Overall system design
- [UI Framework](./ui-framework) - How GPUI works
- [First Project](../getting-started/first-project) - See rendering in action
