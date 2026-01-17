---
title: Blueprint Node System
description: Visual programming node registry and runtime
category: core-concepts
lastUpdated: '2026-01-17'
tags:
  - blueprints
  - visual-programming
  - nodes
  - scripting
related:
  - core-concepts/architecture
position: 10
icon: Network
---

# Blueprint Node System

Pulsar includes a visual programming system called Blueprints. The standard library (`pulsar_std`) provides built-in nodes for common operations. Custom nodes can be added by creating Rust functions with the `#[blueprint]` attribute. The implementation is in `crates/pulsar_std/`.

## What It Provides

The blueprint system provides:
- Automatic node registration at compile time using `linkme`
- Node metadata extraction from Rust functions
- Runtime node registry for querying available nodes
- Support for pure functions, side effects, control flow, and events
- Type constructor registry for generic types
- Category-based node organization

## Node Types

Blueprints support four node types via the `NodeTypes` enum:

```rust
pub enum NodeTypes {
    pure,          // No side effects, data flow only
    fn_,           // Side effects, one exec in/out
    control_flow,  // Multiple exec outputs
    event,         // Entry point (e.g., main, begin_play)
}
```

These determine how the node appears in the visual editor and how code generation works.

## Defining Nodes

Nodes are defined as regular Rust functions with the `#[blueprint]` attribute:

```rust
use pulsar_macros::blueprint;

/// Adds two numbers
#[blueprint(type: pure, category: "Math")]
fn add(a: f32, b: f32) -> f32 {
    a + b
}
```

The macro extracts metadata from the function signature and stores it in the global registry.

### Pure Functions

Pure functions have no side effects and no execution pins:

```rust
#[blueprint(type: pure, category: "Math")]
fn multiply(a: f32, b: f32) -> f32 {
    a * b
}
```

These are the simplest nodes - data flows in through parameters, data flows out through the return value.

### Functions with Side Effects

Functions that modify state or perform I/O use `type: fn_`:

```rust
#[blueprint(type: fn_, category: "Debug")]
fn print(message: String) {
    println!("{}", message);
}
```

These nodes have one execution input and one execution output pin, showing the flow of control.

### Control Flow

Control flow nodes have multiple execution outputs:

```rust
use pulsar_macros::exec_output;

#[blueprint(type: control_flow, category: "Flow")]
fn branch(condition: bool) {
    if condition {
        exec_output!("True");
    } else {
        exec_output!("False");
    }
}
```

The `exec_output!()` macro marks execution output pins. The visual editor creates separate output pins for "True" and "False".

### Events

Events define entry points for blueprint execution:

```rust
#[blueprint(type: event, category: "Game")]
fn begin_play() {
    exec_output!("Body");
    // Event initialization code here
}
```

Events are the starting nodes in a blueprint graph. They have no execution input, only outputs.

## Node Registry

The registry uses `linkme`'s distributed slice feature to collect nodes at link time:

```rust
#[distributed_slice]
pub static BLUEPRINT_REGISTRY: [NodeMetadata] = [..];
```

When you compile, the `#[blueprint]` macro adds entries to this slice. No manual registration needed.

Node metadata:

```rust
pub struct NodeMetadata {
    pub name: &'static str,
    pub node_type: NodeTypes,
    pub params: &'static [NodeParameter],
    pub return_type: Option<&'static str>,
    pub exec_inputs: &'static [&'static str],
    pub exec_outputs: &'static [&'static str],
    pub function_source: &'static str,
    pub documentation: &'static [&'static str],
    pub category: &'static str,
    pub color: Option<&'static str>,
    pub imports: &'static [NodeImport],
}
```

This includes everything needed to display the node in the editor and generate code.

## Querying Nodes

Get all registered nodes:

```rust
use pulsar_std::get_all_nodes;

let nodes = get_all_nodes();
for node in nodes {
    println!("Node: {} (category: {})", node.name, node.category);
}
```

Get nodes by category:

```rust
let math_nodes = pulsar_std::get_nodes_by_category("Math");
```

Find a specific node:

```rust
let add_node = pulsar_std::get_node_by_name("add");
```

Get all categories:

```rust
let categories = pulsar_std::get_all_categories();
```

## Type Constructors

The system also registers type constructors (generic types like `Box`, `Vec`, `Result`):

```rust
use pulsar_macros::blueprint_type;

#[blueprint_type(
    category: "Smart Pointers",
    description: "Heap-allocated value",
    example: "Box<MyStruct>"
)]
struct BoxConstructor<T>(T);
```

Type constructor metadata:

```rust
pub struct TypeConstructorMetadata {
    pub name: &'static str,
    pub params_count: usize,
    pub category: &'static str,
    pub description: &'static str,
    pub example: &'static str,
}
```

Query type constructors:

```rust
let type_constructors = pulsar_std::get_all_type_constructors();
let smart_pointers = pulsar_std::get_type_constructors_by_category("Smart Pointers");
```

## Import Tracking

Nodes can declare external dependencies:

```rust
use pulsar_macros::{blueprint, bp_import};

#[blueprint(type: fn_, category: "HTTP")]
#[bp_import("reqwest", ["Client", "Error"])]
fn fetch_url(url: String) -> Result<String, Error> {
    // Uses reqwest::Client and reqwest::Error
}
```

The `#[bp_import]` macro adds import metadata to the node. When generating code, the blueprint system knows to add `use reqwest::{Client, Error};` at the top.

Import metadata:

```rust
pub struct NodeImport {
    pub crate_name: &'static str,
    pub items: &'static [&'static str],
}
```

Empty `items` means import the whole crate/module.

## Documentation

Doc comments become node documentation:

```rust
/// Calculates the square root of a number.
///
/// Returns NaN for negative inputs.
#[blueprint(type: pure, category: "Math")]
fn sqrt(value: f32) -> f32 {
    value.sqrt()
}
```

The documentation is extracted and stored in `node.documentation` as a slice of strings (one per line).

## Node Colors

Nodes can have custom colors in the visual editor:

```rust
#[blueprint(type: pure, category: "Math", color: "#FF6B35")]
fn special_operation(x: f32) -> f32 {
    x * 2.0 + 1.0
}
```

The color is specified as a hex string. Without a color, the category's default color is used.

## Adding Custom Nodes

To add your own nodes to the engine:

1. Create a module in `crates/pulsar_std/src/`:

```rust
// mymodule/mod.rs
use pulsar_macros::blueprint;

#[blueprint(type: pure, category: "MyCategory")]
pub fn my_function(input: i32) -> i32 {
    input + 10
}
```

2. Export it from `lib.rs`:

```rust
pub mod mymodule;
pub use mymodule::*;
```

3. Rebuild - your nodes are now in the registry

The blueprint macro handles registration automatically. No manual registration code needed.

## Code Generation

When a blueprint is compiled to Rust, the system:

1. Collects all nodes in the graph
2. Extracts their `function_source` field
3. Generates a Rust module with all necessary imports
4. Connects nodes based on the graph structure
5. Handles execution flow and data flow

The generated code is standard Rust that can be compiled normally.

## Standard Library Organization

Built-in nodes are organized by category:

- **Math** - Arithmetic, trigonometry, rounding
- **Logic** - Boolean operations, comparisons
- **Flow** - Branches, loops, switches
- **Debug** - Print, assert, logging
- **Game** - Begin play, tick, input events
- **HTTP** - (Example) Web requests if enabled

Categories are displayed as groups in the node palette in the visual editor.

## Execution Model

Blueprint execution follows these rules:

- **Pure nodes** execute when inputs are available (lazy evaluation)
- **Function nodes** execute when the exec pin is triggered
- **Control flow nodes** branch execution based on conditions
- **Event nodes** start execution when triggered by the engine

Data flows through edges connecting output pins to input pins. Execution flows through exec pins connecting nodes in sequence.

## Limitations

Current implementation:
- No async/await support for blueprint nodes yet
- Generic parameters in node signatures are not fully supported
- Limited type inference (types must be explicit)
- No closures or function pointers in blueprint graphs

For advanced use cases, you can still write regular Rust code and expose high-level operations as blueprint nodes.

## Future Enhancements

Planned improvements:
- Async node support for long-running operations
- Better generic type handling
- Lambda/closure nodes for inline functions
- Debugger integration for step-through execution
- Hot-reload of blueprint changes
