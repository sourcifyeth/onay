// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser;
mod chain;
mod channel;
mod host_manifest;
mod link;
mod peer;
mod store;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{
    AppHandle, Emitter, Manager, State, UserAttentionType, WebviewUrl, WebviewWindowBuilder,
};

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
fn add_request(
    link: State<'_, LinkState>,
    method: String,
    params: serde_json::Value,
    signed: bool,
) -> Result<(), String> {
    let link = link
        .inner()
        .as_ref()
        .map_err(|_| "the link is not running")?;
    link.add_request(method, params, signed)
}

#[tauri::command]
fn dismiss_request(link: State<'_, LinkState>, connection: u64, id: String) {
    if let Ok(link) = link.inner() {
        link.dismiss_request(connection, &id);
    }
}

/// The directory of the end-to-end tests. The app keeps its key store,
/// its socket, its Helios data, and the storage of the page there, and
/// writes no host manifest, so a test run touches nothing of the
/// installed app.
#[cfg(feature = "e2e")]
fn e2e_dir() -> Option<PathBuf> {
    std::env::var_os("ONAY_E2E_DIR").map(PathBuf::from)
}

#[cfg(not(feature = "e2e"))]
fn e2e_dir() -> Option<PathBuf> {
    None
}

/// Where the app keeps its files.
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    match e2e_dir() {
        Some(dir) => Ok(dir),
        None => app
            .path()
            .app_data_dir()
            .map_err(|err| format!("cannot find the app data directory: {err}")),
    }
}

/// Registers the relay with the browsers and starts to listen. Without the
/// key store or the socket there is no link, and the window shows why.
fn start_link(app: &AppHandle) -> LinkState {
    let data_dir = data_dir(app).map_err(|err| vec![err])?;
    let store = Store::open(&data_dir).map_err(|err| {
        vec![format!(
            "cannot open the key store in {}: {err}",
            data_dir.display()
        )]
    })?;

    let mut setup = Setup {
        socket: e2e_dir().map_or_else(onay_ipc::socket_path, |dir| dir.join("onay.sock")),
        ..Setup::default()
    };
    // A second instance stops here, before it points the browsers at its
    // own relay.
    let listener = link::bind(&setup.socket).map_err(|err| {
        vec![format!(
            "cannot listen on {}: {err}",
            setup.socket.display()
        )]
    })?;
    match link::relay_path() {
        Ok(relay) => {
            if e2e_dir().is_none() {
                setup.manifests = host_manifest::install(&relay);
            }
            setup.relay = Some(relay);
        }
        Err(err) => setup
            .errors
            .push(format!("cannot locate the relay binary: {err}")),
    }

    let relay = setup.relay.clone().unwrap_or_default();
    let handle = app.clone();
    let notify = move |notice| {
        if let Err(err) = handle.emit(CHANGED_EVENT, ()) {
            eprintln!("onay: cannot report to the webview: {err}");
        }
        let Some(window) = handle.get_webview_window("main") else {
            return;
        };
        match notice {
            Notice::NewRequest => {
                let _ = window.unminimize();
                let _ = window.request_user_attention(Some(UserAttentionType::Informational));
            }
            // The desktop may refuse the focus and mark the window instead.
            Notice::Focus => {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            Notice::Changed => {}
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
            // The window is built here, not in the config, so that the
            // User-Agent takes the version from the one place it is set.
            let agent = format!(
                "Onay/{} (+https://github.com/sourcifyeth/onay)",
                app.package_info().version
            );
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Onay")
                .inner_size(960.0, 720.0)
                .user_agent(&agent);
            // The page's own storage goes with the rest of the test's files.
            if let Some(dir) = e2e_dir() {
                window = window.data_directory(dir.join("webview"));
            }
            window.build()?;
            app.manage(start_link(app.handle()));
            let helios_dir = data_dir(app.handle())?.join("helios");
            app.manage(chain::Chains::new(helios_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            link_state,
            answer_pairing,
            add_request,
            dismiss_request,
            chain::start_chain,
            chain::stop_chain,
            chain::chain_ready,
            chain::chain_request,
            browser::open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Onay app");
}
