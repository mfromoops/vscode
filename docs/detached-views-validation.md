# Detached views validation

Validated on 2026-10-10 against base `959031245ebb1fe077e0d512e1397c0ae82006e4` in a separate Linux source checkout. No Windows installer or release has been produced.

## Automated checks

- `npm run build-fast`: passed the full source build, including extensions. Subsequent implementation changes passed `npm run build-fast -- --client-only`.
- `npm run typecheck-client`: passed after the final source changes.
- ESLint on all ten changed TypeScript files: passed.
- `npx tsc -p test/fixtures/detached-views`: passed. The fixture was originally exercised as CommonJS and then converted to TypeScript to satisfy the repository hook.
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/vscode-detachable-browsers npm run test-browser-no-install -- --browser chromium --run src/vs/workbench/test/browser/parts/compositePart.test.ts --grep CompositePart`: three passing tests. Coverage includes disposal of composite scopes, duplicate-detach rejection, focusing the leased composite, three repeated cross-document detach/return cycles with the same composite instance, idempotent lease release, and host release when removing a composite.
- `git diff --check`: passed.

The unit test runner printed one resource connection-reset message after reporting three passing tests; its exit status was zero.

## Actual desktop checks

Ran the compiled Code OSS application using Electron 43.7.7 on a Linux Xorg dummy display, with an isolated profile, extension directory and fixture workspace. Playwright connected to Electron's CDP endpoint; this was a native Electron process, not just a browser preview. The environment required `--no-sandbox --disable-gpu`. This configuration does not validate production GPU rendering or OS sandbox behavior.

The following containers rendered in auxiliary windows and returned through the toolbar button or child-window close: Explorer, Search, Source Control, Run and Debug, Extensions, Problems, Output, Debug Console, Terminal, Chat, and the contributed Detached Fixture. Explorer opened the fixture file in the original main editor. Search accepted a query. Chat rendered its input without making a model request. Debug Console became available after the upstream open-source JS debugger built-in extension was downloaded. These checks verify window/container lifecycle and basic rendering, not every action in each view.

The fixture extension supplies a tree and a stateful webview. Both rendered in a detached container. An individual Fixture Webview then detached into a generated container and returned beside the original tree; the draft saved with the webview state API remained visible after return. Other extensions may have different state and DOM assumptions.

A detached Output window survived a full main Electron process shutdown and relaunch with the same profile/workspace. Its persisted entry contained bounds and zoom. After restoration, the return button moved it back successfully. Closing the child and then the application cleared the saved detached-window list.

The desktop automation used CDP focus emulation per target window because the dummy display lacked a fully functioning window manager. It therefore does not establish native Windows keyboard focus, Alt-Tab, taskbar, screen-reader, keyboard-layout, or per-monitor DPI correctness. The browser smoke test separately verified Explorer detach/return and stylesheet cloning with no captured page errors.

## Remaining validation

- Windows is the first requested target. A Windows interactive runner and native build toolchain are still needed; macOS is also untested.
- No physical multi-monitor, mixed DPI, off-screen recovery, snapped-window, accessibility or packaging validation.
- No exhaustive command/keybinding matrix, unsaved-editor shutdown/veto, crash recovery, terminal process I/O continuity, debug session continuity, or arbitrary third-party extension coverage.
- Linux native-keymap could not build because X11/xkbfile development headers were missing. The root native rebuild also encountered a cpu-features/NAN compatibility error; SQLite was rebuilt separately and the application launched. These are source-build environment limitations, not a completed production dependency installation.
- The optional Foundry runtime download was skipped through its supported `FOUNDRY_LOCAL_SKIP_INSTALL=1` flag. Chat/local-model inference was not tested.
- Development logs contained disposable-tracker warnings originating in timer/window and storage stacks. The targeted ownership/disposal tests passed, but the full application has not been established leak-free.

## Reproduction fixture

Build using `docs/detached-views.md`, compile the fixture with `npx tsc -p test/fixtures/detached-views`, then launch with `--extensionDevelopmentPath=<checkout>/test/fixtures/detached-views`. Open **View: Show Detached Fixture**. Type a draft into Fixture Webview, detach either its full container or the individual view, and return it using the left arrow. Repeat with the built-in view containers. Leave Output detached, close the whole application, and relaunch the same workspace/profile to check restoration. Close Output alone and relaunch to verify it stays attached.

Use a disposable workspace/profile for these checks. Native debugger extensions must be installed for Debug Console to appear. Extension views that disallow movement can only detach with their container.
