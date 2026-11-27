/**
 * Centralized, env-configurable storage paths.
 *   DATA_DIR    -> SQLite DB + client_secret*.json (default: app/data)
 *   STORAGE_DIR -> uploads, projects, exports, brandkits (default: app/storage)
 * Allows Docker volumes, Colab Google Drive mounts and isolated test runs.
 */
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "../data"));
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, "../storage"));

const STORAGE_UPLOADS = path.join(STORAGE_DIR, "uploads");
const STORAGE_BRANDKITS = path.join(STORAGE_DIR, "brandkits");
const STORAGE_PROJECTS = path.join(STORAGE_DIR, "projects");
const STORAGE_EXPORTS = path.join(STORAGE_DIR, "exports");

for (const d of [DATA_DIR, STORAGE_UPLOADS, STORAGE_BRANDKITS, STORAGE_PROJECTS, STORAGE_EXPORTS]) {
  fs.mkdirSync(d, { recursive: true });
}

module.exports = {
  DATA_DIR,
  STORAGE_DIR,
  STORAGE_UPLOADS,
  STORAGE_BRANDKITS,
  STORAGE_PROJECTS,
  STORAGE_EXPORTS
};
