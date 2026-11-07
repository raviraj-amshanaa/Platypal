# Platypal

**Care that follows you home.** A web app for the WiE Hackathon (PointClickCare healthcare challenge).

Patients go home from hospital confused about their instructions, and staff don't find out they're struggling until something goes wrong. Platypal turns discharge papers into a **nurse-approved** checklist in the patient's language, lets patients and family report problems by **voice and photo**, and uses AI to **rank those reports by severity** so staff see the most urgent first.

> AI drafts and ranks. The nurse decides. Nothing reaches the patient until a nurse approves it.

## Features

| Who | Feature |
| --- | --- |
| Care team | Photograph discharge papers → AI drafts explanation, meds, appointments, daily checklist |
| Care team | Review side by side with the original: edit, remove, add, then **Approve & send** (translated on approval) |
| Care team | Dashboard sorted by risk, with alerts: urgent reports, missed meds 2 days in a row, no activity for 48 h |
| Care team | Trouble reports with AI severity, summary and reason; override severity; reply (Reviewed / Calling / Advise ER) |
| Patient | Plain-language plan in their language, read aloud, large text, high contrast |
| Patient | One-tap daily checklist |
| Patient | **I'm having trouble**: speak in any language, add a photo → AI triage → staff queue. Emergency words show **Call 911** instantly |
| Patient | **Family Circle**: invite with a 6-digit code, choose exactly what they can see, remove anytime |
| Family | See only what was shared, get alerts, send a report on the patient's behalf (if allowed) |

## Run it

Needs Node.js 18 or newer.

```bash
npm install
cp .env.example .env      # optional: add an AI key (see below)
npm start                 # http://localhost:3000
```

- Open three tabs: `/staff.html`, `/patient.html?id=p_patel`, `/family.html?code=482913`
- `npm run reset` restores the demo seed data
- `npm run dev` restarts the server automatically when you save a file

**AI key:** put an Anthropic (Claude) or OpenAI key in `.env`. With no key the app runs in **mock mode** with canned results, so you can build the UI without a key, and the demo still works if the Wi-Fi dies. The top-right pill shows the current mode.

**Voice input** uses the browser's built-in speech recognition. Use **Chrome or Edge**.

## How it works

1. Nurse uploads a photo → `POST /api/patients` → `ai.draftPlan()` (vision model returns JSON) → saved as `draft`
2. Nurse edits and approves → `POST /api/patients/:id/approve` → `ai.translatePlan()` → `approved`
3. Patient view (`/api/patient-view/:id`) only shows approved plans
4. Trouble report → `POST /api/patients/:id/reports` → emergency keyword check → `ai.triageReport()` (voice transcript + photo + care plan context) → severity, summary, reason
5. Dashboard (`/api/dashboard`) runs the rules in `server/alerts.js` and sorts by risk score

## Project structure (and who owns what)

```
server.js              API routes                         (everyone, carefully)
server/ai.js           All AI prompts + mock fallback      Person A
server/alerts.js       Alert rules + risk score            Person C
server/seed.js         Fake demo patients                  Person D
server/store.js        JSON-file database (data/db.json)
public/staff.html  + js/staff.js     Care team screens      Person B
public/patient.html + js/patient.js  Patient screens        Person C
public/family.html + js/family.js    Family screens         Person C
public/js/trouble.js   Shared trouble-report form
public/js/common.js    Shared helpers (API, read-aloud, voice, languages)
public/css/styles.css  Design system (colors, type)         Person D
```

## Tech

Node.js + Express, vanilla HTML/CSS/JS (no build step), Claude or OpenAI vision models, Web Speech API (voice input), Speech Synthesis API (read-aloud), JSON file storage.

All patient data in this repo is fake.
