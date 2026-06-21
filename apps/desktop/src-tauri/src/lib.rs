use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// The Node server runs as a sidecar process. We keep its handle so it can be
/// killed when the app exits (otherwise it would outlive the window).
struct ServerProcess(Mutex<Option<CommandChild>>);

// Only used by the dev branch of agent_binary() below.
#[cfg(all(debug_assertions, target_arch = "aarch64"))]
const NODE_ARCH: &str = "arm64";
#[cfg(all(debug_assertions, target_arch = "x86_64"))]
const NODE_ARCH: &str = "x64";

/// macOS Keychain service name for stored credentials.
const KEYRING_SERVICE: &str = "com.forma.app";
/// Credential keys we look up and the env var each maps to for the server.
const CREDENTIAL_KEYS: [(&str, &str); 3] = [
    ("anthropic_base_url", "ANTHROPIC_BASE_URL"),
    ("anthropic_auth_token", "ANTHROPIC_AUTH_TOKEN"),
    ("anthropic_api_key", "ANTHROPIC_API_KEY"),
];

/// Absolute path to the native `claude` binary the agent SDK spawns.
/// In dev it lives in the repo's node_modules; in a bundled app it's shipped as
/// a sidecar next to the main executable (Tauri strips the target-triple suffix).
fn agent_binary() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let p = PathBuf::from(format!(
            "{}/../../../node_modules/@anthropic-ai/claude-agent-sdk-darwin-{}/claude",
            env!("CARGO_MANIFEST_DIR"),
            NODE_ARCH
        ));
        std::fs::canonicalize(&p).unwrap_or(p)
    }
    #[cfg(not(debug_assertions))]
    {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("claude")))
            .unwrap_or_else(|| PathBuf::from("claude"))
    }
}

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("config.json"))
}

fn saved_vault(app: &AppHandle) -> Option<String> {
    let raw = fs::read_to_string(config_file(app)?).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get("vault")?.as_str().map(|s| s.to_string())
}

fn save_vault(app: &AppHandle, vault: &str) {
    if let Some(path) = config_file(app) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(path, serde_json::json!({ "vault": vault }).to_string());
    }
}

/// Resolve the vault folder: a saved choice, otherwise prompt once on first run
/// (falling back to ~/FormaVault if the user cancels). The path is persisted.
fn resolve_vault(app: &AppHandle) -> String {
    if let Some(v) = saved_vault(app) {
        return v;
    }
    let default = app
        .path()
        .home_dir()
        .map(|h| h.join("FormaVault"))
        .unwrap_or_else(|_| PathBuf::from("FormaVault"));

    let picked = app
        .dialog()
        .file()
        .set_title("Choose or create a folder for your Forma vault")
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok());

    let vault = picked.unwrap_or(default);
    let _ = fs::create_dir_all(&vault);
    let vault = vault.to_string_lossy().to_string();
    save_vault(app, &vault);
    vault
}

/// Credentials stored in the OS keychain, mapped to server env vars. Empty when
/// nothing is stored — the server then falls back to env / ~/.claude settings.
fn keychain_env() -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (key, env) in CREDENTIAL_KEYS {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, key) {
            if let Ok(value) = entry.get_password() {
                if !value.is_empty() {
                    out.push((env.to_string(), value));
                }
            }
        }
    }
    out
}

/// (Re)start the Node server sidecar for the given vault. Kills any running
/// instance first, then injects port / vault / agent-binary / keychain env.
fn build_and_spawn(app: &AppHandle, vault: &str) -> Result<(), String> {
    if let Some(child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
    let claude_bin = agent_binary();
    let mut sidecar = app
        .shell()
        .sidecar("forma-server")
        .map_err(|e| e.to_string())?
        .env("FORMA_PORT", "8787")
        .env("FORMA_VAULT", vault)
        .env("FORMA_SIDECAR", "1")
        .env("FORMA_CLAUDE_BIN", claude_bin.to_string_lossy().to_string());
    for (k, v) in keychain_env() {
        sidecar = sidecar.env(k, v);
    }
    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    app.state::<ServerProcess>().0.lock().unwrap().replace(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    print!("[server] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprint!("[server] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[server] terminated: {payload:?}");
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn get_vault(app: AppHandle) -> String {
    saved_vault(&app).unwrap_or_default()
}

/// Open a native folder picker; returns the chosen path (or null if cancelled).
/// Async + spawn_blocking so the modal dialog never blocks the main thread that
/// is handling this IPC call (a sync command would deadlock the UI).
#[tauri::command]
async fn pick_vault(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose or create a folder for your Forma vault")
            .blocking_pick_folder()
    })
    .await
    .ok()
    .flatten()
    .and_then(|p| p.into_path().ok())
    .map(|p| p.to_string_lossy().to_string())
}

/// Persist the chosen vault so the next launch starts the server with it. The
/// running server switches at runtime via POST /api/vault/switch (no restart).
#[tauri::command]
fn remember_vault(app: AppHandle, path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    save_vault(&app, &path);
    Ok(())
}

/// Restart the server (e.g. to pick up changed credentials).
#[tauri::command]
fn restart_server(app: AppHandle) -> Result<(), String> {
    let vault = saved_vault(&app).ok_or_else(|| "no vault configured".to_string())?;
    build_and_spawn(&app, &vault)
}

/// Store (or clear, when empty) a credential in the OS keychain. Callable from
/// the frontend so a settings screen can manage secrets without plaintext files.
#[tauri::command]
fn store_credential(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    if value.is_empty() {
        let _ = entry.delete_credential();
        Ok(())
    } else {
        entry.set_password(&value).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn credential_present(key: String) -> bool {
    keyring::Entry::new(KEYRING_SERVICE, &key)
        .and_then(|e| e.get_password())
        .map(|v| !v.is_empty())
        .unwrap_or(false)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            store_credential,
            credential_present,
            get_vault,
            pick_vault,
            remember_vault,
            restart_server
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let vault = resolve_vault(&handle);
            build_and_spawn(&handle, &vault).expect("failed to spawn forma-server");
            #[cfg(feature = "devtools")]
            if let Some(w) = app.get_webview_window("main") {
                w.open_devtools();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(child) = app_handle.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
