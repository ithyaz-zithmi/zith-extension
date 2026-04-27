// Environment configuration for the extension
const ENVIRONMENTS = {
  development: {
    API_BASE_URL: 'http://localhost:5001/api',
    DASHBOARD_BASE_URL: 'http://localhost:3005',
    SKILLS_URL: 'http://localhost:3005/skills',
    LEADS_URL: 'http://localhost:3005/leads',
    PORT: 5001,
    JWT_SECRET: 'your_jwt_secret_key',
    GEMINI_API_KEY: 'AIzaSyAFzETJvGvpCSrPszHWrZv97QmnQHiaQqI'
  },
  production: {
    API_BASE_URL: 'https://zithmi.zithspace.com/api',
    DASHBOARD_BASE_URL: 'https://zithmi.zithspace.com',
    SKILLS_URL: 'https://zithmi.zithspace.com/skills',
    LEADS_URL: 'https://zithmi.zithspace.com/leads',
    PORT: (typeof process !== 'undefined' && process.env && process.env.PORT) || 5001,
    JWT_SECRET: (typeof process !== 'undefined' && process.env && process.env.JWT_SECRET) || 'your_jwt_secret_key',
    GEMINI_API_KEY: (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) || undefined
  }
};

// Function to detect current environment
function detectEnvironment() {
  // Check if we're in development mode
  // You can modify this logic based on your needs
  let isDevelopment = false;
  
  // Browser environment
  if (typeof window !== 'undefined') {
    console.log('Environment detection - window.location.hostname:', window.location.hostname);
    console.log('Environment detection - chrome.runtime available:', typeof chrome !== 'undefined' && chrome.runtime);
    
    isDevelopment = 
      window.location.hostname === 'localhost' || 
      window.location.hostname === '127.0.0.1' ||
      (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest() && (
        chrome.runtime.getManifest().name.includes('Dev') ||
        chrome.runtime.getManifest().version.includes('dev')
      ));
      
    // For Chrome extensions, always assume development unless manifest indicates production
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest()) {
      const manifest = chrome.runtime.getManifest();
      console.log('Environment detection - manifest name:', manifest.name);
      console.log('Environment detection - manifest version:', manifest.version);
      
      // Default to development for Chrome extensions
      isDevelopment = true;
      
      // Check if manifest indicates production
      if (manifest.name.includes('Production') || manifest.version.includes('prod')) {
        isDevelopment = false;
      }
    }
  }
  // Node.js environment
  else if (typeof process !== 'undefined' && process.env) {
    isDevelopment = process.env.NODE_ENV !== 'production';
  }
  
  console.log('Environment detection - isDevelopment:', isDevelopment);
  return isDevelopment ? 'development' : 'production';
}

// Get current environment configuration
function getConfig() {
  const env = detectEnvironment();
  console.log(`Using ${env} environment`);
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
