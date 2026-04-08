// Cthulhu Desktop Node — Tauri Host
//
// Manages two sidecar processes:
//   1. cthulhu-api  — PyInstaller-frozen FastAPI server on :8001
//   2. kubo         — go-ipfs daemon on :5001
//
// On startup: creates data directories, sets environment variables, launches
// both sidecars, and forwards their output to the frontend via events.
//
// On shutdown: sends SIGTERM (Unix) / taskkill (Windows) to both sidecars
// to ensure clean exit.

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// Store sidecar child processes for graceful shutdown
struct SidecarState {
    api_child: Option<CommandChild>,
    kubo_child: Option<CommandChild>,
}

#[tauri::command]
async fn start_services(app: tauri::AppHandle) -> Result<String, String> {
    // Resolve data directory
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    // Create subdirectories
    let db_dir = data_dir.join("data");
    let ipfs_dir = data_dir.join("ipfs_repo");
    let logs_dir = data_dir.join("logs");

    for dir in [&db_dir, &ipfs_dir, &logs_dir] {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    }

    // ── Start Kubo IPFS daemon ──────────────────────────────────────
    let kubo = app
        .shell()
        .sidecar("bin/kubo")
        .map_err(|e| format!("Kubo sidecar error: {e}"))?
        .env("IPFS_PATH", ipfs_dir.to_string_lossy().to_string())
        .args(["daemon", "--init"]);

    let (mut rx_kubo, child_kubo) = kubo.spawn().map_err(|e| format!("Kubo spawn error: {e}"))?;

    // Forward Kubo logs
    let app_kubo = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx_kubo.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let _ = app_kubo.emit("kubo-log", String::from_utf8_lossy(&line).to_string());
                }
                CommandEvent::Stderr(line) => {
                    let _ =
                        app_kubo.emit("kubo-error", String::from_utf8_lossy(&line).to_string());
                }
                _ => {}
            }
        }
    });

    // ── Start Python API server ─────────────────────────────────────
    let db_path = db_dir.join("cthulhu.db");
    let index_db_path = db_dir.join("p2fk_index.db");

    let api = app
        .shell()
        .sidecar("bin/cthulhu-api")
        .map_err(|e| format!("API sidecar error: {e}"))?
        // Database paths
        .env("CTHULHU_DB_PATH", db_path.to_string_lossy().to_string())
        .env(
            "CTHULHU_INDEX_DB_PATH",
            index_db_path.to_string_lossy().to_string(),
        )
        // IPFS
        .env("IPFS_PATH", ipfs_dir.to_string_lossy().to_string())
        .env("IPFS_API_URL", "http://127.0.0.1:5001")
        // Server config
        .env("CTHULHU_PORT", "8001")
        .env("CTHULHU_HOST", "127.0.0.1")
        // Desktop mode flag
        .env("CTHULHU_DESKTOP", "1")
        // CORS — allow Tauri webview origin
        .env("CORS_ORIGINS", "tauri://localhost,https://tauri.localhost,http://localhost:3000");

    let (mut rx_api, child_api) = api.spawn().map_err(|e| format!("API spawn error: {e}"))?;

    // Forward API logs
    let app_api = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx_api.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let _ = app_api.emit("api-log", String::from_utf8_lossy(&line).to_string());
                }
                CommandEvent::Stderr(line) => {
                    let _ =
                        app_api.emit("api-error", String::from_utf8_lossy(&line).to_string());
                }
                _ => {}
            }
        }
    });

    // Store child processes for shutdown
    let state = app.state::<Mutex<SidecarState>>();
    let mut guard = state.lock().map_err(|e| format!("Lock error: {e}"))?;
    guard.api_child = Some(child_api);
    guard.kubo_child = Some(child_kubo);

    Ok(format!(
        "Services started — data: {}",
        data_dir.display()
    ))
}

#[tauri::command]
async fn stop_services(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<Mutex<SidecarState>>();
    let mut guard = state.lock().map_err(|e| format!("Lock error: {e}"))?;

    if let Some(child) = guard.api_child.take() {
        let _ = child.kill();
    }
    if let Some(child) = guard.kubo_child.take() {
        let _ = child.kill();
    }

    Ok("Services stopped".to_string())
}

#[tauri::command]
async fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(data_dir.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(SidecarState {
            api_child: None,
            kubo_child: None,
        }))
        .invoke_handler(tauri::generate_handler![
            start_services,
            stop_services,
            get_data_dir,
        ])
        .setup(|app| {
            // Auto-start services on app launch
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match start_services(handle).await {
                    Ok(msg) => println!("Cthulhu: {msg}"),
                    Err(e) => eprintln!("Cthulhu startup error: {e}"),
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Graceful shutdown on window close
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = stop_services(app).await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error running Cthulhu");
}
