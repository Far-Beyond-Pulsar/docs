---
title: "Your First Project"
description: "Create and understand your first Pulsar project"
category: "getting-started"
position: 3
icon: "FolderPlus"
lastUpdated: "2026-01-12"
tags: ["tutorial", "project", "beginner"]
related: ["getting-started/quick-start", "core-concepts/architecture"]
---

## Obtain an Engine Binary

You can obtain an engine binary by cloning the repository and building a stable commit locally or by going to [The Releases Page](https://github.com/Far-Beyond-Pulsar/Pulsar-Native/releases):

```bash
cargo build --release
```

## Launch the Binary

Launching the binary will populate:

```
%AppData%/Pulsar
```

with the default engine themes and configuration, then bring you directly to the **Pulsar Launcher**.

> [!NOTE]
> Your engine launcher may start in **light mode** by default. **DON’T PANIC!**
> To avoid attracting bugs, press `Ctrl + ,` to open the Settings window. From there, you can change the theme at the top to **Default Dark** (or any other theme you prefer).
>
> **Be sure to click `Save`**, then re-launch the engine to ensure all windows update correctly.

> [!WARNING]
> Buttons and features outside the scope of this guide may not work yet. Many parts of the engine are still **very much a WIP**.

<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/2756f9f6-783a-41a5-b174-8aa4bf87f669" />

---

## Navigate to Templates

From the launcher, navigate to the **Templates** section.

<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/c84817fd-8c7e-4240-96c8-17d173979db2" />

---

## Select `Blank Project`

Choose **Blank Project**. The engine will prompt you to select a directory where the template will be cloned.

Once cloning completes, you’ll be asked to configure a new Git remote for pushing changes. The engine will store this as your default remote.

For now, you can safely skip this step due to the limitation below.

> [!NOTE]
> Pulsar stores most assets as **text** and integrates deeply with **Git** throughout the workflow. Collaboration is a first-class goal, and Git is the engine’s primary version control system.

> [!WARNING]
> There is currently a known issue on some platforms where **text input fields may not function correctly**.
> Fixes for this are planned as part of the upcoming **graphics pipeline overhaul**.

<img width="1280" height="720" alt="Project Creation" src="https://github.com/user-attachments/assets/cb82230c-df44-4e1e-9c19-6253255a1bf6" />

---

## The Editor

🎉 **Congrats — you made it!**
Your new project should open automatically. After a short delay, the 3D rendering engine will initialize and begin drawing the game scene.

<img width="1920" height="1115" alt="image" src="https://github.com/user-attachments/assets/e77fd3e5-b115-4cac-8611-3f20ee37cbf3" />

---

## The File Drawer

Most navigation happens through the **File Drawer** in the bottom-left corner of the editor. From here, you can open and edit game assets directly.

<img width="1920" height="1115" alt="image" src="https://github.com/user-attachments/assets/6071e703-c8ef-4740-b27c-bbe54220659f" />

---

## That’s All for Now!

Have fun exploring the different editors and browsing the project files on disk.
Welcome to **Pulsar** — and thanks for checking it out 💫
