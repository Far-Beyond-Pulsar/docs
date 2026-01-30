---
title: Asset Loading System
description: Embedded asset management with rust-embed
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - assets
  - embedding
  - fonts
  - icons
  - images
related:
  - core-concepts/architecture
position: 21
icon: Image
---

# Asset Loading System

The asset loading system embeds resources (icons, fonts, images) into the binary at compile time using `rust-embed`. This simplifies distribution and ensures assets are always available. The implementation is in `crates/ui/src/assets.rs`.

## What It Provides

The asset loading system provides:
- Compile-time asset embedding
- Runtime asset loading
- GPUI AssetSource integration
- Support for icons, fonts, and images
- Asset listing and enumeration

## Assets Structure

The embedded assets container:

```rust
#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../../assets"]
#[include = "icons/**/*.svg"]
#[include = "fonts/**/*.ttf"]
#[include = "images/**/*.png"]
pub struct Assets;
```

This embeds all SVG icons, TTF fonts, and PNG images from the `assets/` directory.

## Directory Structure

Assets are organized by type:

```dirtree
- assets/
  - icons/
    - file.svg
    - folder.svg
    - search.svg
  - fonts/
    - JetBrainsMono-Regular.ttf
    - JetBrainsMono-Bold.ttf
  - images/
    - logo.png
    - splash.png
```

## Loading Assets

Load an asset by path:

```rust
if let Some(asset) = Assets::get("fonts/JetBrainsMono-Regular.ttf") {
    let font_data: Cow<'static, [u8]> = asset.data;
    // Use font_data
}
```

The data is borrowed from the embedded binary (no allocation).

## Listing Assets

List all assets:

```rust
let all_assets: Vec<_> = Assets::iter().collect();
```

Filter by prefix:

```rust
let icons: Vec<_> = Assets::iter()
    .filter(|path| path.starts_with("icons/"))
    .collect();
```

List fonts:

```rust
let fonts: Vec<_> = Assets::iter()
    .filter(|path| path.starts_with("fonts/"))
    .collect();
```

## GPUI Integration

The `Assets` type implements `AssetSource`:

```rust
impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        if path.is_empty() {
            return Ok(None);
        }
        
        Self::get(path)
            .map(|f| Some(f.data))
            .ok_or_else(|| anyhow!("could not find asset at path \"{path}\""))
    }
    
    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        Ok(Self::iter()
            .filter_map(|p| p.starts_with(path).then(|| p.into()))
            .collect())
    }
}
```

This allows GPUI to load assets transparently.

## Using with GPUI

Register with GPUI:

```rust
App::new().with_assets(Assets)
```

Load assets in UI:

```rust
// Load font
let font = cx.asset_source().load("fonts/JetBrainsMono-Regular.ttf")?;

// Load icon
let icon = cx.asset_source().load("icons/search.svg")?;
```

## Icon Loading

Icons are SVG files:

```rust
let search_icon = Assets::get("icons/search.svg").unwrap();
let svg_data = std::str::from_utf8(&search_icon.data)?;

// Parse and render SVG
```

GPUI can render SVG icons directly.

## Font Loading

Fonts are TTF files:

```rust
let font = Assets::get("fonts/JetBrainsMono-Regular.ttf").unwrap();

// Register with font system
cx.text_system().add_fonts([font.data.to_vec()])?;
```

Multiple font weights/styles can be loaded.

## Image Loading

Images are PNG files:

```rust
let logo = Assets::get("images/logo.png").unwrap();

// Decode PNG
let image = image::load_from_memory(&logo.data)?;
```

Use with image rendering elements.

## Compile-Time Embedding

Assets are embedded at compile time:

1. `rust-embed` finds files matching patterns
2. Files are read and embedded as byte arrays
3. Metadata (filename, size) is generated
4. Runtime loading reads from embedded data

This means:
- No separate asset files needed
- Assets can't be missing at runtime
- Binary size increases with assets

## Benefits

Embedding assets provides:

- **Simple deployment** - Single executable, no asset folders
- **No missing assets** - Assets are always available
- **Fast loading** - No disk I/O, data in memory
- **Version control** - Assets versioned with code

## Trade-offs

Embedding has downsides:

- **Binary size** - Large assets increase executable size
- **No hot reload** - Must recompile to change assets
- **Memory usage** - All assets loaded on startup
- **Build time** - Large asset folders slow compilation

## Asset Variants

For large assets, consider external loading:

```rust
// Small assets - embed
#[derive(RustEmbed)]
#[folder = "assets/ui"]
struct UIAssets;

// Large assets - load from disk
fn load_texture(path: &Path) -> Result<Texture> {
    let data = std::fs::read(path)?;
    // ...
}
```

## Dynamic Assets

For user-generated content, use filesystem:

```rust
// Embedded assets
let default_icon = Assets::get("icons/default.svg")?;

// User assets
let user_icon_path = project_dir.join("icons/custom.svg");
let user_icon = std::fs::read(user_icon_path)?;
```

## Asset Preprocessing

Assets can be optimized at build time:

```bash
# Optimize SVGs
svgo --folder assets/icons

# Optimize PNGs
optipng assets/images/*.png

# Subset fonts
pyftsubset font.ttf --output-file=font-subset.ttf
```

## Example: Icon System

Using embedded icons:

```rust
pub struct IconName {
    path: &'static str,
}

impl IconName {
    pub const FILE: Self = Self { path: "icons/file.svg" };
    pub const FOLDER: Self = Self { path: "icons/folder.svg" };
    pub const SEARCH: Self = Self { path: "icons/search.svg" };
}

fn render_icon(icon: IconName) -> impl IntoElement {
    let svg_data = Assets::get(icon.path).unwrap();
    svg().source(svg_data.data)
}
```

## Example: Font Family

Loading a font family:

```rust
fn load_font_family(cx: &mut AppContext) -> Result<()> {
    let fonts = [
        "fonts/JetBrainsMono-Regular.ttf",
        "fonts/JetBrainsMono-Bold.ttf",
        "fonts/JetBrainsMono-Italic.ttf",
        "fonts/JetBrainsMono-BoldItalic.ttf",
    ];
    
    for font_path in fonts {
        let font = Assets::get(font_path)
            .ok_or_else(|| anyhow!("Missing font: {}", font_path))?;
        cx.text_system().add_fonts([font.data.to_vec()])?;
    }
    
    Ok(())
}
```

## Limitations

Current implementation:
- No asset compression
- No asset streaming
- No lazy loading
- All assets in memory

Future improvements:
- Compressed asset storage
- On-demand decompression
- Asset streaming for large files
- Asset caching strategies
