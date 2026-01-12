---
title: "macOS Installation"
description: "Install Pulsar Engine on macOS"
category: "getting-started"
order: 3
lastUpdated: "2026-01-12"
tags: ["installation", "macos", "setup"]
---

# Installing Pulsar on macOS

This guide walks you through setting up Pulsar Engine on macOS. While Windows is the primary development platform, macOS support is being restored as architectural work stabilizes.

::: warning
**Platform Support Notice**

macOS support is temporarily limited during core architectural changes. Some features may not work as expected. Track restoration progress in the [GitHub discussions](https://github.com/orgs/Far-Beyond-Pulsar/discussions/17).
:::

## Prerequisites

### Install Xcode Command Line Tools

Pulsar requires the Xcode command line tools for compilation:

```bash
xcode-select --install
```

Click "Install" in the dialog that appears. This provides the C/C++ compilers and other build tools Rust needs.

### Install Rust

Use rustup to install Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Follow the prompts (defaults are fine)
# Reload your shell
source "$HOME/.cargo/env"

# Verify
rustc --version
cargo --version
```

### Install Homebrew (Optional but Recommended)

Homebrew makes it easy to install additional dependencies:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Install Additional Dependencies

Using Homebrew:

```bash
brew install git cmake pkg-config
```

## Getting Pulsar

Clone the repository:

```bash
cd ~/Projects  # or wherever you keep code
git clone https://github.com/Far-Beyond-Pulsar/Pulsar-Native.git
cd Pulsar-Native
```

## Building Pulsar

Build with Cargo:

```bash
cargo build --release
```

::: info
**First Build Takes Time**

The first compilation will take 10-20 minutes as Cargo compiles all dependencies. Subsequent builds are much faster thanks to incremental compilation.
:::

### Build Targets

Pulsar uses the Metal graphics API on macOS:

```bash
# Check your architecture
uname -m

# Apple Silicon (M1, M2, etc)
# Target: aarch64-apple-darwin (default)

# Intel Macs
# Target: x86_64-apple-darwin (default)
```

The correct target is automatically selected based on your hardware.

## Running Pulsar

Launch the editor:

```bash
cargo run --release
```

Or run the binary directly:

```bash
./target/release/pulsar
```

## Known macOS-Specific Issues

### Gatekeeper Warnings

macOS may block Pulsar since it's not code-signed:

```bash
# Allow Pulsar to run
xattr -d com.apple.quarantine target/release/pulsar
```

Alternatively, go to System Settings → Privacy & Security and click "Allow" when prompted.

### Retina Display Scaling

Pulsar should automatically detect Retina displays. If UI appears incorrectly scaled:

```bash
# Force scale factor
export WINIT_HIDPI_FACTOR=2.0
cargo run --release
```

### Metal Validation Errors

During development, you might see Metal validation warnings. These are usually harmless but can be disabled:

```bash
export METAL_DEVICE_WRAPPER_TYPE=1
cargo run --release
```

### File System Permissions

If Pulsar can't access certain directories:

1. Open System Settings → Privacy & Security → Files and Folders
2. Find Terminal (or your terminal app)
3. Grant full disk access

### Library Not Found Errors

If you see errors about missing libraries:

```bash
# Check what's missing
otool -L target/release/pulsar

# Install via Homebrew if needed
brew install <missing-library>
```

## Optional: Add to PATH

To run Pulsar from anywhere:

```bash
# Add to ~/.zshrc (or ~/.bash_profile for Bash)
echo 'export PATH="$PATH:$HOME/Projects/Pulsar-Native/target/release"' >> ~/.zshrc

# Reload
source ~/.zshrc
```

## Keeping Updated

Pull latest changes and rebuild:

```bash
cd Pulsar-Native
git pull
cargo build --release
```

If build fails after updating:

```bash
cargo clean
cargo build --release
```

## Performance Tips

### Faster Builds

Use all CPU cores:

```bash
# Check core count
sysctl -n hw.ncpu

# Build with all cores (default behavior)
cargo build --release
```

### Optimize for Your CPU

For maximum performance (longer compile time):

```bash
RUSTFLAGS="-C target-cpu=native" cargo build --release
```

### Debug vs Release

Development workflow:

```bash
# Fast compiles, slow runtime
cargo build
cargo run

# Slower compiles, fast runtime
cargo build --release
cargo run --release
```

Use `cargo check` for fastest iteration (just checks for errors, doesn't fully compile):

```bash
cargo check
```

## Troubleshooting

### "error: linker `cc` not found"

Xcode command line tools aren't installed:

```bash
xcode-select --install
```

### Out of Memory During Build

Close other applications and try:

```bash
# Limit parallel jobs
cargo build --release -j 2
```

### "Framework not found" Errors

Xcode command line tools may need resetting:

```bash
sudo xcode-select --reset
xcode-select --install
```

### Slow Performance

Make sure you're running the release build:

```bash
cargo run --release  # Not just `cargo run`
```

### Graphics Issues

Update to the latest macOS version. Pulsar requires macOS 11 (Big Sur) or newer for Metal 2 support.

## Apple Silicon Notes

Pulsar runs natively on Apple Silicon (M1, M2, M3). There's no need for Rosetta translation—it's a native ARM64 binary.

Performance on Apple Silicon is generally excellent due to the unified memory architecture and GPU performance.

## Next Steps

With Pulsar installed, check out the [Quick Start Guide](../quick-start) to explore the editor and create your first project.

For macOS-specific questions:
- Join the [Discord community](https://discord.gg/5eAKDC53SX)
- Search [GitHub issues](https://github.com/Far-Beyond-Pulsar/Pulsar-Native/issues) for known problems
- Ask in [GitHub discussions](https://github.com/orgs/Far-Beyond-Pulsar/discussions)
