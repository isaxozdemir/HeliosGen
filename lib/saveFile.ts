/**
 * Saving bytes to the user's disk, from both the browser and the desktop shell.
 *
 * The browser trick — an `<a download>` pointed at a blob URL — is silently
 * inert inside the desktop webview: WKWebView has no download handling of its
 * own, so the click resolves to nothing and the file never appears. There the
 * save has to go through Tauri's dialog + fs plugins instead (registered in
 * `src-tauri/src/lib.rs`, scoped in `src-tauri/capabilities/default.json`).
 *
 * Both paths are kept because `next dev` in a real browser has no Tauri API.
 */

/** True when running inside the Tauri webview rather than a plain browser. */
function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Suggest a save directory based on what the file is. */
function defaultDir(filename: string): "download" | "video" | "picture" {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "picture";
  return "download";
}

/**
 * Write `blob` to disk as `filename`, prompting for a location on desktop.
 *
 * Resolves `true` when the bytes were written, `false` when the user dismissed
 * the save dialog. Throws if the write itself fails.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  if (isDesktop()) {
    const [{ save }, { writeFile }, dirs] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
    ]);

    // Seed the dialog with a sensible folder; if the OS won't give us one,
    // let the dialog fall back to wherever it was last pointed.
    let dir: string | undefined;
    try {
      const which = defaultDir(filename);
      dir =
        which === "video"   ? await dirs.videoDir()
      : which === "picture" ? await dirs.pictureDir()
      :                       await dirs.downloadDir();
    } catch {
      dir = undefined;
    }

    const path = await save({ defaultPath: dir ? `${dir}/${filename}` : filename });
    if (!path) return false; // user cancelled

    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return true;
}

/**
 * Fetch an asset through `/api/download` and save it. Returns `false` if the
 * user cancelled the save dialog; throws if the fetch or the write failed.
 */
export async function downloadAsset(url: string, filename: string): Promise<boolean> {
  const resp = await fetch(`/api/download?url=${encodeURIComponent(url)}&filename=${filename}`);
  if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
  return saveBlob(await resp.blob(), filename);
}
