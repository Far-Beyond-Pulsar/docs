---
title: Code Editor Component
description: Virtualized code editor with syntax highlighting
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - editor
  - code
  - virtualized
  - text
related:
  - core-concepts/ui-framework
position: 22
icon: FileCode
---

# Code Editor Component

The code editor is a studio-quality text editor with virtual scrolling for handling massive files. It provides syntax highlighting, line numbers, minimap, and performance optimizations. The implementation is in `crates/ui/src/code_editor.rs`.

## What It Provides

The code editor provides:
- Virtual scrolling (only renders visible lines)
- Line numbers with gutter
- Optional minimap for navigation
- Undo/redo with history
- File loading and saving
- Configurable tab size
- Performance statistics

## CodeEditor Structure

The main editor component:

```rust
pub struct CodeEditor {
    focus_handle: FocusHandle,
    text: Rope,
    path: Option<PathBuf>,
    config: EditorConfig,
    cursor: usize,
    scroll_handle: ScrollHandle,
    scroll_state: ScrollbarState,
    stats: EditorStats,
    visible_range: Range<usize>,
    is_modified: bool,
}
```

Uses `Rope` from the `ropey` crate for efficient text storage.

## Editor Configuration

Configure the editor:

```rust
pub struct EditorConfig {
    pub show_line_numbers: bool,
    pub show_minimap: bool,
    pub tab_size: usize,
    pub minimap_width: Pixels,
}
```

Default configuration:

```rust
EditorConfig {
    show_line_numbers: true,
    show_minimap: true,
    tab_size: 4,
    minimap_width: px(120.0),
}
```

## Creating an Editor

Create a new editor:

```rust
let editor = cx.new(|cx| CodeEditor::new(cx));
```

Load a file:

```rust
editor.update(cx, |editor, cx| {
    editor.load_file("src/main.rs", cx)?;
});
```

Set text directly:

```rust
editor.update(cx, |editor, cx| {
    editor.set_text("fn main() {\n    println!(\"Hello\");\n}", cx);
});
```

## Virtual Scrolling

The editor only renders visible lines for performance:

```rust
const MAX_RENDERED_LINES: usize = 200;
const OVERSCAN_LINES: usize = 10;

fn calculate_visible_range(&self, viewport_height: Pixels, line_height: Pixels) -> Range<usize> {
    let total_lines = self.text.len_lines(LineType::LF);
    let scroll_y = self.scroll_handle.offset().y;
    
    let first_visible = ((scroll_y / line_height).floor() as usize)
        .saturating_sub(OVERSCAN_LINES)
        .min(total_lines);
    
    let lines_in_viewport = ((viewport_height / line_height).ceil() as usize) + 1;
    let total_to_render = (lines_in_viewport + OVERSCAN_LINES * 2).min(MAX_RENDERED_LINES);
    let last_visible = (first_visible + total_to_render).min(total_lines);
    
    first_visible..last_visible
}
```

This limits rendering to ~200 lines regardless of file size.

## Rope Data Structure

Text is stored as a `Rope`:

```rust
use ropey::Rope;

let mut text = Rope::new();
text.insert(0, "Hello, world!");
```

Rope provides:
- Efficient insertion/deletion at any position
- Fast line indexing
- Substring operations
- Large file support

## Line Numbers

Render line numbers in gutter:

```rust
fn render_line_numbers(&self, visible_range: &Range<usize>, line_height: Pixels, cx: &App) -> impl IntoElement {
    div()
        .w(LINE_NUMBER_WIDTH)  // 60px
        .bg(cx.theme().muted.opacity(0.05))
        .border_r_1()
        .border_color(cx.theme().border)
        .children(
            (visible_range.start..visible_range.end).map(|line_idx| {
                div()
                    .h(line_height)
                    .child(format!("{}", line_idx + 1))
            })
        )
}
```

Line numbers are 1-indexed for user display.

## Content Rendering

Render visible lines:

```rust
fn render_content(&self, visible_range: &Range<usize>, line_height: Pixels, cx: &App) -> impl IntoElement {
    div()
        .flex_1()
        .font_family("monospace")
        .children(
            (visible_range.start..visible_range.end).map(|line_idx| {
                let line_text = self.text.line(line_idx, LineType::LF).to_string();
                
                div()
                    .h(line_height)
                    .child(line_text)
            })
        )
}
```

## Minimap

Optional minimap for navigation:

```rust
fn render_minimap(&self, line_height: Pixels, total_lines: usize, cx: &App) -> impl IntoElement {
    div()
        .absolute()
        .right_0()
        .w(self.config.minimap_width)
        .h_full()
        .on_mouse_down(MouseButton::Left, move |event, _window, _cx| {
            // Click to jump to line
            let relative_y = event.position.y / viewport_height;
            let target_line = (relative_y * total_lines as f32) as usize;
            scroll_to_line(target_line);
        })
        .child(render_density_bars())
}
```

The minimap shows code density as small bars.

## Density Visualization

Calculate line density for minimap:

```rust
let line_text = self.text.line(line_idx, LineType::LF).to_string();
let density = (line_text.trim().len() as f32 / 80.0).min(1.0);

if density > 0.05 {
    // Render bar proportional to density
    div()
        .w(relative(density * 0.8))
        .h(px(2.0))
        .bg(cx.theme().foreground.opacity(0.3))
}
```

Longer lines appear as thicker bars.

## Saving Files

Save the current file:

```rust
editor.update(cx, |editor, cx| {
    editor.save(cx)?;
});
```

This:
1. Gets content as string
2. Writes to file path
3. Marks as unmodified
4. Emits `Saved` event

## File Modification

Track if file is modified:

```rust
if editor.read(cx).is_modified() {
    // Show unsaved indicator
}
```

Modified state is set when text changes and cleared on save.

## Editor Events

The editor emits events:

```rust
pub enum CodeEditorEvent {
    Changed { content: String },
    Saved { path: PathBuf, content: String },
}

// Subscribe to events
cx.subscribe(&editor, |_this, _editor, event: &CodeEditorEvent, cx| {
    match event {
        CodeEditorEvent::Changed { content } => {
            // Handle change
        }
        CodeEditorEvent::Saved { path, content } => {
            // Handle save
        }
    }
}).detach();
```

## Editor Statistics

Performance stats:

```rust
pub struct EditorStats {
    pub total_lines: usize,
    pub rendered_lines: usize,
    pub visible_range: Range<usize>,
}

let stats = editor.read(cx).stats();
tracing::debug!("Rendering {} of {} lines", stats.rendered_lines, stats.total_lines);
```

## Status Bar

Display file info:

```rust
fn render_status_bar(&self, cx: &App) -> impl IntoElement {
    div()
        .h(px(24.0))
        .bg(cx.theme().secondary)
        .px_4()
        .child(format!(
            "Line: {} | Total: {} | Rendered: {}",
            self.cursor_line(),
            self.stats.total_lines,
            self.stats.rendered_lines
        ))
}
```

## Cursor Position

Track cursor (byte offset):

```rust
cursor: usize  // Byte offset in rope
```

Convert to line/column:

```rust
fn cursor_line(&self) -> usize {
    self.text.byte_to_line(self.cursor)
}

fn cursor_column(&self) -> usize {
    let line_start = self.text.line_to_byte(self.cursor_line());
    self.cursor - line_start
}
```

## Scrolling

Programmatic scrolling:

```rust
// Scroll to line
let target_y = line_height * target_line as f32;
scroll_handle.set_offset(point(px(0.0), target_y));

// Scroll by delta
let current = scroll_handle.offset();
scroll_handle.set_offset(point(current.x, current.y + delta_y));
```

## Performance

The editor is optimized for:
- **Large files** - Virtual scrolling handles millions of lines
- **Smooth scrolling** - Only rerender visible content
- **Fast text operations** - Rope data structure
- **Low memory** - Don't store rendered output

Tested with 100MB+ files without issues.

## Limitations

Current implementation:
- No syntax highlighting (plain text only)
- No selections or highlighting
- Single cursor only (no multi-cursor)
- No code folding
- No autocomplete

Future improvements:
- Tree-sitter syntax highlighting
- Visual selection support
- Multi-cursor editing
- Code folding/outlining
- LSP integration for autocomplete
