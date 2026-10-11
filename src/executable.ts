import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ExecutableOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export interface ResolvedExecutable {
  command: string;
  source: string;
}

// Resolve once before spawning so the output identifies the exact binary used.
// An explicit setting never falls back to a different installation.
export async function resolveExecutable(
  configured: string,
  options: ExecutableOptions = {}
): Promise<ResolvedExecutable> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? os.homedir();
  const searched: string[] = [];
  const windows = process.platform === "win32";
  const filename = (name: string): string =>
    windows && path.extname(name) === "" ? `${name}.exe` : name;

  const usable = async (candidate: string): Promise<boolean> => {
    searched.push(candidate);
    try {
      await access(candidate, windows ? constants.F_OK : constants.X_OK);
      return (await stat(candidate)).isFile();
    } catch {
      return false;
    }
  };
  const onPath = async (name: string): Promise<string | undefined> => {
    const pathKey = Object.keys(env).find((key) => windows ? key.toUpperCase() === "PATH" : key === "PATH");
    for (const entry of (pathKey === undefined ? "" : env[pathKey] ?? "").split(path.delimiter)) {
      // Do not implicitly execute a binary from the open project directory.
      const directory = windows ? entry.replace(/^"(.*)"$/, "$1") : entry;
      if (!path.isAbsolute(directory)) continue;
      const candidate = path.join(directory, filename(name));
      if (await usable(candidate)) return candidate;
    }
    return undefined;
  };

  const isPath = path.isAbsolute(configured) || configured.includes("/") || (windows && configured.includes("\\"));
  if (isPath) {
    const candidate = path.resolve(cwd, configured);
    if (await usable(candidate)) return { command: candidate, source: "hyperbricks.executable" };
  } else {
    const command = await onPath(configured);
    if (command !== undefined) return { command, source: "VS Code PATH" };
    if (configured === "hyperbricks") {
      let gobin = env.GOBIN;
      let gopath = env.GOPATH;
      if (!gobin) {
        const go = await onPath("go");
        if (go !== undefined) {
          try {
            // Respect `go env -w` without selecting a workspace toolchain or
            // downloading Go merely to discover an installed executable.
            const result = await execFileAsync(go, ["env", "-json", "GOBIN", "GOPATH"], {
              cwd: os.tmpdir(),
              env: { ...env, GOTOOLCHAIN: "local", GOWORK: "off" },
              timeout: 2000,
              maxBuffer: 65536,
              windowsHide: true
            });
            const values: unknown = JSON.parse(result.stdout);
            if (typeof values === "object" && values !== null) {
              if ("GOBIN" in values && typeof values.GOBIN === "string") gobin = values.GOBIN;
              if ("GOPATH" in values && typeof values.GOPATH === "string") gopath = values.GOPATH;
            }
          } catch {
            // Go need not remain installed to run HyperBricks. The inherited
            // Go environment, or its default bin directory, can still resolve it.
          }
        }
      }
      const goRoot = gopath ? gopath.split(path.delimiter)[0] : path.join(home, "go");
      const directory = gobin || (goRoot ? path.join(goRoot, "bin") : "");
      if (path.isAbsolute(directory)) {
        const candidate = path.join(directory, filename("hyperbricks"));
        if (await usable(candidate)) {
          return { command: candidate, source: gobin ? "Go GOBIN" : gopath ? "Go GOPATH/bin" : "default Go bin directory" };
        }
      }
    }
  }

  throw new Error(
    `Cannot find an executable for ${JSON.stringify(configured)}. ` +
    "Install HyperBricks, or set hyperbricks.executable to its absolute path in Settings. " +
    "VS Code may have a different PATH from your terminal; fully quit and reopen VS Code after changing PATH. " +
    `Checked: ${searched.join(", ") || "no executable directories"}.`
  );
}
