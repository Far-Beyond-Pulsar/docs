---
title: "Macro System"
description: "Complete reference for Quark's #[command] procedural macro — automatic Command trait generation, type inference, and async detection"
category: quark
lastUpdated: '2026-03-27'
tags:
  - macros
  - proc-macro
  - codegen
  - ast
position: 3
icon: Wand
---

The `#[command]` procedural macro is the centerpiece of Quark's developer ergonomics. It transforms an annotated function into a full `Command` trait implementation with zero boilerplate — automatically parsing arguments, converting types, and handling both sync and async execution paths.

This document covers the macro's implementation in detail: how it parses attributes, extracts function signatures, generates parsing logic, and produces the final expanded code.

---

## 1. Usage Overview

```rust
#[command(
    name = "spawn",
    syntax = "spawn <entity> <count>",
    short = "Spawn entities into the world",
    docs = "Example: spawn goblin 5"
)]
fn spawn(entity: String, count: usize) {
    for _ in 0..count {
        println!("Spawning {}", entity);
    }
}
```

This single annotation generates:

1. A zero-sized struct `SpawnCommand`
2. A `Command` trait implementation for `SpawnCommand`
3. Argument parsing logic that converts `Vec<String>` → `(String, usize)`
4. Error handling for wrong argument counts or invalid types

The original function remains unchanged and directly callable — the macro **adds** the command wrapper without replacing the function.

---

## 2. Macro Attributes

The `#[command]` macro accepts four required attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `name` | `&str` | The command's unique identifier (used for registry lookup) |
| `syntax` | `&str` | Human-readable syntax string (for help text) |
| `short` | `&str` | One-line description (for command listings) |
| `docs` | `&str` | Detailed documentation (for help output) |

All four attributes must be provided as name-value pairs with string literals. The macro fails at compile time if any are missing:

```rust
#[command(
    name = "example",
    // ERROR: Missing 'syntax', 'short', 'docs' attributes
)]
fn example() {}
```

### Attribute Parsing

The macro uses `syn::Meta` to parse attributes as a comma-separated list of name-value pairs:

```rust
let parser = Punctuated::<Meta, Comma>::parse_terminated;
let args = parser.parse2(input)?;

for meta in args {
    if let Meta::NameValue(nv) = meta {
        let ident = nv.path.get_ident()?;
        let value = extract_string_literal(&nv.value)?;

        match ident.to_string().as_str() {
            "name" => name = Some(value),
            "syntax" => syntax = Some(value),
            "short" => short = Some(value),
            "docs" => docs = Some(value),
            _ => return Err(...), // Unknown attribute
        }
    }
}
```

Each attribute is validated as a string literal at compile time. Non-string values produce a compilation error:

```rust
#[command(name = 123)]  // ERROR: Expected string literal
```

---

## 3. Function Signature Analysis

The macro extracts critical information from the annotated function's signature:

### 3.1 Function Name

```rust
let fn_name = &input.sig.ident;
```

The function name is used to:
- Generate the command struct name (`{FnName}Command`, capitalized)
- Call the original function from the generated wrapper

### 3.2 Async Detection

```rust
let is_async = input.sig.asyncness.is_some();
```

The macro checks for the `async` keyword in the function signature. This determines:
- Whether to implement `execute()` (sync) or `execute_async()` (async)
- Whether to `.await` the function call
- Whether `is_async()` returns `true` or `false`

### 3.3 Parameter Extraction

```rust
for input_param in &input.sig.inputs {
    if let syn::FnArg::Typed(pat_type) = input_param {
        // Extract parameter name (ident)
        if let syn::Pat::Ident(pat_ident) = &*pat_type.pat {
            param_names.push(pat_ident.ident.clone());
        }

        // Extract parameter type
        param_types.push(&*pat_type.ty);
    }
}
```

For each function parameter, the macro extracts:

1. **Parameter name** — The identifier (e.g., `entity`, `count`)
2. **Parameter type** — The type annotation (e.g., `String`, `usize`)

These are stored as parallel vectors: `param_names: Vec<Ident>` and `param_types: Vec<&Type>`.

**Example:**

```rust
fn spawn(entity: String, count: usize)
```

Extracted data:
```rust
param_names = [entity, count]
param_types = [String, usize]
param_count = 2
```

### 3.4 Unsupported Signatures

The macro rejects certain function signatures:

- **`self` parameters** — Commands cannot be methods (no `&self`, `&mut self`, `self`)

```rust
#[command(...)]
fn invalid(&self) {}  // ERROR: Expected typed parameter
```

- **Pattern parameters** — Only simple identifiers are allowed (no destructuring)

```rust
#[command(...)]
fn invalid((a, b): (u32, u32)) {}  // ERROR: Expected simple identifier pattern
```

---

## 4. Code Generation

The macro generates three pieces of code:

1. The original function (unmodified, but re-emitted)
2. A zero-sized struct named `{FnName}Command`
3. A `Command` trait implementation for that struct

### 4.1 Original Function Re-Emission

The macro re-emits the original function with all its attributes, visibility, and body intact:

```rust
#(#fn_attrs)*
#fn_vis async fn #fn_name(#(#param_names: #param_types),*) {
    #fn_block
}
```

This ensures the function remains callable directly:

```rust
spawn("goblin".to_string(), 5);  // Still works
```

### 4.2 Command Struct Generation

```rust
#[allow(non_camel_case_types)]
#fn_vis struct #command_struct_name;
```

Example output:

```rust
pub struct SpawnCommand;
```

**Why zero-sized?**

The struct has no fields, making it a **zero-sized type (ZST)**. When boxed (`Box::new(SpawnCommand)`), the compiler recognizes this and optimizes the allocation to a single pointer with no heap memory.

**Naming convention:**

The struct name is the function name with `Command` appended and the first letter capitalized:

- `spawn` → `SpawnCommand`
- `teleport` → `TeleportCommand`
- `set_volume` → `Set_volumeCommand` (no case transformation beyond the first char)

The `#[allow(non_camel_case_types)]` attribute suppresses warnings for functions that don't follow camelCase conventions.

### 4.3 Command Trait Implementation

The macro generates different implementations for sync vs async functions.

---

## 5. Synchronous Command Generation

For a synchronous function:

```rust
#[command(name = "example", ...)]
fn example(x: u32, y: f32) {
    println!("{} {}", x, y);
}
```

The macro generates:

```rust
impl ::quark::Command for ExampleCommand {
    fn name(&self) -> &str {
        "example"
    }

    fn syntax(&self) -> &str {
        "..." // From attribute
    }

    fn short(&self) -> &str {
        "..." // From attribute
    }

    fn docs(&self) -> &str {
        "..." // From attribute
    }

    fn is_async(&self) -> bool {
        false
    }

    fn execute(&self, args: Vec<String>) -> ::quark::Result<()> {
        // 1. Validate argument count
        if args.len() != 2 {
            return Err(::quark::CommandError::ArgumentCountMismatch {
                expected: 2,
                got: args.len(),
            });
        }

        // 2. Parse and convert arguments
        let x: u32 = args[0].parse()
            .map_err(|_| ::quark::CommandError::TypeConversionError {
                arg: args[0].clone(),
                target_type: "u32",
            })?;

        let y: f32 = args[1].parse()
            .map_err(|_| ::quark::CommandError::TypeConversionError {
                arg: args[1].clone(),
                target_type: "f32",
            })?;

        // 3. Call the original function
        example(x, y);
        Ok(())
    }
}
```

### Key Details

1. **Metadata methods** — Return the literal strings from the attributes
2. **`is_async()`** — Returns `false` for sync functions
3. **Argument validation** — Checks `args.len()` against the expected count
4. **Type conversion** — Calls `.parse()` on each argument string
5. **Error mapping** — Converts parse errors to `CommandError::TypeConversionError`
6. **Function call** — Invokes the original function with the converted arguments

The `target_type` string in error messages is generated by `quote!(#param_type).to_string()`, which produces a human-readable type name (e.g., `"u32"`, `"String"`, `"Vec<usize>"`).

---

## 6. Asynchronous Command Generation

For an async function:

```rust
#[command(name = "save", ...)]
async fn save(filename: String) {
    tokio::fs::write(&filename, "data").await.unwrap();
}
```

The macro generates:

```rust
impl ::quark::Command for SaveCommand {
    fn name(&self) -> &str {
        "save"
    }

    // ... (other metadata methods)

    fn is_async(&self) -> bool {
        true
    }

    fn execute_async<'a>(
        &'a self,
        args: Vec<String>,
    ) -> ::std::pin::Pin<Box<dyn ::std::future::Future<Output = ::quark::Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // 1. Validate argument count
            if args.len() != 1 {
                return Err(::quark::CommandError::ArgumentCountMismatch {
                    expected: 1,
                    got: args.len(),
                });
            }

            // 2. Parse and convert arguments
            let filename: String = args[0].parse()
                .map_err(|_| ::quark::CommandError::TypeConversionError {
                    arg: args[0].clone(),
                    target_type: "String",
                })?;

            // 3. Call the original function (with .await)
            save(filename).await;
            Ok(())
        })
    }
}
```

### Key Differences from Sync

1. **`is_async()` returns `true`** — Signals to the registry that this command requires an async runtime
2. **`execute_async()` implementation** — Returns a pinned boxed future
3. **`.await` on function call** — The original async function is awaited inside the generated future
4. **`async move` block** — The entire parsing and execution logic is wrapped in an async block that captures `args` by move

The `Box::pin()` is necessary because:

- The return type must be `Pin<Box<dyn Future>>` (trait object)
- Async blocks produce opaque `impl Future` types that cannot be directly erased into a trait object
- Boxing the future allows it to be stored in the registry as a `Box<dyn Command>`

---

## 7. Type Conversion Mechanism

All argument conversion relies on the `FromStr` trait:

```rust
let x: T = args[i].parse()?;
```

This calls `<T as FromStr>::from_str(&args[i])`, which works for any type implementing `FromStr`.

**Standard library support:**

The following types implement `FromStr` out of the box:

- Integers: `u8`, `u16`, `u32`, `u64`, `u128`, `usize`, `i8`, `i16`, `i32`, `i64`, `i128`, `isize`
- Floats: `f32`, `f64`
- Strings: `String` (trivial implementation)
- Booleans: `bool` (parses `"true"` and `"false"`)
- IP addresses: `IpAddr`, `Ipv4Addr`, `Ipv6Addr`
- Socket addresses: `SocketAddr`, `SocketAddrV4`, `SocketAddrV6`
- Paths: `PathBuf`

**Custom types:**

User-defined types can implement `FromStr` to be used as command arguments:

```rust
struct EntityId(u64);

impl std::str::FromStr for EntityId {
    type Err = std::num::ParseIntError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(EntityId(s.parse()?))
    }
}

#[command(
    name = "kill",
    syntax = "kill <entity_id>",
    short = "Kill an entity"
)]
fn kill(id: EntityId) {
    println!("Killing entity {}", id.0);
}
```

The macro generates:

```rust
let id: EntityId = args[0].parse()
    .map_err(|_| CommandError::TypeConversionError {
        arg: args[0].clone(),
        target_type: "EntityId",
    })?;
```

**Type name generation:**

The `target_type` string is generated by `quote!(#param_type).to_string()`, which produces:

- `u32` → `"u32"`
- `String` → `"String"`
- `Vec<usize>` → `"Vec < usize >"` (with spaces, due to token formatting)
- `EntityId` → `"EntityId"`

This is purely for error messages — the actual type conversion is determined by `FromStr` trait resolution.

---

## 8. Error Handling

The generated code produces three types of errors:

### 8.1 `ArgumentCountMismatch`

Triggered when the user provides the wrong number of arguments:

```rust
if args.len() != #param_count {
    return Err(::quark::CommandError::ArgumentCountMismatch {
        expected: #param_count,
        got: args.len(),
    });
}
```

**Example:**

```rust
registry.run("spawn goblin");  // Missing second argument
// Error: ArgumentCountMismatch { expected: 2, got: 1 }
```

### 8.2 `TypeConversionError`

Triggered when an argument cannot be parsed as the expected type:

```rust
let x: u32 = args[0].parse()
    .map_err(|_| ::quark::CommandError::TypeConversionError {
        arg: args[0].clone(),
        target_type: "u32",
    })?;
```

**Example:**

```rust
registry.run("spawn goblin abc");  // "abc" cannot be parsed as usize
// Error: TypeConversionError { arg: "abc", target_type: "usize" }
```

The original `ParseIntError` (or whatever error type `FromStr` returns) is discarded — only the string value and target type are retained in the error.

### 8.3 Function Execution Errors

If the command function itself returns `Result<(), E>` (not currently supported by the macro), execution errors would need to be handled by the function body and converted to panics or printed warnings.

The macro currently assumes functions return `()`, not `Result`. Support for `Result`-returning functions is planned for future releases.

---

## 9. Generated Code Size

For a typical command with 2 arguments:

**Input:**

```rust
#[command(
    name = "spawn",
    syntax = "spawn <entity> <count>",
    short = "Spawn entities",
    docs = "Spawns entities"
)]
fn spawn(entity: String, count: usize) {
    println!("Spawning {} {}", entity, count);
}
```

**Output (expanded):**

```rust
// Original function (unmodified)
fn spawn(entity: String, count: usize) {
    println!("Spawning {} {}", entity, count);
}

// Command struct
#[allow(non_camel_case_types)]
pub struct SpawnCommand;

// Command trait implementation (~50 lines of generated code)
impl ::quark::Command for SpawnCommand {
    fn name(&self) -> &str { "spawn" }
    fn syntax(&self) -> &str { "spawn <entity> <count>" }
    fn short(&self) -> &str { "Spawn entities" }
    fn docs(&self) -> &str { "Spawns entities" }
    fn is_async(&self) -> bool { false }

    fn execute(&self, args: Vec<String>) -> ::quark::Result<()> {
        if args.len() != 2 {
            return Err(::quark::CommandError::ArgumentCountMismatch {
                expected: 2,
                got: args.len(),
            });
        }

        let entity: String = args[0].parse()
            .map_err(|_| ::quark::CommandError::TypeConversionError {
                arg: args[0].clone(),
                target_type: "String",
            })?;

        let count: usize = args[1].parse()
            .map_err(|_| ::quark::CommandError::TypeConversionError {
                arg: args[1].clone(),
                target_type: "usize",
            })?;

        spawn(entity, count);
        Ok(())
    }
}
```

**Total:** ~50 lines of generated code per command, regardless of complexity.

---

## 10. Compile-Time Cost

Procedural macros run during compilation and add to compile time. For the `#[command]` macro:

- **Parsing attributes:** ~0.5ms per command
- **AST traversal:** ~1ms per command
- **Code generation:** ~1–2ms per command
- **Total:** ~2–5ms per command

For a project with 100 commands:

```
100 commands × 5ms = 500ms = 0.5 seconds
```

This is added to the total compile time of the crate using the macro. For incremental builds (where only a few commands changed), the cost is proportionally lower.

---

## 11. Macro Hygiene

The generated code uses **fully-qualified paths** (`::quark::Command`, `::std::pin::Pin`) to avoid naming conflicts with user code:

```rust
impl ::quark::Command for SpawnCommand {
    // ...
}
```

This ensures the macro works correctly even if the user has:

- A local type or module named `Command`
- A local type or module named `Pin`, `Future`, `Result`, etc.

The `::` prefix forces resolution to start from the crate root, bypassing any local names.

---

## 12. Limitations and Future Work

### Current Limitations

1. **No optional arguments** — All parameters must be provided (no `Option<T>` support)
2. **No default values** — Cannot specify defaults for missing arguments
3. **No variadic arguments** — Cannot handle `Vec<T>` that consumes all remaining arguments
4. **No `Result<(), E>` return types** — Functions must return `()`, not `Result`
5. **No generic parameters** — Commands cannot be generic over types
6. **No lifetimes** — Parameters cannot have lifetime annotations (`&'a str` not supported)

### Planned Features

- **Optional arguments:** `Option<T>` parameters that can be omitted
- **Default values:** `#[default = "10"]` attribute to provide defaults
- **Named arguments:** `spawn entity=goblin count=5` syntax
- **Variadic arguments:** `Vec<T>` parameter that consumes all remaining args
- **Result returns:** Support for commands that return `Result<(), E>`

---

## 13. Macro Expansion Debugging

To view the macro's generated code, use `cargo expand`:

```bash
cargo install cargo-expand
cargo expand --bin myapp
```

This outputs the fully-expanded source code with all macros applied. Example:

```rust
// Before expansion
#[command(name = "test", ...)]
fn test(x: u32) { println!("{}", x); }

// After expansion
fn test(x: u32) { println!("{}", x); }

pub struct TestCommand;

impl ::quark::Command for TestCommand {
    // ... (full implementation)
}
```

This is invaluable for debugging macro issues or understanding what code the macro generates.

---

## 14. Design Rationale

### Why Generate a Struct Instead of Implementing on the Function?

Rust does not allow trait implementations on functions — only on types. The macro generates a zero-sized struct to act as the "command object" that implements `Command`.

### Why Re-Emit the Original Function?

The macro could replace the function entirely, but re-emitting it preserves the ability to call the function directly without going through the registry. This is useful for:

- Unit testing the command logic without registering it
- Calling the command from other code paths
- Avoiding vtable overhead in hot paths

### Why Not Use a Derive Macro?

Derive macros (`#[derive(Command)]`) apply to structs/enums, not functions. Attribute macros (`#[command]`) can apply to any item, making them the natural choice for function-based commands.

---

## Next Steps

- [Command Trait](./command-trait) — The trait that generated code implements
- [Registry Architecture](./registry) — How generated commands are stored and executed
- [Parser](./parser) — How command strings are tokenized into arguments
