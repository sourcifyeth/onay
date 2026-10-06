// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chain;
mod channel;
mod host_manifest;
mod link;
mod peer;
mod store;

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State, UserAttentionType};

use link::{Link, Notice, Setup, Snapshot};
use store::Store;

/// The webview reads the link state again when it gets this event.
const CHANGED_EVENT: &str = "link-changed";

/// The running link, or the reasons why it did not start.
type LinkState = Result<Arc<Link>, Vec<String>>;

#[tauri::command]
fn link_state(link: State<'_, LinkState>) -> Result<Snapshot, Vec<String>> {
    match link.inner() {
        Ok(link) => Ok(link.snapshot()),
        Err(errors) => Err(errors.clone()),
    }
}

#[tauri::command]
fn answer_pairing(
    link: State<'_, LinkState>,
    connection: u64,
    approve: bool,
) -> Result<(), String> {
    let link = link
        .inner()
        .as_ref()
        .map_err(|_| "the link is not running")?;
    link.answer_pairing(connection, approve)
}

#[tauri::command]
fn dismiss_request(link: State<'_, LinkState>, connection: u64, id: String) {
    if let Ok(link) = link.inner() {
        link.dismiss_request(connection, &id);
    }
}

/// Registers the relay with the browsers and starts to listen. Without the
/// key store or the socket there is no link, and the window shows why.
fn start_link(app: &AppHandle) -> LinkState {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| vec![format!("cannot find the app data directory: {err}")])?;
    let store = Store::open(&data_dir).map_err(|err| {
        vec![format!(
            "cannot open the key store in {}: {err}",
            data_dir.display()
        )]
    })?;

    let mut setup = Setup {
        socket: onay_ipc::socket_path(),
        ..Setup::default()
    };
    match link::relay_path() {
        Ok(relay) => {
            setup.manifests = host_manifest::install(&relay);
            setup.relay = Some(relay);
        }
        Err(err) => setup
            .errors
            .push(format!("cannot locate the relay binary: {err}")),
    }
    let listener = link::bind(&setup.socket).map_err(|err| {
        vec![format!(
            "cannot listen on {}: {err}",
            setup.socket.display()
        )]
    })?;

    let relay = setup.relay.clone().unwrap_or_default();
    let handle = app.clone();
    let notify = move |notice| {
        if let Err(err) = handle.emit(CHANGED_EVENT, ()) {
            eprintln!("onay: cannot report to the webview: {err}");
        }
        if let (Notice::NewRequest, Some(window)) = (notice, handle.get_webview_window("main")) {
            let _ = window.unminimize();
            let _ = window.request_user_attention(Some(UserAttentionType::Informational));
        }
    };
    let link = Link::new(
        setup,
        store,
        Box::new(move |stream| peer::verify(stream, &relay)),
        Box::new(notify),
    );
    link.listen(listener);
    Ok(link)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(start_link(app.handle()));
            let helios_dir = app.path().app_data_dir()?.join("helios");
            app.manage(tauri::async_runtime::block_on(async {
                chain::Chains::start(&helios_dir)
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            link_state,
            answer_pairing,
            dismiss_request,
            chain::chain_ready,
            chain::chain_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Onay app");
}
