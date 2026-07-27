use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
#[cfg(unix)]
use std::time::{Duration, Instant};

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

    let mut cmd = Command::new(&node_bin);
    cmd.arg(&entry)
        .current_dir(&dir)
        .env("DATA_DIR", &data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    // node.exe is a console-subsystem binary: without CREATE_NO_WINDOW it
    // allocates a visible terminal window behind the app on Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().expect("failed to spawn sidecar");

    let stdout = child.stdout.take().expect("sidecar stdout piped");
    enum Startup {
        Port(u16),
        Fatal(String),
    }
    let (tx, rx) = mpsc::channel::<Startup>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut sent = false;
        for line in reader.lines().map_while(Result::ok) {
            if !sent {
                if let Some(rest) = line.strip_prefix("ATHENA_PORT=") {
                    if let Ok(port) = rest.trim().parse::<u16>() {
                        let _ = tx.send(Startup::Port(port));
                        sent = true;
                    }
                } else if let Some(msg) = line.strip_prefix("ATHENA_FATAL=") {
                    let _ = tx.send(Startup::Fatal(msg.to_string()));
                    sent = true;
                }
            }
            println!("[sidecar] {line}");
        }
    });

    let port = match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(Startup::Port(port)) => port,
        Ok(Startup::Fatal(msg)) => panic!("sidecar failed to start: {msg}"),
        Err(_) => panic!("sidecar did not report ATHENA_PORT within 30s"),
    };
    (child, port)
}

// How long to wait for the sidecar to exit on its own after SIGTERM before
// falling back to a hard kill. Only meaningful on unix, where SIGTERM is
// actually sent (see terminate_gracefully below).
#[cfg(unix)]
const SHUTDOWN_GRACE: Duration = Duration::from_secs(15);
#[cfg(unix)]
const POLL_INTERVAL: Duration = Duration::from_millis(100);

// Ask the sidecar to shut down cleanly before resorting to a hard kill.
// The sidecar's own SIGTERM handler (see backend/src/entry/tauri.ts)
// flushes a final encrypted snapshot and finalizes any pending
// enable/disable migration before exiting — a bare kill() (SIGKILL) skips
// straight past all of that, so a window close during an active
// enable-migration session could leave the on-disk state half-finished.
fn terminate_gracefully(mut child: Child) {
    #[cfg(unix)]
    {
        // Avoid pulling in the libc crate just for one syscall — `kill -TERM`
        // via a plain Command does the same thing.
        let sent = Command::new("kill")
            .arg("-TERM")
            .arg(child.id().to_string())
            .status()
            .is_ok();

        if sent {
            let start = Instant::now();
            while start.elapsed() < SHUTDOWN_GRACE {
                match child.try_wait() {
                    // Exited on its own — nothing left to do.
                    Ok(Some(_)) => return,
                    Ok(None) => thread::sleep(POLL_INTERVAL),
                    // Can't determine status; stop waiting and fall through
                    // to the hard kill below.
                    Err(_) => break,
                }
            }
        }
    }
    // Windows has no SIGTERM to send through a plain Command, and the unix
    // path above falls through here if SIGTERM was never delivered or the
    // grace period elapsed without the sidecar exiting.
    let _ = child.kill();
    let _ = child.wait();
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
                    if let Some(child) = state.0.lock().unwrap().take() {
                        terminate_gracefully(child);
                    }
                }
            }
            _ => {}
        });
}
