mod db;

use std::fs;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use db::Plan;

/// The open SQLite connection, shared by all commands.
struct Store(Mutex<Connection>);

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
fn load_plan(store: State<'_, Store>) -> Result<Plan, String> {
    let conn = store.0.lock().map_err(err)?;
    db::load(&conn).map_err(err)
}

#[tauri::command]
fn save_plan(store: State<'_, Store>, plan: Plan) -> Result<(), String> {
    let mut conn = store.0.lock().map_err(err)?;
    db::save(&mut conn, &db::sanitize(plan)).map_err(err)
}

/// Asks where to save, then writes the plan as JSON. Returns the path, or None if cancelled.
#[tauri::command]
async fn export_plan(app: AppHandle, plan: Plan) -> Result<Option<String>, String> {
    let Some(file) = app
        .dialog()
        .file()
        .set_title("Export plan")
        .add_filter("Plan (JSON)", &["json"])
        .set_file_name("team-plan.json")
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(err)?;
    let json = serde_json::to_string_pretty(&db::sanitize(plan)).map_err(err)?;
    fs::write(&path, json).map_err(err)?;
    Ok(Some(path.display().to_string()))
}

/// Asks for a JSON file, replaces the stored plan with it and returns the new plan.
/// Accepts files exported by this app or by the original claude.ai artifact.
#[tauri::command]
async fn import_plan(app: AppHandle, store: State<'_, Store>) -> Result<Option<Plan>, String> {
    let Some(file) = app
        .dialog()
        .file()
        .set_title("Import plan")
        .add_filter("Plan (JSON)", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(err)?;
    let text = fs::read_to_string(&path).map_err(err)?;
    let plan: Plan = serde_json::from_str(&text)
        .map_err(|e| format!("this file isn't a plan ({e})"))?;
    let plan = db::sanitize(plan);
    let mut conn = store.0.lock().map_err(err)?;
    db::save(&mut conn, &plan).map_err(err)?;
    db::load(&conn).map(Some).map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("plan.db"))?;
            app.manage(Store(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_plan, save_plan, export_plan, import_plan])
        .run(tauri::generate_context!())
        .expect("error while running Team Allocation");
}
