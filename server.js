require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

// Load configuration
const { CONFIG } = require('./config.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || CONFIG.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Create a .env file from .env.example');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY is not set. Create a .env file from .env.example');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  if (req.method === 'POST') {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Initialize Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token || token === 'undefined' || token === 'null') {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

/**
 * Mock Extension Login
 * POST /api/auth/extension-login
 */
app.post('/api/auth/extension-login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  const mockTenantId = Buffer.from(email).toString('hex').substring(0, 12);
  const tenantSlug = email.split('@')[1]?.split('.')[0] || 'default';
  const user = { id: 'u123', email, name: 'Test User', tenantId: mockTenantId, tenantSlug };
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

    // TODO: Insert jobData into your database (MongoDB, PostgreSQL, etc.)

    res.status(201).json({ success: true, message: 'Job synced successfully' });
  } catch (error) {
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

    // In a real app, you would save this to your database
    // Example: await Lead.create(leadData);

    res.status(201).json({
      success: true,
      message: 'Lead synchronized successfully',
      data: { id: 'lead_' + Date.now() }
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * Get User Skills (Mock)
 * GET /api/skills
 */
app.get('/api/skills', authenticateToken, (req, res) => {
  const category = req.query.category;

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
 * Sync User Skills (Mock)
 * POST /api/skills/sync
 */
app.post('/api/skills/sync', authenticateToken, (req, res) => {
  try {
    const { skills, category } = req.body;
    console.log(`Syncing ${skills ? skills.length : 0} skills for platform ${category}`);

    // In a mock server, we just return a success response
    res.status(200).json({
      success: true,
      message: 'Skills synced successfully'
    });
  } catch (error) {
    console.error('Error syncing skills:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


/**
 * Handle AI Generation (Summary or Proposal)
 * POST /api/generate
 */
app.post('/api/generate', authenticateToken, async (req, res) => {
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
        if (cleanedText.startsWith('[') && cleanedText.endsWith(']')) {
          data = JSON.parse(cleanedText);
        } else {
          data = cleanedText.split('\n').map(line => line.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean);
        }
      } catch (e) {
        // If parse fails, return raw text split by lines
        data = responseText.split('\n').filter(Boolean);
      }
    }

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ message: 'AI Service Error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
