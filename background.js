// Load configuration
importScripts('config.js');

const API_BASE_URL = CONFIG.API_BASE_URL;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['jobs', 'settings', 'cachedUserSkills'], (result) => {
    if (!result.jobs) chrome.storage.local.set({ jobs: [] });
    if (!result.cachedUserSkills) chrome.storage.local.set({ cachedUserSkills: [] });
    if (!result.settings) {
      chrome.storage.local.set({
        settings: { freelancerName: '', skills: '', defaultTemplate: 'detailed' }
      });
    }
  });
});

// Handle authentication messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'storeAuth') {
    chrome.storage.local.set({
      authToken: request.token,
      currentUser: request.user
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'getAuth') {
    chrome.storage.local.get(['authToken', 'currentUser'], (result) => {
      sendResponse(result);
    });
    return true;
  }

  if (request.action === 'clearAuth') {
    chrome.storage.local.remove(['authToken', 'currentUser'], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'fetchSkills') {
    (async () => {
      try {
        const storage = await new Promise(resolve => {
          chrome.storage.local.get(['authToken'], resolve);
        });

        const authToken = request.token || storage.authToken;
        const category = request.category;

        if (!authToken || authToken === 'undefined' || authToken === 'null') {
          sendResponse({ success: false, error: 'User not authenticated. Please log in again.' });
          return;
        }

        const url = new URL(`${API_BASE_URL}/skills`);
        if (category) url.searchParams.append('category', category);

        const tenantId = extractTenantFromJWT(authToken);
        if (!tenantId) {
          sendResponse({ success: false, error: 'Session context is missing. Please log out and log in again.' });
          return;
        }

        const skillsResponse = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'x-tenant-id': tenantId,
            'Content-Type': 'application/json'
          }
        });

        if (!skillsResponse.ok) {
          sendResponse({ success: false, error: `Failed to fetch skills: ${skillsResponse.status}` });
          return;
        }

        const skillsData = await skillsResponse.json();
        const userSkills = skillsData.data || skillsData || [];
        const jobSkills = request.jobData?.skills || [];

        // Perform skill matching
        const matchedSkills = [];
        const missingSkills = [];
        const userSkillsLower = userSkills.map(s => (s.name || s).toLowerCase());

        jobSkills.forEach(jobSkill => {
          const jsLower = jobSkill.toLowerCase();
          if (userSkillsLower.includes(jsLower)) {
            matchedSkills.push(jobSkill);
          } else {
            const fuzzyMatch = userSkillsLower.some(us => us.includes(jsLower) || jsLower.includes(us));
            if (fuzzyMatch) {
              matchedSkills.push(jobSkill);
            } else {
              missingSkills.push(jobSkill);
            }
          }
        });

        const matchPercentage = jobSkills.length > 0
          ? Math.round((matchedSkills.length / jobSkills.length) * 100)
          : 0;

        sendResponse({
          success: true,
          data: {
            matchedSkills,
            missingSkills,
            matchPercentage,
            platform: category
          }
        });

      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === 'saveJob') {
    chrome.storage.local.get(['currentUser'], async (authData) => {
      const user = authData.currentUser;
      if (!user || (!user.id && !user._id)) {
        sendResponse({ success: false, message: 'Please login to save jobs.' });
        return;
      }

      const userId = user.id || user._id;
      const storageKey = `jobs_${userId}`;

      chrome.storage.local.get([storageKey], async (data) => {
        let jobs = data[storageKey] || [];
        const jobUrl = request.jobData.jobLink || request.jobData.url;
        const normalizedJobUrl = normalizeUrl(jobUrl);

        const exists = jobs.find(j => {
          const jLink = normalizeUrl(j.jobLink || j.url || j.id);
          return jLink === normalizedJobUrl || j.id === jobUrl || j.jobId === jobUrl;
        });

        if (exists) {
          sendResponse({ success: false, message: 'Job already saved!' });
          return;
        }

        const savedEntry = {
          ...request.jobData,
          id: jobUrl,
          proposal: request.proposal,
          status: 'saved',
          score: request.score || 0,
          templateUsed: request.templateUsed || 'unknown',
          createdAt: new Date().toISOString(),
          sync_status: 'pending'
        };

        const syncResult = await syncJobToBackend(
          request.jobData,
          request.proposal,
          request.score,
          request.templateUsed
        );
        if (syncResult.success) {
          savedEntry.sync_status = 'synced';
          savedEntry.leadId = syncResult.data?.id;
        } else {
          savedEntry.sync_status = 'sync_pending';
        }

        jobs.push(savedEntry);
        const update = {};
        update[storageKey] = jobs;
        chrome.storage.local.set(update, () => {
          if (syncResult.success) {
            sendResponse({
              success: true,
              message: 'Job saved & synced!',
              leadId: syncResult.data?.id
            });
          } else if (syncResult.error === 'NO_AUTH') {
            sendResponse({ success: true, message: 'Saved locally. Please login to sync.' });
          } else {
            sendResponse({ success: true, message: 'Saved locally (Sync failed).' });
          }
        });
      });
    });
    return true;
  }

  if (request.action === 'generateAI') {
    const handleAI = async () => {
      const { authToken } = await chrome.storage.local.get(['authToken']);
      const tenantId = authToken ? extractTenantFromJWT(authToken) : null;

      if (!tenantId) {
        sendResponse({ success: false, message: 'Authentication required for AI features' });
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
            'x-tenant-id': tenantId
          },
          body: JSON.stringify(request.payload)
        });

        if (!response.ok) throw new Error('AI Service Unavailable');
        const result = await response.json();
        sendResponse({ success: true, data: result.data });
      } catch (err) {
        sendResponse({ success: false, message: err.message });
      }
    };
    handleAI();
    return true;
  }

  if (request.action === 'getJobs') {
    chrome.storage.local.get(['currentUser'], (authData) => {
      const user = authData.currentUser;
      if (!user || (!user.id && !user._id)) {
        sendResponse({ success: true, jobs: [] });
        return;
      }
      const userId = user.id || user._id;
      const storageKey = `jobs_${userId}`;
      chrome.storage.local.get([storageKey], (data) => sendResponse({ success: true, jobs: data[storageKey] || [] }));
    });
    return true;
  }

  if (request.action === 'updateJobStatus') {
    chrome.storage.local.get(['currentUser'], (authData) => {
      const user = authData.currentUser;
      if (!user) { sendResponse({ success: false, message: 'Not logged in' }); return; }

      const userId = user.id || user._id;
      const storageKey = `jobs_${userId}`;

      chrome.storage.local.get([storageKey], (data) => {
        let jobs = data[storageKey] || [];
        const idx = jobs.findIndex(j => j.id === request.id || j.jobId === request.id);
        if (idx !== -1) {
          jobs[idx].status = request.status;
          const update = {};
          update[storageKey] = jobs;
          chrome.storage.local.set(update, () => sendResponse({ success: true }));
        } else {
          sendResponse({ success: false, message: 'Job not found' });
        }
      });
    });
    return true;
  }

  if (request.action === 'deleteJob') {
    chrome.storage.local.get(['currentUser'], (authData) => {
      const user = authData.currentUser;
      if (!user) { sendResponse({ success: false, message: 'Not logged in' }); return; }

      const userId = user.id || user._id;
      const storageKey = `jobs_${userId}`;

      chrome.storage.local.get([storageKey], (data) => {
        let jobs = data[storageKey] || [];
        jobs = jobs.filter(j => j.id !== request.id && j.jobId !== request.id);
        const update = {};
        update[storageKey] = jobs;
        chrome.storage.local.set(update, () => sendResponse({ success: true }));
      });
    });
    return true;
  }

  if (request.action === 'retrySync') {
    chrome.storage.local.get(['currentUser'], (authData) => {
      const user = authData.currentUser;
      if (!user) { sendResponse({ success: false, message: 'Not logged in' }); return; }

      const userId = user.id || user._id;
      const storageKey = `jobs_${userId}`;

      chrome.storage.local.get([storageKey], async (data) => {
        let jobs = data[storageKey] || [];
        const jobIdx = jobs.findIndex(j => j.id === request.id || j.jobId === request.id);

        if (jobIdx === -1) {
          sendResponse({ success: false, message: 'Job not found' });
          return;
        }

        const job = jobs[jobIdx];
        const syncResult = await syncJobToBackend(job, job.proposal, job.score, job.templateUsed);

        if (syncResult.success) {
          jobs[jobIdx].sync_status = 'synced';
          jobs[jobIdx].leadId = syncResult.data?.id;
          const update = {};
          update[storageKey] = jobs;
          chrome.storage.local.set(update, () => sendResponse({ success: true }));
        } else {
          sendResponse({ success: false, message: 'Sync failed' });
        }
      });
    });
    return true;
  }

  if (request.action === 'syncSkillsToBackend') {
    (async () => {
      try {
        const { authToken } = await chrome.storage.local.get(['authToken']);

        if (!authToken) {
          sendResponse({ success: false, error: 'User not authenticated' });
          return;
        }

        const tenantId = extractTenantFromJWT(authToken);
        if (!tenantId) {
          sendResponse({ success: false, error: 'Could not resolve tenant context' });
          return;
        }

        const response = await fetch(`${API_BASE_URL}/skills/sync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'x-tenant-id': tenantId,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            skills: request.skills,
            category: request.platform
          })
        });

        const responseText = await response.text();

        if (!response.ok) {
          let errorMessage = `Sync failed with status ${response.status}`;
          if (responseText) {
            if (responseText.trim().startsWith('<')) {
              errorMessage = `Server error (${response.status}): Invalid response format.`;
            } else {
              try {
                const errorData = JSON.parse(responseText);
                errorMessage = errorData.message || errorData.error || errorMessage;
              } catch {
                errorMessage = responseText.substring(0, 150);
              }
            }
          }
          sendResponse({ success: false, error: errorMessage });
          return;
        }

        let result = {};
        try {
          result = JSON.parse(responseText);
        } catch (e) {
          // Response was not JSON
        }

        sendResponse({ success: true, message: result.message || 'Skills synced successfully' });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});

// Handle token from web app
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.token) {
    chrome.storage.local.set({ authToken: request.token }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

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

/**
 * Normalizes a URL for robust comparison across different sessions/tracking params.
 */
function normalizeUrl(url) {
  if (!url) return '';
  let str = url.toLowerCase().trim();

  const upworkMatch = str.match(/(~01[a-f0-9]+)/);
  if (upworkMatch) return upworkMatch[1];

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

// Helper to sync job to backend (Mapped to your LeadData schema)
async function syncJobToBackend(jobData, proposal, score, templateUsed) {
  const { authToken } = await chrome.storage.local.get(['authToken']);
  const tenantId = authToken ? extractTenantFromJWT(authToken) : null;

  if (!tenantId) {
    return { success: false, error: 'NO_AUTH' };
  }

  let platform = 'Upwork';
  const jobLink = jobData.jobLink || jobData.url || '';
  if (jobLink.includes('freelancer.com')) platform = 'Freelancer';
  else if (jobLink.includes('guru.com')) platform = 'Guru';
  
  const leadPayload = {
    tenant_id: tenantId,
    title: jobData.title,
    summary: jobData.summary,
    skills: jobData.skills || [],
    jobLink: jobData.jobLink,
    platform: platform,
    clientName: `${platform} Client (${jobData.clientLocation || 'Global'})`,
    clientMail: `client@${platform.toLowerCase()}.com`,
    clientLocation: jobData.clientLocation,
    duration: jobData.duration,
    postedOn: jobData.postedOn || new Date().toISOString(),
    status: 'Open',
    externalJobId: jobData.jobId,
    experienceLevel: jobData.experienceLevel,
    jobType: jobData.jobType,
    budget: jobData.budget,
    hourlyRate: jobData.hourlyRate,
    clientRating: jobData.clientRating,
    clientSpend: jobData.clientSpend,
    clientJobsPosted: jobData.clientJobsPosted,
    clientPaymentVerified: jobData.clientPaymentVerified || false,
    clientPhoneVerified: jobData.clientPhoneVerified || false,
    aiScore: score || 0,
    proposalText: proposal,
    templateUsed: templateUsed,
    ai_summary: jobData.ai_summary || jobData.aiSummary || '',
    aiSummary: jobData.ai_summary || jobData.aiSummary || '',
    internalNotes: jobData.notes || jobData.internalNotes || '',
    skillAnalysis: jobData.skillAnalysis || null,
    attachments: jobData.attachments || []
  };

  try {
    const response = await fetch(`${API_BASE_URL}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'x-tenant-id': tenantId
      },
      body: JSON.stringify(leadPayload)
    });

    const responseText = await response.text();

    if (!response.ok) {
      let errorMessage = `Backend sync failed with status ${response.status}`;
      if (responseText) {
        if (responseText.trim().startsWith('<')) {
          errorMessage = `Server error (${response.status}): Invalid response format.`;
        } else {
          try {
            const errorData = JSON.parse(responseText);
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch {
            errorMessage = responseText.substring(0, 150);
          }
        }
      }
      throw new Error(errorMessage);
    }

    let responseData = {};
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      // Response was not JSON
    }

    return { success: true, data: responseData.data || responseData };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
