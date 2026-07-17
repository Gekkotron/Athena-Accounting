use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

struct SidecarHandle(Mutex<Option<Child>>);

fn sidecar_dir(app: &tauri::AppHandle) -> PathBuf {
    // In production the sidecar/ folder is bundled as a resource; in dev the
    // developer runs `cargo tauri dev` from desktop/src-tauri, and the sidecar
    // lives one level up at ../sidecar.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("sidecar");
        if bundled.join("entry.js").exists() {
            return bundled;
        }
    }
    // Dev fallback: <cargo manifest>/../sidecar
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("desktop/src-tauri has a parent")
        .join("sidecar")
}

fn spawn_sidecar(app: &tauri::AppHandle) -> (Child, u16) {
    let dir = sidecar_dir(app);
    let node_bin = if cfg!(windows) {
        dir.join("node.exe")
    } else {
        dir.join("node")
    };
    let entry = dir.join("entry.js");

    // Point the backend at the platform-standard per-user app-data directory
    // (macOS: ~/Library/Application Support/<bundle-id>/, Linux:
    // ~/.local/share/<bundle-id>/, Windows: %APPDATA%\<bundle-id>\). The
    // sidecar's own cwd is inside the .app resource bundle and is read-only
    // on macOS, so DATA_DIR must be set explicitly.
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("no app data dir available on this platform");
    std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");

    let mut child = Command::new(&node_bin)
        .arg(&entry)
        .current_dir(&dir)
        .env("DATA_DIR", &data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn sidecar");

    let stdout = child.stdout.take().expect("sidecar stdout piped");
    let (tx, rx) = mpsc::channel::<u16>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut sent = false;
        for line in reader.lines().map_while(Result::ok) {
            if !sent {
                if let Some(rest) = line.strip_prefix("ATHENA_PORT=") {
                    if let Ok(port) = rest.trim().parse::<u16>() {
                        let _ = tx.send(port);
                        sent = true;
                    }
                }
            }
            println!("[sidecar] {line}");
        }
    });

    let port = rx
        .recv_timeout(std::time::Duration::from_secs(30))
        .expect("sidecar did not report ATHENA_PORT within 30s");
    (child, port)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let (child, port) = spawn_sidecar(&handle);
            app.manage(SidecarHandle(Mutex::new(Some(child))));

            let url = format!("http://127.0.0.1:{port}/")
                .parse()
                .expect("valid loopback url");
            WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                .title("Athena Accounting")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .resizable(true)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri app")
        .run(|app, event| match event {
            RunEvent::WindowEvent {
                event: WindowEvent::Destroyed,
                ..
            }
            | RunEvent::ExitRequested { .. } => {
                if let Some(state) = app.try_state::<SidecarHandle>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
            _ => {}
        });
}
