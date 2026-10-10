# Detached views in Code OSS

This feature branch adds auxiliary OS windows for workbench view containers and independently movable views. It shares the original workbench, workspace services, extension host and editor session. It does not start a second workspace window.

Base: `microsoft/vscode` commit `959031245ebb1fe077e0d512e1397c0ae82006e4` (development version 1.142.0). Branch: `feature/detachable-view-containers`. Windows is the first target; macOS has not been validated.

## Use

Open the Command Palette (F1), then:

- **View: Move View Container to New Window...** — detach Explorer, Search, Source Control, Run and Debug, Extensions, Problems, Output, Debug Console, Terminal, Chat, or a contributed container. A container keeps its existing view instances and their in-memory state.
- **View: Move View to New Window...** — detach an individual subview. Views that allow moving are isolated using VS Code's existing view-move API; closing returns them to their original container. This can recreate that subview, just as a normal move between sidebars does. Extension-managed transient state is only as durable as the extension's normal view-state implementation.
- **View: Move View Container Back to Main Window** — return the container from its child window. The left-arrow button in the child toolbar does the same. Closing the child also returns the container.

These actions are also on view-title context menus. Repeating detach for an already detached container focuses its existing window. You can open several containers at once, resize them and move them between monitors. Existing floating-editor, terminal-editor and chat-editor commands remain available.

Window bounds and detached container IDs are stored per workspace on this machine. Normal application shutdown saves detached windows for reopening. Closing a child alone removes it from the restore list. The main editor retains unsaved editors; detaching does not close or duplicate editors or terminal processes.

## Build and run on Windows

Use a separate checkout. Install Git, the Node version in `.nvmrc` (24.18.0 for this commit), Python, and Visual Studio Build Tools with the C++ desktop workload and Windows SDK required by VS Code's source build. Run these commands in a Developer PowerShell:

```powershell
git clone https://github.com/microsoft/vscode.git vscode-detachable
cd vscode-detachable
git checkout 959031245ebb1fe077e0d512e1397c0ae82006e4
git switch -c feature/detachable-view-containers
# For the final git-format-patch deliverable:
git am C:\path\to\vscode-detachable.patch
npm run install-fast
npm run typecheck-client
npm run build-fast
.\scripts\code.bat --user-data-dir "$env:TEMP\code-oss-detached-profile" --extensions-dir "$env:TEMP\code-oss-detached-extensions" C:\path\to\your\workspace
```

The checkpoint patch is a plain diff and uses `git apply`, not `git am`. The final patch is a git-format-patch with its commit message.

The checkout also contains `.agents/skills/launch/scripts/launch.ps1` for isolated launches and CDP automation. To test extension contributions, first run `npx tsc -p test/fixtures/detached-views`, then add:

```powershell
--extensionDevelopmentPath="$PWD\test\fixtures\detached-views"
```

For an unsigned local Windows x64 product build, the upstream packaging task is:

```powershell
npm run gulp vscode-win32-x64-min
```

It writes the sibling `VSCode-win32-x64` directory. Packaging was not run on Windows in this environment; this is the source build path, not a supplied or verified installer. Native dependencies must be built on the target OS. Keep Code OSS branding and licenses. This branch does not enable Microsoft's Visual Studio Marketplace or add proprietary extensions.

If source dependency installation fails fetching the optional Foundry local-model runtime, its upstream installer supports `FOUNDRY_LOCAL_SKIP_INSTALL=1`. That skips local-model runtime installation; it is not a substitute for the native dependencies needed by the editor. Do not use `--ignore-scripts` for a desktop installation.

## Validation and boundaries

See `detached-views-validation.md` for the checks actually performed. A Windows interactive runner with the above toolchain and two monitors (or equivalent display emulation) is still required to validate Windows titlebars, taskbar/Alt-Tab, focus, per-monitor DPI, keyboard layouts, off-screen recovery, and an installable package.

Known boundaries:

- Non-movable subviews can only detach with their container. Menus explain this instead of bypassing the view's contract.
- These commands apply to registered workbench views/containers, not the Activity Bar, status bar, arbitrary dialogs, notifications, or every embedded widget. Existing editor floating commands handle editor tabs.
- Agents-window layouts do not implement the optional detach capability.
- Extension webviews re-create their iframe when changing windows through VS Code's existing webview claim/release lifecycle. State not saved by the extension can be lost. Test each important extension before depending on it.
- Individual-view movement uses upstream view recreation; it does not promise preservation of every widget's transient selection or unsent input. Moving the whole container is the higher-fidelity path.
- No new drag-to-detach gesture, custom docking grid, or snapped-window grouping is included. Use commands and the return button.
- Main-window navigation remains the editor destination for detached Explorer/SCM views. Floating editor routing keeps upstream semantics.
- Crash recovery, arbitrary extension webviews, actual multi-monitor hardware and Windows/macOS desktop behavior need additional coverage.

## Implementation

`CompositePart` lends an existing composite and its DOM to an auxiliary host and blocks a second main-window instance. `PaneCompositePartService` routes open/focus/close and visibility events. `ViewsService` resolves detached active views and avoids hiding unrelated main-window parts. `DetachedViewsService` owns child windows, toolbars, window-scoped view contexts, leases, duplicate-open suppression and workspace restoration. Returning a lease restores its original document before the child is destroyed. The auxiliary-window CSS copy handles CSSOM-inserted development styles as well as normal stylesheet links.
