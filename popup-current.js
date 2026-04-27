/**
 * popup.js - Fixed version with proper authentication
 */

// Authentication state
let isAuthenticated = false;
let currentUser = null;

// Check authentication on load
function checkAuth() {
  console.log('Checking authentication...');
  chrome.storage.local.get(['authToken', 'currentUser'], (result) => {
    console.log('Storage result:', result);
    if (result.authToken && result.currentUser) {
      console.log('Found stored credentials, showing main interface');
      isAuthenticated = true;
      currentUser = result.currentUser;
      showMainInterface();
    } else {
      console.log('No stored credentials found, showing login');
      showLoginInterface();
    }
  });
}

// Show login interface
function showLoginInterface() {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('extractorView').classList.add('hidden');
  document.getElementById('savedJobsView').classList.add('hidden');
  document.getElementById('logoutBtn').style.display = 'none';
}

// Show main interface after login
function showMainInterface() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('extractorView').classList.remove('hidden');
  document.getElementById('logoutBtn').style.display = 'block';
  initializeApp();
}

// Handle login
async function handleLogin(email, password) {
  try {
    console.log('Attempting login with:', email);
    const response = await fetch(`${CONFIG.API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'b85c1b5b-77a3-4281-9147-51d6bd3ee94d'
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    console.log('Login response:', data);
    
    if (data.success) {
      console.log('Login successful, storing credentials...');
      isAuthenticated = true;
      currentUser = data.user;
      
      // Store auth data
      chrome.storage.local.set({
        authToken: data.token,
        currentUser: data.user
      }, () => {
        console.log('Credentials stored successfully');
        showMainInterface();
        showToast('Login successful!');
      });
    } else {
      console.log('Login failed:', data.message);
      showLoginError(data.message || 'Invalid credentials');
    }
  } catch (error) {
    console.error('Login error:', error);
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
  }, 3000);
}

// Handle logout
function handleLogout() {
  isAuthenticated = false;
  currentUser = null;
  
  chrome.storage.local.remove(['authToken', 'currentUser'], () => {
    showLoginInterface();
    showToast('Logged out successfully');
  });
}

// Show toast message
function showToast(message) {
  const toast = document.getElementById('statusToast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// Initialize app after authentication
function initializeApp() {
  console.log('Initializing app...');
  
  const extractBtn = document.getElementById('extractBtn');
  const generateBtn = document.getElementById('generateBtn');
  const saveBtn = document.getElementById('saveBtn');
  const templateSelect = document.getElementById('templateSelect');

  const extractorView = document.getElementById('extractorView');
  const savedJobsView = document.getElementById('savedJobsView');

  let currentJobData = null;
  let userSettings = null;

  // Load user settings
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {};
    if (settings) {
      userSettings = settings;
      if (settings.defaultTemplate) templateSelect.value = settings.defaultTemplate;
    }
  });

  // Navigation event listeners
  document.getElementById('optionsBtn').addEventListener('click', (e) => { 
    e.preventDefault(); 
    chrome.runtime.openOptionsPage(); 
  });
  
  document.getElementById('viewExtractorBtn').addEventListener('click', (e) => { 
    e.preventDefault(); 
    switchView('extractor'); 
  });
  
  document.getElementById('viewSavedBtn').addEventListener('click', (e) => { 
    e.preventDefault(); 
    switchView('saved'); 
    loadSavedJobs(); 
  });

  function switchView(view) {
    if (view === 'extractor') {
      extractorView.classList.remove('hidden'); 
      savedJobsView.classList.add('hidden');
      document.getElementById('viewExtractorBtn').classList.add('active'); 
      document.getElementById('viewSavedBtn').classList.remove('active');
    } else {
      extractorView.classList.add('hidden'); 
      savedJobsView.classList.remove('hidden');
      document.getElementById('viewExtractorBtn').classList.remove('active'); 
      document.getElementById('viewSavedBtn').classList.add('active');
    }
  }

  // Load saved jobs function
  function loadSavedJobs() {
    const listEl = document.getElementById('savedJobsList');
    listEl.innerHTML = '<div class="spinner"></div>';

    chrome.runtime.sendMessage({ action: 'getJobs' }, (res) => {
      listEl.innerHTML = '';
      const jobs = res.jobs || [];
      if (jobs.length === 0) { 
        document.getElementById('emptyJobsMsg').classList.remove('hidden'); 
        return; 
      }
      document.getElementById('emptyJobsMsg').classList.add('hidden');

      jobs.reverse().forEach(job => {
        const bdg = getScoreBadgeClass(job.score || 0);
        const card = document.createElement('div');
        card.className = 'card crm-card';
        card.innerHTML = `
          <h3 style="margin-bottom: 10px; line-height: 1.4;">
            <a href="${job.jobLink || job.id}" target="_blank" style="text-decoration:none; color:inherit;">${job.title}</a>
          </h3>
          <div style="display:flex; gap: 6px; flex-wrap:wrap; margin-bottom: 10px; align-items: center;">
             <span class="score-badge ${bdg.class}" style="font-size:11px; padding: 4px 8px;">${job.score || 0}</span>
             <div class="badge ${job.status === 'applied' ? 'applied' : ''}" style="margin:0;">${job.jobType === 'hourly' ? 'Hourly' : 'Fixed-Price'}: ${job.budget !== 'N/A' ? job.budget : (job.hourlyRate || job.budget)}</div>
             <div class="badge" style="margin:0;">Template: ${job.templateUsed || 'Custom'}</div>
             <div class="badge ${job.sync_status === 'synced' ? 'applied' : 'score-low'}" style="margin:0; font-size:10px;">${job.sync_status === 'synced' ? 'Synced' : 'Pending'}</div>
          </div>
          <p class="crm-desc">${job.summary || job.description || ''}</p>
          <div class="crm-actions">
            ${job.status !== 'applied' ? `<button class="outline-btn apply-job-btn" data-id="${job.id || job.jobId}">Mark Applied</button>` : ''}
            <button class="outline-btn danger-btn delete-job-btn" data-id="${job.id || job.jobId}">Delete</button>
          </div>
        `;
        listEl.appendChild(card);
      });

      document.querySelectorAll('.apply-job-btn').forEach(b => b.addEventListener('click', e => updateJobStatus(e.target.dataset.id, 'applied')));
      document.querySelectorAll('.delete-job-btn').forEach(b => b.addEventListener('click', e => deleteJob(e.target.dataset.id)));
    });
  }

  function updateJobStatus(id, status) { 
    chrome.runtime.sendMessage({ action: 'updateJobStatus', id, status }, (res) => { 
      if (res.success) { 
        showToast('Status updated'); 
        loadSavedJobs(); 
      } 
    }); 
  }
  
  function deleteJob(id) { 
    if (!confirm('Delete this?')) return; 
    chrome.runtime.sendMessage({ action: 'deleteJob', id }, (res) => { 
      if (res.success) { 
        showToast('Deleted'); 
        loadSavedJobs(); 
      } 
    }); 
  }

  function getScoreBadgeClass(score) {
    if (score >= 80) return { class: 'score-high', text: 'High Value' };
    if (score >= 50) return { class: 'score-med', text: 'Medium Value' };
    return { class: 'score-low', text: 'Low Value' };
  }

  console.log('App initialized successfully');
}

// Main execution
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, setting up authentication...');
  
  // Authentication event listeners
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    handleLogin(email, password);
  });
  
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  
  // Check authentication on load
  checkAuth();
});
