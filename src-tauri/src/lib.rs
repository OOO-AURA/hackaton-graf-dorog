mod check;
mod net;
mod sim;

use std::fs;
use std::path::PathBuf;

/// Downloads map data for the area loader; see net.rs for why this is not done in the web view.
#[tauri::command]
async fn http_request(url: String, form: Option<String>) -> Result<net::HttpReply, String> {
    tauri::async_runtime::spawn_blocking(move || net::request(&url, form.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

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

/// Exports the graph as a SUMO network through netconvert.
#[tauri::command]
async fn export_sumo(path: PathBuf, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sim::export_net(&text, &path))
        .await
        .map_err(|e| e.to_string())?
}

/// Micro level: SUMO run on the current graph, played back in the app.
#[tauri::command]
async fn simulate(text: String, minutes: u32, demand: Option<sim::Demand>, extras: Option<sim::Extras>) -> Result<sim::SimResult, String> {
    tauri::async_runtime::spawn_blocking(move || sim::simulate(&text, minutes, demand, extras))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn sumo_status() -> sim::SumoStatus {
    tauri::async_runtime::spawn_blocking(sim::sumo_status).await.unwrap_or_else(|_| sim::sumo_status())
}

/// Quits for real once the front end has confirmed that unsaved edits may be dropped.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

const QUIT_ID: &str = "graf-quit";

/// The stock Quit item terminates the process directly on macOS, past every guard.
/// Swap it for our own item that asks the front end first. Other platforms have no app menu.
#[cfg(target_os = "macos")]
fn install_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app)?;
    for top in menu.items()? {
        let MenuItemKind::Submenu(sub) = top else { continue };
        for item in sub.items()? {
            if let MenuItemKind::Predefined(p) = &item {
                if p.text()?.starts_with("Quit") {
                    sub.remove(p)?;
                    let quit = MenuItem::with_id(app, QUIT_ID, p.text()?, true, Some("CmdOrCtrl+Q"))?;
                    sub.append(&quit)?;
                }
            }
        }
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Emitter, Manager};
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![http_request, read_osm, write_osm, check_osm, simulate, export_sumo, sumo_status, quit_app])
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            install_menu(_app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == QUIT_ID {
                let _ = app.emit("quit-requested", ());
            }
        })
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
