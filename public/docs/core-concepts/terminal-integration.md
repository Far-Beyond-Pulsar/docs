---
title: Terminal Integration
description: Integrated terminal emulator using Alacritty
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - terminal
  - alacritty
  - pty
  - shell
related:
  - core-concepts/ui-framework
position: 14
icon: Terminal
---

> [!WARNING]
> The terminal is being removed from the core engine and moved to [The Terminal Plugin](https://github.com/Far-Beyond-Pulsar/Plugin_Terminal) the plugins will soon get their very own section. This page will be migrated there and updated accordingly

# Terminal Integration

Pulsar includes an integrated terminal emulator built on Alacritty's `alacritty_terminal` crate. It provides a full-featured terminal with PTY support, rendering, and input handling. The implementation is in `ui-crates/ui_terminal/`.

## Architecture

The terminal system has several components:

- **Terminal** - Core terminal state using Alacritty's `Term`
- **TerminalDrawer** - Panel that displays the terminal in the dock
- **TerminalElement** - GPUI element that renders terminal content
- **TerminalWindow** - Standalone terminal window
- **EventLoop** - Background thread handling PTY I/O

## Terminal Core

The `Terminal` type wraps Alacritty's terminal emulator:

```rust
pub struct Terminal {
    term: Arc<FairMutex<Term<EventProxy>>>,
    pty: Arc<Mutex<tty::Pty>>,
    notifier: Notifier,
    event_rx: UnboundedReceiver<AlacTermEvent>,
    content: TerminalContent,
    bounds: TerminalBounds,
}
```

This maintains the terminal state (screen buffer, cursor position, etc.) and communicates with the shell process through a PTY (pseudo-terminal).

## Initialization

Initialize terminal keybindings:

```rust
ui_terminal::init(cx);
```

This registers actions for Tab and Shift-Tab handling, which must be handled specially in terminals (they can't be used for focus navigation).

## Terminal Context

Terminals have a focus context that prevents key interception:

```rust
pub const TERMINAL_CONTEXT: &str = "Terminal";
```

When a terminal is focused, normal keybindings are disabled and input is sent directly to the shell. This allows shell applications like vim or htop to receive all keys.

## Creating a Terminal

Create a new terminal instance:

```rust
let terminal = cx.new(|cx| {
    Terminal::new(
        working_directory,
        window,
        cx
    )
});
```

The working directory sets the initial directory for the shell. If None, uses the user's home directory.

## Terminal Content

The `TerminalContent` struct holds renderable terminal state:

```rust
pub struct TerminalContent {
    pub cells: Vec<IndexedCell>,
    pub mode: TermMode,
    pub display_offset: usize,
    pub cursor: RenderableCursor,
    pub cursor_char: char,
    pub terminal_bounds: TerminalBounds,
}
```

This is extracted from the Alacritty term and cached for rendering. The cells are colored characters at grid positions.

## Terminal Bounds

Terminal dimensions are calculated from available space:

```rust
pub struct TerminalBounds {
    pub cell_width: Pixels,
    pub line_height: Pixels,
    pub bounds: Bounds<Pixels>,
}

impl TerminalBounds {
    pub fn num_lines(&self) -> usize {
        (self.bounds.size.height / self.line_height).floor() as usize
    }
    
    pub fn num_columns(&self) -> usize {
        (self.bounds.size.width / self.cell_width).floor() as usize
    }
}
```

The terminal grid is sized to fit the available space. Resizing the window resizes the terminal.

## Event Loop

The terminal runs an event loop in a background thread:

```rust
let event_loop = EventLoop::new(
    Arc::clone(&term),
    notifier,
    pty,
    pty_config,
);

thread::spawn(move || {
    event_loop.run(proxy);
});
```

This reads from the PTY and writes to it, handling ANSI escape sequences and updating the terminal state.

## Terminal Events

The terminal emits events upward:

```rust
pub enum Event {
    TitleChanged,
    CloseTerminal,
    Bell,
    Wakeup,
}
```

UI components subscribe to these:

```rust
cx.subscribe(&terminal, |this, _, event: &TerminalEvent, cx| {
    match event {
        TerminalEvent::TitleChanged => {
            // Update window/tab title
        }
        TerminalEvent::CloseTerminal => {
            // Shell exited, close terminal
        }
        TerminalEvent::Bell => {
            // Terminal bell
        }
        _ => {}
    }
}).detach();
```

## Input Handling

Keyboard input is sent to the shell:

```rust
terminal.update(cx, |terminal, cx| {
    terminal.input("ls\n".as_bytes());
});
```

The terminal handles special keys:

```rust
actions!(terminal, [SendTab, SendShiftTab]);

// Tab key handler
fn handle_tab(&mut self, _action: &SendTab, cx: &mut Context<Self>) {
    self.input(b"\t");
}
```

Most keys are converted to bytes and written to the PTY automatically.

## Rendering

The `TerminalElement` renders terminal content:

```rust
impl Render for Terminal {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        TerminalElement::new(self.content.clone())
            .cell_width(self.bounds.cell_width)
            .line_height(self.bounds.line_height)
    }
}
```

The element draws each cell with the correct foreground/background colors and applies styling (bold, italic, underline, etc.).

## Cursor Rendering

The cursor is rendered based on its shape and visibility:

```rust
pub struct RenderableCursor {
    pub shape: CursorShape,
    pub point: AlacPoint,
}

pub enum CursorShape {
    Block,
    Underline,
    Beam,
}
```

The cursor blinks and changes shape based on the mode (insert vs normal).

## Scrollback

Terminals maintain scrollback history:

```rust
terminal.update(cx, |terminal, cx| {
    terminal.scroll(ScrollDelta::Lines(-5)); // Scroll up 5 lines
});
```

The display offset tracks how far scrolled back from the bottom. Mouse wheel events scroll the terminal.

## Terminal Modes

Alacritty supports various terminal modes:

```rust
pub struct TermMode {
    // Application cursor keys
    // Mouse tracking
    // Bracketed paste
    // Alt screen buffer
    // ... many more
}
```

These are toggled by ANSI escape sequences and affect input/output behavior.

## Shell Integration

The terminal spawns a shell process:

```rust
let pty = tty::new(&pty_config, window_size)?;
```

On Unix, this is typically `/bin/bash` or `/bin/zsh`. On Windows, it's `cmd.exe` or PowerShell.

The PTY config specifies:
- Shell command and args
- Environment variables
- Working directory

## Terminal Drawer

The `TerminalDrawer` wraps a terminal in a panel:

```rust
pub struct TerminalDrawer {
    terminal: Entity<Terminal>,
    focus_handle: FocusHandle,
}
```

This can be docked in the workspace like any other panel.

## Terminal Window

The `TerminalWindow` provides a standalone terminal:

```rust
pub struct TerminalWindow {
    terminal: Entity<Terminal>,
}
```

This opens in its own window separate from the main editor.

## Color Themes

Terminal colors are mapped from ANSI codes:

```rust
// Standard ANSI colors
let colors = [
    rgb(0x000000), // Black
    rgb(0xcd3131), // Red
    rgb(0x0dbc79), // Green
    rgb(0xe5e510), // Yellow
    rgb(0x2472c8), // Blue
    rgb(0xbc3fbc), // Magenta
    rgb(0x11a8cd), // Cyan
    rgb(0xe5e5e5), // White
];
```

These can be customized per theme for a cohesive look.

## Performance

The terminal renderer is optimized:
- Only redraw changed cells (dirty tracking)
- Batch cell drawing with instancing
- Limit update frequency (60 FPS)
- Skip rendering when not visible

For large outputs (e.g., `cat` a big file), performance remains smooth.

## Limitations

Current implementation:
- No multiplexing (single shell per terminal)
- No session persistence (sessions die when app closes)
- Limited shell integration features (no prompt detection)
- No ligature support in rendering
- No GPU-accelerated rendering (CPU only)

Future improvements:
- tmux/screen style multiplexing
- Session persistence/restoration
- Shell integration (working directory detection, command status)
- Ligature support for programming fonts
- GPU text rendering
