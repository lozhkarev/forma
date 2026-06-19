use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// The Node server runs as a sidecar process. We keep its handle so it can be
/// killed when the app exits (otherwise it would outlive the window).
struct ServerProcess(Mutex<Option<CommandChild>>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            // Spawn the bundled forma-server (Node SEA) on a fixed port; the
            // frontend talks to it at http://localhost:8787.
            let sidecar = app
                .shell()
                .sidecar("forma-server")
                .expect("forma-server sidecar not found")
                .env("FORMA_PORT", "8787");
            let (mut rx, child) = sidecar.spawn().expect("failed to spawn forma-server");
            app.state::<ServerProcess>().0.lock().unwrap().replace(child);

            // Surface the server's output in the app's stdout for debugging.
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
