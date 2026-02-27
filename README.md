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
1. **Upload:** Drop your resume in PDF/Doc format.
2. **Match:** Paste the Target Job Description.
3. **Analyze:** Receive a structured ATS compatibility score.
4. **Optimize:** Follow specific, AI-driven suggestions to improve ranking.

---

## ✨ Core Features

* **📊 ATS Compatibility Score:** Generates a weighted score based on keyword matching, skills alignment, and structural formatting.
* **🎯 AI-Powered Matching:** Performs deep gap analysis to identify missing hard/soft skills required for specific roles.
* **☁️ Secure Storage:** Save and manage multiple resume versions via **Puter.js** cloud integration.
* **🔐 Serverless Auth:** Fully browser-based authentication—no traditional database or backend required.
* **🎨 Modern UI/UX:** A clean, responsive interface built with **Tailwind CSS** and **Vite** for lightning-fast interactions.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React, TypeScript, React Router v7 |
| **State Management** | Zustand |
| **Styling** | Tailwind CSS |
| **Serverless/Cloud** | Puter.com (Auth, Storage, AI Integration) |
| **Build Tool** | Vite |
| **Deployment** | Vercel |

---

## 🧠 How It Works

<details>
<summary><strong>Click to view Technical Pipeline</strong></summary>

### 1️⃣ Resume Parsing
The system extracts raw text and identifies key sections (Skills, Education, Experience) using client-side processing.

### 2️⃣ Job Description Analysis
The AI parses the job posting to identify "Must-Have" vs "Nice-to-Have" competencies.

### 3️⃣ The Scoring Engine
A custom algorithm calculates the final score based on:
- **Keyword Match:** Presence of industry-standard terms.
- **Skills Alignment:** Direct overlap with job requirements.
- **Structural Compliance:** Check for ATS-friendly formatting.

### 4️⃣ Feedback Generation
The system produces actionable tips, such as:
- Suggestions for stronger **Action Verbs**.
- Guidance on **Quantifiable Achievements**.
- Missing keyword alerts.
</details>

---

## 📂 Project Architecture

```text
resume-ly/
├── src/
│   ├── components/    # Reusable UI components
│   ├── pages/         # View/Route definitions
│   ├── store/         # Zustand state logic
│   ├── utils/         # Scoring algorithms & parsers
│   └── assets/        # Static files & icons
├── public/
├── package.json
├── vite.config.ts
└── tsconfig.json
