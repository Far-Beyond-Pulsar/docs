---
title: "Linux Installation"
description: "Install Pulsar Engine on Linux"
category: "installation"
position: 2
icon: "Laptop"
lastUpdated: "2026-01-12"
tags: ["installation", "linux", "setup"]
---

# Installing Pulsar on Linux

This guide covers setting up Pulsar Engine on Linux distributions. While Windows is currently the primary development platform, you can still build and run Pulsar on Linux with some additional setup.

::: warning
**Platform Support Notice**

Linux support is temporarily limited while core architectural work is ongoing. Some features may not work as expected. Check the [GitHub discussions](https://github.com/orgs/Far-Beyond-Pulsar/discussions/17) for current status.
:::

## Prerequisites

### Install Rust

Pulsar requires Rust 1.70 or newer:

```bash
# Install rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Reload your shell
source "$HOME/.cargo/env"

# Verify installation
rustc --version
cargo --version
```

### Install Development Tools

You'll need build essentials and some additional libraries:

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install build-essential git pkg-config libssl-dev \
    libx11-dev libxcursor-dev libxrandr-dev libxi-dev \
    libasound2-dev libpulse-dev libudev-dev
```

**Fedora:**
```bash
sudo dnf install gcc gcc-c++ git openssl-devel \
    libX11-devel libXcursor-devel libXrandr-devel libXi-devel \
    alsa-lib-devel pulseaudio-libs-devel systemd-devel
```

**Arch:**
```bash
sudo pacman -S base-devel git openssl \
    libx11 libxcursor libxrandr libxi \
    alsa-lib libpulse systemd
```

### Install Vulkan

Pulsar uses Vulkan for rendering:

```bash
# Ubuntu/Debian
sudo apt install libvulkan1 vulkan-tools vulkan-validationlayers

# Fedora
sudo dnf install vulkan-loader vulkan-tools vulkan-validation-layers

# Arch
sudo pacman -S vulkan-icd-loader vulkan-tools vulkan-validation-layers
```

Verify Vulkan works:

```bash
vulkaninfo | grep "deviceName"
```

You should see your GPU listed.

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

The first build will take 10-20 minutes as dependencies compile.

::: info
**Debug vs Release**

Use `--release` for normal use. Omit it for faster compile times during development, but expect slower runtime performance.
:::

## Running Pulsar

Launch the editor:

```bash
cargo run --release
```

Or run the binary directly:

```bash
./target/release/pulsar
```

## Known Linux-Specific Issues

### Wayland vs X11

Pulsar currently works best under X11. If you're using Wayland, you may need to force X11 mode:

```bash
# Force X11 for current session
export WAYLAND_DISPLAY=
cargo run --release
```

Or use XWayland.

### HiDPI Scaling

If UI elements appear too small or too large:

```bash
# Set scale factor (adjust value as needed)
export WINIT_X11_SCALE_FACTOR=1.5
cargo run --release
```

### Missing Libraries

If you see errors about missing `.so` files, check what's missing:

```bash
ldd target/release/pulsar
```

Install any libraries marked as "not found" using your package manager.

### GPU Driver Issues

**NVIDIA:**
```bash
# Install proprietary drivers
sudo ubuntu-drivers autoinstall
```

**AMD:**
```bash
# Mesa should work out of the box
# If not, install:
sudo apt install mesa-vulkan-drivers
```

**Intel:**
```bash
sudo apt install intel-media-va-driver
```

## Optional: Add to PATH

To run Pulsar from anywhere:

```bash
# Add to ~/.bashrc or ~/.zshrc
export PATH="$PATH:$HOME/Projects/Pulsar-Native/target/release"

# Reload shell
source ~/.bashrc  # or ~/.zshrc
```

## Keeping Updated

Pull latest changes:

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

## Troubleshooting

### "error: linker `cc` not found"

Install build essentials:

```bash
sudo apt install build-essential  # Ubuntu/Debian
sudo dnf install gcc gcc-c++       # Fedora
sudo pacman -S base-devel          # Arch
```

### Slow Compilation

Reduce parallel jobs if running out of memory:

```bash
cargo build --release -j 2
```

Or use `cargo check` for faster iteration without full compilation:

```bash
cargo check
```

### Permission Errors

Make sure you're not running from a root-owned directory:

```bash
ls -la Pulsar-Native
# Should show your username, not root
```

### Graphics Initialization Failed

1. Verify Vulkan works: `vulkaninfo`
2. Update graphics drivers
3. Check `~/.local/share/vulkan/` for configuration issues

## Next Steps

Now that Pulsar is installed, check out the [Quick Start Guide](../quick-start) to learn the editor and create your first project.

For Linux-specific questions, join the [Discord community](https://discord.gg/5eAKDC53SX) or search [GitHub issues](https://github.com/Far-Beyond-Pulsar/Pulsar-Native/issues) for known problems.
