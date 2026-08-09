import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/**
 * Reads the last bytes of a file without loading the whole thing, discarding a
 * partial leading line so every returned line is complete. Shared by each
 * backend that tails an append-only log.
 */
export function readFileTail(path: string, maxBytes = 512 * 1024): string {
  let file: number | undefined;
  try {
    file = openSync(path, "r");
    const size = fstatSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    readSync(file, buffer, 0, buffer.length, start);
    const content = buffer.toString("utf8");
    if (start === 0) return content;
    const firstNewline = content.indexOf("\n");
    return firstNewline < 0 ? "" : content.slice(firstNewline + 1);
  } catch {
    return "";
  } finally {
    if (file !== undefined) closeSync(file);
  }
}
