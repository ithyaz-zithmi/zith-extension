const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

// Load configuration
const { CONFIG } = require('./config.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = CONFIG.PORT;
const JWT_SECRET = CONFIG.JWT_SECRET;
const GEMINI_API_KEY = CONFIG.GEMINI_API_KEY;

app.use(cors());
app.use(express.json());

// Initialize Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token || token === 'undefined' || token === 'null') {
    console.log('Auth Failed: No valid token found in header');
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Auth Failed: Invalid/Expired token');
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

/**
 * Mock Login
 * POST /api/auth/login
 */
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  console.log(`Login attempt for ${email}`);
  
  // High-five mock login - always succeeds for testing!
  // Generate a mock tenant ID based on the email domain or a static UUID if preferred
  const mockTenantId = Buffer.from(email).toString('hex').substring(0, 12); 
  const user = { id: 'u123', email, name: 'Test User', tenantId: mockTenantId };
  const accessToken = jwt.sign(user, JWT_SECRET, { expiresIn: '24h' });
  
  res.json({ success: true, accessToken, user });
});


/**
 * Mock Auth Check
 * GET /api/auth/check
 */
app.get('/api/auth/check', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});


/**
 * Sync Job to Database
 * POST /api/jobs
 */
app.post('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const jobData = req.body;
    const userId = req.user.id;

    console.log(`Saving job for user ${userId}:`, jobData.title);

    // TODO: Insert jobData into your database (MongoDB, PostgreSQL, etc.)
    // Example: await db.jobs.insertOne({ ...jobData, userId, syncedAt: new Date() });

    res.status(201).json({ success: true, message: 'Job synced successfully' });
  } catch (error) {
    console.error('Save Job Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * Handle Lead Synchronization (from extension)
 * POST /api/leads
 */
app.post('/api/leads', authenticateToken, async (req, res) => {
  try {
    const leadData = req.body;
    const tenantId = req.headers['x-tenant-id'];
    const userId = req.user.id;

    console.log('=== LEAD SYNC RECEIVED ===');
    console.log('User ID:', userId);
    console.log('Tenant:', tenantId);
    console.log('Title:', leadData.title);
    console.log('AI Summary:', leadData.ai_summary ? 'PRESENT' : 'MISSING');
    console.log('Internal Notes:', leadData.internalNotes);
    console.log('Skill Analysis:', leadData.skillAnalysis ? `Match: ${leadData.skillAnalysis.matchPercentage}%` : 'N/A');
    
    // In a real app, you would save this to your database
    // Example: await Lead.create(leadData);

    res.status(201).json({ 
      success: true, 
      message: 'Lead synchronized successfully',
      data: { id: 'lead_' + Date.now() } // Mock lead ID
    });
  } catch (error) {
    console.error('Lead Sync Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * Get User Skills (Mock)
 * GET /api/skills
 */
app.get('/api/skills', authenticateToken, (req, res) => {
  console.log('=== GET /api/skills REQUEST RECEIVED ===');
  const category = req.query.category;
  console.log(`Fetching skills for user ${req.user.id}, category: ${category}`);


  // Mock skills dictionary
  const skillsMap = {
    'upwork': ['React', 'Node.js', 'JavaScript', 'TypeScript', 'Chromium Extension', 'Firebase', 'PostgreSQL'],
    'freelancer': ['HTML5', 'CSS3', 'jQuery', 'PHP', 'Laravel', 'MySQL', 'WordPress']
  };

  const skills = category ? (skillsMap[category.toLowerCase()] || []) : [...skillsMap.upwork, ...skillsMap.freelancer];

  res.json({
    success: true,
    data: skills
  });
});


/**
 * Handle AI Generation (Summary or Proposal)
 * POST /api/generate
 */
app.post('/api/generate', async (req, res) => {
  try {
    const { type, text, job, settings, templateType } = req.body;
    let prompt = '';

    if (type === 'summary') {
      prompt = `Summarize the following job description into 3 to 6 highly concise bullet points (short sentences) for a freelancer to quickly grasp the core requirements. Respond strictly with a JSON array of strings: ["point 1", "point 2"]. Description: ${text}`;
    } else if (type === 'proposal') {
      const fName = settings?.freelancerName || 'Freelancer';
      const skillsConfig = settings?.skills || 'development';
      const desc = job.summary || job.description || '';

      prompt = `You are a Top-Rated Plus, world-class expert freelancer named ${fName} specializing deeply in: ${skillsConfig}.
      Write an absolute standout, high-converting Upwork proposal for this job titled "${job.title}".
      Job Description Context: "${desc.substring(0, 2000)}"
      Style: ${templateType || 'detailed'}
      Output requirements: Print ONLY the raw proposal string.`;
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let data = responseText;
    if (type === 'summary') {
      try {
        // Clean up markdown if AI includes it
        let cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        // Sometimes Gemini returns a markdown list or just text, let's be extra careful
        if (cleanedText.startsWith('[') && cleanedText.endsWith(']')) {
          data = JSON.parse(cleanedText);
        } else {
          // If not a JSON array, split by lines and filter
          data = cleanedText.split('\n').map(line => line.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean);
        }
      } catch (e) {
        console.error("JSON Parse Error on Summary:", e);
      }
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('AI Generation Error:', error);
    res.status(500).json({ message: 'AI Service Error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
