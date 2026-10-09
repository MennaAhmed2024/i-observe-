import fs from "node:fs";
import path from "node:path";

/**
 * Read a setting from the repo-root `.env` - the same file the Python service uses.
 *
 * Keeps exactly ONE copy of every secret on this machine: the OpenRouter key lives in
 * `E:\I-observe\.env` (gitignored) and is never duplicated into `web/.env.local`.
 * A real environment variable always wins over the file.
 */
export function envFromRoot(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const file = path.join(path.resolve(process.cwd(), ".."), ".env");
    if (!fs.existsSync(file)) return undefined;
    const line = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    const value = line?.slice(name.length + 1).trim();
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
