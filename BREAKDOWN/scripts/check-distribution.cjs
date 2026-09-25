#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

let asar;
try {
  asar = require("@electron/asar");
} catch {
  console.error("[distribution-check] @electron/asar is unavailable; run npm ci first.");
  process.exit(2);
}

const repoRoot = fs.realpathSync(path.resolve(__dirname, ".."));
const rootPackagePath = path.join(repoRoot, "package.json");
const requestedPackageDir = path.resolve(
  process.argv[2] || path.join(repoRoot, "release", "win-unpacked"),
);
const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function realExisting(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  return fs.realpathSync(filePath);
}

function assertContained(parentRealPath, childPath, label) {
  const childRealPath = realExisting(childPath, label);
  const relative = path.relative(parentRealPath, childRealPath);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return childRealPath;
  }
  throw new Error(`${label} resolves outside the packaged directory.`);
}

function normalizeAsarEntry(entry) {
  return entry.replaceAll("\\", "/").replace(/^\/+/, "");
}

function containsAnySecret(buffer, secrets) {
  for (const secret of secrets) {
    if (buffer.includes(Buffer.from(secret, "utf8"))) return true;
    if (buffer.includes(Buffer.from(secret, "utf16le"))) return true;
  }
  return false;
}

function loadOptionalPrivateIds() {
  const privateTargetPath = path.join(repoRoot, "src", "conversation-target.json");
  if (!fs.existsSync(privateTargetPath)) return { present: false, ids: [] };

  const privateTarget = readJson(privateTargetPath, "local private conversation target");
  const ids = [privateTarget.conversationId, privateTarget.projectId]
    .filter((value) => typeof value === "string" && value.length > 0);
  return { present: true, ids: [...new Set(ids)] };
}

function walkRegularFiles(directory, packageRealPath) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const realPath = assertContained(packageRealPath, fullPath, `resource ${entry.name}`);
    const stat = fs.statSync(realPath);
    if (stat.isDirectory()) {
      files.push(...walkRegularFiles(realPath, packageRealPath));
    } else if (stat.isFile()) {
      files.push(realPath);
    }
  }
  return files;
}

let packageRealPath;
try {
  packageRealPath = realExisting(requestedPackageDir, "packaged directory");
  if (!fs.statSync(packageRealPath).isDirectory()) {
    throw new Error("packaged directory is not a directory.");
  }

  const resourcesPath = assertContained(packageRealPath, path.join(packageRealPath, "resources"), "resources directory");
  const appAsarPath = assertContained(packageRealPath, path.join(resourcesPath, "app.asar"), "app.asar");
  const guardDirectory = assertContained(packageRealPath, path.join(resourcesPath, "guard"), "guard resources directory");
  const guardExePath = assertContained(packageRealPath, path.join(guardDirectory, "Breakdown.Guard.exe"), "Breakdown.Guard.exe");

  const rootPackage = readJson(rootPackagePath, "root package.json");
  if (typeof rootPackage.version !== "string" || rootPackage.version.length === 0) {
    fail("root package.json has no usable version.");
  }

  let asarEntries = [];
  try {
    asarEntries = asar.listPackage(appAsarPath).map(normalizeAsarEntry);
  } catch (error) {
    throw new Error(`cannot read app.asar: ${error.message}`);
  }
  const asarEntrySet = new Set(asarEntries);

  const requiredAsarEntries = [
    "package.json",
    "dist/main.js",
    "ui/index.html",
    "ui/app.js",
    "ui/style.css",
  ];
  for (const requiredEntry of requiredAsarEntries) {
    if (!asarEntrySet.has(requiredEntry)) fail(`required ASAR entry is missing: ${requiredEntry}`);
  }
  if (!fs.statSync(guardExePath).isFile()) fail("Breakdown.Guard.exe is not a regular file.");

  try {
    const packagedPackage = JSON.parse(asar.extractFile(appAsarPath, "package.json").toString("utf8"));
    if (packagedPackage.version !== rootPackage.version) {
      fail(`packaged app version ${String(packagedPackage.version)} does not match root package version ${rootPackage.version}.`);
    }
  } catch (error) {
    fail(`cannot read packaged package.json: ${error.message}`);
  }

  for (const entry of asarEntries) {
    const lower = entry.toLowerCase();
    const base = path.posix.basename(lower);
    const isLegacyTarget = base === "conversation-target.json" || base === "conversation-target.example.json";
    const isProjectSource = lower.startsWith("src/");
    const isProjectTests = lower.startsWith("tests/") || lower.startsWith("dist/tests/");
    const isDevMaterial = lower.startsWith(".dev/");
    if (isLegacyTarget || isProjectSource || isProjectTests || isDevMaterial) {
      fail(`forbidden ASAR entry is packaged: ${entry}`);
    }
  }

  const privateTarget = loadOptionalPrivateIds();
  if (privateTarget.present && privateTarget.ids.length > 0) {
    const packagedAppBytes = fs.readFileSync(appAsarPath);
    if (containsAnySecret(packagedAppBytes, privateTarget.ids)) {
      fail("a local private conversation/project identifier is embedded in app.asar.");
    }

    for (const guardFile of walkRegularFiles(guardDirectory, packageRealPath)) {
      if (containsAnySecret(fs.readFileSync(guardFile), privateTarget.ids)) {
        fail("a local private conversation/project identifier is embedded in native guard resources.");
        break;
      }
    }

    const extraTextTargets = [
      path.join(resourcesPath, "docs"),
      path.join(resourcesPath, "recover.ps1"),
    ];
    for (const target of extraTextTargets) {
      if (!fs.existsSync(target)) continue;
      const targetRealPath = assertContained(packageRealPath, target, "packaged text resource");
      const stat = fs.statSync(targetRealPath);
      const files = stat.isDirectory() ? walkRegularFiles(targetRealPath, packageRealPath) : [targetRealPath];
      if (files.some((file) => containsAnySecret(fs.readFileSync(file), privateTarget.ids))) {
        fail("a local private conversation/project identifier is embedded in packaged text resources.");
        break;
      }
    }
  }

  if (errors.length > 0) {
    console.error("[distribution-check] FAILED");
    for (const error of errors) console.error(` - ${error}`);
    process.exit(1);
  }

  console.log("[distribution-check] OK");
  console.log(` - version: ${rootPackage.version}`);
  console.log(` - ASAR entries checked: ${asarEntries.length}`);
  console.log(` - native guard: ${path.basename(guardExePath)}`);
  console.log(` - private target exact-value scan: ${privateTarget.present && privateTarget.ids.length > 0 ? "performed" : "skipped"}`);
} catch (error) {
  console.error(`[distribution-check] ERROR: ${error.message}`);
  process.exit(2);
}
