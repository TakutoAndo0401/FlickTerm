import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    throw new Error(`Invalid argument at position ${index}: ${key ?? ""}`);
  }
  args.set(key.slice(2), value);
}

const artifact = required("artifact");
const signatureFile = required("signature");
const platform = required("platform");
const repository = required("repository");
const tag = required("tag");
const output = args.get("output") ?? "latest.json";
const version = tag.startsWith("v") ? tag.slice(1) : tag;
const signature = readFileSync(signatureFile, "utf8").trim();
const artifactName = basename(artifact);

const latest = {
  version,
  notes: `FlickTerm ${tag}`,
  pub_date: new Date().toISOString(),
  platforms: {
    [platform]: {
      signature,
      url: `https://github.com/${repository}/releases/download/${tag}/${artifactName}`
    }
  }
};

writeFileSync(output, `${JSON.stringify(latest, null, 2)}\n`);

function required(name) {
  const value = args.get(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}
