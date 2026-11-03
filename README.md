# CCM Generator

A small web app that builds a **CALTech Course Manual (CCM)** as a Word file from a syllabus, the number of lectures and the class slot.

Everything runs in the browser. There is no server, no build step and no dependency: the `.docx` is made by filling the embedded `CCM_Template.docx` (`assets/template.js`) in place, so fonts, tables and page layout are the template's own. Nothing you type is uploaded (the form is autosaved in your own browser's local storage).

## Academic calendar

Upload the VIT Bhopal *Academic Calendar* PDF (section 3, "Academic calendar"). It may hold several semesters (Fall and Winter); pick one. The app reads the first and last instructional day, holidays, sectional holidays, CAT-1 / CAT-2 weeks, fests and the Saturday instructional days with the weekday timetable they follow.

* Without a class list: sessions are dated on your chosen class days (Mon-Fri) from the first instructional day (or your own later start date) and never go past the last instructional day. Holidays, CAT weeks and fests are skipped; a Saturday instructional day counts as the weekday it follows. If fewer days fit than you asked for, the plan is shortened and a warning says so.
* With a VTOP / Excel class list: the dates are used as given and checked against the calendar (holiday, CAT week, outside the term, unlisted Saturday). Warnings appear above the session list.
* "Sectional holiday" rows (for example Onam, Good Friday) apply to some students only, so classes run unless you untick that option. The day totals this gives match the "No. of instructional days" line printed in the 2026-27 calendars.
* Extra holidays can still be typed under "Holidays to skip".
* Tests: `node test/calendar.js` (Chromium, needs playwright).

## Quick start (two uploads)
1. **Upload the syllabus PDF** (section 0). The code, title, objectives, outcomes, units with hours, guest lecture, books and suggested experiments are read from it. If the PDF is a scan, or does not read properly, paste its text into the box below the button instead.
2. **Upload the class list** (section 3): VTOP “Date of lecture” page(s) or an Excel/CSV sheet.
3. Add faculty / semester details, check the form, click **Create session plan**, then download one class or all classes.

The PDF reader (pdf.js, Apache-2.0) is bundled in `lib/pdfjs-main.js` and `lib/pdfjs-worker.js` as plain scripts, so it works from your GitHub Pages link **and** when `index.html` is opened straight from a folder, with no internet. Upload the whole `lib` folder together with the app. (`tools-build-pdfjs.py` regenerates these two files from a newer pdfjs-dist build.)

### Syllabus layouts that are understood
* the older VIT “Unit No. / Unit Content / No. of hours / SOs” table (e.g. CSE3011),
* the newer VIT layout with a *Course code · Course title · L T P J C* row and **Module:1 … 6 hours** headings,
* **Unit I / UNIT-1 / Chapter 1** headings with hours in brackets (theory only courses),
* lab-only courses (no lecture units): the list of experiments becomes the session topics,
* PDFs that contain several courses: pick the course from a list.

Course objectives / outcomes may be numbered, bulleted or written as sentences. Text and reference books, experiments, guest lecture, BoS / Academic-Council lines are picked up when present.

**Always check the form after reading a PDF.** Reading is pattern based, so an unusual layout can leave parts empty or mis-split, and the app lists warnings for what it could not find. The unit → CO links are guessed from matching words. Scanned PDFs (pictures of text) cannot be read; paste the text instead.

## What you enter

| Section | Fields |
|---|---|
| Course details | code, title, type, credits, slot (e.g. `F11+F12`), semester, faculty, … |
| Syllabus | objectives, course outcomes, units (title, hours, SOs, COs, topics), books, BoS/approval dates, experiments |
| Lectures | total sessions (e.g. 22), guest lectures, optional start date, class days and holidays |
| Mapping | CO–SO and CO–PO/PSO matrices |
| Classes (optional) | VTOP “Date of lecture” pages (.html), or an Excel/CSV sheet with `Class ID`, `Date` (+ optional `Slot`, `Venue`) |

## Class-wise CCMs
Upload one VTOP “Date of lecture” page per class (File → Save page as… → HTML), or one Excel/CSV sheet that lists several classes. The app reads the class ID, slot, venue, course code/title and every lecture date, then:
* builds a separate plan per class (number of sessions = number of dates for that class),
* puts the class ID, slot, venue and real lecture dates in that class's CCM,
* lets you download one class as `.docx`, or all classes in one `.zip`.

Excel/CSV layout (header row required, see **Download CSV template**):

| Class ID | Date | Slot | Venue |
|---|---|---|---|
| BL2026270100324 | 14-07-2026 | F11+F12 | AB02-301 |

Dates may be Excel dates or text (`14-07-2026`, `2026-07-14`, `14-Jul-2026`).

## What you get

Cover page, contents, ABET/NBA outcomes, syllabus page, CO–SO and CO–PO mapping, course plan table, assessment tools, CO attainment table, one **session-plan page per lecture**, and a starter model question paper.

### How the session plan is made
1. Lectures (total minus guest lectures) are shared between units in proportion to their hours (largest-remainder rounding, at least one each).
2. The unit's topic list is split into consecutive groups, one per lecture. If a unit has 3+ sessions and *activity* is ticked, its last session becomes "Activity on Unit n".
3. Experiments are spread evenly over the sessions as the after-class activity.
4. Dates are assigned from the start date on the chosen class days, skipping holidays.
5. Before-class, entry/exit ticket, material and weightage text come from templates; **every field can be edited** in the preview before you download.

The plan is rule based, so the topic grouping is a starting point. Review it and adjust.

## Publish on GitHub Pages
1. Create a repository and push these files to the `main` branch.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The included workflow (`.github/workflows/pages.yml`) deploys the site on every push. Your app will be at `https://<user>.github.io/<repo>/`.

Without Actions you can also choose *Deploy from a branch → main / (root)*.

## Run locally
Open `index.html` in a browser, or serve the folder (`python3 -m http.server`).

Tests (need Node 18+; the browser tests also need `playwright` with Chromium and LibreOffice for `soffice`):
* `node test/generate.js` – writes `test/out.docx` from the Python sample.
* `node test/fuzz.js` – 300 random syllabi / lecture counts: planning and document writing must never fail and no topic may be lost.
* `node test/parse.js test/sample-syllabus.pdf test/fixtures/*.pdf` – shows what the syllabus reader finds in each PDF.
* `node test/filecheck.js` – opens index.html from a folder (file://) and reads the sample PDF.
* `node test/e2e.js` – drives the real page: syllabus PDF → class list → plan → .docx, for every sample PDF.

## Notes
* Contents-page numbers are not filled in automatically.
* The logo and the standard ABET/NBA outcome wording come from the VIT Bhopal CCM template. Untick *Show logo* for other institutions.
* Files: `planner.js` (session planning), `importers.js` (VTOP / Excel / CSV readers), `syllabus.js` (syllabus PDF reader), `lib/` (bundled pdf.js), `docgen.js` (fills the CCM template, ZIP writer), `assets/template.js` (embedded template; rebuild with `tools-build-template.py`), `app.js` (UI), `sample.js` (CSE3011 example).
