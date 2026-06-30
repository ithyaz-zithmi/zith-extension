// Environment configuration for the extension
// NOTE: Secrets (JWT_SECRET, GEMINI_API_KEY) are loaded from .env on the server side.
// The extension itself does not need these values.

const ENVIRONMENTS = {
  development: {
    API_BASE_URL: 'http://localhost:5001/api',
    PORT: 5001
  },
  production: {
    API_BASE_URL: 'https://zithmi.zithspace.com/api',
    PORT: (typeof process !== 'undefined' && process.env && process.env.PORT) || 5001
  }
};

// Get dynamic tenant-based frontend URLs
function getTenantUrls(tenantSlug) {
  const isDevelopment = detectEnvironment() === 'development';
  if (isDevelopment) {
    return {
      DASHBOARD_BASE_URL: 'http://localhost:3005',
      SKILLS_URL: 'http://localhost:3005/skills',
      LEADS_URL: 'http://localhost:3005/leads'
    };
  }
  
  // Fallback to default if no slug is provided
  const slug = tenantSlug || 'zithmi';
  return {
    DASHBOARD_BASE_URL: `https://${slug}.zithspace.com`,
    SKILLS_URL: `https://${slug}.zithspace.com/skills`,
    LEADS_URL: `https://${slug}.zithspace.com/leads`
  };
}

// Function to detect current environment
function detectEnvironment() {
  // Check if we are in a Chrome extension environment (either window or service worker)
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
    const manifest = chrome.runtime.getManifest();
    let isDevelopment = true;
    if (manifest.name && (manifest.name.includes('Production') || manifest.version.includes('prod'))) {
      isDevelopment = false;
    }
    return isDevelopment ? 'development' : 'production';
  }

  // Browser environment
  if (typeof window !== 'undefined') {
    const isLocal =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    return isLocal ? 'development' : 'production';
  }

  // Node.js environment
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV !== 'production' ? 'development' : 'production';
  }

  return 'production';
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
  module.exports = { ENVIRONMENTS, detectEnvironment, getConfig, CONFIG, getTenantUrls };
}

// For Chrome extension environment
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
  window.ENVIRONMENTS = ENVIRONMENTS;
  window.getTenantUrls = getTenantUrls;
}
