const fs = require("node:fs");
const path = require("node:path");

const CHROME = {
  light: {
    background: "#f1efe8",
    overlay: "#fafaf7",
    symbol: "#1a1916",
    ink: "#1a1916",
  },
  dark: {
    background: "#161412",
    overlay: "#1e1c19",
    symbol: "#f1efe8",
    ink: "#f1efe8",
  },
};

function normalizeTheme(theme) {
  return theme === "dark" ? "dark" : "light";
}

function loadUiTheme(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeTheme(raw.theme);
  } catch {
    return "light";
  }
}

function saveUiTheme(file, theme) {
  const next = normalizeTheme(theme);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ theme: next })}\n`, "utf8");
}

function windowChrome(theme) {
  return CHROME[normalizeTheme(theme)];
}

module.exports = {
  loadUiTheme,
  saveUiTheme,
  windowChrome,
  normalizeTheme,
};
