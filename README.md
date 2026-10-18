# <h1 align="center">📄 **Resume.ly** – AI-Powered ATS Resume Analyzer</h1>

<p align="center">
  <strong>An intelligent resume analysis platform that scans resumes, calculates ATS compatibility scores, and provides actionable, job-specific improvement feedback.</strong>
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

Built with **React Router v7 on Node**, uploads are processed asynchronously by a **BullMQ worker**, persisted in **PostgreSQL**, and streamed back to the browser over **Server-Sent Events**.

### 🛠️ The Workflow
1. **Upload:** Drop your resume as a PDF (up to 20 MB).
2. **Match:** Paste the Target Job Description.
3. **Analyze:** Receive an ATS compatibility score plus scores for tone, content, structure and skills.
4. **Optimize:** Follow specific, AI-driven suggestions to improve ranking.

---

## ✨ Core Features

* **📊 Explainable ATS Engine:** Deterministic checks (layout, reading order, sections, contact info, dates, hidden text) and job-description keyword matching produce an ATS readiness score, with the evidence for every point deducted.
* **🧠 AI Feedback:** Gemini scores tone & style, content, structure and skills with specific tips. The overall score blends the engine and the AI, and the page shows the breakdown.
* **🎯 Job-Specific Feedback:** The job title and description are part of the prompt, so feedback targets the role you're applying for.
* **☁️ Private Storage:** Every resume, analysis and file is scoped to its owner; other users get a 404. You can delete any of your resumes.
* **🔐 Real Auth:** Argon2-hashed passwords and database-backed sessions in HttpOnly cookies.
* **⚙️ Durable Jobs:** Idempotent submissions, retries with backoff, error classification and crash recovery.
* **🛡️ Validated AI Output:** Model responses are checked against a Zod schema, retried once if malformed, and never saved as a fake score.
* **🎨 Modern UI/UX:** A clean, responsive interface built with **Tailwind CSS** and **Vite** for lightning-fast interactions.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React, TypeScript, React Router v7, Tailwind CSS |
| **Server** | Node.js (React Router loaders, actions, resource routes) |
| **Database** | PostgreSQL + Drizzle ORM |
| **Queue & Worker** | BullMQ + Redis, separate Node worker process |
| **AI** | Gemini via `@google/genai` behind an `LLMProvider` interface |
| **PDF** | `pdfjs-dist` for text extraction, `@napi-rs/canvas` for thumbnails |
| **Validation** | Zod |
| **Testing & CI** | Vitest, React Testing Library, GitHub Actions |
| **Infra** | Docker, Docker Compose |

---

## 🧠 How It Works

<details>
<summary><strong>Click to view Technical Pipeline</strong></summary>

### 1️⃣ Upload
The upload action validates the file (size and `%PDF-` magic bytes), stores it under an owner-scoped key, and computes an idempotency key from the user, file hash, job title, job description, prompt version and model. A repeated submission returns the existing analysis instead of running again. The action then enqueues a job and redirects immediately.

### 2️⃣ Worker
A separate process picks up the job, extracts text and glyph positions from every page, renders a WebP thumbnail, and runs the deterministic ATS engine. It then calls Gemini at temperature 0 with the resume text in the user turn, apart from the instructions. Each step updates the analysis stage and publishes progress.

### 2️⃣b ATS engine
Pure functions over the extracted document: column and reading-order detection from text positions, section headings (fuzzy matched), contact details, date formats and ranges, page and font checks, tiny hidden text, and instruction-like phrases. Keywords come from a curated skills dictionary with aliases, split into required and nice-to-have. The same input always gives the same report. These are heuristics, not any employer's real ATS.

### 3️⃣ Validation and failures
Model output is validated with Zod. Malformed output gets one retry with the validation error. Declined or all-zero responses fail the analysis instead of saving a fake score. Transient errors (network, 429, 5xx) retry with exponential backoff; permanent ones (invalid PDF, no text layer, bad credentials) fail immediately.

### 4️⃣ Recovery
A repeatable job reconciles the database with the queue: analyses stuck in `processing` with no heartbeat are re-queued or failed.

### 5️⃣ Progress
The review page subscribes to an SSE stream (current state first, then live updates) and falls back to polling if the stream drops.
</details>

---

## 📂 Project Architecture

```text
resume-ly/
├── app/
│   ├── .server/       # Server-only: db, auth, queue, storage, LLM, jobs, PDF
│   ├── components/    # UI components
│   ├── routes/        # Pages and resource routes (files, SSE)
│   └── lib/           # Shared: Zod schema, analysis retry, helpers
├── worker/            # BullMQ worker entrypoint
├── drizzle/           # SQL migrations
├── constants/         # AI prompt and response format
├── test/              # Test setup, fixtures, PDF builder
├── docker-compose.yml
└── Dockerfile
```

---

## 📏 Evaluation

The ATS engine is measured against a labeled synthetic dataset (25 resumes, 6 job descriptions): `npm run eval`. CI fails if the numbers get worse. AI score consistency can be measured with your own key via `npm run eval:llm`. See [evals/README.md](evals/README.md) for the method, the first run's findings, and the limits of the data.

---

## ⚙️ Getting Started

```bash
cp .env.example .env          # set SESSION_SECRET and GEMINI_API_KEY
docker compose up -d postgres redis
npm install
npm run db:migrate
npm run dev                   # http://localhost:5173
npm run worker                # in a second terminal
```

Or run everything in containers: `docker compose up --build`.

```bash
npm test            # unit tests; server tests also need Postgres from compose
npm run typecheck
```
