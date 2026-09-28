// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod host_manifest;
mod link;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let status = link::start(app.handle().clone());
            app.manage(status);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![link::status])
        .run(tauri::generate_context!())
        .expect("error while running the Onay app");
}
