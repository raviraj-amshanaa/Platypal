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
| Patient | Plain-language care plan in their selected language (English + 9 translation languages), with read-aloud functionality, large text and high contrast |
| Patient | One-tap daily checklist |
| Patient | **I'm having trouble**: Describe the issue by speaking in English or uploading a photo → AI triage → staff queue. Emergency words show **Call 911** |
| Patient | **Family Circle**: invite with a 6-digit code, choose exactly what they can see, remove anytime |
| Family | See only what was shared, get alerts, send a report on the patient's behalf (if allowed) |

## Run it

Needs Node.js 18 or newer.

```bash
npm install
cp .env.example .env      # optional: add an AI key (see below)
npm start                 # http://localhost:3000
```

- Open `http://localhost:3000` and sign in. Expand **Try a demo account** on the sign-in page, or use these (password `platypal-demo`):
  `nurse.kim` (care team), `raj.patel` (patient), `priya.patel` (family). Set `DEMO_ACCOUNTS=off` in `.env` to disable them.
- `npm run reset` restores the demo seed data
- `npm run dev` restarts the server automatically when you save a file

**AI key:** put an Anthropic (Claude) or OpenAI key in `.env`. With no key the app runs in **mock mode** with canned results, so you can build the UI without a key, and the demo still works if the Wi-Fi dies. The top-right pill shows the current mode.

**Voice input** uses the browser's built-in speech recognition. Use **Chrome or Edge**.

## Accounts and sign-in

Three account types, picked on the sign-in page:

| Type | To create an account you need |
| --- | --- |
| Care team | The staff access code (`STAFF_ACCESS_CODE` in `.env`, default `PLATY-STAFF-2026`) and your name |
| Patient | The 6-digit **discharge code** shown to staff on the patient's screen (**Discharge code** line) |
| Family | The 6-digit invite code the patient created in Family Circle |

`/staff.html`, `/patient.html` and `/family.html` require sign-in. A patient can only open their own page, and a family member only their own invite. Care team accounts can open all three. Passwords are hashed (scrypt); sessions are an httpOnly cookie held in server memory, so restarting the server signs everyone out. Set `COOKIE_SECURE=1` when serving over HTTPS.

Note: the `/api/*` data routes are not authenticated yet, only the pages are.

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
server/auth.js         Accounts, sessions, page protection
server/seed.js         Fake demo patients                  Person D
server/store.js        JSON-file database (data/db.json)
public/index.html + signup.html     Sign-in / sign-up (js/auth.js, css/auth.css)
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
