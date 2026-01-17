---
title: Workspace, Panels & Docks
description: The workspace and docking system in Pulsar
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - ui
  - workspace
  - dock
  - panels
related:
  - core-concepts/ui-framework
  - core-concepts/architecture
position: 6
icon: LayoutDashboard
---

# Workspace, Panels & Docks

Pulsar uses a docking workspace system similar to VS Code or Unreal Engine. You can drag tabs between panels, split panels, and dock them to the left/bottom/right edges. This document covers how it's implemented.

## Structure

The docking system is in `crates/ui/src/dock/` and `crates/ui/src/workspace/`. There are several types involved:

- **Workspace** - High-level wrapper that creates a DockArea
- **DockArea** - The main container with center content and optional side docks
- **Dock** - Left, right, or bottom edge containers (collapsible/resizable)
- **DockItem** - Tree structure representing layouts (splits, tabs, panels, tiles)
- **TabPanel** - Renders tabs and handles drag/drop
- **Panel** - Trait that custom panels implement

## DockArea

`DockArea` is the core type. Located in `crates/ui/src/dock/mod.rs`.

Structure:

```rust
pub struct DockArea {
    id: SharedString,
    version: Option<usize>,
    bounds: Bounds<Pixels>,
    
    // Center content
    items: DockItem,
    
    // Side docks (optional)
    left_dock: Option<Entity<Dock>>,
    right_dock: Option<Entity<Dock>>,
    bottom_dock: Option<Entity<Dock>>,
    
    zoom_view: Option<AnyView>,
    locked: bool,
    panel_style: PanelStyle,
    
    // Isolation system
    channel: DockChannel,
}
```

Creating a dock area:

```rust
// Default channel (0)
let dock_area = cx.new(|cx| {
    DockArea::new("my-workspace", None, window, cx)
});

// Custom channel for isolation
let dock_area = cx.new(|cx| {
    DockArea::new_with_channel("my-workspace", None, DockChannel(3), window, cx)
});
```

The `version` field is used for default layout versioning. When the version changes, the default layout can be reapplied.

## DockChannel - Isolation System

`DockChannel` is a simple wrapper around `u32` that isolates different dock systems from each other. Located in `crates/ui/src/dock/tab_panel.rs`:

```rust
pub struct DockChannel(pub u32);

impl Default for DockChannel {
    fn default() -> Self {
        DockChannel(0)
    }
}
```

When you drag a tab, the drag data includes the channel. Drop targets check if the dragged tab's channel matches their own channel:

```rust
// From tab_panel.rs, line 1256
if drag.channel != self.channel {
    tracing::debug!("DROP: Rejected - drag from different channel");
    return;
}
```

This prevents tabs from one workspace interfering with another workspace. The level editor uses `DockChannel(3)` while the main editor uses the default `DockChannel(0)`.

Why this matters: Pulsar can have multiple workspace instances open simultaneously (like the main editor and the level editor). Without channel isolation, dragging a tab from the level editor could accidentally drop it into the main editor's workspace, breaking both interfaces.

## DockItem Tree

`DockItem` is an enum that represents the layout tree:

```rust
pub enum DockItem {
    Split {
        axis: Axis,
        items: Vec<DockItem>,
        sizes: Vec<Option<Pixels>>,
        view: Entity<StackPanel>,
    },
    Tabs {
        items: Vec<Arc<dyn PanelView>>,
        active_ix: usize,
        view: Entity<TabPanel>,
    },
    Panel {
        view: Arc<dyn PanelView>,
    },
    Tiles {
        items: Vec<TileItem>,
        view: Entity<Tiles>,
    },
}
```

Building a layout:

```rust
// Create a tabbed layout with multiple panels
let tabs = DockItem::tabs(
    vec![panel1, panel2, panel3],
    Some(0),  // active tab index
    &dock_area_weak,
    window,
    cx,
);

// Create a split layout
let split = DockItem::split(
    Axis::Horizontal,
    vec![left_item, right_item],
    &dock_area_weak,
    window,
    cx,
);

// With specific sizes
let split_sized = DockItem::split_with_sizes(
    Axis::Vertical,
    vec![top_item, bottom_item],
    vec![Some(px(300.0)), None],  // top is 300px, bottom fills remaining
    &dock_area_weak,
    window,
    cx,
);
```

The tree structure allows nesting. You can have splits containing tabs, tabs containing panels, etc.

## Docks (Left/Right/Bottom)

`Dock` is a fixed container at the edge of the window. Located in `crates/ui/src/dock/dock.rs`.

```rust
pub struct Dock {
    placement: DockPlacement,
    dock_area: WeakEntity<DockArea>,
    panel: DockItem,
    size: Pixels,
    open: bool,
    collapsible: bool,
    resizing: bool,
}
```

Creating docks:

```rust
dock_area.update(cx, |dock_area, cx| {
    // Left dock with tabs
    let left_content = DockItem::tabs(...);
    dock_area.set_left_dock(
        left_content,
        Some(px(250.0)),  // initial width
        true,             // open by default
        window,
        cx,
    );
    
    // Bottom dock
    let bottom_content = DockItem::tabs(...);
    dock_area.set_bottom_dock(
        bottom_content,
        Some(px(200.0)),  // initial height
        false,            // closed by default
        window,
        cx,
    );
});
```

Docks can be toggled open/closed and resized by dragging the resize handle. The resize handle appears on the inner edge (right edge for left dock, top edge for bottom dock, etc.).

## Panels

The `Panel` trait defines what goes inside a `DockItem`. Located in `crates/ui/src/dock/panel.rs`.

```rust
pub trait Panel: Render + Focusable + EventEmitter<PanelEvent> {
    fn panel_name(&self) -> &'static str;
    fn title(&self, window: &Window, cx: &App) -> AnyElement;
    fn closable(&self, cx: &App) -> bool { true }
    fn zoomable(&self, cx: &App) -> bool { true }
    fn dump(&self, cx: &App) -> PanelState;
    
    // Optional overrides
    fn title_style(&self, _: &App) -> Option<TitleStyle> { None }
    fn title_suffix(&self, _: &Window, _: &App) -> Option<AnyElement> { None }
    fn popup_menu(&self, _: &Window, _: &App) -> Option<PopupMenu> { None }
}
```

The panel name must be unique and static. It's used for persistence and lookup.

Example from the level editor (`ui-crates/ui_level_editor/src/level_editor/workspace_panels.rs`):

```rust
impl Panel for ViewportPanel {
    fn panel_name(&self) -> &'static str {
        "ViewportPanel"
    }
    
    fn title(&self, _: &Window, _: &App) -> AnyElement {
        "Viewport".into_any_element()
    }
    
    fn closable(&self, _: &App) -> bool {
        false  // Can't close the viewport
    }
    
    fn dump(&self, _: &App) -> PanelState {
        PanelState::new(self)
    }
}
```

## WorkspacePanel Helper

For simple panels, there's a helper type in `crates/ui/src/workspace/workspace_panel.rs`:

```rust
let panel = cx.new(|cx| {
    WorkspacePanel::new(
        "my-panel",
        "My Panel Title",
        |window, cx| {
            // Render function
            div().child("Panel content").into_any_element()
        },
        cx,
    )
    .closable(false)
});
```

This creates a panel with a custom render function without implementing the full `Panel` trait yourself.

## TabPanel

`TabPanel` is the view that renders tabs and handles drag/drop. Located in `crates/ui/src/dock/tab_panel.rs`.

```rust
pub struct TabPanel {
    focus_handle: FocusHandle,
    dock_area: WeakEntity<DockArea>,
    stack_panel: Option<WeakEntity<StackPanel>>,
    panels: Vec<Arc<dyn PanelView>>,
    active_ix: usize,
    closable: bool,
    zoomed: bool,
    collapsed: bool,
    channel: DockChannel,
    // ... more fields
}
```

The tab panel:
- Renders the tab bar with close buttons
- Handles tab selection
- Manages drag-and-drop of tabs (both reordering and moving between panels)
- Shows split preview when dragging to edges
- Emits `PanelEvent::LayoutChanged` when structure changes

Drag and drop flow:

1. User drags a tab → creates `DragPanel` with the tab's channel
2. Hover over drop target → checks if `drag.channel == self.channel`
3. If channels match → shows drop visual (border highlight or split preview)
4. If channels don't match → ignores the drag
5. Drop → moves panel to new location (if same channel)

## Workspace Helper

The `Workspace` type in `crates/ui/src/workspace/mod.rs` is a high-level wrapper:

```rust
pub struct Workspace {
    dock_area: Entity<DockArea>,
}

impl Workspace {
    pub fn new(
        id: impl Into<SharedString>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let dock_area = cx.new(|cx| {
            DockArea::new(id, None, window, cx)
        });
        Self { dock_area }
    }
    
    pub fn new_with_channel(
        id: impl Into<SharedString>,
        channel: DockChannel,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let dock_area = cx.new(|cx| {
            DockArea::new_with_channel(id, None, channel, window, cx)
        });
        Self { dock_area }
    }
}
```

The workspace simplifies initialization:

```rust
let workspace = cx.new(|cx| {
    Workspace::new_with_channel(
        "level-editor-workspace",
        DockChannel(3),
        window,
        cx
    )
});

workspace.update(cx, |workspace, cx| {
    let dock_area = workspace.dock_area().downgrade();
    
    // Create center content
    let center = DockItem::tabs(vec![viewport_panel], None, &dock_area, window, cx);
    
    // Create left sidebar
    let left = DockItem::tabs(vec![hierarchy_panel], None, &dock_area, window, cx);
    
    // Create right sidebar
    let right = DockItem::split(
        Axis::Vertical,
        vec![
            DockItem::tabs(vec![inspector_panel], None, &dock_area, window, cx),
            DockItem::tabs(vec![materials_panel], None, &dock_area, window, cx),
        ],
        &dock_area,
        window,
        cx,
    );
    
    workspace.initialize(center, Some(left), Some(right), None, window, cx);
});
```

## Real Usage Example

From `ui-crates/ui_level_editor/src/level_editor/ui/panel.rs`:

```rust
let workspace = cx.new(|cx| {
    Workspace::new_with_channel(
        "level-editor-workspace",
        ui::dock::DockChannel(3),  // Isolated from main editor
        window,
        cx
    )
});

workspace.update(cx, |workspace, cx| {
    let dock_area = workspace.dock_area().downgrade();
    
    // Center: viewport
    let viewport_panel = cx.new(|cx| ViewportPanel::new(...));
    let center = DockItem::tab(viewport_panel, &dock_area, window, cx);
    
    // Left: hierarchy + assets
    let hierarchy = cx.new(|cx| HierarchyPanel::new(...));
    let assets = cx.new(|cx| AssetsPanel::new(...));
    let left = DockItem::tabs(
        vec![Arc::new(hierarchy), Arc::new(assets)],
        Some(0),
        &dock_area,
        window,
        cx,
    );
    
    // Right: split between inspector and materials
    let inspector = cx.new(|cx| InspectorPanel::new(...));
    let materials = cx.new(|cx| MaterialsPanel::new(...));
    let right = DockItem::split(
        Axis::Vertical,
        vec![
            DockItem::tab(inspector.clone(), &dock_area, window, cx),
            DockItem::tab(materials, &dock_area, window, cx),
        ],
        &dock_area,
        window,
        cx,
    );
    
    workspace.initialize(center, Some(left), Some(right), None, window, cx);
});
```

This creates a layout with:
- Viewport in the center (not closable)
- Hierarchy and assets tabs on the left
- Inspector and materials vertically split on the right
- All isolated to `DockChannel(3)` so it doesn't interfere with the main editor

## Layout Persistence

The `DockArea` can serialize/deserialize its layout via the state system. This is how Pulsar remembers your panel arrangement between sessions.

The `version` field lets you bump the layout version when you change the default layout. If the saved version doesn't match, Pulsar resets to the new default.

## Events

The dock system emits events:

```rust
pub enum DockEvent {
    LayoutChanged,  // Emitted frequently when layout changes
    DragDrop(AnyDrag),  // Emitted when drag-drop completes
}
```

Subscribe to these if you need to save layout state:

```rust
cx.subscribe(&dock_area, |this, _, event: &DockEvent, cx| {
    match event {
        DockEvent::LayoutChanged => {
            // Debounce and save layout
        }
        DockEvent::DragDrop(_) => {
            // Handle custom drag data
        }
    }
}).detach();
```

## PanelView Trait

`PanelView` is the trait object wrapper around `Panel`:

```rust
pub trait PanelView: Send + Sync {
    fn view(&self) -> Arc<dyn PanelView>;
    fn entity_id(&self) -> EntityId;
    fn panel_name(&self, cx: &App) -> &'static str;
    fn visible(&self, cx: &App) -> bool;
    fn set_active(&self, active: bool, window: &mut Window, cx: &mut App);
    // ... more methods
}
```

This is automatically implemented for `Entity<P: Panel>` via a blanket impl. You work with `Arc<dyn PanelView>` when adding panels to the dock system.

## Limitations

The dock system is powerful but has some constraints:

- Channels must be assigned at creation time (can't change later)
- Center dock can't be collapsed (only side docks can)
- Tiles layout is less tested than splits/tabs
- Drag-drop only works within the same window (can't drag to another OS window)

The last point is being worked on - there's code for detecting when dragging outside the window bounds to create a new window, but it's not fully connected yet.
