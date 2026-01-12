---
title: "Windows Installation"
description: "Complete installation guide for Windows 10 and 11"
category: "installation"
position: 1
icon: "MonitorSmartphone"
lastUpdated: "2026-01-12"
tags: ["installation", "windows", "setup"]
---

# Windows Installation

Welcome to the Pulsar Engine installation guide for Windows! This guide will walk you through everything you need to get up and running with Pulsar on Windows 10 or Windows 11.

## Prerequisites

Before installing Pulsar Engine, make sure your system meets these requirements:

- **Operating System**: Windows 10 (version 1909 or later) or Windows 11
- **RAM**: 8GB minimum, 16GB recommended for larger projects
- **Disk Space**: 2GB for the engine and tools, plus space for your projects
- **Graphics**: DirectX 11 compatible GPU (DirectX 12 recommended)
- **Visual Studio**: 2019 or later (Community Edition works fine)

## Installation Methods

You have two ways to install Pulsar Engine on Windows: using the installer or building from source. We'll cover both methods.

### Method 1: Using the Installer (Recommended)

The installer is the fastest way to get started and includes everything you need:

1. **Download the Installer**
   - Visit the [Pulsar Engine downloads page](https://pulsar-engine.dev/downloads)
   - Download the latest Windows installer (`.exe` file)
   - The installer is typically around 150MB

2. **Run the Installer**
   - Double-click the downloaded `.exe` file
   - If Windows SmartScreen appears, click "More info" then "Run anyway"
   - Click "Yes" when prompted by User Account Control

3. **Choose Installation Options**
   - **Installation Path**: Default is `C:\Program Files\Pulsar Engine\`
   - **Components**: 
     - ✅ Pulsar Engine Core (required)
     - ✅ Pulsar Editor (recommended)
     - ✅ Visual Studio Integration (if VS detected)
     - ⬜ Documentation (optional, can view online)
     - ⬜ Example Projects (recommended for beginners)

4. **Complete Installation**
   - Click "Install" and wait for the process to complete
   - The installer will automatically add Pulsar to your PATH
   - Click "Finish" when done

5. **Verify Installation**
   - Open a new Command Prompt or PowerShell window
   - Run: `pulsar --version`
   - You should see the version number (e.g., `Pulsar Engine v0.6.0`)

### Method 2: Building from Source

If you want the latest development features or plan to contribute to Pulsar, building from source gives you more control:

1. **Install Git**
   - Download from [git-scm.com](https://git-scm.com/download/win)
   - During installation, select "Git from the command line and also from 3rd-party software"

2. **Install CMake**
   - Download from [cmake.org](https://cmake.org/download/)
   - Choose the Windows installer (`.msi` file)
   - During installation, select "Add CMake to the system PATH"

3. **Install Visual Studio**
   - Download Visual Studio Community from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/)
   - Run the installer and select these workloads:
     - Desktop development with C++
     - Game development with C++
   - Make sure these individual components are checked:
     - MSVC v143 (or latest)
     - Windows 10/11 SDK
     - C++ CMake tools for Windows

4. **Clone the Repository**
   ```bash
   git clone https://github.com/pulsar-engine/pulsar-native.git
   cd pulsar-native
   git submodule update --init --recursive
   ```

5. **Build Pulsar**
   - Open "Developer Command Prompt for VS 2022" from Start menu
   - Navigate to the cloned repository
   - Run the build script:
   ```bash
   mkdir build
   cd build
   cmake .. -G "Visual Studio 17 2022" -A x64
   cmake --build . --config Release
   ```

6. **Install Locally**
   ```bash
   cmake --install . --prefix "C:\Program Files\Pulsar Engine"
   ```

7. **Add to PATH**
   - Open System Properties → Environment Variables
   - Under "System variables", find "Path" and click "Edit"
   - Click "New" and add: `C:\Program Files\Pulsar Engine\bin`
   - Click "OK" on all dialogs

8. **Verify Build**
   - Open a new Command Prompt
   - Run: `pulsar --version`

## Setting Up Visual Studio Integration

Pulsar includes tight integration with Visual Studio for C++ scripting:

1. **Install the Extension**
   - If you used the installer, the extension is already installed
   - If building from source, find `PulsarVSExtension.vsix` in `build/tools/`
   - Double-click to install

2. **Configure the Extension**
   - Open Visual Studio
   - Go to Tools → Options → Pulsar Engine
   - Set "Engine Path" to your installation directory
   - Enable "Auto-generate project files" if desired

3. **Test the Integration**
   - Create a new Pulsar project from the Editor
   - In Visual Studio, go to File → Open → Project/Solution
   - Navigate to your project folder and open the `.sln` file
   - You should see syntax highlighting and IntelliSense for Pulsar APIs

## Graphics API Setup

Pulsar on Windows supports both DirectX 11 and DirectX 12:

### DirectX 11 (Default)
DirectX 11 is included with Windows 10/11, so no additional setup is needed. This is the default renderer and works on all systems.

### DirectX 12 (Recommended)
For better performance and modern features:

1. **Update Windows**
   - Go to Settings → Update & Security → Windows Update
   - Install all available updates
   - DirectX 12 is included in Windows 10 1909+ and all Windows 11 versions

2. **Update Graphics Drivers**
   - **NVIDIA**: Download from [nvidia.com/drivers](https://www.nvidia.com/drivers)
   - **AMD**: Download from [amd.com/support](https://www.amd.com/support)
   - **Intel**: Download from [intel.com/content/www/us/en/support](https://www.intel.com/content/www/us/en/support)

3. **Enable DX12 in Pulsar**
   - Open the Pulsar Editor
   - Go to Edit → Project Settings → Renderer
   - Change "Graphics API" to "DirectX 12"
   - Restart the editor

## Common Installation Issues

### Issue: "VCRUNTIME140.dll was not found"

**Solution**: Install the Visual C++ Redistributable:
- Download from [Microsoft's support site](https://support.microsoft.com/en-us/help/2977003/the-latest-supported-visual-c-downloads)
- Install both x64 and x86 versions
- Restart your computer

### Issue: "The code execution cannot proceed because MSVCP140.dll was not found"

**Solution**: Same as above - install Visual C++ Redistributable.

### Issue: Installer fails with "Access denied"

**Solution**: 
- Right-click the installer and select "Run as administrator"
- If that doesn't work, try installing to a different location (e.g., `C:\Pulsar\`)

### Issue: Command `pulsar` not recognized

**Solution**: 
- The PATH wasn't updated properly
- Manually add the installation directory to your PATH (see "Add to PATH" in Method 2)
- Make sure to open a *new* Command Prompt after adding to PATH

### Issue: Build fails with CMake errors

**Solution**: 
- Ensure CMake version is 3.16 or higher: `cmake --version`
- Make sure you're using "Developer Command Prompt for VS" not regular Command Prompt
- Delete the `build` folder and try again with clean build

### Issue: "Cannot open include file: 'pulsar/core.h'"

**Solution**: 
- Pulsar SDK wasn't installed correctly
- Re-run the installer or `cmake --install` step
- Verify `C:\Program Files\Pulsar Engine\include` exists and contains headers

## Post-Installation Steps

After installation, we recommend:

1. **Run the Verification Script**
   ```bash
   pulsar verify-install
   ```
   This checks that all components are installed correctly.

2. **Set Up Your First Project**
   - Follow the [First Project guide](/docs/getting-started/first-project) to create your first Pulsar game
   - Or run: `pulsar create MyFirstGame` to generate a starter project

3. **Explore Example Projects**
   - If you installed examples, find them in `Documents\Pulsar Engine\Examples\`
   - Open them in the Pulsar Editor to see how things work

4. **Join the Community**
   - Check out the [Discord server](https://discord.gg/pulsar-engine) for help
   - Browse the [forums](https://forums.pulsar-engine.dev) for tutorials and tips

## Updating Pulsar

To update to a newer version of Pulsar Engine:

### If Installed via Installer:
1. Download the latest installer
2. Run it - it will detect the existing installation
3. Choose "Update" when prompted
4. Your projects and settings will be preserved

### If Built from Source:
```bash
cd pulsar-native
git pull
git submodule update --recursive
cd build
cmake --build . --config Release
cmake --install . --prefix "C:\Program Files\Pulsar Engine"
```

## Uninstallation

If you need to remove Pulsar Engine:

### If Installed via Installer:
- Go to Settings → Apps → Apps & features
- Find "Pulsar Engine" in the list
- Click "Uninstall" and follow the prompts

### If Built from Source:
- Delete the installation directory (e.g., `C:\Program Files\Pulsar Engine\`)
- Remove the PATH entry (System Properties → Environment Variables)
- Delete the CMake build directory in your source folder

Your projects are stored separately in `Documents\Pulsar Engine\Projects\` and won't be deleted automatically.

## Next Steps

Now that Pulsar Engine is installed, you're ready to start creating! We recommend:

1. **[Quick Start Guide](/docs/getting-started/quick-start)** - Take a tour of the Pulsar Editor
2. **[Your First Project](/docs/getting-started/first-project)** - Build a simple game step-by-step
3. **[Core Concepts](/docs/core-concepts)** - Understand how Pulsar works

Welcome to the Pulsar community! We can't wait to see what you build.
