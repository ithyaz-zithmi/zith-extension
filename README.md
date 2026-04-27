# ZithPort — Freelancer Kit Chrome Extension

> A smart Chrome extension that extracts job details from **Upwork** and **Freelancer**, generates AI-powered proposals, matches your skills, and syncs leads to the [Zithspace](https://zithmi.zithspace.com) dashboard — your personal freelancer CRM.

---

## ✨ Features

- **Job Extraction** — Automatically scrape job title, description, budget, duration, client info, and required skills from Upwork & Freelancer job pages.
- **AI-Powered Proposals** — Generate tailored proposals using Google Gemini AI with multiple templates (Detailed, Short, Technical).
- **AI Job Summary** — Get concise bullet-point summaries of job descriptions for quick evaluation.
- **Skill Matching** — Compare job requirements against your synced skill set and see match percentages.
- **Lead Scoring** — Jobs are scored to help you prioritize the best opportunities.
- **Duplicate Detection** — Warns you if a job is already in your pipeline.
- **CRM Sync** — Save extracted leads directly to the Zithspace backend with full metadata.
- **Local Storage Fallback** — Jobs are saved locally even if backend sync fails, with retry support.
- **Settings Panel** — Configure your name, skills, and default proposal template.

---

## 📁 Project Structure

```
zith-extension/
├── manifest.json        # Chrome Extension manifest (MV3)
├── background.js        # Service worker — handles API calls, auth, sync
├── content.js           # Content script — scrapes Upwork & Freelancer pages
├── popup.html           # Extension popup UI
├── popup.js             # Popup logic — extraction, proposals, saved jobs
├── popup.css            # Popup styles
├── config.js            # Environment configuration (dev/prod)
├── options.html         # Settings/options page
├── options.js           # Options page logic
├── server.js            # Local dev server (Express + Gemini AI)
├── logo.jpeg            # Extension logo
└── .gitignore           # Git ignore rules
```

---

## 🚀 Getting Started

### Prerequisites

- **Google Chrome** (or any Chromium-based browser)
- **Node.js** v18+ (for the local dev server)

### 1. Install the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `zith-extension` folder

### 2. Run the Local Dev Server

```bash
# Install dependencies
npm install express cors jsonwebtoken @google/generative-ai

# Start the server
node server.js
```

The server starts at `http://localhost:5001` and provides:

| Endpoint              | Method | Description                    |
| --------------------- | ------ | ------------------------------ |
| `/api/auth/login`     | POST   | Mock authentication            |
| `/api/auth/check`     | GET    | Verify auth token              |
| `/api/leads`          | POST   | Sync extracted leads           |
| `/api/jobs`           | POST   | Save job data                  |
| `/api/skills`         | GET    | Fetch user skills              |
| `/api/generate`       | POST   | AI summary & proposal generation |

### 3. Configure the Extension

1. Click the ZithPort extension icon
2. Log in with any email/password (mock auth)
3. Open **Settings** (gear icon) to set your name, skills, and default template

---

## 🔧 Usage

1. Navigate to a job listing on [Upwork](https://www.upwork.com) or [Freelancer](https://www.freelancer.com)
2. Click the **ZithPort** extension icon
3. Click **Extract Job** to scrape the job details
4. Review the extracted data — budget, skills, client info, AI score
5. Click **Match Skills** to compare against your profile
6. Click **Generate Smart Proposal** to create an AI-tailored proposal
7. Click **Save Job & Proposal** to sync the lead to Zithspace

---

## ⚙️ Configuration

The extension supports two environments configured in `config.js`:

| Setting             | Development                      | Production                         |
| ------------------- | -------------------------------- | ---------------------------------- |
| API Base URL        | `http://localhost:5001/api`      | `https://zithmi.zithspace.com/api` |
| Dashboard URL       | `http://localhost:3005`          | `https://zithmi.zithspace.com`     |

Environment is auto-detected based on the runtime context.

---

## 🛠 Tech Stack

- **Chrome Extensions Manifest V3**
- **Vanilla JavaScript** (no framework dependencies)
- **Express.js** (dev server)
- **Google Gemini AI** (proposal & summary generation)
- **JWT** (authentication)
- **Chrome Storage API** (local persistence)

---

## 📄 License

This project is proprietary. All rights reserved.
