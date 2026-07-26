import { Worker } from 'node:worker_threads';

// Hard-kill the sidecar when its parent (the Tauri shell) dies.
//
// The graceful path — shell kills the child on window close — misses two real
// cases: the shell being force-quit (SIGKILL leaves the child orphaned) and
// the child's own event loop being wedged (a PGlite busy-wait blocks every JS
// signal/exit handler). Both happened in the field on macOS: an orphaned
// sidecar kept the PGlite datadir open at 100% CPU and poisoned the next
// launch.
//
// A worker thread has its own event loop, so it keeps ticking even when the
// main thread is stuck inside WASM, and SIGKILL needs no cooperation from the
// wedged thread. The liveness probe (`kill(pid, 0)`) works on Windows too.
const WATCHDOG_SOURCE = `
const { workerData } = require('node:worker_threads');
const { parentPid, selfPid, intervalMs } = workerData;
const alive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (err) { return err.code === 'EPERM'; }
};
setInterval(() => {
  if (!alive(parentPid)) {
    try { process.kill(selfPid, 'SIGKILL'); } catch { /* already dying */ }
  }
}, intervalMs);
`;

export function startParentWatchdog(intervalMs = 2000): Worker {
  const worker = new Worker(WATCHDOG_SOURCE, {
    eval: true,
    workerData: { parentPid: process.ppid, selfPid: process.pid, intervalMs },
  });
  // Never keep the process alive on its own, and never crash it on error.
  worker.unref();
  worker.on('error', () => {
    /* watchdog is best-effort */
  });
  return worker;
}
