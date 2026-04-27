// Load configuration
importScripts('config.js');

// Force localhost URLs for development
console.log('=== BACKGROUND SCRIPT INIT ===');
console.log('Background script - CONFIG available:', typeof CONFIG !== 'undefined');

// Temporarily force localhost URLs to fix the issue
API_BASE_URL = 'http://localhost:5001/api';
console.log('=== FORCING LOCALHOST URL FOR DEVELOPMENT ===');
console.log('=== FINAL API_BASE_URL:', API_BASE_URL, '===');

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
    console.log('Storing auth data in background script');
    chrome.storage.local.set({
      authToken: request.token,
      currentUser: request.user
    }, () => {
      console.log('Auth data stored in background');
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'getAuth') {
    chrome.storage.local.get(['authToken', 'currentUser'], (result) => {
      console.log('Retrieved auth data from background:', result);
      sendResponse(result);
    });
    return true;
  }
  
  if (request.action === 'clearAuth') {
    chrome.storage.local.remove(['authToken', 'currentUser'], () => {
      console.log('Auth data cleared from background');
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'fetchSkills') {
    (async () => {
      try {
        // Safer storage retrieval
        const storage = await new Promise(resolve => {
          chrome.storage.local.get(['authToken'], resolve);
        });
        
        const authToken = request.token || storage.authToken;
        const category = request.category;
        
        console.log('=== SKILLS FETCH DEBUG ===');
        console.log('Category:', category);
        console.log('Auth Token Present:', !!authToken);
        
        if (!authToken || authToken === 'undefined' || authToken === 'null') {
          console.error('Skill Matching: No valid auth token found');
          sendResponse({ success: false, error: 'User not authenticated. Please log in again.' });
          return;
        }


        console.log(`Background script fetching skills for category: ${category}...`);
        console.log(`Background script using API_BASE_URL: ${API_BASE_URL}`);
        
        const url = new URL(`${API_BASE_URL}/skills`);
        if (category) url.searchParams.append('category', category);
        
        console.log(`Background script fetching from URL: ${url.toString()}`);

        const tenantId = extractTenantFromJWT(authToken);
        console.log('Background: Using Dynamic Tenant ID:', tenantId);
        
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
          const text = await skillsResponse.text();
          console.error('Background API Error:', text);
          sendResponse({ success: false, error: `Failed to fetch skills: ${skillsResponse.status}` });
          return;
        }

        const skillsData = await skillsResponse.json();
        console.log('Skills data received:', skillsData);
        
        const userSkills = skillsData.data || skillsData || [];
        const jobSkills = request.jobData?.skills || [];
        
        // Perform skill matching
        const matchedSkills = [];
        const missingSkills = [];

        // Find matched skills (case-insensitive exact match preferred)
        const jobSkillsLower = jobSkills.map(s => s.toLowerCase());
        const userSkillsLower = userSkills.map(s => (s.name || s).toLowerCase());

        jobSkills.forEach(jobSkill => {
          const jsLower = jobSkill.toLowerCase();
          if (userSkillsLower.includes(jsLower)) {
            matchedSkills.push(jobSkill);
          } else {
            // Also check fuzzy inclusion for robustness
            const fuzzyMatch = userSkillsLower.some(us => us.includes(jsLower) || jsLower.includes(us));
            if (fuzzyMatch) {
              matchedSkills.push(jobSkill);
            } else {
              missingSkills.push(jobSkill);
            }
          }
        });

        // Calculate match percentage based on JOB skills needed
        const matchPercentage = jobSkills.length > 0 
          ? Math.round((matchedSkills.length / jobSkills.length) * 100)
          : 0;

        console.log('Background match results:', { matchedSkills, missingSkills, matchPercentage });

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
        console.error('Background fetch error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

});

// Handle token from web app
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  console.log('=== TOKEN SYNC DEBUG ===');
  console.log('Extension ID:', chrome.runtime.id);
  console.log('Expected ID:', 'magcgpahmioofihhcfeaaomacdepnhcn');
  console.log('ID matches:', chrome.runtime.id === 'magcgpahmioofihhcfeaaomacdepnhcn');
  console.log('External message received:', request);
  console.log('Sender origin:', sender.origin);
  
  if (request.token) {
    console.log('Token sync received:', {
      hasToken: !!request.token,
      tokenLength: request.token.length,
      tokenStart: request.token.substring(0, 20) + '...',
      senderOrigin: sender.origin
    });
    
    chrome.storage.local.set({ authToken: request.token }, () => {
      console.log('Storage set completed');
      if (chrome.runtime.lastError) {
        console.error('Storage error:', chrome.runtime.lastError);
      } else {
        console.log('Auth token stored successfully');
      }
      sendResponse({ success: true });
    });
    return true;
  } else {
    console.log('No token in request, request keys:', Object.keys(request));
  }
});

// Helper to extract tenant ID from JWT token
function extractTenantFromJWT(token) {
  try {
    console.log('JWT Token parts:', token.split('.').length);
    const payloadPart = token.split('.')[1];
    console.log('Payload part length:', payloadPart.length);
    const payload = JSON.parse(atob(payloadPart));
    console.log('Decoded JWT payload:', payload);
    console.log('Tenant ID from payload:', payload.tenantId);
    return payload.tenantId;
  } catch (error) {
    console.error('Failed to extract tenant from JWT:', error);
    console.error('Token start:', token.substring(0, 50) + '...');
    return null;
  }
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

// Helper to sync job to backend (Mapped to your LeadData schema)
async function syncJobToBackend(jobData, proposal, score, templateUsed) {
  // Try to resolve tenant from auth token
  const { authToken } = await chrome.storage.local.get(['authToken']);
  const tenantId = authToken ? extractTenantFromJWT(authToken) : null;

  
  if (!tenantId) {
    console.error('SyncJobToBackend - No tenant ID found in session');
    return { success: false, error: 'NO_AUTH' };
  }

  console.log('Using resolved tenant ID:', tenantId);


    const platform = jobData.jobLink.includes('freelancer.com') ? 'Freelancer' : 'Upwork';
    const leadPayload = {
    tenant_id: tenantId, // Add tenant ID
    title: jobData.title,
    summary: jobData.summary,
    skills: jobData.skills || [],
    jobLink: jobData.jobLink,
    clientName: `${platform} Client (${jobData.clientLocation || 'Global'})`,
    clientMail: `client@${platform.toLowerCase()}.com`, // Placeholder for required field
    clientLocation: jobData.clientLocation,
    duration: jobData.duration,
    postedOn: jobData.postedOn || new Date().toISOString(), // Use actual job posting date or fallback
    status: 'Open',
    
    // Job Metadata
    externalJobId: jobData.jobId,
    experienceLevel: jobData.experienceLevel,
    jobType: jobData.jobType,
    budget: jobData.budget,
    hourlyRate: jobData.hourlyRate,
    
    // Client Quality Data
    clientRating: jobData.clientRating,
    clientSpend: jobData.clientSpend,
    clientJobsPosted: jobData.clientJobsPosted,
    clientPaymentVerified: jobData.clientPaymentVerified || false,
    clientPhoneVerified: jobData.clientPhoneVerified || false,
    
    // AI & Proposal Data
    aiScore: score || 0,
    proposalText: proposal,
    templateUsed: templateUsed,
    ai_summary: jobData.ai_summary || jobData.aiSummary || '',
    aiSummary: jobData.ai_summary || jobData.aiSummary || '',
    internalNotes: jobData.notes || jobData.internalNotes || '',
    skillAnalysis: jobData.skillAnalysis || null,
    attachments: jobData.attachments || []
  };

  console.log('Background: Constructed leadPayload:', leadPayload);

  try {
    console.log('=== EXTENSION API REQUEST DEBUG ===');
    console.log('API URL:', `${API_BASE_URL}/leads`);
    console.log('Request method: POST');
    console.log('Request headers:', {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId
    });
    console.log('Request payload:', JSON.stringify(leadPayload, null, 2));
    console.log('Payload stringified for comparison:', JSON.stringify(leadPayload));
    
    const response = await fetch(`${API_BASE_URL}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId
      },
      body: JSON.stringify(leadPayload)
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('Response body:', responseText);

    if (!response.ok) {
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch {
        errorData = { message: responseText };
      }
      throw new Error(errorData.message || `Backend sync failed with status ${response.status}`);
    }
    
    let responseData = {};
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.log('Response was not JSON');
    }

    console.log('Lead saved successfully to backend');
    return { success: true, data: responseData.data || responseData };
  } catch (err) {
    console.error('Sync Error:', err);
    console.error('Error details:', err.stack);
    return { success: false, error: err.message };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
          sync_status: 'pending' // Initial status
        };
        
        // 1. Sync to backend with LeadData mapping
        const syncResult = await syncJobToBackend(
          request.jobData, 
          request.proposal, 
          request.score, 
          request.templateUsed
        );
        if (syncResult.success) {
          savedEntry.sync_status = 'synced';
          savedEntry.leadId = syncResult.data?.id; // Store leadId
        } else {
          savedEntry.sync_status = 'sync_pending';
        }

        // 2. Save locally
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

      console.log('AI Generation - Using dynamic tenant ID:', tenantId);
      console.log(`AI Generation - using API_BASE_URL: ${API_BASE_URL}`);

      try {
        const generateUrl = `${API_BASE_URL}/generate`;
        console.log(`AI Generation - fetching from URL: ${generateUrl}`);
        
        const response = await fetch(generateUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
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
          jobs[jobIdx].leadId = syncResult.data?.id; // Store leadId on retry
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
        console.log('Background: Syncing skills to backend...');
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

        console.log('Syncing for Tenant:', tenantId);

        const response = await fetch(`${API_BASE_URL}/skills/sync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'x-tenant-id': tenantId,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            skills: request.skills,
            category: request.platform // Map platform to category
          })
        });

        const result = await response.json();
        console.log('Sync Results:', result);
        
        if (response.ok) {
          sendResponse({ success: true, message: result.message });
        } else {
          sendResponse({ success: false, error: result.message || 'Sync failed' });
        }
      } catch (error) {
        console.error('Background Sync Error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});
