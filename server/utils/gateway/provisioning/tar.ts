import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Minimal ustar writer: just enough to stream a build context directory to the Docker Engine
// `POST /build` endpoint without pulling in an archiving dependency. Regular files and dirs only;
// symlinks/device nodes are not needed by deploy/user-container.
function tarHeader(name: string, mode: number, size: number, type: "0" | "5") {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, Math.min(name.length, 100), "utf8");
  header.write(mode.toString(8).padStart(7, "0") + "\0", 100);
  header.write("0001000\0", 108); // uid
  header.write("0001000\0", 116); // gid
  header.write(size.toString(8).padStart(11, "0") + "\0", 124);
  header.write(
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0") + "\0",
    136,
  );
  header[156] = type.charCodeAt(0);
  header.write("ustar\0" + "00", 257);
  // The chksum field itself is treated as eight spaces while summing.
  header.write("        ", 148);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
  return header;
}

/**
 * Recursively tars a directory tree. Directories get explicit `5` entries; file contents are
 * preserved verbatim. Paths are stored relative to `dir` using POSIX separators.
 */
export function tarTree(dir: string): Buffer {
  const chunks: Buffer[] = [];
  const walk = (current: string, prefix: string) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        chunks.push(tarHeader(`${name}/`, 0o755, 0, "5"));
        walk(absolute, name);
      } else if (entry.isFile()) {
        const data = readFileSync(absolute);
        chunks.push(tarHeader(name, 0o644, data.length, "0"), data);
        const pad = (512 - (data.length % 512)) % 512;
        if (pad > 0) chunks.push(Buffer.alloc(pad));
      }
    }
  };
  walk(dir, "");
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

export function tarDirectory(dir: string): Buffer {
  const chunks: Buffer[] = [];
  const addEntry = (absPath: string, relName: string) => {
    const stat = statSync(absPath);
    if (stat.isDirectory()) {
      chunks.push(tarHeader(relName.replace(/\/*$/, "") + "/", stat.mode & 0o777, 0, "5"));
      for (const child of readdirSync(absPath)) {
        addEntry(path.join(absPath, child), `${relName}/${child}`.replace(/^\.\//, ""));
      }
    } else if (stat.isFile()) {
      const data = readFileSync(absPath);
      chunks.push(tarHeader(relName.replace(/^\.\//, ""), stat.mode & 0o777, data.length, "0"));
      chunks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
    }
  };
  for (const entry of readdirSync(dir)) {
    addEntry(path.join(dir, entry), entry);
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}
