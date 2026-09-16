// Unbuffered progress logger shared across the import pipeline. console.log
// on Node routes through stdout which is block-buffered when piped (Tauri
// sidecar) — a stuck transaction can leave its last few logs invisible in
// the buffer. process.stderr on Node is synchronous when piped, so every
// line reaches the parent process immediately. Prefixed for grep-ability
// in the sidecar output.
export function trace(msg: string): void {
  try {
    process.stderr.write(`[imports:trace] ${msg}\n`);
  } catch {
    // Never let logging failure break an import.
  }
}
