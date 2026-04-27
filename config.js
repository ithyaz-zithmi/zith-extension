// Environment configuration for the extension
// NOTE: Secrets (JWT_SECRET, GEMINI_API_KEY) are loaded from .env on the server side.
// The extension itself does not need these values.

const ENVIRONMENTS = {
  development: {
    API_BASE_URL: 'http://localhost:5001/api',
    DASHBOARD_BASE_URL: 'http://localhost:3005',
    SKILLS_URL: 'http://localhost:3005/skills',
    LEADS_URL: 'http://localhost:3005/leads',
    PORT: 5001
  },
  production: {
    API_BASE_URL: 'https://zithmi.zithspace.com/api',
    DASHBOARD_BASE_URL: 'https://zithmi.zithspace.com',
    SKILLS_URL: 'https://zithmi.zithspace.com/skills',
    LEADS_URL: 'https://zithmi.zithspace.com/leads',
    PORT: (typeof process !== 'undefined' && process.env && process.env.PORT) || 5001
  }
};

// Function to detect current environment
function detectEnvironment() {
  let isDevelopment = false;

  // Browser environment
  if (typeof window !== 'undefined') {
    isDevelopment =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest() && (
        chrome.runtime.getManifest().name.includes('Dev') ||
        chrome.runtime.getManifest().version.includes('dev')
      ));

    // For Chrome extensions, default to development unless manifest indicates production
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest()) {
      const manifest = chrome.runtime.getManifest();
      isDevelopment = true;
      if (manifest.name.includes('Production') || manifest.version.includes('prod')) {
        isDevelopment = false;
      }
    }
  }
  // Node.js environment
  else if (typeof process !== 'undefined' && process.env) {
    isDevelopment = process.env.NODE_ENV !== 'production';
  }

  return isDevelopment ? 'development' : 'production';
}

// Get current environment configuration
function getConfig() {
  const env = detectEnvironment();
  return ENVIRONMENTS[env];
}

// Export configuration for different environments
const CONFIG = getConfig();

// For Node.js environments (like server.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ENVIRONMENTS, detectEnvironment, getConfig, CONFIG };
}

// For Chrome extension environment
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
  window.ENVIRONMENTS = ENVIRONMENTS;
}
