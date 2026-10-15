# Team Allocation (desktop)

A desktop version of the team allocation planner, built with Tauri 2 and Rust.
The plan is stored in a local SQLite database on this computer. It works
offline and needs no account.

The planner behaves exactly like the web version: people on the left, a month
(or two or three) of days across the top, and drag-and-drop bookings. Two
buttons are new, **Import** and **Export**, for moving a plan in and out as a
JSON file.

## What you need

- **Rust 1.90.0.** Install from <https://rustup.rs>. The repo's
  `rust-toolchain.toml` pins this version, so rustup installs it for you
  inside this folder.
- **System libraries for Tauri.** These depend on your operating system:
  - **Windows:** Microsoft C++ Build Tools ("Desktop development with C++")
    and WebView2. WebView2 is already present on Windows 10 and 11.
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
  - **Linux (Debian/Ubuntu):**
    ```
    sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
      libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
    ```
  Full list: <https://v2.tauri.app/start/prerequisites/>
- **Tauri CLI.** Use one of these:
  - `cargo install tauri-cli --version "^2" --locked`, or
  - if you have Node.js, `npm install` in this folder (then use `npm run …`
    instead of `cargo tauri …`).

You don't need Node.js otherwise. The interface is plain HTML, CSS and
JavaScript with no build step.

## Run it

```
cargo tauri dev        # or: npm run dev
```

The first build downloads and compiles the Rust dependencies, which takes a few
minutes. Later builds are fast.

## Build an installer

```
cargo tauri build      # or: npm run build
```

The installers end up in `src-tauri/target/release/bundle/`: `.msi`/`.exe`
on Windows, `.dmg`/`.app` on macOS, `.deb`/`.rpm`/`.AppImage` on Linux. Build
on each operating system you want an installer for.

## Bring in your current plan

The plan is not in this repo, because it contains real people's names and
roles. To get it, export the plan from the claude.ai artifact as JSON and
save it as `seed/current-plan.json`. The `seed/` folder is git-ignored, so the
file stays on your machine. Open the app, click **Import**, choose that file,
and confirm. Import replaces whatever is in the app.

## Where the data is kept

A single SQLite file, `plan.db`, in the app's data folder:

| System  | Location |
|---------|----------|
| Windows | `%APPDATA%\com.teamallocation.desktop\plan.db` |
| macOS   | `~/Library/Application Support/com.teamallocation.desktop/plan.db` |
| Linux   | `~/.local/share/com.teamallocation.desktop/plan.db` |

It uses WAL mode, so you may also see `plan.db-wal` and `plan.db-shm` next to
it. Close the app before copying the files. For backups, **Export** is easier:
it writes one JSON file you can keep anywhere and import again later.

Tables:

- `people`: id, name, role, position (the order of rows on screen)
- `projects`: id, name, color, position
- `allocations`: id, person_id, project_id, start_date, end_date (inclusive,
  `YYYY-MM-DD`), load (10–100 %), note

Deleting a person or a project also deletes their bookings.

## How it's put together

```
src/                    The interface (HTML, CSS, JS) and the bundled font
  index.html
  styles.css
  app.js                Same planner code as the web version; only the
                        load/save/import/export functions differ
  fonts/                Hanken Grotesk (SIL Open Font License, see OFL.txt)
src-tauri/
  src/lib.rs            Tauri setup and the four commands the interface calls:
                        load_plan, save_plan, export_plan, import_plan
  src/db.rs             SQLite schema, load/save in one transaction, input
                        clean-up, and unit tests
  tauri.conf.json       Window size, app id, security policy, installer icons
  capabilities/         Tauri permissions for the window
  icons/                App icons
seed/                   Git-ignored. Your exported plan goes here (not in git)
rust-toolchain.toml    Pins the Rust version (1.90.0)
```

Every change in the planner sends the whole plan to `save_plan`, which checks
it (drops bookings that point at missing people or projects, fixes reversed
dates, keeps load within 10–100 %) and writes it in one transaction. This
matches how the web version saved, and with a single user there are no
conflicts to handle.

Run the database tests with:

```
cd src-tauri && cargo test
```

## Changing the app id

`identifier` in `src-tauri/tauri.conf.json` (`com.teamallocation.desktop`)
decides the data folder name. Change it before you start using the app for
real, for example to your company's reverse domain. Changing it later moves
the app to a new, empty data folder; Export first, then Import after.
