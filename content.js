/**
 * content.js
 * Extracts job details from Upwork job pages.
 */

// Helper to validate extracted job data and calculate confidence
const validateJobData = (data) => {
  const missingFields = [];
  let score = 0;

  // Critical Fields (Weight: 40 each)
  if (data.title && data.title !== 'Title not found') score += 40; else missingFields.push('Title');
  if (data.summary && data.summary !== 'Summary not found') score += 40; else missingFields.push('Description');

  // Secondary Fields (Weight: 4 each)
  if (data.skills && data.skills.length > 0) score += 4; else missingFields.push('Skills');
  if (data.budget !== 'N/A' || data.hourlyRate !== 'N/A') score += 4; else missingFields.push('Budget/Rate');
  if (data.clientLocation !== 'N/A') score += 4; else missingFields.push('Location');
  if (data.clientRating !== 'N/A') score += 4; else missingFields.push('Rating');
  if (data.postedOn !== 'N/A') score += 4; else missingFields.push('Posted Date');

  let confidence = 'high';
  let message = 'Extraction successful! Most fields were found.';
  
  if (score < 85) {
    confidence = 'medium';
    message = 'Partial extraction. Some secondary fields (like budget or skills) were not found.';
  }
  if (score < 60) {
    confidence = 'low';
    message = 'Low confidence. Critical fields like the title or description may be missing. Try scrolling down and extracting again.';
  }

  return { score, confidence, message, missingFields };
};

// Platform Detection
const getPlatform = () => {
    const host = window.location.hostname;
    if (host.includes('upwork.com')) return 'upwork';
    if (host.includes('freelancer.com')) return 'freelancer';
    if (host.includes('guru.com')) return 'guru';
    // if (host.includes('toptal.com')) return 'toptal';
    // if (host.includes('fiverr.com')) return 'fiverr';
    return 'unknown';
};

const isProfilePage = () => {
  const path = window.location.pathname;
  const host = window.location.hostname;
  
  // Upwork patterns
  if (host.includes('upwork.com')) {
    return path.includes('/freelancers/') || path.includes('/profile/') || path.includes('/nx/find-work/profile/');
  }
  
  // Freelancer patterns
  if (host.includes('freelancer.com')) {
    return path.includes('/u/') || path.includes('/freelancers/') || path.includes('/me') || path.includes('/profile/');
  }
  
  return false;
};

// Global selectors for user skills to be used across extraction and caching
const USER_SKILL_SELECTORS = [
  // 1. Sidebar on Find Work feed (Upwork)
  '[data-test="my-profile-sidebar"] [data-qa="skill"]',
  '[data-test="my-profile-sidebar"] .air3-token',
  '#my-profile-sidebar [data-qa="skill"]',
  'section[aria-labelledby="my-profile-sidebar"] .air3-token',
  
  // 2. Profile Page (Dedicated /freelancers/ page)
  '[data-test="skills"] [data-test="skill"]',
  '[data-test="skills"] .air3-token',
  '[data-test="skills-section"] .air3-token',
  '[data-qa="skills"] [data-qa="skill"]',
  '[data-qa="skills"] .air3-token',
  '.visitor-profile-skills .air3-token',
  '.up-skill-badge-text',
  '.up-skill-badge',
  
  // 3. Mini Profile / Other profile containers
  '[data-qa="my-profile"] [data-qa="skill"]',
  '.up-sidebar [data-qa="skill"]',

  // 4. Freelancer.com Profile Selectors (Top skills)
  'fl-tag .fl-tag-text',
  '.SkillList-item',
  '.SkillBadge',
  '.UserSkill-name',
  '[data-active-skill="true"]',
  '.SkillBadge-name',
  'fl-profile-skills fl-tag'
];

// Helper to extract skills from document (global scope)
const extractSkillsFromDocument = (selectors, excludeContext = null) => {
  let items = [];
  
  // Containers to explicitly ignore (Job Cards in the feed)
  // We only ignore these if we are NOT on a profile page
  const ignoreContainers = isProfilePage() ? '' : '.job-tile, [data-test="job-tile"], .air3-slider, .up-slider, .up-modal';
  

  for (let sel of selectors) {
    try {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        for (let i = 0; i < els.length; i++) {
          const el = els[i];
          
          // CRITICAL: Skip elements that are inside the current extraction overlay
          if (excludeContext && excludeContext !== document && excludeContext.contains(el)) {
            continue;
          }

          // EXTRA SAFETY: Skip elements inside Job Tiles on the feed (skipped on profile page)
          if (ignoreContainers && el.closest(ignoreContainers)) {
            continue;
          }

          let text = el.innerText || el.textContent || '';
          text = text.trim();

          // Handle Freelancer modal tags that usually have an " x" at the end (remove button)
          if (text.toLowerCase().endsWith(' x')) {
              text = text.substring(0, text.length - 2).trim();
          }

          if (text && !items.includes(text) && text.length > 1) {
            // Further validation: Expertise tokens are usually 1-3 words
            const wordCount = text.split(/\s+/).length;
            if (wordCount <= 4) {
              items.push(text);
            }
          }
        }
      }
    } catch (e) { }
  }

  // If we are on a profile page and found nothing, try a last-ditch global search
  if (isProfilePage() && items.length === 0) {
    const host = window.location.hostname;
    
    if (host.includes('upwork.com')) {
      const allTokens = document.querySelectorAll('.air3-token, [data-test="skill"]');
      allTokens.forEach(el => {
        let text = el.innerText || el.textContent || '';
        text = text.trim();
        if (text && !items.includes(text) && text.length > 1 && text.length < 50) {
          if (text.split(/\s+/).length <= 4) items.push(text);
        }
      });
    }

    if (host.includes('freelancer.com')) {
      // 1. Find section by header text
      const headers = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, fl-text, span, div.SectionTitle'));
      const skillsHeader = headers.find(h => {
        const t = (h.innerText || '').toLowerCase();
        return t === 'top skills' || t === 'skills' || t.includes('top skills');
      });

      if (skillsHeader) {
        // Look for tags/badges in the immediate section
        const container = skillsHeader.closest('section, div, fl-bit') || skillsHeader.parentElement;
        const tags = container.querySelectorAll('fl-tag, .fl-tag, a, span.SkillBadge, .SkillList-item');
        tags.forEach(el => {
          let text = el.innerText || el.textContent || '';
          text = text.trim();
          if (text && !items.includes(text) && text.length > 1 && text.length < 40) {
            if (text.split(/\s+/).length <= 4 && !text.includes('\n') && !text.includes('skills')) {
              items.push(text);
            }
          }
        });
      }

      // 2. Generic tag fallback
      if (items.length === 0) {
        const allTags = document.querySelectorAll('fl-tag .fl-tag-text, fl-tag, .fl-tag, .SkillBadge, .UserSkill-name');
        allTags.forEach(el => {
          let text = el.innerText || el.textContent || '';
          text = text.trim();
          if (text && !items.includes(text) && text.length > 1 && text.length < 40) {
            items.push(text);
          }
        });
      }
    }
  }

  return items;
};

// Background Skill Caching
const tryCacheUserSkills = () => {
    const platform = getPlatform();
    if (platform === 'unknown') return;

    // Identify current job slider/modal to EXCLUDE it from user skill matching
    // FIX: If we are on a profile page, we SHOULD scan the modal! 
    const currentOverlay = isProfilePage() ? null : document.querySelector('.air3-slider, .up-slider, .up-modal, [role="dialog"], fl-modal, .JobDescription');

    const skills = extractSkillsFromDocument(USER_SKILL_SELECTORS, currentOverlay);
    
    // Filter out common job-specific skills if found in the main content instead of sidebar
    const filteredSkills = skills.filter(s => s.length > 1 && s.length < 40);

    if (filteredSkills.length > 0) {
        const storageKey = `cachedUserSkills_${platform}`;
        const update = {};
        update[storageKey] = filteredSkills;
        chrome.storage.local.set(update);
        return true;
    }
    return false;
};

// More aggressive caching: Multiple attempts during page load/hydration
[1000, 3000, 6000, 10000].forEach(delay => {
    setTimeout(tryCacheUserSkills, delay);
});

// Core Extraction Logic for Upwork
const performUpworkExtraction = () => {
    // 0. Scope to active modal/slider if present (fixes background feed bleeding)
    let searchContext = document;
    const overlays = document.querySelectorAll('.air3-slider, .up-slider, .up-modal, [role="dialog"], [data-test="job-details"]');
    let maxArea = 0;

    for (let i = 0; i < overlays.length; i++) {
      const rect = overlays[i].getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > maxArea && area > 50000) {
        maxArea = area;
        searchContext = overlays[i];
      }
    }

    // 1. Safe Extractor Helper
    const getText = (selectors, fallback = 'N/A', excludeTexts = []) => {
      const findText = (context) => {
        for (let sel of selectors) {
          try {
            const els = context.querySelectorAll(sel);
            for (let i = els.length - 1; i >= 0; i--) {
              const el = els[i];
              let text = el.innerText || '';
              if (!text.trim()) text = el.textContent || '';
              text = text.trim();

              if (text && text.length > 2) {
                let isExcluded = false;
                const lower = text.toLowerCase();
                for (let ex of excludeTexts) {
                  if (lower.includes(ex)) { isExcluded = true; break; }
                }
                if (!isExcluded) return text;
              }
            }
          } catch (e) { }
        }
        return null;
      };

      let res = findText(searchContext);
      
      // Fallback to document ONLY if searchContext is not an overlay/modal
      // This prevents background leakage when a slider is open
      const isOverlay = searchContext !== document;
      if (!res && !isOverlay) {
        res = findText(document);
      }

      return res || fallback;
    };

    // New Helper: Find value by searching for a text label nearby
    const getByLabel = (labelName, fallback = 'N/A') => {
        const lowerLabel = labelName.toLowerCase();
        const walker = document.createTreeWalker(searchContext, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.toLowerCase().includes(lowerLabel)) {
                const parent = node.parentElement;
                // Look for siblings or descendants of the parent that might contain the value
                if (parent) {
                    const sibling = parent.nextElementSibling;
                    if (sibling && sibling.innerText && sibling.innerText.length > 1) return sibling.innerText.trim();
                    
                    const nextParentSibling = parent.parentElement ? parent.parentElement.nextElementSibling : null;
                    if (nextParentSibling && nextParentSibling.innerText && nextParentSibling.innerText.length > 1) return nextParentSibling.innerText.trim();
                }
            }
        }
        return fallback;
    };

    // Helper to fetch array lists (like Skills)
    const getArray = (selectors) => {
      let items = [];
      const contextOptions = [searchContext];
      
      // Only include document fallback if we aren't in a specific overlay
      if (searchContext === document) {
        // No change needed
      } else {
        // If we're in an overlay, we strictly search the overlay for job details
      }

      for (let context of contextOptions) {
        for (let sel of selectors) {
          try {
            const els = context.querySelectorAll(sel);
            if (els.length > 0) {
              for (let i = 0; i < els.length; i++) {
                let text = els[i].innerText || els[i].textContent || '';
                text = text.trim();
                if (text && !items.includes(text) && text.length > 1) items.push(text);
              }
              if (items.length > 0) return items;
            }
          } catch (e) { }
        }
      }
      return items;
    };

    // 2. Extract Basic Core
    const titleExclusions = ['contract-to-hire', 'featured', 'enterprise', 'urgent', 'saved', 'job details'];
    const title = getText([
      '[data-ev-label="job_title"]', '[data-test="job-title"]', '[data-qa="job-title"]',
      'h1[class*="title"]', 'h2[class*="title"]',
      '.air3-slider h1', '.air3-slider h2', '.up-slider h1', '.up-slider h2', '.up-card-title',
      'header h1', 'header h2', 'h1', 'h2', 'h3', 'h4'
    ], 'Title not found', titleExclusions);

    const getFullHTMLText = (selectors, fallback = 'N/A') => {
      const fetcher = (ctx) => {
        let globalBestText = '';
        for (let sel of selectors) {
          try {
            const els = ctx.querySelectorAll(sel);
            for (let i = 0; i < els.length; i++) {
              const clone = els[i].cloneNode(true);
              clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
              clone.querySelectorAll('p, div, li').forEach(b => b.appendChild(document.createTextNode('\n')));
              let text = clone.textContent.trim().replace(/\n{3,}/g, '\n\n');

              if (text.length > globalBestText.length) {
                globalBestText = text;
              }
            }
          } catch (e) { }
        }
        return globalBestText;
      }

      let res = '';
      if (searchContext !== document) res = fetcher(searchContext);
      if (!res || res.length < 15) {
        let docFallback = fetcher(document);
        if (docFallback.length > res.length) res = docFallback;
      }
      return res.length > 5 ? res : fallback;
    };

    const summary = getFullHTMLText([
      '[data-qa="job-description"]', '[data-test="description"]', '[data-test="job-description-text"]',
      '[data-ev-label="job_description"]', '.job-description',
      '.up-text-body-pre-line', '[itemprop="description"]', '.break-word', '.text-body-sm'
    ], 'Summary not found');

    // 3. Skills Array
    const skills = getArray([
      '[data-qa="skill"]', '[data-test="skill"]', '[data-qa="skills-item"]', '[data-test="Skill"]',
      '.up-skill-badge', '.skill-badge', '.air3-token', 'a.air3-token', 'button.air3-token',
      'a[href*="/nx/search/talent"]', 'a[href*="/nx/search/skills"]', 'a[href*="skills"]', 'a[href*="ontology_skill_uid"]',
      '.skills-list .up-badge', '.skills-list .air3-badge', '.skills-list .badge',
      'span.up-badge', '[data-ev-label="search_skills"]', '[data-test="Expertise"] .badge',
      '[data-qa="skills"] span', '[data-test="skills"] span', '[data-qa="skills"] .air3-token',
      'span[slot="label"]'
    ]);

    // 4. JOB TYPE DETECTION (MOVED BEFORE PRICE EXTRACTION)
    const rawText = searchContext.innerText || document.body.innerText;
    
    // STEP 2: Detect jobType FIRST
    let jobType = 'unknown';
    let projectTypeFromLabel = 'unknown';
    
    // Try multiple selectors for job type
    const typeSelectors = [
      '[data-test="job-type"]', '[data-qa="job-type"]',
      '[data-test="project-type"]', '[data-qa="project-type"]',
      '.job-type', '.project-type',
      '.job-details-section .job-type',
      '.job-post-type', '.employment-type',
      '[data-ev-label="job_type"]',
      '.job-features .job-type',
      '.job-type-badge', '.project-type-badge',
      // Additional Upwork-specific selectors
      '.job-timeline .job-type', '.timeline-badge .job-type',
      '.job-details .type', '.project-details .type',
      '[data-test="timeline-badge"]', '[data-qa="timeline-badge"]',
      '.up-job-card .job-type', '.job-post-header .type',
      '.job-description .type', '.job-meta .type'
    ];
    
    let typeEl = null;
    for (const selector of typeSelectors) {
      typeEl = searchContext.querySelector(selector);
      if (typeEl) break;
    }
    
    if (typeEl) {
      const typeText = typeEl.innerText.toLowerCase();
      
      // Prioritize specific job types
      if (typeText.includes('full-time')) jobType = 'full-time';
      else if (typeText.includes('full time')) jobType = 'full-time';
      else if (typeText.includes('ongoing')) jobType = 'ongoing';
      else if (typeText.includes('long-term')) jobType = 'ongoing';
      else if (typeText.includes('continuous')) jobType = 'ongoing';
      else if (typeText.includes('regular work')) jobType = 'ongoing';
      else if (typeText.includes('recurring')) jobType = 'ongoing';
      else if (typeText.includes('fixed-price')) jobType = 'fixed';
      else if (typeText.includes('fixed price')) jobType = 'fixed';
      else if (typeText.includes('fixed')) jobType = 'fixed';
      else if (typeText.includes('project-based')) jobType = 'fixed';
      else if (typeText.includes('milestone')) jobType = 'fixed';
      else if (typeText.includes('hourly')) jobType = 'hourly';
      else if (typeText.includes('per hour')) jobType = 'hourly';
      else if (typeText.includes('/hour')) jobType = 'hourly';
      else if (typeText.includes('/hr')) jobType = 'hourly';
      
    }
    
    // Check labels for job type
    const jobTypeLabel = getByLabel('Job Type');
    if (jobTypeLabel !== 'N/A') {
      const labelText = jobTypeLabel.toLowerCase();
      if (labelText.includes('full-time') || labelText.includes('full time')) jobType = 'full-time';
      else if (labelText.includes('hourly')) jobType = 'hourly';
      else if (labelText.includes('fixed') || labelText.includes('fixed-price')) jobType = 'fixed';
    }
    
    // Check Project Type label separately
    const projectTypeLabel = getByLabel('Project Type');
    if (projectTypeLabel !== 'N/A') {
      const labelText = projectTypeLabel.toLowerCase();
      
      if (labelText.includes('ongoing')) projectTypeFromLabel = 'ongoing';
      else if (labelText.includes('long-term')) projectTypeFromLabel = 'ongoing';
      else if (labelText.includes('continuous')) projectTypeFromLabel = 'ongoing';
      else if (labelText.includes('regular work')) projectTypeFromLabel = 'ongoing';
      else if (labelText.includes('fixed') || labelText.includes('fixed-price')) projectTypeFromLabel = 'fixed';
      else if (labelText.includes('hourly')) projectTypeFromLabel = 'hourly';
      else if (labelText.includes('complex project')) projectTypeFromLabel = 'complex project';
      else if (labelText.includes('simple project')) projectTypeFromLabel = 'simple project';
      else if (labelText.includes('advanced project')) projectTypeFromLabel = 'advanced project';
      else if (labelText.includes('basic project')) projectTypeFromLabel = 'basic project';
      else {
        projectTypeFromLabel = projectTypeLabel.trim();
      }
    }
    
    // Fallback keyword matching if still unknown
    if (jobType === 'unknown') {
      const contextText = searchContext.innerText.toLowerCase();
      
      if (contextText.includes('full-time') || contextText.includes('full time')) jobType = 'full-time';
      else if (contextText.includes('ongoing')) jobType = 'ongoing';
      else if (contextText.includes('fixed-price') || contextText.includes('fixed price')) jobType = 'fixed';
      else if (contextText.includes('hourly')) jobType = 'hourly';
    }
    

    // 5. BUDGET AND HOURLY RATE EXTRACTION (AFTER jobType detection)
    let budget = getText([
      '[data-test="budget"]', '[data-qa="budget"]', '[data-qa="client-budget"]',
      '[data-ev-label="budget"]', '[data-test="is-fixed-price"] strong',
      'li[data-qa="budget"] strong', 'div[data-qa="budget"] strong', 
      '.job-features strong[data-qa="budget"]',
      'span[data-test="budget"]',
      '.job-details-section .budget strong', '.job-type-budget strong',
      '[data-test="tiered-budget"]', '.tiered-budget .amount',
      '.budget-amount', '.fixed-price-amount',
      '.job-post-budget strong', '.job-post-budget .amount',
      '[data-qa="job-post-budget"]', '[data-test="job-post-budget"]',
      '.job-details .budget', '.job-post .budget',
      '[data-test="fixed-price-budget"]', '[data-qa="fixed-price-budget"]',
      '.fixed-price .amount', '.fixed-price-budget',
      '.project-budget', '.project-details .budget',
      '[data-test="project-budget"]', '[data-qa="project-budget"]',
      '.price-amount', '.job-price',
      '[data-test="price"]', '[data-qa="price"]',
      '.budget-info .amount', '.budget-info strong'
    ]);
    

    let hourlyRate = getText([
      '[data-test="hourly-rate"]', '[data-qa="hourly-rate"]',
      '[data-ev-label="hourly_rate"]', '[data-test="is-hourly"] strong',
      'li[data-qa="hourly-rate"] strong',
      'span[data-test="hourly-rate"]'
    ]);
    

    // Highly aggressive regex fallback capturing monetary ranges or strings explicitly
    // ONLY if we still don't have a clear price
    if (
      (budget === 'N/A' || budget === '' || !budget.includes('$')) &&
      (hourlyRate === 'N/A' || hourlyRate === '' || !hourlyRate.includes('$'))
    ) {
      // Try label searching for "Budget"
      const labelBudget = getByLabel('Budget');
      if (labelBudget !== 'N/A' && labelBudget.includes('$')) {
          budget = labelBudget;
      } else {
        // Look for budget/rate in specific containers if selectors failed
        const budgetContainer = searchContext.querySelector('[data-test="job-type"], [data-test="budget-amount"], .job-details');
        const textToSearch = budgetContainer ? budgetContainer.innerText : searchContext.innerText;
        
        const normalizedText = textToSearch
          .replace(/\n+/g, ' ')
          .replace(/\s+/g, ' ');
        
        const isValidPrice = (text) => {
          if (!text) return false;
          const lower = text.toLowerCase();
          return (
            text.includes('$') &&
            !lower.includes('spent') &&
            !lower.includes('earned') &&
            !lower.includes('avg') &&
            !lower.includes('average') &&
            !lower.includes('total spent') &&
            !lower.includes('hours') &&
            !lower.includes('proposals')
          );
        };
        
        const text = normalizedText;
        
        // Hourly Range detection
        let match = text.match(/\$\s*([\d,.]+)\s*-\s*\$\s*([\d,.]+)\s*(hourly|\/hr|per hour)/i);
        if (match) {
          hourlyRate = `$${match[1]} - $${match[2]}`;
          jobType = 'hourly';
        } else {
          // Generic Range detection
          match = text.match(/\$\s*([\d,.]+)\s*-\s*\$\s*([\d,.]+)/i);
          if (match) {
            if (jobType === 'hourly') {
              hourlyRate = `$${match[1]} - $${match[2]}`;
            } else {
              budget = `$${match[1]} - $${match[2]}`;
            }
          }
        }
        
        // Single Price fallback
        if (!budget.includes('$') && !hourlyRate.includes('$')) {
          const fallbackMatches = text.match(/\$\d+(?:,\d+)?/g) || [];
          for (const fallback of fallbackMatches) {
            if (isValidPrice(fallback)) {
              if (jobType === 'hourly') {
                hourlyRate = fallback;
              } else {
                budget = fallback;
              }
              break; 
            }
          }
        }
      }
    }
    
    // FINAL NORMALIZATION: Ensure fields are mutually exclusive to avoid UI confusion
    if (jobType === 'hourly') {
      budget = 'N/A';
    } else if (jobType === 'fixed') {
      hourlyRate = 'N/A';
    }

    let duration = getText([
      '[data-qa="project-length"]', '[data-test="project-length"]',
      'li[data-qa="project-length"] strong', '[data-ev-label="project_length"]'
    ]);
    if (duration === 'N/A') duration = getByLabel('Project Length');
    if (duration === 'N/A') {
      const durMatch = rawText.match(/(Less than \d+ month(?:s)?|\d+ to \d+ months|More than \d+ months)/i);
      if (durMatch) duration = durMatch[1];
    }

    let experienceLevel = getText([
      '[data-qa="experience-level"]', '[data-test="experience-level"]',
      'li[data-qa="experience-level"] strong', '[data-ev-label="experience_level"]'
    ]);
    if (experienceLevel === 'N/A') experienceLevel = getByLabel('Experience Level');
    if (experienceLevel === 'N/A') {
      const expMatch = rawText.match(/(Entry level|Intermediate|Expert)/i);
      if (expMatch) experienceLevel = expMatch[1];
    }

    // 5. Client Information
    const rawClientText = searchContext.innerText || searchContext.textContent || document.body.innerText || '';

    let clientRating = getText(['.up-rating .sr-only', '[data-test="client-rating"]', '[data-qa="client-rating"]', '[data-ev-label="client_rating"]']);

    if (clientRating === 'N/A' || !clientRating.toLowerCase().includes('review')) {
      const ratingMatch = rawClientText.match(/(\d+\.\d{1,2}(?:\s+of\s+|\s*\()\s*[0-9,]+\s*reviews?\)?)/i);
      if (ratingMatch) {
        clientRating = ratingMatch[1];
      } else if (/No reviews yet|0 reviews/i.test(rawClientText)) {
        clientRating = "0 reviews";
      }
    }

    const clientSpend = getText(['[data-test="client-spend"]', '.client-spend', '[data-qa="client-spend"]']);
    const clientLocation = getText(['[data-test="client-location"] strong', '[data-qa="client-location"] strong', '[data-test="client-location"]', '[data-qa="client-location"]']);
    const clientJobsPosted = getText(['[data-test="client-jobs-posted"]', '[data-qa="client-jobs-posted"]', '.client-history']);

    const isPaymentVerified = /Payment(?: method)? verified/i.test(rawClientText);
    const isPhoneVerified = /Phone(?: number)? verified/i.test(rawClientText);

    // 6. Meta
    let postedOn = getText(['[data-test="posted-on"]', '.posted-time', '#posted-on', '[data-qa="posted-on"]']);

    if (postedOn === 'N/A') {
      const timeMatch = rawText.match(/(?:Posted\s*)?(\d+\s+(?:minute|hour|day|week|month)s?\s+ago|yesterday|just\s+now)/i);
      if (timeMatch) postedOn = timeMatch[0];
    }

    if (postedOn !== 'N/A') {
      const now = new Date();

      if (postedOn.includes('just now')) {
        postedOn = now.toISOString();
      } else if (postedOn.includes('yesterday')) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        postedOn = yesterday.toISOString();
      } else if (postedOn.includes('ago')) {
        const match = postedOn.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i);
        if (match) {
          const value = parseInt(match[1]);
          const unit = match[2].toLowerCase();
          const pastDate = new Date(now);

          switch (unit) {
            case 'minute':
              pastDate.setMinutes(pastDate.getMinutes() - value);
              break;
            case 'hour':
              pastDate.setHours(pastDate.getHours() - value);
              break;
            case 'day':
              pastDate.setDate(pastDate.getDate() - value);
              break;
            case 'week':
              pastDate.setDate(pastDate.getDate() - (value * 7));
              break;
            case 'month':
              pastDate.setMonth(pastDate.getMonth() - value);
              break;
          }
          postedOn = pastDate.toISOString();
        }
      } else {
        const parsedDate = new Date(postedOn);
        if (!isNaN(parsedDate.getTime())) {
          postedOn = parsedDate.toISOString();
        }
      }
    }

    // 7. Attachments - Extract both name and URL
    const getAttachmentsWithUrls = (selectors) => {
        let items = [];
        for (let sel of selectors) {
            try {
                const els = searchContext.querySelectorAll(sel);
                els.forEach(el => {
                    // If it's a link element, extract both name and URL
                    if (el.tagName === 'A' && el.href) {
                        const name = el.innerText.trim() || el.textContent.trim() || 'Attachment';
                        const url = el.href;
                        if (name && url && !items.find(item => item.url === url)) {
                            items.push({ name, url });
                        }
                    } else {
                        // For non-link elements, try to find the containing link
                        const parentLink = el.closest('a[href]');
                        if (parentLink && parentLink.href) {
                            const name = el.innerText.trim() || el.textContent.trim() || parentLink.innerText.trim() || 'Attachment';
                            const url = parentLink.href;
                            if (name && url && !items.find(item => item.url === url)) {
                                items.push({ name, url });
                            }
                        } else {
                            // Fallback to just text if no URL found
                            const text = el.innerText.trim() || el.textContent.trim();
                            if (text && text.length > 0 && !items.find(item => item.name === text)) {
                                items.push({ name: text, url: text });
                            }
                        }
                    }
                });
                if (items.length > 0) break;
            } catch (e) {}
        }
        return items;
    };

    const attachments = getAttachmentsWithUrls([
      'a[href*="/api/profiles/v2/attachments/"]',
      'a[href*="attachment"]',
      'a[href*="/attachments/"]',
      '.up-attachment a',
      '[data-qa="attachment"] a',
      '[data-test="attachment"] a',
      '.attachment-name a',
      '.attachment a'
    ]);

    // 8. User Profile Skills (New: For DOM-based matching)
    const userSkills = getArray(USER_SKILL_SELECTORS);
    if (userSkills.length > 0) {
      chrome.storage.local.set({ cachedUserSkills: userSkills });
    }

    const data = {
      jobId: window.location.href,
      jobLink: window.location.href,
      title,
      summary,
      skills,
      userSkills, // Added for local matching
      attachments,
      budget,
      hourlyRate,
      duration,
      experienceLevel,
      clientRating,
      clientSpend,
      clientLocation,
      clientJobsPosted,
      clientPaymentVerified: isPaymentVerified,
      clientPhoneVerified: isPhoneVerified,
      jobType,
      projectType: projectTypeFromLabel !== 'unknown' ? projectTypeFromLabel : jobType,
      postedOn
    };

    // Apply Validation Scoring
    data.validation = validateJobData(data);
    return data;
};

const performFreelancerExtraction = () => {
    // Attempt to scope search to the main content area, but fall back to document
    let searchContext = document.querySelector('main, #main, fl-project-view, .PageProjectView-main, .JobDescription, fl-bit.PageProjectView-main, fl-project-details') || document;
    
    // 1. Safe Extractor Helpers (Isolated for Freelancer)
    const getText = (selectors, fallback = 'N/A') => {
        for (let sel of selectors) {
            try {
                const els = searchContext.querySelectorAll(sel);
                for (let i = 0; i < els.length; i++) {
                    const text = els[i].innerText.trim();
                    if (text && text.length > 1) return text;
                }
                
                // Backup check on whole document if scoped search failed
                const fallbackEls = document.querySelectorAll(sel);
                 for (let i = 0; i < fallbackEls.length; i++) {
                    const text = fallbackEls[i].innerText.trim();
                    if (text && text.length > 1) return text;
                }
            } catch (e) {}
        }
        return fallback;
    };

    const getArray = (selectors) => {
        let items = [];
        for (let sel of selectors) {
            try {
                const els = document.querySelectorAll(sel); // Skills often scattered, document is safer
                els.forEach(el => {
                    const text = el.innerText.trim();
                    if (text && !items.includes(text) && text.length > 2) {
                        // Avoid grabbing multi-line blocks as a single skill
                        if (text.length < 50 && !text.includes('\n')) {
                            items.push(text);
                        }
                    }
                });
                if (items.length > 0) break;
            } catch (e) {}
        }
        return items;
    };

    const getByLabel = (labelName, fallback = 'N/A') => {
        const lowerLabel = labelName.toLowerCase();
        // search wider as labels might be outside the 'main' content
        const nodes = document.querySelectorAll('p, div, span, label, dt, th, h1, h2, h3, h4, fl-bit, fl-text');
        for (let node of nodes) {
            const nodeText = (node.innerText || '').toLowerCase();
            if (nodeText === lowerLabel || (nodeText.includes(lowerLabel) && nodeText.length < lowerLabel.length + 5)) {
                // Look for the value in siblings or parent's siblings
                let valNode = node.nextElementSibling;
                
                // If the value is inside a child of the sibling (common in fl-bit)
                if (valNode && !valNode.innerText.trim()) {
                    valNode = valNode.querySelector('fl-text, span, div') || valNode;
                }

                if (!valNode || !valNode.innerText.trim()) {
                    // Try parent's next sibling
                    if (node.parentElement) valNode = node.parentElement.nextElementSibling;
                }
                
                if (valNode && valNode.innerText.trim()) {
                    let val = valNode.innerText.trim();
                    if (val.toLowerCase() === lowerLabel) continue;
                    return val;
                }
            }
        }
        return fallback;
    };

    // 2. Core Fields
    const title = getText([
        'h1', '.JobDescription-title', '.PageProjectView-header-title', 
        '[data-qa="job-title"]', '.project-title', '.app-project-details-title',
        'fl-project-details-header h1', 'fl-project-details h1'
    ], 'Title not found');

    const summary = (() => {
        const selectors = [
            '.app-project-details-description', 'div.ProjectDescription',
            '.JobDescription-description', '.PageProjectView-description', 
            '.project-description', '[data-qa="job-description"]',
            '.Card-body .FormattedText', 'fl-project-details-description',
            '.PageProjectView-main-details-description'
        ];
        for (let sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const clone = el.cloneNode(true);
                clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                return clone.innerText.trim();
            }
        }
        return 'Summary not found';
    })();

    const skills = getArray([
        'a[href^="/jobs/"]', '.JobDescription-skills a', '.PageProjectView-skill', 
        '.SkillBadge', '[data-qa="job-skills"] a', 'fl-project-description-skills a',
        'fl-tag .fl-tag-text', '.skill-link'
    ]);

    // 3. Budget & Job Type
    let budget = 'N/A';
    let hourlyRate = 'N/A';
    let jobType = 'unknown';

    // Find budget via specific selectors
    const budgetSelectors = [
        '.app-project-header-budget', '.JobDescription-budget', '.PageProjectView-budget', 
        '.project-budget', '.Card-header-budget', 'fl-project-details-header-budget',
        '.Budget-amount', '[data-qa="budget-amount"]'
    ];
    
    let rawBudget = getText(budgetSelectors).toLowerCase();
    
    // Aggressive regex fallback for budget
    if (rawBudget === 'n/a' || rawBudget.includes('0.00')) {
        const fullText = document.body.innerText;
        // Search for ranges like "â‚¹600.00 â€“ 1,500.00 INR" or "$250 - $750 USD"
        const rangeRegex = /([\â‚¹\$â‚¬Â£]\s*[\d,.]+(?:\.\d{2})?\s*(?:â€“|-|to)\s*[\â‚¹\$â‚¬Â£]?\s*[\d,.]+(?:\.\d{2})?\s*(?:INR|USD|EUR|GBP|AUD|CAD)?)/i;
        const singleRegex = /([\â‚¹\$â‚¬Â£]\s*[\d,.-]+\s*(?:INR|USD|EUR|GBP|AUD|CAD)?(?:\s*\/\s*hr|\s*per hour)?)/i;
        
        const budgetMatch = fullText.match(rangeRegex) || fullText.match(singleRegex);
        if (budgetMatch && (!rawBudget.includes('0.00') || !budgetMatch[1].includes('0.00'))) {
            rawBudget = budgetMatch[1].toLowerCase();
        } else {
            // Check for label
            const labelBudget = getByLabel('Budget');
            if (labelBudget !== 'N/A' && !labelBudget.includes('0.00')) rawBudget = labelBudget.toLowerCase();
        }
    }

    if (rawBudget !== 'n/a') {
        if (rawBudget.includes('hr') || rawBudget.includes('hour') || rawBudget.includes('/') || rawBudget.includes('hourly')) {
            jobType = 'hourly';
            hourlyRate = rawBudget;
        } else {
            jobType = 'fixed';
            budget = rawBudget;
        }
    }

    // 4. Client Info
    const rawClientText = document.body.innerText;
    
    let clientLocation = getText([
        '.app-project-details-client-location', '.JobDescription-client-location', 
        '.PageProjectView-client-location', '[data-qa="client-location"]', 
        '.client-location', 'fl-flag + span', 'fl-project-details-header-client-location',
        '.Location-text', '.Country-name', '.AboutClient-location'
    ]);
    
    if (clientLocation === 'N/A') {
        clientLocation = getByLabel('Location');
    }
    
    // Fallback: search for Indore/India etc near "About the Client"
    if (clientLocation === 'N/A') {
        const clientSecMatch = rawClientText.match(/About the Client\s*\n+([^\n]+(?:\n+[^\n]+)?)/i);
        if (clientSecMatch) {
            const lines = clientSecMatch[1].split('\n').map(l => l.trim()).filter(l => l.length > 2);
            if (lines.length > 0) clientLocation = lines.join(', ');
        }
    }

    let clientRating = getText([
        '.app-project-details-client-rating', '.Rating-stars', 
        '.PageProjectView-client-rating', '.Rating-stars-container',
        'fl-rating .Rating-stars', '.Rating-value'
    ]);
    
    if (clientRating === 'N/A' || clientRating.length < 2 || clientRating === '0.0') {
        // Try to find rating by looking for "reviews" text or simple numeric patterns near "Member since"
        const ratingMatch = rawClientText.match(/(\d+\.\d)\s*\n+\d+\s+reviews/i) || 
                          rawClientText.match(/(\d+\.\d\s*\(\s*[\d,]+\s*reviews\s*\))/i) ||
                          rawClientText.match(/(?:^|\n)(\d\.\d)(?:\n|$)/);
        if (ratingMatch) clientRating = ratingMatch[1];
    }

    // Client Verifications
    const isPaymentVerified = /Payment verified/i.test(rawClientText);
    const isIdentityVerified = /Identity verified/i.test(rawClientText);
    const isPhoneVerified = /Phone verified/i.test(rawClientText);
    const isEmailVerified = /Email verified/i.test(rawClientText);

    // 5. Meta
    let postedOn = getText([
        '.app-project-details-posted', '.JobDescription-posted', 
        '.PageProjectView-posted', '.time-ago', '[data-qa="posted-on"]',
        'fl-project-details-header-posted', '.Posted-time'
    ]);
    
    if (postedOn === 'N/A') {
        const timeMatch = rawClientText.match(/(\d+\s+(?:minute|hour|day|week|month)s?\s+ago)/i);
        if (timeMatch) postedOn = timeMatch[1];
    }

    // Enhanced attachment extraction for Freelancer with URLs
    const getFreelancerAttachmentsWithUrls = (selectors) => {
        let items = [];
        for (let sel of selectors) {
            try {
                const els = document.querySelectorAll(sel);
                els.forEach(el => {
                    // If it's a link element, extract both name and URL
                    if (el.tagName === 'A' && el.href) {
                        const name = el.innerText.trim() || el.textContent.trim() || 'Attachment';
                        const url = el.href;
                        if (name && url && !items.find(item => item.url === url)) {
                            items.push({ name, url });
                        }
                    } else {
                        // For non-link elements, try to find the containing link
                        const parentLink = el.closest('a[href]');
                        if (parentLink && parentLink.href) {
                            const name = el.innerText.trim() || el.textContent.trim() || parentLink.innerText.trim() || 'Attachment';
                            const url = parentLink.href;
                            if (name && url && !items.find(item => item.url === url)) {
                                items.push({ name, url });
                            }
                        } else {
                            // Fallback to just text if no URL found
                            const text = el.innerText.trim() || el.textContent.trim();
                            if (text && text.length > 0 && !items.find(item => item.name === text)) {
                                items.push({ name: text, url: text });
                            }
                        }
                    }
                });
                if (items.length > 0) break;
            } catch (e) {}
        }
        return items;
    };

    const attachments = getFreelancerAttachmentsWithUrls([
        '.app-project-details-files a', '.JobDescription-attachments a', 
        '.PageProjectView-attachment a', '.AttachmentItem-link a',
        'fl-project-details-description-attachments a',
        'a[href*="/projects/attachments/"]',
        'a[href*="attachment"]',
        '.attachment a'
    ]);

    const data = {
        jobId: window.location.href,
        jobLink: window.location.href,
        title,
        summary,
        skills,
        attachments,
        budget,
        hourlyRate,
        jobType,
        clientLocation,
        clientRating,
        clientPaymentVerified: isPaymentVerified,
        clientIdentityVerified: isIdentityVerified,
        clientPhoneVerified: isPhoneVerified,
        clientEmailVerified: isEmailVerified,
        postedOn
    };

    // Apply Validation Scoring
    data.validation = validateJobData(data);
    return data;
};

// ─────────────────────────────────────────────────────────────
// Guru.com Extraction
// ─────────────────────────────────────────────────────────────
const performGuruExtraction = () => {
    // Scope to main job content; fall back to document
    const searchContext =
        document.querySelector(
            '.jobDetails, .job__details, [class*="jobDescription"], .jobPostingDetails, ' +
            '.guruJobDesc, #jobDetails, main, #main'
        ) || document;

    // Detect the employer/Posted By container to avoid matching headers/navigation
    const getEmployerContainer = () => {
        // Option 1: Look for container with header "Posted By"
        const headings = document.querySelectorAll('h2, h3, h4, h5, h6, div, p, span, strong, td');
        for (const h of headings) {
            const txt = (h.innerText || h.textContent || '').trim().toLowerCase();
            if (txt === 'posted by') {
                const container = h.closest('.card, .module, section, div, [class*="sidebar"], [class*="container"]');
                if (container) return container;
            }
        }
        
        // Option 2: Look for common employer class names (excluding main navigation/header)
        const classContainers = document.querySelectorAll(
            '.jobDetails__employer, .jobPost__employer, .guruEmployer, .memberInfo, ' +
            '.postedBy, [class*="postedBy"], [class*="employer"], [class*="Employer"]'
        );
        for (const container of classContainers) {
            if (!container.closest('header, nav, .header, .nav, #header, #nav, .navigation')) {
                return container;
            }
        }
        
        return document;
    };

    const employerContext = getEmployerContainer();

    // Helpers
    const getText = (selectors, fallback = 'N/A') => {
        for (const sel of selectors) {
            try {
                for (const el of searchContext.querySelectorAll(sel)) {
                    const t = (el.innerText || el.textContent || '').trim();
                    if (t && t.length > 1) return t;
                }
                for (const el of document.querySelectorAll(sel)) {
                    const t = (el.innerText || el.textContent || '').trim();
                    if (t && t.length > 1) return t;
                }
            } catch (e) {}
        }
        return fallback;
    };

    // Scoped client helper
    const getClientText = (selectors, fallback = 'N/A') => {
        for (const sel of selectors) {
            try {
                for (const el of employerContext.querySelectorAll(sel)) {
                    const t = (el.innerText || el.textContent || '').trim();
                    if (t && t.length > 1) return t;
                }
            } catch (e) {}
        }
        return getText(selectors, fallback);
    };

    const getArray = (selectors) => {
        const items = [];
        for (const sel of selectors) {
            try {
                document.querySelectorAll(sel).forEach(el => {
                    const t = (el.innerText || el.textContent || '').trim();
                    if (t && !items.includes(t) && t.length > 1 && t.length < 60 && !t.includes('\n'))
                        items.push(t);
                });
                if (items.length > 0) break;
            } catch (e) {}
        }
        return items;
    };

    // Walk DOM tree looking for a label -> sibling value pattern
    const getByLabel = (labelName, fallback = 'N/A') => {
        const lower = labelName.toLowerCase();
        
        // Scope search to employerContext first for client-related labels
        const searchNodes = Array.from(employerContext.querySelectorAll(
            'span, div, p, label, dt, li, td, strong, h4, h5'
        )).concat(Array.from(document.querySelectorAll(
            'span, div, p, label, dt, li, td, strong, h4, h5'
        )));
        
        const uniqueNodes = Array.from(new Set(searchNodes));

        for (const node of uniqueNodes) {
            const nt = (node.innerText || node.textContent || '').trim().toLowerCase();
            if (nt === lower || (nt.startsWith(lower) && nt.length < lower.length + 4)) {
                let val = node.nextElementSibling;
                if (val && (val.innerText || val.textContent || '').trim()) return (val.innerText || val.textContent).trim();
                if (node.parentElement) {
                    val = node.parentElement.nextElementSibling;
                    if (val && (val.innerText || val.textContent || '').trim()) return (val.innerText || val.textContent).trim();
                }
                if (node.parentElement) {
                    const parentTxt = (node.parentElement.innerText || node.parentElement.textContent || '').trim();
                    const stripped = parentTxt.replace((node.innerText || node.textContent).trim(), '').trim();
                    if (stripped.length > 1) return stripped;
                }
            }
        }
        return fallback;
    };

    // Helper: scan page for sidebar stat label+value pairs
    // Guru shows: "Jobs Posted   16" as adjacent cells/divs
    const getSidebarStat = (labelText) => {
        const lower = labelText.toLowerCase();
        const candidates = Array.from(employerContext.querySelectorAll(
            'td, th, dt, dd, li, span, div, p, strong'
        )).concat(Array.from(document.querySelectorAll(
            'td, th, dt, dd, li, span, div, p, strong'
        )));
        
        const uniqueCandidates = Array.from(new Set(candidates));

        for (const el of uniqueCandidates) {
            const t = (el.innerText || el.textContent || '').trim();
            if (t.toLowerCase() === lower) {
                // Try adjacent sibling in same row/parent
                const sibling = el.nextElementSibling;
                if (sibling) {
                    const sv = (sibling.innerText || sibling.textContent || '').trim();
                    if (sv) return sv;
                }
                // Parent's next sibling (for table row / div row patterns)
                if (el.parentElement) {
                    const pSib = el.parentElement.nextElementSibling;
                    if (pSib) {
                        const psv = (pSib.innerText || pSib.textContent || '').trim();
                        if (psv) return psv;
                    }
                    // Value might be rest of parent text after the label
                    const parentText = (el.parentElement.innerText || el.textContent || '').trim();
                    const stripped = parentText.replace(t, '').trim().replace(/^[:\-|]+/, '').trim();
                    if (stripped && stripped.length > 0 && stripped !== t) return stripped;
                }
            }
        }
    };

    // Title
    const title = getText([
        '.jobHeading__title',
        '.jobTitle h1', '.jobTitle h2',
        '[class*="jobTitle"] h1', '[class*="jobTitle"] h2',
        '.guruJobTitle', '#jobTitle',
        'h1.title', 'h2.title',
        'h1', 'h2'
    ], 'Title not found');

    // Description
    const summary = (() => {
        const descSelectors = [
            '.jobDesc', '.job__description', '[class*="jobDescription"]',
            '.jobDetails__description', '#jobDescription',
            '.guruJobDesc', '.jobPost__description',
            '.jobDetails .description', '.jobPost .description'
        ];
        for (const sel of descSelectors) {
            const el = document.querySelector(sel);
            if (el) {
                const clone = el.cloneNode(true);
                clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                clone.querySelectorAll('p, div, li').forEach(b => b.appendChild(document.createTextNode('\n')));
                const txt = clone.textContent.trim().replace(/\n{3,}/g, '\n\n');
                if (txt.length > 30) return txt;
            }
        }
        return 'Summary not found';
    })();

    // Skills
    const skills = getArray([
        '.skillsList__skill',
        '.skillsList a', '.skills__list a', '[class*="skillTag"] a',
        '[class*="skill"] a', '[class*="skill"] span',
        '.jobSkills a', '.jobSkills span',
        'a[href*="/jobs/q"]',
        '.tag a', '.tags a',
        '[class*="tag"]'
    ]);

    // Budget / Rate
    // Guru renders: "Fixed Price  |  Under $250" or "Hourly  |  $45 - $60/hr"
    let budget = 'N/A';
    let hourlyRate = 'N/A';
    let jobType = 'unknown';

    // Step 1: Try dedicated budget elements
    const budgetEl = document.querySelector(
        '.jobBudget, .job__budget, [class*="jobBudget"], .budgetType, ' +
        '.guruBudget, .jobPost__budget, [class*="Budget"] .amount, ' +
        '.services__budget, #jobBudget, .jobHeading__budget'
    );
    let rawHeaderText = budgetEl ? (budgetEl.innerText || budgetEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

    // Step 2: Scan page for the "Fixed Price | Under $250" pattern
    if (!rawHeaderText) {
        const allEls = document.querySelectorAll('p, div, span, strong, li, h3, h4');
        for (const el of allEls) {
            const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            // Short single-line text with pricing keywords
            if (t.length < 150) {
                const lt = t.toLowerCase();
                if ((lt.includes('fixed') || lt.includes('hourly')) &&
                    (t.includes('$') || lt.includes('under') || lt.includes('over'))) {
                    rawHeaderText = t;
                    break;
                }
            }
        }
    }

    // Step 3: Also check label-based fallbacks
    if (!rawHeaderText) rawHeaderText = getByLabel('Budget');
    if (!rawHeaderText || rawHeaderText === 'N/A') rawHeaderText = getByLabel('Rate');
    if (!rawHeaderText || rawHeaderText === 'N/A') rawHeaderText = getByLabel('Bid Range');
    if (!rawHeaderText || rawHeaderText === 'N/A') rawHeaderText = getByLabel('Est. Budget');

    // Step 4: Parse the raw text
    if (rawHeaderText && rawHeaderText !== 'N/A') {
        const lt = rawHeaderText.toLowerCase();

        if (lt.includes('hourly') || lt.includes('/hr') || lt.includes('per hour')) {
            jobType = 'hourly';
            const rateMatch = rawHeaderText.match(/\$\s*[\d,]+(?:\.\d{1,2})?\s*[-\u2013]\s*\$?\s*[\d,]+(?:\.\d{1,2})/);
            if (rateMatch) {
                hourlyRate = rateMatch[0].trim();
            } else {
                const singleMatch = rawHeaderText.match(/\$\s*[\d,]+(?:\.\d{1,2})?/);
                if (singleMatch) hourlyRate = singleMatch[0].trim();
            }
        } else if (lt.includes('fixed') || lt.includes('price')) {
            jobType = 'fixed';
            const rangeMatch = rawHeaderText.match(/\$\s*[\d,]+(?:\.\d{1,2})?\s*[-\u2013]\s*\$?\s*[\d,]+(?:\.\d{1,2})/);
            if (rangeMatch) {
                budget = rangeMatch[0].trim();
            } else {
                const budgetMatch = rawHeaderText.match(/(?:Under|Over|Up to)?\s*\$\s*[\d,]+(?:\.\d{1,2})?(?:k)?/i);
                if (budgetMatch) budget = budgetMatch[0].trim();
            }
        }
    }

    // Step 5: Scoped regex fallback in job header section only (not full body)
    if (budget === 'N/A' && hourlyRate === 'N/A') {
        const headerSection = document.querySelector(
            '.jobHeading, .jobPost__header, .jobDetails__header, .jobBudgetSection, ' +
            '.jobPost .card:first-child, h1, h2'
        );
        const textToSearch = headerSection ? (headerSection.innerText || headerSection.textContent || '') : '';
        const rangeMatch = textToSearch.match(
            /([\$\u20B9\u20AC\u00A3]\s*[\d,]+(?:\.\d{1,2})?\s*[-\u2013]\s*[\$\u20B9\u20AC\u00A3]?\s*[\d,]+(?:\.\d{1,2})?(?:\s*(?:INR|USD|EUR|GBP|AUD|CAD))?)/i
        );
        const singleMatch = textToSearch.match(
            /([\$\u20B9\u20AC\u00A3]\s*[\d,]+(?:\.\d{1,2})?(?:\s*\/\s*hr|\/\s*hour|per hour)?)/i
        );
        if (rangeMatch) rawHeaderText = rangeMatch[1];
        else if (singleMatch) rawHeaderText = singleMatch[1];

        if (rawHeaderText && rawHeaderText !== 'N/A') {
            const lt = rawHeaderText.toLowerCase();
            if (lt.includes('/hr') || lt.includes('/hour') || lt.includes('per hour') || lt.includes('hourly')) {
                jobType = 'hourly';
                hourlyRate = rawHeaderText;
            } else {
                jobType = 'fixed';
                budget = rawHeaderText;
            }
        }
    }

    // Client info
    const rawText = document.body.innerText || document.body.textContent || '';

    const clientName = getClientText([
        '.avatarinfo .identityName strong',
        '.avatarinfo .identityName',
        '.jobDetails__employer .identityName',
        '.employerName', '.employer__name', '[class*="employerName"]',
        '.jobPost__employer h2', '.jobPost__employer h3',
        '.guruEmployer .name', '#employerName',
        '.memberInfo .name', '.memberName',
        '.postedBy a', '[class*="postedBy"] a',
        '[class*="employer"] a', '[class*="Employer"] a',
    ]);

    let clientLocation = getClientText([
        '.avatarinfo .subtext strong',
        '.avatarinfo .subtext',
        '.employerLocation', '.employer__location', '[class*="employerLocation"]',
        '.guruLocation', '.memberLocation',
        '[class*="location"] span', '.jobPost__location',
        'span[itemprop="addressLocality"]', 'span[itemprop="addressCountry"]'
    ]);
    if (clientLocation === 'N/A') clientLocation = getByLabel('Location');

    // Clean up Guru location if it contains metadata separator '|'
    if (clientLocation && clientLocation !== 'N/A') {
        const parts = clientLocation.split('|').map(p => p.trim());
        let cleanLocation = 'N/A';
        for (const part of parts) {
            if (!part) continue;
            const lowerPart = part.toLowerCase();
            // Exclude feedback, member since, or placeholders like empty percentages
            if (lowerPart.includes('%') || 
                lowerPart.includes('feedback') || 
                lowerPart.includes('member since') || 
                lowerPart.includes('joined') ||
                lowerPart === 'no feedback' ||
                lowerPart === 'n/a') {
                continue;
            }
            // First valid part is the location
            cleanLocation = part;
            break;
        }
        clientLocation = cleanLocation;
    }

    // Feedback / Rating
    let clientRating = getSidebarStat('Feedback');
    if (clientRating === 'N/A') {
        clientRating = getClientText([
            '.employerRating', '.employer__rating', '[class*="employerRating"]',
            '.guruFeedback', '.feedbackScore', '.memberFeedback',
            '[class*="feedback"] .percent', '[class*="rating"] .value'
        ]);
    }
    if (clientRating && clientRating !== 'N/A') {
        const pctMatch = clientRating.match(/([\d.]+%)/);
        if (pctMatch) {
            clientRating = pctMatch[1];
        } else if (clientRating.toLowerCase().includes('no feedback')) {
            clientRating = 'No Feedback';
        }
    }
    if (clientRating === 'N/A') {
        const fbMatch = rawText.match(/Feedback\s+([\d.]+%)/i) ||
                        rawText.match(/([\d.]+)\s*\(\s*[\d,]+\s*reviews?\s*\)/i) ||
                        rawText.match(/([\d]+%?)\s*feedback/i);
        if (fbMatch) clientRating = fbMatch[1];
    }

    // Total Spend
    let clientSpend = getSidebarStat('Total Spend');
    if (clientSpend === 'N/A') {
        clientSpend = getClientText([
            '.totalPaid', '.employer__totalPaid', '[class*="totalPaid"]',
            '[class*="totalSpend"]', '.guruTotalSpend'
        ]);
    }
    if (clientSpend === 'N/A') clientSpend = getByLabel('Total Paid');
    if (clientSpend === 'N/A') clientSpend = getByLabel('Total Spend');

    // Jobs Posted
    let clientJobsPosted = getSidebarStat('Jobs Posted');
    if (clientJobsPosted === 'N/A') {
        clientJobsPosted = getClientText(['.jobsPosted', '.employer__jobsPosted', '[class*="jobsPosted"]']);
    }
    if (clientJobsPosted === 'N/A') clientJobsPosted = getByLabel('Jobs Posted');

    // Jobs Paid
    let clientJobsPaid = getSidebarStat('Jobs Paid');
    if (clientJobsPaid === 'N/A') clientJobsPaid = getByLabel('Jobs Paid');

    // Paid Invoices
    let clientPaidInvoices = getSidebarStat('Paid Invoices');
    if (clientPaidInvoices === 'N/A') clientPaidInvoices = getByLabel('Paid Invoices');

    // Outstanding Invoices
    let clientOutstandingInvoices = getSidebarStat('Outstanding Invoices');
    if (clientOutstandingInvoices === 'N/A') clientOutstandingInvoices = getByLabel('Outstanding Invoices');

    // Verifications
    const isPaymentVerified = /payment\s*verified/i.test(rawText);
    const isPhoneVerified = /phone\s*verified/i.test(rawText);
    const isIdentityVerified = /identity\s*verified/i.test(rawText);

    // Posted Date
    let postedOn = getText([
        '.jobHeading__meta',
        '.jobPostedDate', '.job__postedDate', '[class*="postedDate"]',
        '.guruPostedDate', '.postDate', '[class*="postDate"]',
        'time', '[datetime]'
    ]);

    if (postedOn === 'N/A') {
        const timeEl = document.querySelector('time[datetime], [datetime]');
        if (timeEl) postedOn = timeEl.getAttribute('datetime') || timeEl.innerText.trim() || timeEl.textContent.trim();
    }

    if (postedOn === 'N/A') {
        const m = rawText.match(/(\d+\s+(?:minute|hour|day|week|month)s?\s+ago)/i);
        if (m) postedOn = m[1];
    }

    // Normalise to ISO
    if (postedOn && postedOn !== 'N/A') {
        postedOn = postedOn.replace(/^posted\s+/i, '').trim();
        const now = new Date();
        const agoMatch = postedOn.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i);
        if (agoMatch) {
            const val = parseInt(agoMatch[1]);
            const unit = agoMatch[2].toLowerCase();
            const d = new Date(now);
            if (unit === 'minute') d.setMinutes(d.getMinutes() - val);
            else if (unit === 'hour') d.setHours(d.getHours() - val);
            else if (unit === 'day') d.setDate(d.getDate() - val);
            else if (unit === 'week') d.setDate(d.getDate() - val * 7);
            else if (unit === 'month') d.setMonth(d.getMonth() - val);
            postedOn = d.toISOString();
        } else {
            const parsed = new Date(postedOn);
            if (!isNaN(parsed.getTime())) postedOn = parsed.toISOString();
        }
    }

    // Duration / Experience
    const duration = getByLabel('Duration') !== 'N/A' ? getByLabel('Duration') : getByLabel('Project Length');
    const experienceLevel = getByLabel('Experience Level') !== 'N/A' ? getByLabel('Experience Level') : getByLabel('Skill Level');

    // Build Result
    const data = {
        jobId: window.location.href,
        jobLink: window.location.href,
        title,
        summary,
        skills,
        attachments: [],
        budget,
        hourlyRate,
        jobType,
        projectType: jobType,
        duration,
        experienceLevel,
        clientName,
        clientLocation,
        clientRating,
        clientSpend,
        clientJobsPosted,
        clientJobsPaid,
        clientPaidInvoices,
        clientOutstandingInvoices,
        clientPaymentVerified: isPaymentVerified,
        clientPhoneVerified: isPhoneVerified,
        clientIdentityVerified: isIdentityVerified,
        postedOn
    };

    data.validation = validateJobData(data);
    return data;
};

// ─────────────────────────────────────────────────────────────
// Toptal.com Extraction
// ─────────────────────────────────────────────────────────────
/*
const performToptalExtraction = () => {
    // Toptal job pages are React SPAs; scope to the main content block
    const searchContext =
        document.querySelector(
            '[class*="JobDetails"], [class*="jobDetails"], [class*="job-details"], ' +
            '[class*="JobDescription"], main, #main'
        ) || document;

    // ── Helpers ──────────────────────────────────────────────
    const getText = (selectors, fallback = 'N/A') => {
        for (const sel of selectors) {
            try {
                for (const el of searchContext.querySelectorAll(sel)) {
                    const t = (el.innerText || '').trim();
                    if (t && t.length > 1) return t;
                }
                for (const el of document.querySelectorAll(sel)) {
                    const t = (el.innerText || '').trim();
                    if (t && t.length > 1) return t;
                }
            } catch (e) {}
        }
        return fallback;
    };

    const getArray = (selectors) => {
        const items = [];
        for (const sel of selectors) {
            try {
                document.querySelectorAll(sel).forEach(el => {
                    const t = (el.innerText || '').trim();
                    if (t && !items.includes(t) && t.length > 1 && t.length < 60 && !t.includes('\n'))
                        items.push(t);
                });
                if (items.length > 0) break;
            } catch (e) {}
        }
        return items;
    };

    const getByLabel = (labelName, fallback = 'N/A') => {
        const lower = labelName.toLowerCase();
        for (const node of document.querySelectorAll('span, div, p, label, dt, li, td, strong, h4, h5')) {
            const nt = (node.innerText || '').trim().toLowerCase();
            if (nt === lower || (nt.startsWith(lower) && nt.length < lower.length + 4)) {
                let val = node.nextElementSibling;
                if (val && (val.innerText || '').trim()) return val.innerText.trim();
                if (node.parentElement) {
                    val = node.parentElement.nextElementSibling;
                    if (val && (val.innerText || '').trim()) return val.innerText.trim();
                }
            }
        }
        return fallback;
    };

    // ── Title ────────────────────────────────────────────────
    const title = getText([
        '[class*="JobTitle"] h1', '[class*="JobTitle"] h2',
        '[class*="job-title"]', '[class*="jobTitle"]',
        '[data-testid="job-title"]', '.JobDetails h1',
        'h1', 'h2'
    ], 'Title not found');

    // ── Description ──────────────────────────────────────────
    const summary = (() => {
        const selectors = [
            '[class*="JobDescription"]', '[class*="job-description"]',
            '[class*="JobDetails__description"]', '[class*="jobDescription"]',
            '[data-testid="job-description"]', '.job-description',
            '[class*="Description"] p', '[class*="description"]'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const clone = el.cloneNode(true);
                clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                clone.querySelectorAll('p, div, li').forEach(b => b.appendChild(document.createTextNode('\n')));
                const txt = clone.textContent.trim().replace(/\n{3,}/g, '\n\n');
                if (txt.length > 30) return txt;
            }
        }
        return 'Summary not found';
    })();

    // ── Skills ───────────────────────────────────────────────
    const skills = getArray([
        '[class*="Skill"] span', '[class*="skill"] span',
        '[class*="SkillTag"]', '[class*="skill-tag"]',
        '[class*="Tag"] span', '[data-testid="skill"]',
        '[class*="RequiredSkill"]', '[class*="required-skill"]',
        'li[class*="skill"]'
    ]);

    // ── Budget / Rate ─────────────────────────────────────────
    let budget = 'N/A';
    let hourlyRate = 'N/A';
    let jobType = 'unknown';

    // Toptal primarily deals with hourly rates
    let rawRate = getText([
        '[class*="PayRate"]', '[class*="pay-rate"]',
        '[class*="Rate"]', '[class*="rate"]',
        '[class*="Salary"]', '[class*="Budget"]',
        '[data-testid="pay-rate"]', '[data-testid="rate"]'
    ]);
    if (rawRate === 'N/A') rawRate = getByLabel('Rate');
    if (rawRate === 'N/A') rawRate = getByLabel('Pay Rate');
    if (rawRate === 'N/A') rawRate = getByLabel('Compensation');
    if (rawRate === 'N/A') rawRate = getByLabel('Budget');

    if (rawRate === 'N/A') {
        const rawText = (searchContext.innerText || '');
        const rateMatch = rawText.match(
            /([\\$\u20b9\u20ac\u00a3]\s*[\d,]+(?:\.?\d{2})?\s*(?:\/\s*hr|\/\s*hour|per hour|hourly)?)/i
        );
        if (rateMatch) rawRate = rateMatch[1];
    }

    if (rawRate && rawRate !== 'N/A') {
        const lower = rawRate.toLowerCase();
        if (lower.includes('/hr') || lower.includes('/hour') || lower.includes('per hour') || lower.includes('hourly')) {
            jobType = 'hourly';
            hourlyRate = rawRate;
        } else if (lower.includes('$') || lower.match(/[\d,]+/)) {
            // Toptal often posts hourly; default to hourly if it has a number
            jobType = 'hourly';
            hourlyRate = rawRate;
        }
    }

    // ── Client / Company Info ────────────────────────────────
    const rawText = document.body.innerText || '';

    const clientName = getText([
        '[class*="CompanyName"]', '[class*="company-name"]',
        '[class*="ClientName"]', '[class*="client-name"]',
        '[data-testid="company-name"]',
        '[class*="Employer"] h2', '[class*="Employer"] h3'
    ]);

    let clientLocation = getText([
        '[class*="Location"]', '[class*="location"]',
        '[data-testid="location"]',
        'span[class*="Country"]', 'span[class*="country"]'
    ]);
    if (clientLocation === 'N/A') clientLocation = getByLabel('Location');
    if (clientLocation === 'N/A') clientLocation = getByLabel('Country');

    const clientRating = getText([
        '[class*="Rating"]', '[class*="rating"]',
        '[class*="Score"]', '[class*="score"]',
        '[data-testid="rating"]'
    ]);

    const duration = getByLabel('Duration') !== 'N/A'
        ? getByLabel('Duration')
        : getByLabel('Engagement Length');

    const experienceLevel = getByLabel('Experience Level') !== 'N/A'
        ? getByLabel('Experience Level')
        : getByLabel('Seniority');

    const isPaymentVerified = /payment\s*verified/i.test(rawText);
    const isPhoneVerified = /phone\s*verified/i.test(rawText);

    // ── Posted Date ──────────────────────────────────────────
    let postedOn = getText([
        '[class*="PostedDate"]', '[class*="posted-date"]',
        '[class*="PostDate"]', '[class*="post-date"]',
        'time', '[datetime]'
    ]);
    if (postedOn === 'N/A') {
        const timeEl = document.querySelector('time[datetime], [datetime]');
        if (timeEl) postedOn = timeEl.getAttribute('datetime') || timeEl.innerText.trim();
    }
    if (postedOn === 'N/A') {
        const m = rawText.match(/(\d+\s+(?:minute|hour|day|week|month)s?\s+ago)/i);
        if (m) postedOn = m[1];
    }
    if (postedOn && postedOn !== 'N/A') {
        const now = new Date();
        const agoMatch = postedOn.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i);
        if (agoMatch) {
            const val = parseInt(agoMatch[1]);
            const unit = agoMatch[2].toLowerCase();
            const d = new Date(now);
            if (unit === 'minute') d.setMinutes(d.getMinutes() - val);
            else if (unit === 'hour') d.setHours(d.getHours() - val);
            else if (unit === 'day') d.setDate(d.getDate() - val);
            else if (unit === 'week') d.setDate(d.getDate() - val * 7);
            else if (unit === 'month') d.setMonth(d.getMonth() - val);
            postedOn = d.toISOString();
        } else {
            const parsed = new Date(postedOn);
            if (!isNaN(parsed.getTime())) postedOn = parsed.toISOString();
        }
    }

    const data = {
        jobId: window.location.href,
        jobLink: window.location.href,
        title,
        summary,
        skills,
        attachments: [],
        budget,
        hourlyRate,
        jobType,
        projectType: jobType,
        duration,
        experienceLevel,
        clientName,
        clientLocation,
        clientRating,
        clientSpend: 'N/A',
        clientJobsPosted: 'N/A',
        clientPaymentVerified: isPaymentVerified,
        clientPhoneVerified: isPhoneVerified,
        postedOn
    };

    data.validation = validateJobData(data);
    return data;
};
*/

// ─────────────────────────────────────────────────────────────
// Fiverr.com Extraction
// ─────────────────────────────────────────────────────────────
/*
const performFiverrExtraction = () => {
    // Fiverr gig pages — scope to the main gig content container
    const searchContext =
        document.querySelector(
            '[class*="gig-page"], .gig-page-wrapper, .gig-overview, ' +
            '[class*="GigPage"], #gig-page, main, #main'
        ) || document;

    // ── Helpers ──────────────────────────────────────────────
    const getText = (selectors, fallback = 'N/A') => {
        for (const sel of selectors) {
            try {
                for (const el of searchContext.querySelectorAll(sel)) {
                    const t = (el.innerText || '').trim();
                    if (t && t.length > 1) return t;
                }
                for (const el of document.querySelectorAll(sel)) {
                    const t = (el.innerText || '').trim();
                    if (t && t.length > 1) return t;
                }
            } catch (e) {}
        }
        return fallback;
    };

    const getArray = (selectors) => {
        const items = [];
        for (const sel of selectors) {
            try {
                document.querySelectorAll(sel).forEach(el => {
                    const t = (el.innerText || '').trim();
                    if (t && !items.includes(t) && t.length > 1 && t.length < 60 && !t.includes('\n'))
                        items.push(t);
                });
                if (items.length > 0) break;
            } catch (e) {}
        }
        return items;
    };

    const getByLabel = (labelName, fallback = 'N/A') => {
        const lower = labelName.toLowerCase();
        for (const node of document.querySelectorAll('span, div, p, label, dt, li, td, strong, h4, h5')) {
            const nt = (node.innerText || '').trim().toLowerCase();
            if (nt === lower || (nt.startsWith(lower) && nt.length < lower.length + 4)) {
                let val = node.nextElementSibling;
                if (val && (val.innerText || '').trim()) return val.innerText.trim();
                if (node.parentElement) {
                    val = node.parentElement.nextElementSibling;
                    if (val && (val.innerText || '').trim()) return val.innerText.trim();
                }
            }
        }
        return fallback;
    };

    // ── Title ────────────────────────────────────────────────
    // On Fiverr, the gig title is the "service" name shown at top
    const title = getText([
        'h1.gig-title', '[class*="gig-title"]', '[class*="gigTitle"]',
        '[class*="GigTitle"]', 'h1[class*="title"]',
        '[data-testid="gig-title"]', 'h1'
    ], 'Title not found');

    // ── Description ──────────────────────────────────────────
    const summary = (() => {
        const selectors = [
            '[class*="gig-description"]', '[class*="gigDescription"]',
            '[class*="GigDescription"]', '.description-content',
            '[data-testid="gig-description"]', '.gig-page-description',
            '[class*="overview-description"]'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const clone = el.cloneNode(true);
                clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                clone.querySelectorAll('p, div, li').forEach(b => b.appendChild(document.createTextNode('\n')));
                const txt = clone.textContent.trim().replace(/\n{3,}/g, '\n\n');
                if (txt.length > 30) return txt;
            }
        }
        return 'Summary not found';
    })();

    // ── Skills / Tags ─────────────────────────────────────────
    // Fiverr uses category tags and gig tags rather than skills
    const skills = getArray([
        '[class*="gig-tags"] a', '[class*="gigTags"] a',
        '[class*="tag-link"]', '[class*="TagLink"]',
        'a[class*="tag"]', '[data-testid="gig-tag"]',
        '[class*="Tags"] a', '[class*="tags"] a',
        '[class*="category"] a'
    ]);

    // ── Pricing / Budget ──────────────────────────────────────
    // Fiverr packages: Basic / Standard / Premium with prices
    let budget = 'N/A';
    let hourlyRate = 'N/A';
    let jobType = 'fixed'; // Fiverr is always fixed-price

    // Try to grab the starting price (Basic package)
    const priceEl = document.querySelector(
        '[class*="price-value"]:first-child, [class*="priceValue"]:first-child, ' +
        '[class*="package-price"]:first-child, [class*="packagePrice"]:first-child, ' +
        '.basic-price, [data-testid="basic-price"], [data-testid="package-price"]'
    );
    let rawPrice = priceEl ? (priceEl.innerText || '').trim() : '';

    if (!rawPrice) {
        // Grab all prices and take the first (cheapest)
        const allPrices = document.querySelectorAll(
            '[class*="price-value"], [class*="priceValue"], [class*="package-price"]'
        );
        if (allPrices.length > 0) rawPrice = (allPrices[0].innerText || '').trim();
    }

    if (!rawPrice) rawPrice = getByLabel('Starting at');
    if (!rawPrice || rawPrice === 'N/A') {
        // Regex on scoped context
        const m = (searchContext.innerText || '').match(/([\\$\u20b9\u20ac\u00a3]\s*[\d,]+(?:\.\d{2})?)/);
        if (m) rawPrice = m[1];
    }

    if (rawPrice && rawPrice !== 'N/A') {
        budget = rawPrice;
    }

    // ── Seller Info ───────────────────────────────────────────
    const rawText = document.body.innerText || '';

    // Seller name = "client" equivalent on Fiverr
    const clientName = getText([
        '[class*="seller-name"]', '[class*="sellerName"]',
        '[class*="SellerName"]', '[data-testid="seller-name"]',
        '.seller-card-username', '[class*="username"]',
        'a[class*="username"]'
    ]);

    // Seller location
    let clientLocation = getText([
        '[class*="seller-location"]', '[class*="sellerLocation"]',
        '[data-testid="seller-location"]', '[class*="Location"]'
    ]);
    if (clientLocation === 'N/A') clientLocation = getByLabel('From');

    // Seller rating
    let clientRating = getText([
        '[class*="rating-score"]', '[class*="ratingScore"]',
        '[class*="seller-rating"]', '[data-testid="rating"]',
        '[class*="avg-rating"]', '.gig-rating'
    ]);
    if (clientRating === 'N/A') {
        const rm = rawText.match(/([\d.]+)\s*\(\s*[\d,]+\s*reviews?\s*\)/i);
        if (rm) clientRating = rm[0];
    }

    // Seller total orders / reviews as proxy for "jobs posted"
    const clientJobsPosted = getText([
        '[class*="reviews-count"]', '[class*="reviewsCount"]',
        '[class*="orders-count"]', '[data-testid="reviews-count"]',
        '[class*="total-reviews"]'
    ]);

    // Seller level (e.g. "Level 2", "Top Rated")
    const experienceLevel = getText([
        '[class*="seller-level"]', '[class*="sellerLevel"]',
        '[class*="SellerLevel"]', '[data-testid="seller-level"]',
        '[class*="level-badge"]', '[class*="badge-title"]'
    ]);

    const isPaymentVerified = /payment\s*verified/i.test(rawText) || /verified/i.test(rawText);
    const isPhoneVerified = /phone\s*verified/i.test(rawText);

    // ── Delivery Time as Duration ─────────────────────────────
    const duration = getText([
        '[class*="delivery-time"]', '[class*="deliveryTime"]',
        '[data-testid="delivery-time"]', '[class*="delivery"] span'
    ]) !== 'N/A'
        ? getText(['[class*="delivery-time"]', '[class*="deliveryTime"]', '[data-testid="delivery-time"]'])
        : getByLabel('Delivery Time');

    // ── Posted / Member Since ─────────────────────────────────
    let postedOn = getText([
        '[class*="member-since"]', '[class*="memberSince"]',
        '[data-testid="member-since"]', 'time', '[datetime]'
    ]);
    if (postedOn === 'N/A') {
        const timeEl = document.querySelector('time[datetime]');
        if (timeEl) postedOn = timeEl.getAttribute('datetime') || timeEl.innerText.trim();
    }
    if (postedOn && postedOn !== 'N/A') {
        const parsed = new Date(postedOn);
        if (!isNaN(parsed.getTime())) postedOn = parsed.toISOString();
    }

    const data = {
        jobId: window.location.href,
        jobLink: window.location.href,
        title,
        summary,
        skills,
        attachments: [],
        budget,
        hourlyRate,
        jobType,
        projectType: 'fixed',
        duration,
        experienceLevel,
        clientName,
        clientLocation,
        clientRating,
        clientSpend: 'N/A',
        clientJobsPosted,
        clientPaymentVerified: isPaymentVerified,
        clientPhoneVerified: isPhoneVerified,
        postedOn
    };

    data.validation = validateJobData(data);
    return data;
};
*/

const extractors = {
    upwork: performUpworkExtraction,
    freelancer: performFreelancerExtraction,
    guru: performGuruExtraction,
    // toptal: performToptalExtraction,
    // fiverr: performFiverrExtraction
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractJob") {
    const platform = getPlatform();

    const extractor = extractors[platform] || (() => ({ error: 'Unknown platform' }));

    // Smart Retry Mechanism for SPA / Hydration
    let data = extractor();
    
    // Check if critical fields are missing and retry
    const isMissingCritical = (d) => !d || d.title === 'Title not found' || d.summary === 'Summary not found' || d.error;

    if (isMissingCritical(data) && platform !== 'unknown') {
        setTimeout(() => {
            data = extractor();
            sendResponse({ success: !data.error, data: data });
        }, 1000);
    } else {
        sendResponse({ success: !data.error, data: data });
    }
    return true;
  }
  
  if (request.action === "syncUserSkills") {
    const currentOverlay = document.querySelector('.air3-slider, .up-slider, .up-modal, [role="dialog"]');
    const skills = extractSkillsFromDocument(USER_SKILL_SELECTORS, currentOverlay);
    
    if (skills.length > 0) {
        chrome.storage.local.set({ cachedUserSkills: skills }, () => {
            sendResponse({ 
                success: true, 
                count: skills.length, 
                skills: skills,
                platform: getPlatform()
            });
        });
    } else {
        sendResponse({ success: false, error: "No skills found in sidebar. Please ensure your profile is visible." });
    }
    return true;
  }
});
