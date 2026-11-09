mod check;
mod sim;

use std::fs;
use std::path::PathBuf;

#[tauri::command]
fn read_osm(path: PathBuf) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Не удалось открыть {}: {e}", path.display()))
}

/// Writes through a temp file and a rename so a crash mid-write never leaves a truncated .osm.
#[tauri::command]
fn write_osm(path: PathBuf, text: String) -> Result<(), String> {
    let tmp = path.with_extension("osm.tmp");
    fs::write(&tmp, text).map_err(|e| format!("Не удалось записать {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Не удалось сохранить {}: {e}", path.display()))
}

#[tauri::command]
async fn check_osm(app: tauri::AppHandle, text: String) -> Result<check::Report, String> {
    let java_source = check::matsim_source(&app);
    tauri::async_runtime::spawn_blocking(move || check::run_all(&text, java_source))
        .await
        .map_err(|e| e.to_string())?
}

/// Micro level: SUMO run on the current graph, played back in the app.
#[tauri::command]
async fn simulate(text: String, minutes: u32) -> Result<sim::SimResult, String> {
    tauri::async_runtime::spawn_blocking(move || sim::simulate(&text, minutes))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Quits for real once the front end has confirmed that unsaved edits may be dropped.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

pub fn run() {
    use tauri::{Emitter, Manager};
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_osm, write_osm, check_osm, simulate, quit_app])
        .build(tauri::generate_context!())
        .expect("error while building application")
        .run(|app, event| {
            // Cmd+Q on macOS asks the app to exit without closing the window first, so the
            // window's close guard never runs. Hold the exit and let the front end ask.
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                if !app.webview_windows().is_empty() {
                    api.prevent_exit();
                    let _ = app.emit("quit-requested", ());
                }
            }
        });
}
