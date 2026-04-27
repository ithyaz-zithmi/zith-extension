/**
 * popup.js
 * State-driven UI for main extension and CRM views.
 */

// Authentication state
let isAuthenticated = false;
let currentUser = null;
let authFallbackTimer = null;

// Check authentication on load
function checkAuth() {
  console.log('Checking authentication...');

  // First ensure Chrome storage is ready
  ensureStorageReady(() => {
    // Use retry mechanism with polling
    checkAuthWithRetry(0);
  });
}

// Ensure Chrome storage is ready
function ensureStorageReady(callback) {
  // Check if storage is available and ready
  try {
    chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
      console.log('Storage is ready, bytes in use:', bytesInUse);
      callback();
    });
  } catch (error) {
    console.log('Storage not ready, retrying...', error);
    setTimeout(() => {
      ensureStorageReady(callback);
    }, 100);
  }
}

// Check authentication with retry mechanism
function checkAuthWithRetry(attempt) {
  const maxAttempts = 5;
  const delay = attempt * 200; // Exponential backoff: 0, 200, 400, 600, 800ms

  console.log(`Auth check attempt ${attempt + 1}/${maxAttempts} with ${delay}ms delay`);

  setTimeout(() => {
    checkAuthFromMultipleSources(attempt, maxAttempts);
  }, delay);
}

// Check authentication from multiple storage sources with retry
function checkAuthFromMultipleSources(attempt, maxAttempts) {
  console.log('Checking auth from background script on attempt', attempt + 1);

  // First try background script storage
  chrome.runtime.sendMessage({ action: 'getAuth' }, (backgroundResult) => {
    console.log('Background storage result:', backgroundResult);
    console.log('Background storage keys:', Object.keys(backgroundResult));

    if (backgroundResult.authToken && backgroundResult.currentUser) {
      console.log('Found credentials in background storage on attempt', attempt + 1);

      // Copy to popup local storage for faster access
      chrome.storage.local.set({
        authToken: backgroundResult.authToken,
        currentUser: backgroundResult.currentUser
      }, () => {
        proceedWithAuth(backgroundResult.authToken, backgroundResult.currentUser);
      });
      return;
    }

    // If not found in background, try local storage
    console.log('Not found in background storage, trying local storage...');
    chrome.storage.local.get(['authToken', 'currentUser'], (localResult) => {
      console.log('Local storage result:', localResult);
      console.log('Local storage keys:', Object.keys(localResult));

      if (localResult.authToken && localResult.currentUser) {
        console.log('Found credentials in local storage on attempt', attempt + 1);
        proceedWithAuth(localResult.authToken, localResult.currentUser);
        return;
      }

      // If not found in local, try sync storage
      console.log('Not found in local storage, trying sync storage...');
      chrome.storage.sync.get(['authToken', 'currentUser'], (syncResult) => {
        console.log('Sync storage result:', syncResult);
        console.log('Sync storage keys:', Object.keys(syncResult));

        if (syncResult.authToken && syncResult.currentUser) {
          console.log('Found credentials in sync storage, copying to local...');
          // Copy to local storage for faster access
          chrome.storage.local.set({
            authToken: syncResult.authToken,
            currentUser: syncResult.currentUser
          }, () => {
            proceedWithAuth(syncResult.authToken, syncResult.currentUser);
          });
        } else {
          console.log('No credentials found in any storage on attempt', attempt + 1);

          // Retry if we haven't reached max attempts
          if (attempt < maxAttempts - 1) {
            console.log('Retrying auth check...');
            checkAuthWithRetry(attempt + 1);
          } else {
            console.log('Max retry attempts reached, trying aggressive check...');
            // Final aggressive check before showing login
            aggressiveStorageCheck();

            // Set a single centralized timer to show login if all checks fail
            if (authFallbackTimer) clearTimeout(authFallbackTimer);
            authFallbackTimer = setTimeout(() => {
              console.log('Fallback: No auth found after exhaustive checks (3s), showing login');
              showLoginInterface();
            }, 3000); // Increased to 3s for slower storage/network
          }
        }
      });
    });
  });
}

// Proceed with authentication after finding credentials
function proceedWithAuth(token, user, isFreshLogin = false) {
  console.log('Proceeding with auth, token preview:', token.substring(0, 20) + '...');
  console.log('Is fresh login:', isFreshLogin);

  // Clear fallback timer immediately
  if (authFallbackTimer) {
    clearTimeout(authFallbackTimer);
    authFallbackTimer = null;
  }

  // OPTIMISTIC UI: Show main interface immediately if we have a token
  isAuthenticated = true;
  currentUser = user;
  showMainInterface();

  // Background validation (skip for fresh login)
  if (!isFreshLogin) {
    console.log('Starting background token validation...');
    validateToken(token)
      .then(isValid => {
        if (!isValid) {
          console.log('Background validation: Token invalid/expired, forcing logout');
          showToast('Session expired. Please log in again.');
          clearAllAuthData();
          showLoginInterface();
        } else {
          console.log('Background validation: Token is valid');
        }
      })
      .catch(error => {
        console.log('Background validation: Request failed, keeping current session:', error);
      });
  }
}

// Helper to extract tenant ID from JWT token
function extractTenantFromJWT(token) {
  try {
    const payloadPart = token.split('.')[1];
    const payload = JSON.parse(atob(payloadPart));
    return payload.tenantId;
  } catch (error) {
    return null;
  }
}

// Validate stored token with backend
async function validateToken(token) {
  try {
    const tenantId = extractTenantFromJWT(token);
    if (!tenantId) {
      console.error('Token Validation: No tenant ID found in token');
      return false;
    }
    console.log('Validating token for tenant:', tenantId);

    const response = await fetch(`${CONFIG.API_BASE_URL}/auth/check`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-tenant-id': tenantId
      }
    });


    const data = await response.json();

    console.log('Token validation response:', data);

    if (response.status === 401) {
      console.log('Token expired or invalid (401)');
      return false;
    }

    if (response.status === 403) {
      console.log('Token forbidden (403)');
      return false;
    }

    return data.success;
  } catch (error) {
    console.error('Token validation error:', error);
    // If network error, assume token is still valid to avoid unnecessary logouts
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.log('Network error during token validation, assuming token is valid');
      return true; // Keep channel open for async response
    }
    return false;
  }
}

// Clear authentication data
function clearAuthData() {
  chrome.storage.local.remove(['authToken', 'currentUser']);
  chrome.storage.sync.remove(['authToken', 'currentUser']);
  isAuthenticated = false;
  currentUser = null;
}

// Clear all authentication data (both storage types)
function clearAllAuthData() {
  chrome.storage.local.remove(['authToken', 'currentUser']);
  chrome.storage.sync.remove(['authToken', 'currentUser']);
  isAuthenticated = false;
  currentUser = null;
}

// Manual storage check for debugging
function checkStorageManually() {
  chrome.storage.local.get(null, (allItems) => {
    console.log('All storage items:', allItems);
    console.log('Storage keys:', Object.keys(allItems));
  });

  chrome.storage.local.get(['authToken', 'currentUser'], (result) => {
    console.log('Manual storage check:', result);
  });

  // Also check sync storage
  chrome.storage.sync.get(['authToken', 'currentUser'], (syncResult) => {
    console.log('Manual sync storage check:', syncResult);
  });
}

// Aggressive fallback storage check
function aggressiveStorageCheck() {
  console.log('Performing aggressive storage check...');

  // Try multiple approaches
  const checks = [
    // Direct key check
    () => chrome.storage.local.get(['authToken', 'currentUser']),
    // Get all items
    () => chrome.storage.local.get(null),
    // Sync storage check
    () => chrome.storage.sync.get(['authToken', 'currentUser']),
    // Sync all items
    () => chrome.storage.sync.get(null)
  ];

  let found = false;

  checks.forEach((check, index) => {
    try {
      check((result) => {
        console.log(`Aggressive check ${index + 1} result:`, result);

        // If we find auth data in any check, use it immediately
        if (result.authToken && result.currentUser && !found) {
          found = true;
          console.log('Found auth data in aggressive check', index + 1);
          proceedWithAuth(result.authToken, result.currentUser);
        }
      });
    } catch (error) {
      console.log('Aggressive check error:', error);
    }
  });
}

// Show login interface
function showLoginInterface() {
  if (authFallbackTimer) {
    clearTimeout(authFallbackTimer);
    authFallbackTimer = null;
  }

  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('extractorView').classList.add('hidden');
  document.getElementById('savedJobsView').classList.add('hidden');
  document.querySelector('.header-nav').classList.add('hidden');
}

// Show main interface after login
function showMainInterface() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('extractorView').classList.remove('hidden');
  document.getElementById('savedJobsView').classList.add('hidden');
  document.querySelector('.header-nav').classList.remove('hidden');
  document.getElementById('logoutBtn').style.display = 'inline-flex';

  // Show extractor view by default
  switchView('extractor');
}

// Global toast notification function
function showToast(msg) {
  const toast = document.getElementById('statusToast');
  if (toast) {
    toast.innerText = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
  } else {
    console.log('Toast:', msg); // Fallback to console if toast element not found
  }
}

// Handle login
async function handleLogin(email, password) {
  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'b85c1b5b-77a3-4281-9147-51d6bd3ee94d'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    console.log('Complete login response:', data);

    if (data.success) {
      isAuthenticated = true;
      currentUser = data.user;

      console.log('Login successful, storing auth data:', {
        token: data.accessToken ? data.accessToken.substring(0, 20) + '...' : 'undefined',
        hasToken: !!data.accessToken,
        user: data.user
      });

      // Store auth data only if token exists
      if (data.accessToken) {
        console.log('Storing auth data via background script');

        // Store via background script for persistence
        chrome.runtime.sendMessage({
          action: 'storeAuth',
          token: data.accessToken,
          user: data.user
        }, (response) => {
          console.log('Background storage response:', response);

          if (response && response.success) {
            console.log('Auth data stored successfully via background');

            // Also store in popup storage for immediate access
            const authData = {
              authToken: data.accessToken,
              currentUser: data.user
            };

            chrome.storage.local.set(authData, () => {
              console.log('Auth data also stored in popup local storage');
              checkStorageManually();
            });
          } else {
            console.error('Background storage failed');
            showLoginError('Login failed: Could not store authentication');
          }
        });
      } else {
        console.error('No token received from backend, cannot store auth data');
        showLoginError('Login failed: No authentication token received');
        return;
      }

      // For fresh login, proceed directly without token validation
      proceedWithAuth(data.accessToken, data.user, true);
      showToast('Login successful!');
    } else {
      showLoginError('Sign up with Zithspace to use the extension for free');
    }
  } catch (error) {
    showLoginError('Login failed. Please try again.');
  }
}

// Show login error
function showLoginError(message) {
  const errorDiv = document.getElementById('loginError');
  const errorMsg = document.getElementById('loginErrorMsg');
  errorMsg.textContent = message;
  errorDiv.classList.remove('hidden');

  setTimeout(() => {
    errorDiv.classList.add('hidden');
  }, 5000);
}

// Handle logout
function handleLogout() {
  clearAuthData();
  showLoginInterface();
  showToast('Logged out successfully');
}

async function generateGeminiSummary(text) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'generateAI',
      payload: {
        type: 'summary',
        text: text.substring(0, 2500)
      }
    }, (response) => {
      if (response && response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.message || 'Failed to generate summary'));
      }
    });
  });
}

function scoreJob(job) {
  let score = 0;
  const breakdown = [];

  if ((job.budget && job.budget !== 'N/A') || (job.hourlyRate && job.hourlyRate !== 'N/A')) {
    score += 20;
    breakdown.push('Budget/Rate specified (+20%)');
  }

  if (job.clientSpend) {
    const rawSpend = job.clientSpend.replace(/[^0-9]/g, '');
    const spendNum = parseInt(rawSpend);
    if (spendNum > 1000) {
      score += 20;
      breakdown.push('High value client (>$1k spend) (+20%)');
    } else if (spendNum > 100) {
      score += 10;
      breakdown.push('Established client (>$100 spend) (+10%)');
    }
  }

  if (job.clientRating) {
    const rawRating = parseFloat(job.clientRating.replace(/[^0-9.]/g, ''));
    if (!isNaN(rawRating) && rawRating >= 4.0) {
      score += 20;
      breakdown.push('Highly rated client (4.0+) (+20%)');
    }
  }

  if (job.summary && job.summary.length > 300) {
    score += 20;
    breakdown.push('Detailed job description (+20%)');
  }
  
  if (job.summary && job.summary.toLowerCase().includes("long term")) {
    score += 20;
    breakdown.push('Long-term potential (+20%)');
  }

  return { total: Math.min(score, 100), breakdown };
}

function getScoreBadgeClass(score) {
  if (score >= 80) return { class: 'score-high', text: '🟢 High Value' };
  if (score >= 50) return { class: 'score-med', text: '🟡 Medium Value' };
  return { class: 'score-low', text: '🔴 Low Value' };
}

async function generateAIProposal(job, settings, templateType) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'generateAI',
      payload: {
        type: 'proposal',
        job,
        settings,
        templateType
      }
    }, (response) => {
      if (response && response.success) {
        resolve(response.data);
      } else {
        // Fallback to static builder if background AI fails or auth missing
        console.warn("AI Generation failed, using static fallback:", response?.message);
        resolve(buildDynamicProposal(job, settings, templateType));
      }
    });
  });
}

function buildDynamicProposal(job, settings, templateType) {
  const fName = settings?.freelancerName || 'Freelancer';
  const skillsConfig = settings?.skills || 'development';
  // safely fetch from summary
  const summary = job.summary || job.description || '';
  const shortDesc = summary.substring(0, 250).replace(/\n/g, ' ');

  if (templateType === 'short') {
    return `Hi,\n\nI saw your job for "${job.title}" and noticed you're looking for someone with expertise in ${skillsConfig}. I'd love to jump in and assist with your requirement: "${shortDesc}..."\n\nLet's chat about how I can solve this quickly.\n\nBest,\n${fName}`;
  }
  if (templateType === 'technical') {
    return `Hi,\n\nI'm reaching out regarding "${job.title}".\n\nUnderstanding the Problem:\nYour requirement details: "${shortDesc}..." indicates a need for a robust mapping of logic.\n\nProposed Solution:\nApplying my knowledge of ${skillsConfig}, I will ensure a scalable implementation.\n\nLet's schedule a call to discuss the technical approach.\n\nRegards,\n${fName}`;
  }
  return `Hi there,\n\nThank you for posting the job: "${job.title}".\n\nI have thoroughly read the description: "${shortDesc}..."\n\nAs a specialist utilizing [${skillsConfig}], I am confident in delivering high-quality results for this scope. I approach tasks with clear communication and structured milestones.\n\nAre you available for a brief chat to align on expectations?\n\nBest wishes,\n${fName}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const extractBtn = document.getElementById('extractBtn');
  const generateBtn = document.getElementById('generateBtn');
  const saveBtn = document.getElementById('saveBtn');
  const templateSelect = document.getElementById('templateSelect');

  const extractorView = document.getElementById('extractorView');
  const savedJobsView = document.getElementById('savedJobsView');

  let currentJobData = null;
  let userSettings = null;
  let lastSavedLeadId = null;

  chrome.storage.local.get(['settings', 'authToken'], (result) => {
    console.log('Popup - Storage result:', result);
    console.log('Storage keys available:', Object.keys(result));

    const settings = result.settings || {};
    const authToken = result.authToken || null;

    console.log('Popup - Auth check on load:', {
      hasToken: !!authToken,
      tokenLength: authToken ? authToken.length : 0,
      tokenStart: authToken ? authToken.substring(0, 20) + '...' : 'none',
      authToken: authToken
    });

    if (settings) {
      userSettings = settings;
      if (settings.defaultTemplate) templateSelect.value = settings.defaultTemplate;
    }

    // Check authentication on startup
    checkAuth();
  });

  document.getElementById('optionsBtn').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  document.getElementById('viewExtractorBtn').addEventListener('click', (e) => { e.preventDefault(); switchView('extractor'); });
  document.getElementById('viewSavedBtn').addEventListener('click', (e) => { e.preventDefault(); switchView('saved'); loadSavedJobs(); });

  // Quick Actions
  document.getElementById('dashboardBtn').addEventListener('click', (e) => {
    e.preventDefault();
    const dashboardUrl = CONFIG.LEADS_URL;
    window.open(dashboardUrl, '_blank');
  });

  document.getElementById('viewInDashboardBtn').addEventListener('click', (e) => {
    e.preventDefault();
    const url = lastSavedLeadId 
      ? `${CONFIG.DASHBOARD_BASE_URL}/leads/view/${lastSavedLeadId}` 
      : CONFIG.LEADS_URL;
    window.open(url, '_blank');
  });

  document.getElementById('extractNewBtn').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('extractor');
    setExtractorState('idle');
  });

  function switchView(view) {
    if (view === 'extractor') {
      extractorView.classList.remove('hidden'); savedJobsView.classList.add('hidden');
      document.getElementById('viewExtractorBtn').classList.add('active'); document.getElementById('viewSavedBtn').classList.remove('active');
    } else {
      extractorView.classList.add('hidden'); savedJobsView.classList.remove('hidden');
      document.getElementById('viewExtractorBtn').classList.remove('active'); document.getElementById('viewSavedBtn').classList.add('active');
    }
  }

  function setExtractorState(state, message = '') {
    ['idleState', 'loadingState', 'errorState', 'jobDetails', 'successState'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    if (state === 'idle') document.getElementById('idleState').classList.remove('hidden');
    if (state === 'loading') { document.getElementById('loadingMsg').innerText = message || 'Loading...'; document.getElementById('loadingState').classList.remove('hidden'); }
    if (state === 'error') { document.getElementById('errorMsg').innerText = message || 'Error'; document.getElementById('errorState').classList.remove('hidden'); }
    if (state === 'success') {
      document.getElementById('jobDetails').classList.remove('hidden');
    }
    if (state === 'final_success') {
      const title = document.getElementById('successTitle');
      const msg = document.getElementById('successMsg');

      if (message === 'Job saved & synced!') {
        title.innerText = "Lead Saved Successfully!";
        msg.innerText = "The job has been synced to Zithspace.";
      } else {
        title.innerText = "Saved Locally";
        msg.innerText = "Save complete, but sync is pending. You can retry from the Saved list.";
      }

      document.getElementById('successState').classList.remove('hidden');
    }
  }

  const doExtraction = async () => {
    if (!isAuthenticated) {
      showToast('Please log in to use the extractor');
      showLoginInterface();
      return;
    }
    setExtractorState('loading', 'Injecting script...');
    extractBtn.disabled = true;
    resetUIFields();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { setExtractorState('error', 'No active tab found.'); return; }

    chrome.tabs.sendMessage(tab.id, { action: "extractJob" }, (response) => {
      extractBtn.disabled = false;
      if (chrome.runtime.lastError) return setExtractorState('error', 'Could not sync. Ensure you are on an active job page (Upwork or Freelancer).');
      if (response && response.success) {
        currentJobData = response.data;
        populateExtractedJob(currentJobData);
        setExtractorState('success');
      } else {
        setExtractorState('error', response?.error || 'Failed to extract.');
      }
    });
  };
  extractBtn.addEventListener('click', doExtraction);
  document.getElementById('retryBtn').addEventListener('click', doExtraction);
  document.getElementById('matchSkillsBtn').addEventListener('click', doSkillMatching);
  document.getElementById('matchSkillsInJobBtn').addEventListener('click', doSkillMatching);

  function formatFullDate(isoString) {
    if (!isoString || isoString === 'N/A' || isoString === 'Time not found') return isoString;
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return isoString;
      
      const options = { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
      };
      return date.toLocaleString('en-US', options).replace(',', ' ·');
    } catch (e) {
      return isoString;
    }
  }

  function formatPostedDate(postedStr) {
    if (!postedStr || postedStr === 'N/A' || postedStr === 'Time not found') return postedStr;
    const str = postedStr.toLowerCase();
    const date = new Date();

    if (str.includes('yesterday') || str.includes('1 day ago') || str.includes('a day ago')) {
      date.setDate(date.getDate() - 1);
    } else if (str.includes('days ago')) {
      const days = parseInt(str.replace(/[^0-9]/g, ''));
      if (!isNaN(days)) date.setDate(date.getDate() - days);
    } else if (str.includes('week')) {
      const weeks = parseInt(str.replace(/[^0-9]/g, '')) || 1;
      date.setDate(date.getDate() - (weeks * 7));
    } else if (str.includes('month')) {
      const months = parseInt(str.replace(/[^0-9]/g, '')) || 1;
      date.setMonth(date.getMonth() - months);
    }

    const shortDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${postedStr} (${shortDate})`;
  }

  function checkDuplicate(url) {
    chrome.storage.local.get(null, (items) => {
      const allSavedJobs = [];
      Object.keys(items).forEach(key => {
        if (key.startsWith('jobs_')) {
          allSavedJobs.push(...items[key]);
        }
      });
      
      const normalizedUrl = normalizeUrl(url);
      const isDuplicate = allSavedJobs.some(j => {
        const jLink = normalizeUrl(j.jobLink || j.url || j.id);
        return jLink === normalizedUrl || j.id === url || j.jobId === url;
      });

      const warningEl = document.getElementById('duplicateWarning');
      const fixedSaveContainer = document.getElementById('fixedSaveBtn');
      const saveBtn = document.getElementById('saveBtn');
      const generateBtn = document.getElementById('generateBtn');

      if (isDuplicate) {
        warningEl.classList.remove('hidden');
        if (fixedSaveContainer) {
          fixedSaveContainer.classList.remove('hidden'); // Show it
        }
        if (saveBtn) {
          saveBtn.innerText = "Job Already in Zithspace";
          saveBtn.disabled = true;
          saveBtn.classList.replace('success-btn', 'secondary-btn');
          saveBtn.style.opacity = '0.6';
          saveBtn.style.cursor = 'not-allowed';
        }
        // Still allow generating proposals
        if (generateBtn) {
          generateBtn.innerText = "🚀 Generate Another Proposal";
          generateBtn.disabled = false;
        }
      } else {
        warningEl.classList.add('hidden');
        if (saveBtn) {
          saveBtn.innerText = "Save Job & Proposal";
          saveBtn.disabled = false;
          saveBtn.classList.add('success-btn');
          saveBtn.classList.remove('secondary-btn');
          saveBtn.style.opacity = '1';
        }
        if (generateBtn) {
          generateBtn.innerText = "🚀 Generate Smart Proposal";
          generateBtn.disabled = false;
        }
      }
    });
  }

  function populateExtractedJob(data) {
    // Confidence / Status Banner Rendering
    const statusBanner = document.getElementById('extractionStatus');
    if (statusBanner && data.validation) {
      const v = data.validation;
      let confClass = 'conf-high';
      let icon = '✅';
      
      if (v.confidence === 'medium') { confClass = 'conf-med'; icon = '⚠️'; }
      if (v.confidence === 'low') { confClass = 'conf-low'; icon = '❌'; }
      
      let missingTxt = '';
      if (v.missingFields && v.missingFields.length > 0) {
        missingTxt = `<div class="missing-fields">Missing: ${v.missingFields.join(', ')}</div>`;
      }
      
      statusBanner.innerHTML = `
        <div class="status-banner ${confClass}" style="box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05);">
          <div style="display:flex; gap:10px; align-items:center;">
            <div style="width: 24px; height: 24px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: var(--shadow-sm);">
              ${icon}
            </div>
            <span style="letter-spacing: 0.3px;">${v.message}</span>
          </div>
          ${missingTxt}
        </div>
      `;
      statusBanner.classList.remove('hidden');
    }

    const titleDisplay = document.getElementById('jobTitleDisplay');
    if (titleDisplay) {
      titleDisplay.innerText = data.title;
    }

    const notesInput = document.getElementById('jobNotesInput');
    if (notesInput) {
      notesInput.value = ''; // Reset notes for new extraction
    }

    // Check for duplicates
    checkDuplicate(data.jobLink || data.url);

    if (data.jobLink) {
      document.getElementById('uiJobLink').innerText = data.jobLink;
      document.getElementById('uiJobLink').href = data.jobLink;
      document.getElementById('jobLinkContainer').classList.remove('hidden');
    }

    // Formatting Rate and Project Type separately like Upwork
    let rateDisplay = 'N/A';
    let projectTypeDisplay = 'N/A';

    // Determine rate display (hourly rate or fixed budget)
    if (data.jobType === 'hourly') {
      rateDisplay = data.hourlyRate !== 'N/A' ? `${data.hourlyRate} Hourly` : 'Budget hidden';
      projectTypeDisplay = 'Hourly';
    } else if (data.jobType === 'fixed') {
      rateDisplay = data.budget !== 'N/A' ? data.budget : 'Budget hidden';
      projectTypeDisplay = 'Fixed-Price';
    } else if (data.jobType === 'full-time') {
      // Full-time jobs typically have fixed budgets
      rateDisplay = data.budget !== 'N/A' ? data.budget : 'Budget hidden';
      projectTypeDisplay = 'Full-Time';
    } else if (data.jobType === 'ongoing') {
      // For ongoing projects, show hourly rate if available, otherwise budget
      if (data.hourlyRate !== 'N/A') {
        rateDisplay = `${data.hourlyRate} Hourly`;
      } else if (data.budget !== 'N/A') {
        rateDisplay = data.budget;
      } else {
        rateDisplay = 'Budget hidden';
      }
      projectTypeDisplay = 'Ongoing project';
    } else {
      // Unknown type - determine from available data
      if (data.hourlyRate !== 'N/A') {
        rateDisplay = `${data.hourlyRate} Hourly`;
        projectTypeDisplay = 'Hourly';
      } else if (data.budget !== 'N/A') {
        rateDisplay = data.budget;
        projectTypeDisplay = 'Fixed-Price';
      } else {
        rateDisplay = 'Budget hidden';
        projectTypeDisplay = 'Job Type Unknown';
      }
    }
    
    // Override project type display if we have separate project type data
    if (data.projectType && data.projectType !== data.jobType) {
      // Convert project type to display format
      if (data.projectType === 'ongoing') projectTypeDisplay = 'Ongoing project';
      else if (data.projectType === 'fixed') projectTypeDisplay = 'Fixed-Price';
      else if (data.projectType === 'hourly') projectTypeDisplay = 'Hourly';
      else if (data.projectType === 'full-time') projectTypeDisplay = 'Full-Time';
      else if (data.projectType === 'complex project') projectTypeDisplay = 'Complex project';
      else if (data.projectType === 'simple project') projectTypeDisplay = 'Simple project';
      else if (data.projectType === 'advanced project') projectTypeDisplay = 'Advanced project';
      else if (data.projectType === 'basic project') projectTypeDisplay = 'Basic project';
      else {
        // For custom project types, use the original text with proper capitalization
        projectTypeDisplay = data.projectType.charAt(0).toUpperCase() + data.projectType.slice(1);
      }
    }

    // Update separate elements
    document.getElementById('jobBudgetWrap').innerText = rateDisplay;
    
    // Make sure the project type element exists before updating
    const projectTypeElement = document.getElementById('jobProjectTypeWrap');
    if (projectTypeElement) {
      projectTypeElement.innerText = `Type: ${projectTypeDisplay}`;
      console.log('Updated project type display:', projectTypeDisplay);
    } else {
      console.error('jobProjectTypeWrap element not found');
    }

    // Expanded Metadata
    document.getElementById('clientLocation').innerText = data.clientLocation;
    document.getElementById('clientRating').innerText = data.clientRating;

    // Custom logic for grid badge validations
    const payEl = document.getElementById('clientPaymentStat');
    if (data.clientPaymentVerified) { 
      payEl.innerText = '✅ Verified'; 
      payEl.className = 'detail-value verified'; 
    } else { 
      payEl.innerText = '❌ Unverified'; 
      payEl.className = 'detail-value unverified'; 
    }

    const phoneEl = document.getElementById('clientPhoneStat');
    if (data.clientPhoneVerified) { 
      phoneEl.innerText = '✅ Verified'; 
      phoneEl.className = 'detail-value verified'; 
    } else { 
      phoneEl.innerText = '❌ Unverified'; 
      phoneEl.className = 'detail-value unverified'; 
    }

    document.getElementById('postedTime').innerText = formatPostedDate(data.postedOn);
    document.getElementById('jobDurationWrap').innerText = `Duration: ${data.duration}`;
    document.getElementById('jobExperienceWrap').innerText = `Level: ${data.experienceLevel}`;

    const skillsSection = document.getElementById('skillsSection');
    skillsSection.classList.remove('hidden'); // Always render the card natively so user knows it executed

    const skillsContainer = document.getElementById('jobSkills');
    if (data.skills && data.skills.length > 0) {
      data.skills.forEach(skill => {
        const span = document.createElement('span');
        span.className = 'skill-pill';
        span.innerText = skill;
        skillsContainer.appendChild(span);
      });
    } else {
      skillsContainer.innerHTML = '<span class="text-muted" style="font-size:12px;">No explicit skills tagged.</span>';
    }

    // Attachments Render
    const attachmentsSection = document.getElementById('attachmentsSection');
    const attachContainer = document.getElementById('jobAttachments');
    attachContainer.innerHTML = '';
    if (data.attachments && data.attachments.length > 0) {
      data.attachments.forEach(att => {
        const span = document.createElement('span');
        span.className = 'attachment-pill';
        // Handle both string attachments and object attachments with name property
        const attachmentName = typeof att === 'string' ? att : (att.name || 'Attachment');
        span.innerText = attachmentName;
        attachContainer.appendChild(span);
      });
      attachmentsSection.classList.remove('hidden');
    } else {
      attachmentsSection.classList.add('hidden');
    }

    document.getElementById('jobDescription').innerText = data.summary || data.description || '';

    // AI Summary Trigger Logic
    const aiSec = document.getElementById('aiSummarySection');
    const aiLoader = document.getElementById('aiSummaryLoader');
    const aiInput = document.getElementById('aiSummaryInput');

    aiInput.classList.add('hidden');
    aiInput.value = '';

    if (data.summary && data.summary.length > 50) {
      aiSec.classList.remove('hidden');
      aiLoader.classList.remove('hidden');

      generateGeminiSummary(data.summary).then(points => {
        aiLoader.classList.add('hidden');
        // Defensive check: ensure points is an array
        if (Array.isArray(points)) {
          // Join points with bullets and double newlines for better "pace"
          aiInput.value = points.map(pt => `• ${pt}`).join('\n\n');
        } else if (typeof points === 'string') {
          // If it's just a string, show it directly or split by common delimiters
          aiInput.value = points.split('\n').filter(l => l.trim()).map(line => line.trim().startsWith('•') ? line : `• ${line}`).join('\n\n');
        } else {
          aiInput.value = String(points);
        }
        aiInput.classList.remove('hidden');
        
        // Auto-resize to show content fully
        aiInput.style.height = 'auto';
        aiInput.style.height = (aiInput.scrollHeight) + 'px';

      }).catch((err) => {
        console.error("AI Summary Error:", err);
        aiLoader.innerText = "Error parsing AI Summary. Ensure API constraints are valid.";
      });
    } else {
      aiSec.classList.add('hidden');
    }

    const scoreResult = scoreJob(data);
    data.calculatedScore = scoreResult.total;
    const badgeInfo = getScoreBadgeClass(scoreResult.total);
    const badgeEl = document.getElementById('jobScoreBadge');
    badgeEl.className = `score-badge ${badgeInfo.class}`;
    badgeEl.innerText = `${scoreResult.total}/100 - ${badgeInfo.text}`;

    // Render Breakdown
    const breakdownEl = document.getElementById('scoreBreakdown');
    if (breakdownEl) {
      breakdownEl.innerHTML = scoreResult.breakdown.map(point => `<li>${point}</li>`).join('');
      breakdownEl.classList.remove('hidden');
    }

    // Use full date for postedTime if it looks like an ISO string
    if (data.postedOn && data.postedOn.includes('T') && data.postedOn.includes('Z')) {
      document.getElementById('postedTime').innerText = `📅 ${formatFullDate(data.postedOn)}`;
    } else {
      document.getElementById('postedTime').innerText = `📅 ${formatPostedDate(data.postedOn)}`;
    }

    document.getElementById('proposalBox').classList.add('hidden');
    document.getElementById('fixedSaveBtn').classList.add('hidden');
    generateBtn.classList.remove('hidden');
  }

  generateBtn.addEventListener('click', async () => {
    if (!isAuthenticated) {
      showToast('Please log in first');
      showLoginInterface();
      return;
    }
    if (!currentJobData) return;
    generateBtn.disabled = true; generateBtn.innerText = "Generating...";
    const proposal = await generateAIProposal(currentJobData, userSettings, templateSelect.value);
    document.getElementById('proposalTextarea').value = proposal;
    document.getElementById('proposalBox').classList.remove('hidden');
    document.getElementById('fixedSaveBtn').classList.remove('hidden');
    generateBtn.disabled = false; generateBtn.innerText = "Regenerate Proposal";
  });

  templateSelect.addEventListener('change', () => {
    if (!document.getElementById('proposalBox').classList.contains('hidden')) {
      generateBtn.click();
    }
  });
  const copyBtn = document.getElementById('copyProposalBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const ta = document.getElementById('proposalTextarea');
      ta.select();
      document.execCommand('copy');
      const originalText = copyBtn.innerText;
      copyBtn.innerText = '✅ Copied!';
      setTimeout(() => copyBtn.innerText = originalText, 2000);
    });
  }

/**
 * Normalizes a URL for robust comparison across different sessions/tracking params.
 */
function normalizeUrl(url) {
  if (!url) return '';
  let str = url.toLowerCase().trim();
  
  // Upwork: Extract canonical job ID (~01 followed by hex)
  const upworkMatch = str.match(/(~01[a-f0-9]+)/);
  if (upworkMatch) return upworkMatch[1];

  // Freelancer: Extract project ID or slug
  if (str.includes('freelancer.com/projects/')) {
    const parts = str.split('freelancer.com/projects/')[1].split(/[/?#]/)[0];
    if (parts) return 'fl_' + parts;
  }
  
  try {
    const u = new URL(url);
    const paramsToRemove = ['source', 'context', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'ref'];
    paramsToRemove.forEach(p => u.searchParams.delete(p));
    
    let normalized = u.origin + u.pathname;
    if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized.toLowerCase();
  } catch (e) {
    return str.replace(/\/$/, '');
  }
}

  saveBtn.addEventListener('click', () => {
    if (!isAuthenticated) {
      showToast('Please log in first');
      showLoginInterface();
      return;
    }
    if (!currentJobData) return;

    // Read edited values
    const editedTitle = document.getElementById('jobTitleDisplay').innerText.trim();
    const editedSummary = document.getElementById('aiSummaryInput').value.trim();
    const notes = document.getElementById('jobNotesInput').value.trim();

    saveBtn.disabled = true; saveBtn.innerText = "Saving...";

    const payload = {
      action: 'saveJob',
      jobData: {
        ...currentJobData,
        title: editedTitle,
        summary: currentJobData.summary,
        ai_summary: editedSummary,
        aiSummary: editedSummary, // Also send camelCase
        notes: notes 
      },
      proposal: document.getElementById('proposalTextarea').value.trim(),
      score: currentJobData.calculatedScore,
      templateUsed: templateSelect.value
    };

    console.log('Popup: Sending saveJob payload:', payload);

    chrome.runtime.sendMessage(payload, (resp) => {
      saveBtn.disabled = false; saveBtn.innerText = "Save Job & Proposal";
      if (resp && resp.success) {
        showToast(resp.message || 'Successfully saved!');
        if (resp.leadId) lastSavedLeadId = resp.leadId;
        setExtractorState('final_success', resp.message);
      } else {
        showToast(resp?.message || 'Error saving job.');
      }
    });
  });

  function loadSavedJobs() {
    const listEl = document.getElementById('savedJobsList');
    listEl.innerHTML = '<div class="spinner"></div>';

    chrome.runtime.sendMessage({ action: 'getJobs' }, (res) => {
      listEl.innerHTML = '';
      const jobs = res.jobs || [];

      // Update Analytics
      const totalCount = jobs.length;
      const appliedCount = jobs.filter(j => j.status === 'applied' || j.status === 'interview').length;
      document.getElementById('statTotal').innerText = totalCount;
      document.getElementById('statApplied').innerText = appliedCount;

      if (jobs.length === 0) { document.getElementById('emptyJobsMsg').classList.remove('hidden'); return; }
      document.getElementById('emptyJobsMsg').classList.add('hidden');

      const statuses = [
        { id: 'saved', label: 'Saved', class: '' },
        { id: 'applied', label: 'Applied', class: 'applied' },
        { id: 'interview', label: 'Interview', class: 'interview' },
        { id: 'closed', label: 'Closed', class: 'closed' }
      ];

      jobs.reverse().forEach(job => {
        const bdg = getScoreBadgeClass(job.score || 0);
        const card = document.createElement('div');
        card.className = 'card crm-card';

        const currentStatus = statuses.find(s => s.id === job.status) || statuses[0];

        card.innerHTML = `
          <div style="display:flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <h3 style="margin: 0; line-height: 1.3;">
              <a href="${job.jobLink || job.id}" target="_blank" style="text-decoration:none; color:inherit;">${job.title}</a>
            </h3>
            <div class="badge ${currentStatus.class}" style="white-space:nowrap; border-radius: 4px; font-size: 10px;">${currentStatus.label.toUpperCase()}</div>
          </div>
          
          <div style="display:flex; gap: 6px; flex-wrap:wrap; margin-bottom: 12px; align-items: center;">
             <span class="score-badge ${bdg.class}" style="font-size:10px; padding: 2px 6px;">${job.score || 0}</span>
             <div class="badge" style="margin:0; font-size:10px;">${job.jobType === 'hourly' ? 'H' : 'F'}: ${job.budget !== 'N/A' ? job.budget : (job.hourlyRate || job.budget)}</div>
             <div class="badge ${job.sync_status === 'synced' ? 'applied' : 'score-low'}" style="margin:0; font-size:9px;">
               ${job.sync_status === 'synced' ? '☁️ Synced' : `<span class="retry-sync-btn" data-id="${job.id || job.jobId}" style="cursor:pointer; text-decoration:underline;">⏳ Retry Sync</span>`}
             </div>
          </div>
          
          <p class="crm-desc" style="margin: 8px 0;">${job.summary || job.description || ''}</p>
          ${job.notes ? `<div class="notes-box" style="background:#FFFBEB; border: 1px solid #FEF3C7; padding: 8px; border-radius: 6px; font-size: 11px; margin-top: 8px; color: #92400E;"><strong>Notes:</strong> ${job.notes}</div>` : ''}
          
          ${job.skillAnalysis ? `
            <div class="skill-analysis-crm" style="margin-top: 10px; padding: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
               <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                 <span style="font-size:10px; font-weight:800; color:#64748b; text-transform:uppercase;">🎯 Skill Match: ${job.skillAnalysis.matchPercentage}%</span>
                 <div style="width: 40px; height: 4px; background: #e2e8f0; border-radius: 2px;">
                   <div style="width: ${job.skillAnalysis.matchPercentage}%; height: 100%; background: ${job.skillAnalysis.matchPercentage >= 70 ? '#10b981' : job.skillAnalysis.matchPercentage >= 40 ? '#f59e0b' : '#f43f5e'}; border-radius: 2px;"></div>
                 </div>
               </div>
               <div style="display:flex; flex-wrap:wrap; gap:4px;">
                 ${(job.skillAnalysis.matchedSkills || []).slice(0, 5).map(s => `<span style="font-size:9px; background:#ecfdf5; color:#065f46; padding:1px 5px; border-radius:3px; border:1px solid #a7f3d0;">${s}</span>`).join('')}
                 ${(job.skillAnalysis.missingSkills || []).length > 0 ? `<span style="font-size:9px; color:#94a3b8; font-style:italic;">+ ${(job.skillAnalysis.missingSkills || []).length} gaps</span>` : ''}
               </div>
            </div>
          ` : ''}
          
          <div class="crm-actions" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display:flex; justify-content: space-between; align-items: center;">
            <div style="display:flex; gap: 4px; align-items: center;">
              <select class="status-select" data-id="${job.id || job.jobId}" style="font-size: 11px; padding: 4px 8px; height: auto; width: auto; border-radius: 4px;">
                ${statuses.map(s => `<option value="${s.id}" ${job.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
              </select>
              ${job.leadId ? `<a href="${CONFIG.DASHBOARD_BASE_URL}/leads/view/${job.leadId}" target="_blank" class="outline-btn" style="padding: 4px 8px; font-size: 10px; text-decoration: none; color: var(--primary); border-color: var(--primary);">🌐 Open on Zithspace</a>` : ''}
            </div>
            <button class="outline-btn danger-btn delete-job-btn" data-id="${job.id || job.jobId}" style="padding: 4px 10px; font-size: 11px;">Delete</button>
          </div>
        `;
        listEl.appendChild(card);
      });

      document.querySelectorAll('.status-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
          updateJobStatus(e.target.dataset.id, e.target.value);
        });
      });

      document.querySelectorAll('.retry-sync-btn').forEach(b => {
        b.addEventListener('click', (e) => {
          retrySyncJob(e.target.dataset.id);
        });
      });

      document.querySelectorAll('.delete-job-btn').forEach(b => b.addEventListener('click', e => deleteJob(e.target.dataset.id)));
    });
  }

  function retrySyncJob(id) {
    showToast('Retrying sync...');
    chrome.runtime.sendMessage({ action: 'retrySync', id }, (res) => {
      if (res.success) {
        showToast('Synced successfully!');
        loadSavedJobs();
      } else {
        showToast('Sync failed again. Check connection.');
      }
    });
  }

  function updateJobStatus(id, status) { chrome.runtime.sendMessage({ action: 'updateJobStatus', id, status }, (res) => { if (res.success) { showToast('Status updated'); loadSavedJobs(); } }); }
  function deleteJob(id) { if (!confirm('Delete this?')) return; chrome.runtime.sendMessage({ action: 'deleteJob', id }, (res) => { if (res.success) { showToast('Deleted'); loadSavedJobs(); } }); }

  // Authentication event listeners
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    handleLogin(email, password);
  });

  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // Skill Matching Function
  async function doSkillMatching() {
    console.log('Starting skill matching via API...');
    
    if (!isAuthenticated) {
      showToast('Please log in to use skill matching');
      showLoginInterface();
      return;
    }

    if (!currentJobData) {
      showToast('Please extract a job first');
      return;
    }

    setExtractorState('loading', 'Consulting Zithspace skills...');
    
    try {
      // Identify current platform
      const platform = currentJobData.jobLink.includes('freelancer.com') ? 'freelancer' : 'upwork';
      console.log(`Matching for platform: ${platform} via API`);

      chrome.runtime.sendMessage({
        action: 'fetchSkills',
        category: platform,
        jobData: currentJobData
      }, (response) => {

        if (response && response.success) {
          const { matchedSkills, missingSkills, matchPercentage } = response.data;
          
          // Store analysis in job data for UI consistency
          currentJobData.skillAnalysis = {
            matchedSkills,
            missingSkills,
            matchPercentage
          };

          console.log(`Match Results from API (${platform}):`, currentJobData.skillAnalysis);
          
          displaySkillMatchResults(matchedSkills, missingSkills, matchPercentage, currentJobData);
          showToast(`Skills matched via Zithspace API (${platform})`);
        } else {
          console.error('API matching failed:', response?.error);
          showToast(`Matching failed: ${response?.error || 'Unknown error'}`);
        }
        setExtractorState('success');
      });
      
    } catch (error) {
      console.error('Skill matching error:', error);
      showToast(`Failed to match skills: ${error.message}`);
      setExtractorState('success');
    }
  }


  // Display skill matching results in a premium report format
  function displaySkillMatchResults(matchedSkills, missingSkills, matchPercentage, jobData) {
    const existingSection = document.querySelector('.skill-matching-results');
    if (existingSection) existingSection.remove();

    const color = matchPercentage >= 75 ? '#10b981' : matchPercentage >= 40 ? '#f59e0b' : '#f43f5e';
    const bgColor = matchPercentage >= 75 ? '#ecfdf5' : matchPercentage >= 40 ? '#fffbeb' : '#fff1f2';
    
    let advice = '';
    if (matchPercentage >= 85) advice = "Excellent match! Your profile is highly aligned with this role. We recommend highlighting your relevant experience in your first paragraph.";
    else if (matchPercentage >= 60) advice = "Good match. You have the core architecture required. Focus on how you can help them bridge the few missing gaps mentioned below.";
    else if (matchPercentage >= 35) advice = "Moderate match. This might be a stretch role. If you apply, emphasize your ability to learn quickly and solve the specific problem described in the brief.";
    else advice = "Low Skill Alignment. This job requires specific tools you haven't mentioned yet. Consider updating your profile or searching for roles more aligned with your current stack.";

    const matchingSection = document.createElement('div');
    matchingSection.className = 'card mt-3 skill-matching-results';
    matchingSection.style.cssText = 'padding: 0; overflow: hidden; border: 1px solid #e2e8f0;';
    
    matchingSection.innerHTML = `
      <div style="background: #f8fafc; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">🎯 Skill Alignment Analysis</span>
        <span style="font-size: 10px; color: #94a3b8;">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
      </div>

      <div style="padding: 16px;">
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
          <div style="position: relative; width: 64px; height: 64px; border-radius: 50%; background: ${bgColor}; display: flex; align-items: center; justify-content: center; border: 4px solid ${color};">
            <span style="font-size: 16px; font-weight: 800; color: ${color};">${matchPercentage}%</span>
          </div>
          <div style="flex: 1;">
            <p style="font-size: 13px; font-weight: 700; color: #1e293b; margin: 0 0 4px 0;">${matchPercentage >= 70 ? 'High Compatibility' : matchPercentage >= 40 ? 'Fair Match' : 'Potential Gap Detected'}</p>
            <p style="font-size: 12px; color: #64748b; margin: 0; line-height: 1.4;">${advice}</p>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 16px;">
          <!-- Matched Section -->
          <div>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span style="font-size: 11px; font-weight: 700; color: #065f46; text-transform: uppercase;">Your Expertise Match (${matchedSkills.length})</span>
            </div>
            <div class="skills-wrap" style="gap: 6px;">
              ${matchedSkills.length > 0 
                ? matchedSkills.map(skill => `<span style="background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${skill}</span>`).join('') 
                : '<span style="font-size: 11px; color: #94a3b8; font-style: italic;">No exact matches found.</span>'}
            </div>
          </div>

          <!-- Missing Section -->
          <div>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <span style="font-size: 11px; font-weight: 700; color: #9f1239; text-transform: uppercase;">Growth Opportunities (${missingSkills.length})</span>
            </div>
            <div class="skills-wrap" style="gap: 6px;">
              ${missingSkills.length > 0 
                ? missingSkills.map(skill => `<span style="background: #fff1f2; color: #9f1239; border: 1px solid #fecdd3; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${skill}</span>`).join('') 
                : '<span style="font-size: 11px; color: #94a3b8; font-style: italic;">You have all the required skills for this job!</span>'}
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 24px;">
          <button class="secondary-btn hide-results" style="flex: 1; padding: 8px; font-size: 12px; font-weight: 700; background: #fff; border: 1px solid #e2e8f0; color: #64748b; border-radius: 8px; cursor: pointer;">Close Report</button>
          <button class="extract-new" style="flex: 1; padding: 8px; font-size: 12px; font-weight: 700; background: #6366f1; border: none; color: white; border-radius: 8px; cursor: pointer;">Next Extraction</button>
        </div>
      </div>
    `;

    const jobDetailsElement = document.getElementById('jobDetails');
    jobDetailsElement.parentNode.insertBefore(matchingSection, jobDetailsElement);

    matchingSection.querySelector('.hide-results').addEventListener('click', () => matchingSection.remove());
    matchingSection.querySelector('.extract-new').addEventListener('click', () => {
      switchView('extractor');
      setExtractorState('idle');
      matchingSection.remove();
    });
  }

  function resetUIFields() {
    // Clear textual displays
    const idsToClear = [
      'jobTitleDisplay', 'uiJobLink', 'jobBudgetWrap', 
      'jobProjectTypeWrap', 'clientLocation', 'clientRating',
      'postedTime', 'jobDurationWrap', 'jobExperienceWrap'
    ];
    
    idsToClear.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerText = '...';
    });

    // Clear specific elements
    const notesInput = document.getElementById('jobNotesInput');
    if (notesInput) notesInput.value = '';

    const skillsContainer = document.getElementById('jobSkills');
    if (skillsContainer) skillsContainer.innerHTML = '';

    const statusBanner = document.getElementById('extractionStatus');
    if (statusBanner) {
      statusBanner.innerHTML = '';
      statusBanner.classList.add('hidden');
    }

    const payEl = document.getElementById('clientPaymentStat');
    if (payEl) {
      payEl.innerText = '...';
      payEl.className = 'detail-value';
    }

    const phoneEl = document.getElementById('clientPhoneStat');
    if (phoneEl) {
      phoneEl.innerText = '...';
      phoneEl.className = 'detail-value';
    }
  }

  function syncProfileSkills() {
    console.log('Manual profile sync started...');
    const syncBtn = document.getElementById('syncProfileBtn');
    if (!syncBtn) return;

    if (!isAuthenticated) {
      showToast('Please log in to sync your profile with Zithspace');
      showLoginInterface();
      return;
    }

    const originalText = syncBtn.innerText;
    syncBtn.innerText = '⏳ Syncing...';
    syncBtn.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        syncBtn.innerText = originalText;
        syncBtn.disabled = false;
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, { action: 'syncUserSkills' }, (res) => {
        if (chrome.runtime.lastError) {
          showToast('Failed to connect. Please refresh the page!');
          syncBtn.innerText = originalText;
          syncBtn.disabled = false;
          return;
        }

        if (res && res.success) {
          const platform = res.platform || 'General';
          console.log(`Extracted ${res.count} skills for ${platform}, syncing to backend...`);
          
          // Send to background for backend sync
          chrome.runtime.sendMessage({ 
            action: 'syncSkillsToBackend', 
            skills: res.skills,
            platform: platform
          }, (syncRes) => {
            if (syncRes && syncRes.success) {
              // Store in platform-specific local cache
              const storageKey = `cachedUserSkills_${platform.toLowerCase()}`;
              const update = {};
              update[storageKey] = res.skills;
              
              chrome.storage.local.set(update, () => {
                showToast(`Success! Synced ${res.count} skills for ${platform}.`);
                syncBtn.innerHTML = `✅ ${platform} Synced`;
              });
            } else {
              showToast(syncRes?.error || 'Synced locally, but cloud sync failed.');
              syncBtn.innerHTML = '⚠️ Local Sync Only';
            }
            
            setTimeout(() => {
              syncBtn.innerText = originalText;
              syncBtn.disabled = false;
            }, 3000);
          });
        } else {
          showToast('Could not find skills. Ensure you are on your profile page.');
          syncBtn.innerText = originalText;
          syncBtn.disabled = false;
        }
      });
    });
  }

  document.getElementById('syncProfileBtn').addEventListener('click', syncProfileSkills);

  // Check authentication on load
  checkAuth();
});
