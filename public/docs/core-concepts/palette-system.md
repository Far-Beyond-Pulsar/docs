---
title: Command Palette System
description: Command palette architecture in Pulsar
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - ui
  - command-palette
related:
  - core-concepts/ui-framework
  - core-concepts/architecture
position: 5
icon: Search
---

# Command Palette System

Pulsar has a command palette you can use to search for and execute actions. This document covers how it's built and how to use it in the codebase.

## What It Is

The command palette is the searchable command interface you see when you press Ctrl+Shift+P (or Cmd+Shift+P on Mac). It shows available commands, lets you filter them by typing, and executes the selected command.

The implementation is in `ui-crates/ui_common/src/command_palette/` and consists of four main types:

- **PaletteManager** - Global registry for palette instances
- **Palette** - Stores items and their callbacks
- **PaletteViewDelegate** - Adapter between Palette and the UI
- **GenericPalette** - The actual UI component with search and rendering

## How It Works

### PaletteManager

Located in `palette_manager.rs`. This is a global singleton that tracks registered palettes.

```rust
// Initialize once at app startup
PaletteManager::init(cx);

// Register a new palette
let (palette_id, palette_ref) = PaletteManager::register_palette("commands", window, cx);

// Retrieve later by ID
let palette = PaletteManager::get_palette(palette_id, cx);
```

The manager gives you a `PaletteId` (just a `usize` wrapper) and an `Entity<Palette>`. The manager holds weak references, so you need to store the entity somewhere or it'll get dropped.

### Palette

Located in `palette_data.rs`. This is where the items live.

Each item has:
- Unique `ItemId` 
- Name and description strings
- Icon from `ui::IconName`
- Category string for grouping
- Keywords (optional) for search
- Callback: `Arc<dyn Fn(&mut Window, &mut App)>`

```rust
palette_ref.update(cx, |palette, cx| {
    let item_id = palette.add_item(
        "Toggle File Manager",
        "Show or hide the file manager panel",
        IconName::Folder,
        "View",
        |window, cx| {
            window.dispatch_action(Box::new(ToggleFileManager), cx);
        },
        cx,
    );
});
```

The callback receives `&mut Window` and `&mut App` so it can dispatch actions or modify state.

### Rebindable Callbacks

One feature worth noting: you can change what an item does without recreating it.

```rust
palette.rebind_callback(
    item_id,
    |window, cx| {
        // New implementation
    },
    cx,
)
```

This is used when the same command name should do different things based on context (like "Run Current Test" depending on which test file is active).

### PaletteViewDelegate

Located in `palette_delegate.rs`. This implements the `PaletteDelegate` trait from `palette_trait.rs`.

The delegate's job is to provide the UI component (`GenericPalette`) with the data it needs:
- Placeholder text for the search input
- Categorized list of items
- Filtering logic (default implementation does substring search)
- What to do when an item is confirmed

```rust
let delegate = PaletteViewDelegate::new(palette_ref.clone(), cx);
```

The delegate caches the categorized items from the palette for rendering.

### GenericPalette

Located in `generic_palette.rs`. This is the GPUI view that renders the palette UI.

Features:
- Search input with real-time filtering
- Categories with expand/collapse
- Keyboard navigation (arrow keys, enter, escape)
- Modal overlay with click-to-dismiss
- Optional documentation panel (not currently used)

```rust
let view = cx.new(|cx| GenericPalette::new(delegate, window, cx));
```

The palette emits `DismissEvent` when closed (either by selecting an item or pressing escape).

## Actual Usage in Pulsar

The main command palette is registered in `ui-crates/ui_core/src/app/constructors.rs`:

```rust
let (palette_id, palette_ref) = PaletteManager::register_palette("commands", window, cx);

palette_ref.update(cx, |palette, cx| {
    palette.add_item(
        "Toggle File Manager",
        "Show or hide the file manager panel",
        IconName::Folder,
        "View",
        |window, cx| {
            window.dispatch_action(Box::new(ToggleFileManager), cx);
        },
        cx,
    );
    
    palette.add_item(
        "Open Settings",
        "Open application settings",
        IconName::Settings,
        "Application",
        |window, cx| {
            window.dispatch_action(Box::new(ui::OpenSettings), cx);
        },
        cx,
    );
    
    // ... more items
});
```

The palette is shown/hidden in `ui-crates/ui_core/src/app/mod.rs`:

```rust
if self.state.command_palette_open {
    let palette = self.state.command_palette.clone().expect("Palette not initialized");
    
    if let Some(view) = &self.state.command_palette_view {
        // Reuse existing view
        let input_handle = view.read(cx).search_input.read(cx).focus_handle(cx);
        input_handle.focus(window);
    } else {
        // Create new view
        let delegate = PaletteViewDelegate::new(palette.clone(), &*cx);
        let view = cx.new(|cx| GenericPalette::new(delegate, window, cx));
        
        // Subscribe to dismiss
        cx.subscribe_in(&view, window, move |this, view, _: &DismissEvent, window, cx| {
            let selected_item_id = view.update(cx, |view, _| {
                view.delegate_mut().take_selected_item()
            });
            
            if let Some(item_id) = selected_item_id {
                palette.update(cx, |palette, cx| {
                    let _ = palette.execute_item(item_id, window, cx);
                });
            }
            
            this.state.command_palette_open = false;
            this.state.focus_handle.focus(window);
            cx.notify();
        }).detach();
        
        self.state.command_palette_view = Some(view.clone());
    }
}
```

When dismissed:
1. Check if an item was selected via `take_selected_item()`
2. If yes, execute its callback via `execute_item()`
3. Close the palette and restore focus

## Key Types

### PaletteId

```rust
pub struct PaletteId(usize);
```

Opaque ID for a registered palette. Used to retrieve palettes from the manager.

### ItemId

```rust
pub struct ItemId(usize);
```

Opaque ID for an item within a palette. Used to remove or rebind items.

### PaletteItemData

```rust
pub struct PaletteItemData {
    pub id: ItemId,
    pub name: String,
    pub description: String,
    pub icon: IconName,
    pub keywords: Vec<String>,
    pub category: String,
    pub callback: Arc<dyn Fn(&mut Window, &mut App) + Send + Sync>,
}
```

The concrete item type that `Palette` stores internally.

### PaletteItem Trait

```rust
pub trait PaletteItem: Clone + 'static {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn icon(&self) -> IconName;
    fn keywords(&self) -> Vec<&str> { vec![] }
    fn documentation(&self) -> Option<String> { None }
}
```

Trait for types that can be displayed in a palette. `PaletteItemData` implements this.

### PaletteDelegate Trait

```rust
pub trait PaletteDelegate: 'static {
    type Item: PaletteItem;
    
    fn placeholder(&self) -> &str;
    fn categories(&self) -> Vec<(String, Vec<Self::Item>)>;
    fn filter(&self, query: &str) -> Vec<(String, Vec<Self::Item>)>;
    fn confirm(&mut self, item: &Self::Item);
    fn categories_collapsed_by_default(&self) -> bool { false }
    fn supports_docs(&self) -> bool { /* ... */ }
}
```

Interface between data and UI. `GenericPalette` works with any type that implements this. The default `filter()` implementation does substring matching on name, description, and keywords.

## Adding Items with Keywords

For better search matching:

```rust
palette.add_item_with_keywords(
    "Toggle Render Stats",
    "Show/hide rendering performance metrics",
    IconName::BarChart,
    "View",
    vec!["fps".to_string(), "performance".to_string()],
    |window, cx| { /* ... */ },
    cx,
);
```

Now searching "fps" will match this item even though "fps" isn't in the name.

## Dynamic Items

You can add/remove items at runtime:

```rust
// Add
let item_id = palette.add_item(...);

// Remove
palette.remove_item(item_id, cx);
```

This is useful for palettes that reflect runtime state (like recently opened files).

## Custom Delegates

Instead of using `PaletteViewDelegate`, you can implement `PaletteDelegate` yourself:

```rust
struct MyCustomDelegate {
    items: Vec<MyItem>,
}

impl PaletteDelegate for MyCustomDelegate {
    type Item = MyItem;
    
    fn placeholder(&self) -> &str { "Search..." }
    fn categories(&self) -> Vec<(String, Vec<MyItem>)> { /* ... */ }
    fn confirm(&mut self, item: &MyItem) { /* ... */ }
}

let view = cx.new(|cx| GenericPalette::new(MyCustomDelegate { items }, window, cx));
```

This lets you use `GenericPalette` with any data source, not just `Palette` entities.

## Swapping Delegates

`GenericPalette` has a `swap_delegate()` method to change content without recreating the view:

```rust
palette_view.update(cx, |view, cx| {
    view.swap_delegate(new_delegate, window, cx);
});
```

This keeps the view alive and properly subscribed while changing what it displays.

## Memory Management

The `PaletteManager` holds **weak** references to palettes. If you don't store the `Entity<Palette>` somewhere, it'll be dropped and the palette will disappear from the registry.

```rust
// Good - store the entity
struct AppState {
    command_palette: Entity<Palette>,
}

// Bad - only the ID, entity gets dropped
struct AppState {
    command_palette_id: PaletteId,
}
```

## Cleanup

Unregister palettes when you're done with them:

```rust
PaletteManager::unregister_palette(palette_id, cx);
```

This removes the palette from the registry. The entity will be dropped when all strong references are gone.

## Implementation Notes

- The palette stores items in a `HashMap<ItemId, PaletteItemData>`
- Callbacks are `Arc<dyn Fn>` so they can be cloned and shared safely
- The UI only renders visible items (collapsed categories don't render their children)
- Keyboard navigation wraps around at the ends of the list
- Search filtering happens on every keystroke
- The modal overlay blocks all mouse events to prevent interaction with the UI behind it

## Limitations

Currently this is only used for the main command palette. You could create multiple palettes for different purposes, but there's no UI for switching between them built yet.

The plugin system doesn't have access to the palette API, so plugins can't register their own commands in the palette.
