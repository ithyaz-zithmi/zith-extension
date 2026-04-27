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
  
  console.log(`Extracting skills from document. Profile Page: ${isProfilePage()}`);

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
      console.log('Upwork profile fallback scan...');
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
      console.log('Freelancer profile fallback scan (Top skills)...');
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

    console.log(`Attempting to cache user skills for ${platform} (excluding overlay if present)...`);
    const skills = extractSkillsFromDocument(USER_SKILL_SELECTORS, currentOverlay);
    
    // Filter out common job-specific skills if found in the main content instead of sidebar
    const filteredSkills = skills.filter(s => s.length > 1 && s.length < 40);

    if (filteredSkills.length > 0) {
        console.log(`Successfully cached ${platform} user skills (Count: ${filteredSkills.length}):`, filteredSkills);
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
      console.log('Job type element found:', typeText);
      
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
      
      console.log('Detected job type from element:', jobType);
    }
    
    // Check labels for job type
    const jobTypeLabel = getByLabel('Job Type');
    if (jobTypeLabel !== 'N/A') {
      const labelText = jobTypeLabel.toLowerCase();
      console.log(`Found Job Type label: ${jobTypeLabel}`);
      if (labelText.includes('full-time') || labelText.includes('full time')) jobType = 'full-time';
      else if (labelText.includes('hourly')) jobType = 'hourly';
      else if (labelText.includes('fixed') || labelText.includes('fixed-price')) jobType = 'fixed';
    }
    
    // Check Project Type label separately
    const projectTypeLabel = getByLabel('Project Type');
    if (projectTypeLabel !== 'N/A') {
      const labelText = projectTypeLabel.toLowerCase();
      console.log(`Found Project Type label: ${projectTypeLabel}`);
      
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
        console.log(`Preserving custom project type: ${projectTypeFromLabel}`);
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
    
    console.log('=== FINAL JOB TYPE ===');
    console.log('Final jobType:', jobType);
    console.log('Final projectTypeFromLabel:', projectTypeFromLabel);

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
    
    console.log('Initial budget extraction:', budget);

    let hourlyRate = getText([
      '[data-test="hourly-rate"]', '[data-qa="hourly-rate"]',
      '[data-ev-label="hourly_rate"]', '[data-test="is-hourly"] strong',
      'li[data-qa="hourly-rate"] strong',
      'span[data-test="hourly-rate"]'
    ]);
    
    console.log('Initial hourly rate extraction:', hourlyRate);

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
    console.log('Extracted User Skills from DOM durante extraction:', userSkills);
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
        // Search for ranges like "₹600.00 – 1,500.00 INR" or "$250 - $750 USD"
        const rangeRegex = /([\₹\$€£]\s*[\d,.]+(?:\.\d{2})?\s*(?:–|-|to)\s*[\₹\$€£]?\s*[\d,.]+(?:\.\d{2})?\s*(?:INR|USD|EUR|GBP|AUD|CAD)?)/i;
        const singleRegex = /([\₹\$€£]\s*[\d,.-]+\s*(?:INR|USD|EUR|GBP|AUD|CAD)?(?:\s*\/\s*hr|\s*per hour)?)/i;
        
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

const extractors = {
    upwork: performUpworkExtraction,
    freelancer: performFreelancerExtraction
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractJob") {
    const platform = getPlatform();
    console.log(`Extraction started for ${platform}...`);

    const extractor = extractors[platform] || (() => ({ error: 'Unknown platform' }));

    // Smart Retry Mechanism for SPA / Hydration
    let data = extractor();
    
    // Check if critical fields are missing and retry
    const isMissingCritical = (d) => !d || d.title === 'Title not found' || d.summary === 'Summary not found' || d.error;

    if (isMissingCritical(data) && platform !== 'unknown') {
        console.log("Critical fields missing or error, retrying in 1000ms for hydration...");
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
    console.log("Manual User Skills Sync Requested...");
    const currentOverlay = document.querySelector('.air3-slider, .up-slider, .up-modal, [role="dialog"]');
    const skills = extractSkillsFromDocument(USER_SKILL_SELECTORS, currentOverlay);
    
    if (skills.length > 0) {
        chrome.storage.local.set({ cachedUserSkills: skills }, () => {
            console.log("Manual Sync Success:", skills);
            sendResponse({ 
                success: true, 
                count: skills.length, 
                skills: skills,
                platform: getPlatform()
            });
        });
    } else {
        console.warn("Manual Sync Failed: No skills found.");
        sendResponse({ success: false, error: "No skills found in sidebar. Please ensure your profile is visible." });
    }
    return true;
  }
});
