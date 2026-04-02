// Cthulhu Desktop Node — Tauri Host
// Manages the Python API sidecar and Kubo IPFS daemon as child processes.

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn start_services(app: tauri::AppHandle) -> Result<String, String> {
    // Start Kubo IPFS daemon
    let kubo = app
        .shell()
        .sidecar("bin/kubo")
        .map_err(|e| format!("Kubo sidecar error: {e}"))?
        .args(["daemon", "--init"]);

    let (_rx_kubo, _child_kubo) = kubo.spawn().map_err(|e| format!("Kubo spawn error: {e}"))?;

    // Start Python API server
    let api = app
        .shell()
        .sidecar("bin/cthulhu-api")
        .map_err(|e| format!("API sidecar error: {e}"))?;

    let (mut rx_api, _child_api) = api.spawn().map_err(|e| format!("API spawn error: {e}"))?;

    // Forward API stdout/stderr to frontend
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx_api.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let _ = app_handle.emit("api-log", String::from_utf8_lossy(&line).to_string());
                }
                CommandEvent::Stderr(line) => {
                    let _ = app_handle.emit("api-error", String::from_utf8_lossy(&line).to_string());
                }
                _ => {}
            }
        }
    });

    Ok("Services started".to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![start_services])
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
        .run(tauri::generate_context!())
        .expect("error running Cthulhu");
}
