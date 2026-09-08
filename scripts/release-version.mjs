import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const targets = [
  {
    path: "package.json",
    read: (text) => JSON.parse(text).version,
    pattern: /^(\s*"version":\s*")([^"]+)(")/m,
  },
  {
    path: "src-tauri/tauri.conf.json",
    read: (text) => JSON.parse(text).version,
    pattern: /^(\s*"version":\s*")([^"]+)(")/m,
  },
  {
    path: "src-tauri/Cargo.toml",
    pattern: /^(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m,
  },
  {
    path: "src-tauri/Cargo.lock",
    pattern: /^(name = "flickterm"\r?\nversion = ")([^"]+)(")/m,
  },
];

const [command, rawVersion] = process.argv.slice(2);

switch (command) {
  case "check":
    check(rawVersion);
    break;
  case "set":
    set(rawVersion);
    break;
  default:
    console.error(
      [
        "Usage:",
        "  node scripts/release-version.mjs check [version]",
        "  node scripts/release-version.mjs set <version>",
        "",
        "A leading \"v\" (for example v0.2.19) is accepted and stripped.",
      ].join("\n"),
    );
    process.exit(2);
}

function check(rawExpected) {
  const expected = rawExpected === undefined ? undefined : normalize(rawExpected);
  const current = targets.map((target) => ({
    path: target.path,
    version: readVersion(target),
  }));
  const baseline = expected ?? current[0].version;
  const mismatches = current.filter((entry) => entry.version !== baseline);

  for (const entry of current) {
    console.log(`${entry.path}: ${entry.version}`);
  }

  if (mismatches.length > 0) {
    console.error(
      expected === undefined
        ? `Version mismatch between version files (expected all to be ${baseline}).`
        : `Version mismatch: expected ${expected} in every version file.`,
    );
    console.error(`Run "pnpm version:set ${baseline}" to align them.`);
    process.exit(1);
  }

  console.log(`All version files are ${baseline}.`);
}

function set(rawVersion) {
  if (rawVersion === undefined) {
    console.error("Missing version. Usage: node scripts/release-version.mjs set <version>");
    process.exit(2);
  }
  const version = normalize(rawVersion);

  for (const target of targets) {
    const file = resolve(root, target.path);
    const text = readFileSync(file, "utf8");
    if (!target.pattern.test(text)) {
      throw new Error(`Could not locate the version field in ${target.path}`);
    }
    const updated = text.replace(target.pattern, `$1${version}$3`);
    if (updated !== text) {
      writeFileSync(file, updated);
    }
    console.log(`${target.path}: ${version}`);
  }
}

function readVersion(target) {
  const text = readFileSync(resolve(root, target.path), "utf8");
  const version = target.read ? target.read(text) : text.match(target.pattern)?.[2];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`Could not read the version from ${target.path}`);
  }
  return version;
}

function normalize(rawVersion) {
  const version = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion;
  if (!semverPattern.test(version)) {
    console.error(`Invalid version "${rawVersion}". Expected X.Y.Z (optionally prefixed with "v").`);
    process.exit(2);
  }
  return version;
}
