/**
 * popup.js
 * State-driven UI for main extension and CRM views.
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
    const response = await fetch(`${CONFIG.API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'b85c1b5b-77a3-4281-9147-51d6bd3ee94d'
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
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
        // Verify storage
        chrome.storage.local.get(['authToken', 'currentUser'], (result) => {
          console.log('Verification - stored data:', result);
        });
        showMainInterface();
        showToast('Login successful!');
      });
    } else {
      console.log('Login failed:', data.message);
      showLoginError(data.message || 'Invalid credentials');
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
  if (job.budget && job.budget.includes("$")) score += 20;

  if (job.clientSpend) {
    const rawSpend = job.clientSpend.replace(/[^0-9]/g, '');
    if (rawSpend && parseInt(rawSpend) > 1000) score += 20;
    else if (rawSpend && parseInt(rawSpend) > 100) score += 10;
  }

  if (job.clientRating) {
    const rawRating = parseFloat(job.clientRating.replace(/[^0-9.]/g, ''));
    if (!isNaN(rawRating) && rawRating >= 4.0) score += 20;
  }

  // Notice we now use summary since we renamed description to summary
  if (job.summary && job.summary.length > 300) score += 20;
  if (job.summary && job.summary.toLowerCase().includes("long term")) score += 20;

  return Math.min(score, 100);
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

// Initialize app after authentication
// DOMContentLoaded wrapper
document.addEventListener('DOMContentLoaded', function() {
  // Helper functions
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

  function initializeApp() {
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
    document.getElementById('optionsBtn').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
    document.getElementById('viewExtractorBtn').addEventListener('click', (e) => { e.preventDefault(); switchView('extractor'); });
    document.getElementById('viewSavedBtn').addEventListener('click', (e) => { e.preventDefault(); switchView('saved'); loadSavedJobs(); });

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
      ['idleState', 'loadingState', 'errorState', 'jobDetails'].forEach(id => document.getElementById(id).classList.add('hidden'));
      if (state === 'idle') document.getElementById('idleState').classList.remove('hidden');
      if (state === 'loading') { document.getElementById('loadingMsg').innerText = message || 'Loading...'; document.getElementById('loadingState').classList.remove('hidden'); }
      if (state === 'error') { document.getElementById('errorMsg').innerText = message || 'Error'; document.getElementById('errorState').classList.remove('hidden'); }
      if (state === 'success') document.getElementById('jobDetails').classList.remove('hidden');
    }

    function showToast(msg) {
      const toast = document.getElementById('statusToast');
      toast.innerText = msg; toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 3000);
    }

    const doExtraction = async () => {
      setExtractorState('loading', 'Injecting script...');
      extractBtn.disabled = true;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) { setExtractorState('error', 'No active tab found.'); return; }

      chrome.tabs.sendMessage(tab.id, { action: "extractJob" }, (response) => {
        extractBtn.disabled = false;
        if (chrome.runtime.lastError) return setExtractorState('error', 'Could not sync. Ensure you are on an active Upwork job page.');
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

    function populateExtractedJob(data) {
      document.getElementById('jobTitle').innerText = data.title;
      
      if (data.jobLink) {
          document.getElementById('uiJobLink').innerText = data.jobLink;
          document.getElementById('uiJobLink').href = data.jobLink;
          document.getElementById('jobLinkContainer').classList.remove('hidden');
      }

      // Formatting Job Type and Budget dynamically
      let budgetDisplay = data.budget !== 'N/A' ? data.budget : data.hourlyRate;
      let typeDisplay = data.jobType === 'hourly' ? "Hourly" : "Fixed-Price";
      document.getElementById('jobBudgetWrap').innerText = budgetDisplay !== 'N/A' ? `${typeDisplay}: ${budgetDisplay}` : `${typeDisplay}: Budget hidden`;

      // Expanded Metadata
      document.getElementById('clientLocation').innerText = data.clientLocation;
      document.getElementById('clientRating').innerText = data.clientRating;

      // Custom logic for grid badge validations
      const payEl = document.getElementById('clientPaymentStat');
      if (data.clientPaymentVerified) { payEl.innerText = 'Verified'; payEl.className = 'stat-value verified-green'; }
      else { payEl.innerText = 'Unverified'; payEl.className = 'stat-value'; }

      const phoneEl = document.getElementById('clientPhoneStat');
      if (data.clientPhoneVerified) { phoneEl.innerText = 'Verified'; phoneEl.className = 'stat-value verified-green'; }
      else { phoneEl.innerText = 'Unverified'; phoneEl.className = 'stat-value'; }

      document.getElementById('postedTime').innerText = formatPostedDate(data.postedOn);
      document.getElementById('jobDurationWrap').innerText = `Duration: ${data.duration}`;
      document.getElementById('jobExperienceWrap').innerText = `Level: ${data.experienceLevel}`;

      // Skills Badges Wrapper Array Processing
      const skillsContainer = document.getElementById('jobSkills');
      const skillsSection = document.getElementById('skillsSection');
      skillsContainer.innerHTML = ''; // clear out
      skillsSection.classList.remove('hidden'); // Always render the card natively so user knows it executed

      if (data.skills && data.skills.length > 0) {
        data.skills.forEach(skill => {
          const span = document.createElement('span');
          span.className = 'skill-chip';
          span.innerText = skill;
          skillsContainer.appendChild(span);
        });
      } else {
        skillsContainer.innerHTML = '<span class="text-muted" style="font-size:12px;">No explicit skills tagged.</span>';
      }

      // Attachments Render
      const attachContainer = document.getElementById('jobAttachments');
      attachContainer.innerHTML = '<span style="font-weight:600; font-size:12px; margin-right:5px; color:#555;">Attachments:</span>';
      if (data.attachments && data.attachments.length > 0) {
        data.attachments.forEach(att => {
          const span = document.createElement('span');
          span.className = 'skill-chip';
          span.style.backgroundColor = '#f1f5f9';
          span.style.color = '#334155';
          span.style.textDecoration = 'underline';
          span.innerText = att;
          attachContainer.appendChild(span);
        });
        attachContainer.classList.remove('hidden');
      } else {
        attachContainer.classList.add('hidden');
      }

      document.getElementById('jobDescription').innerText = data.summary || data.description || '';

      // AI Summary Trigger Logic
      const aiSec = document.getElementById('aiSummarySection');
      const aiLoader = document.getElementById('aiSummaryLoader');
      const aiList = document.getElementById('aiSummaryPoints');

      aiList.classList.add('hidden');
      aiList.innerHTML = '';

      if (data.summary && data.summary.length > 50) {
        aiSec.classList.remove('hidden');
        aiLoader.classList.remove('hidden');

        generateGeminiSummary(data.summary).then(points => {
          aiLoader.classList.add('hidden');
          points.forEach(pt => {
            const li = document.createElement('li');
            li.innerText = pt;
            li.style.marginBottom = '6px';
            aiList.appendChild(li);
          });
          aiList.classList.remove('hidden');
        }).catch(() => {
          aiLoader.innerText = "Error parsing AI Summary. Ensure API constraints are valid.";
        });
      } else {
        aiSec.classList.add('hidden');
      }

      const score = scoreJob(data);
      data.calculatedScore = score;
      const badgeInfo = getScoreBadgeClass(score);
      const badgeEl = document.getElementById('jobScoreBadge');
      badgeEl.className = `score-badge ${badgeInfo.class}`;
      badgeEl.innerText = `${score}/100 - ${badgeInfo.text}`;

      document.getElementById('proposalBox').classList.add('hidden');
      generateBtn.classList.remove('hidden');
    }

    generateBtn.addEventListener('click', async () => {
      if (!currentJobData) return;
      generateBtn.disabled = true; generateBtn.innerText = "Generating...";
      const proposal = await generateAIProposal(currentJobData, userSettings, templateSelect.value);
      document.getElementById('proposalTextarea').value = proposal;
      document.getElementById('proposalBox').classList.remove('hidden');
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
        copyBtn.innerText = 'Copied!';
        setTimeout(() => copyBtn.innerText = originalText, 2000);
      });
    }

    saveBtn.addEventListener('click', () => {
      if (!currentJobData) return;
      saveBtn.disabled = true; saveBtn.innerText = "Saving...";

      const payload = {
        action: 'saveJob',
        jobData: currentJobData,
        proposal: document.getElementById('proposalTextarea').value.trim(),
        score: currentJobData.calculatedScore,
        templateUsed: templateSelect.value
      };

      chrome.runtime.sendMessage(payload, (resp) => {
        saveBtn.disabled = false; saveBtn.innerText = "Save Job & Proposal";
        if (resp && resp.success) {
          showToast('Successfully saved!');
          setTimeout(() => switchView('saved'), 1000);
          setTimeout(loadSavedJobs, 1100);
        } else { showToast(resp?.message || 'Error saving job.'); }
      });
    });

    function loadSavedJobs() {
      const listEl = document.getElementById('savedJobsList');
      listEl.innerHTML = '<div class="spinner"></div>';

      chrome.runtime.sendMessage({ action: 'getJobs' }, (res) => {
        listEl.innerHTML = '';
        const jobs = res.jobs || [];
        if (jobs.length === 0) { document.getElementById('emptyJobsMsg').classList.remove('hidden'); return; }
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
      });
    }
  }

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
  
  // Add event listeners for dynamically created elements
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('apply-job-btn')) {
      updateJobStatus(e.target.dataset.id, 'applied');
    }
    if (e.target.classList.contains('delete-job-btn')) {
      deleteJob(e.target.dataset.id);
    }
  });
});
