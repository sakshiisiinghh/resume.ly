# <h1 align="center">📄 **Resume.ly** – AI-Powered ATS Resume Analyzer</h1>

<p align="center">
  <strong>An intelligent, serverless resume analysis platform that scans resumes, calculates ATS compatibility scores, and provides actionable, job-specific improvement feedback.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
</p>

<p align="center"> Built with ❤️ by <strong>Sakshi Singh</strong> </p>

---

## 🚀 Live Application

🔗 **Deployed on Vercel:** [View Live Demo](https://resume-ly-neon.vercel.app/auth?next=/)

---

## 📌 Overview

**Resume.ly** helps job seekers bridge the gap between their experience and automated hiring systems. Over **75% of resumes** are rejected by ATS systems before ever reaching a human recruiter; Resume.ly levels the playing field.

Built using a modern **React + TypeScript + Serverless** architecture, the platform eliminates the need for traditional backend management while maintaining high performance and security.

### 🛠️ The Workflow
1. **Upload:** Drop your resume as a PDF (up to 20 MB).
2. **Match:** Paste the Target Job Description.
3. **Analyze:** Receive an ATS compatibility score plus scores for tone, content, structure and skills.
4. **Optimize:** Follow specific, AI-driven suggestions to improve ranking.

---

## ✨ Core Features

* **📊 ATS Compatibility Score:** Gemini scores the resume out of 100 for ATS suitability, tone & style, content, structure and skills, each with specific tips.
* **🎯 Job-Specific Feedback:** The job title and description are part of the prompt, so feedback targets the role you're applying for.
* **☁️ Secure Storage:** Analyzed resumes are saved to your own **Puter.js** cloud storage, and you can delete any of them.
* **🔐 Serverless Auth:** Fully browser-based authentication, with no traditional database or backend required.
* **🛡️ Validated AI Output:** Model responses are checked against a Zod schema, retried once if malformed, and never saved as a fake score.
* **🎨 Modern UI/UX:** A clean, responsive interface built with **Tailwind CSS** and **Vite** for lightning-fast interactions.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React, TypeScript, React Router v7 |
| **State Management** | Zustand |
| **Styling** | Tailwind CSS |
| **AI** | Gemini (`google/gemini-3.5-flash`) via Puter.js |
| **Validation** | Zod |
| **Serverless/Cloud** | Puter.com (Auth, Storage, KV, AI gateway) |
| **Testing & CI** | Vitest, React Testing Library, GitHub Actions |
| **Build Tool** | Vite |
| **Deployment** | Vercel |

---

## 🧠 How It Works

<details>
<summary><strong>Click to view Technical Pipeline</strong></summary>

### 1️⃣ Resume Parsing
The PDF's text is extracted in the browser with `pdfjs-dist`. Image-only PDFs with no selectable text are rejected up front, since an ATS can't read them either. Page 1 is also rendered to an image for the preview.

### 2️⃣ Storage
The PDF and preview image are uploaded to Puter cloud storage. A record with `status: "processing"` is saved to Puter KV.

### 3️⃣ AI Analysis
The resume text, job title and job description go to Gemini at temperature 0 with a structured JSON format. Resume text is delimited in the prompt and treated as data, not instructions.

### 4️⃣ Validation
The response is validated with Zod. Malformed output gets one retry that includes the validation error. If the model declines, or returns all-zero scores, the analysis is marked `failed` instead of showing a score.

### 5️⃣ Feedback
The results page shows the overall score, ATS score and per-category tips from the validated response.
</details>

---

## 📂 Project Architecture

```text
resume-ly/
├── app/
│   ├── components/    # UI components (score gauges, accordion, uploader, cards)
│   ├── routes/        # Pages: home, auth, upload, resume/:id, wipe
│   ├── lib/           # Puter store, PDF parsing, Zod schema, analysis + delete logic
│   └── root.tsx
├── constants/         # AI prompt and response format
├── types/             # Global and Puter type declarations
├── test/              # Test setup and fixtures
├── public/            # Static assets and the pdf.js worker
├── .github/workflows/ # CI: typecheck, test, build
├── react-router.config.ts
├── vite.config.ts
└── vitest.config.ts
```

---

## ⚙️ Getting Started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit and component tests
npm run typecheck
```
