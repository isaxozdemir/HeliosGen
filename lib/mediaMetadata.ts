import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

/** Strip EXIF/IPTC/XMP (images) or metadata tags (video) from a buffer before storage. */
export async function stripMetadata(buffer: Buffer, contentType: string): Promise<Buffer> {
  if (contentType.startsWith("image/")) {
    return sharp(buffer).toBuffer();
  }
  if (contentType.startsWith("video/")) {
    const extension = contentType.includes("webm") ? "webm" : "mp4";
    const tmpDir = await mkdtemp(join(tmpdir(), "strip-meta-"));
    const inputPath  = join(tmpDir, `input.${extension}`);
    const outputPath = join(tmpDir, `output.${extension}`);
    try {
      await writeFile(inputPath, buffer);
      await execFileAsync("ffmpeg", [
        "-i", inputPath,
        "-map_metadata", "-1",
        "-c", "copy",
        "-y", outputPath,
      ]);
      return await readFile(outputPath);
    } catch (e) {
      // ffmpeg isn't bundled with the desktop app (see DESKTOP.md). Without it
      // the video can't be scrubbed, but failing here would abort the whole
      // mirror-to-disk step and leave the generation pointing at kie's 3-day
      // temp URL — which no longer downloads. Keep the bytes; skip the strip.
      console.warn("[strip-metadata] ffmpeg unavailable, storing video as-is:", (e as Error).message);
      return buffer;
    } finally {
      await Promise.all([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {}),
      ]);
    }
  }
  return buffer;
}
