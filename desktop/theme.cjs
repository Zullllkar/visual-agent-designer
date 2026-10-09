const fs = require("node:fs");
const path = require("node:path");

/** Match studio-home.css aluminum shell and ink buttons. */
const CHROME = {
  light: {
    background: "#edeef1",
    overlay: "#edeef1",
    symbol: "#141416",
    ink: "#141416",
    accent: "#141416",
  },
  dark: {
    background: "#0e0f12",
    overlay: "#0e0f12",
    symbol: "#f2f3f5",
    ink: "#f2f3f5",
    accent: "#f2f3f5",
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

function titleBarOverlayOptions(theme, scrim) {
  if (scrim) {
    return {
      color: "#00000000",
      symbolColor: "#f4f4f5",
      height: 40,
    };
  }
  const chrome = windowChrome(theme);
  return {
    color: chrome.overlay,
    symbolColor: chrome.symbol,
    height: 40,
  };
}

module.exports = {
  loadUiTheme,
  saveUiTheme,
  windowChrome,
  normalizeTheme,
  titleBarOverlayOptions,
};
