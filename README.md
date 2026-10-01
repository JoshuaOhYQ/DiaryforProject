# Project Log Book

A small web app that makes the supervisor's log book painless: you log work as you do it
(under a minute per entry), link it to a Gantt chart, and the app writes the weekly log book
pages for you as Word, PDF or CSV.

It started for **PIPER** (IDP1 Group 2, Sunway University) and works for any project: one copy
can hold several projects, and new ones start from a template.

- **Log entries**: date, author, feature, Gantt task, hours, type, what you did, problems, fixes,
  result/evidence, next steps. Markdown, tags, links (paste a commit hash), and pasted screenshots.
  Full-text search and filters.
- **Team & features**: members, roles and colours, feature owners and status, and a
  *who did what* matrix (hours and entries per member × feature, click a cell for the entries).
- **Gantt chart**: drag to move, drag the ends to resize, dependencies, milestones (◆), week/month
  zoom, colour by feature or member. Actual dates come from linked log entries, so slippage
  shows up on its own. Export PNG or PDF.
- **Log book**: pick a week and get hours table, per-member summary, entries with screenshots,
  completed tasks, issues and fixes, next week's plan and signature lines. Export `.docx`,
  PDF or CSV, for the whole team or one member. "Draft from entries" writes a summary
  paragraph from your fields (a template, no AI).
- **Dashboard**: hours per member per week, hours per feature, overdue tasks, tasks due in the
  next 7 days, and days since each member's last entry.

Built with Vite + React + TypeScript. There is no server or account: data lives in your browser
and in `data/logbook.json`, which you commit to Git like any other file.

---

## Setup

1. Install **Node.js 24 LTS** (22.18 or newer works): <https://nodejs.org>, or on Windows
   `winget install OpenJS.NodeJS.LTS`. Restart the terminal afterwards.
2. In this folder:

   ```bash
   npm install      # also registers the Git merge driver for data/logbook.json
   npm run dev      # open http://localhost:5173
   ```

**If `node` or `npm` is "not recognized"** after installing Node, the terminal has an old PATH.
First close all terminals (and VS Code) and open a new one. If that doesn't help, check that Node
is installed and refresh the PATH in the current PowerShell window:

```powershell
Test-Path "C:\Program Files\nodejs\node.exe"     # True = installed
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
node --version
```

If it says `False`, Node isn't installed: run the `winget` command above (or use the installer
from nodejs.org with "Add to PATH" ticked) and open a new terminal. Signing out of Windows and
back in also fixes a stale PATH.

If `npm install` says scripts are disabled, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and retry.

That's it. While `npm run dev` is running, **every change is written to `data/logbook.json`**
(and screenshots to `data/assets/`). The dot in the top bar shows when it last saved.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app and save to `data/` as you work |
| `npm run dev -- --host` | Same, reachable from phones on the same Wi-Fi (they save to your laptop's `data/` too) |
| `npm test` | Run the tests (data layer, merging, Gantt date maths, log book builder, importer) |
| `npm run build` | Build the static site into `dist/` (includes a copy of `data/`) |
| `npm run seed -- --force` | Recreate `data/logbook.json` from the PIPER template and `docs/WORK_LOG_smart_home.md` |

## Everyday use

- Press **N** anywhere to log work. **Ctrl+Enter** saves, **Esc** cancels. The date defaults to
  today and the author to whoever last logged on this computer.
- Paste a screenshot with **Ctrl+V** inside the form, or drop files on it.
- In **Links**, paste a URL, `label | URL`, or a bare commit hash (set the repo URL in Settings
  and it becomes a link to that commit).
- Pick a **Gantt task** in the entry so the chart can show actual vs planned dates. From an entry,
  click the task name to jump to the chart; from the chart, click a task to see its entries.
- Press **/** on the Log page to search. Quoted phrases work: `"two brokers"`.
- Friday: open **Log book**, click **Draft from entries** for each member, tidy the paragraph,
  then export **Word** or **PDF**. Choose a member in the drop-down for individual pages.

## Sharing with the team through Git

`data/logbook.json` is the shared log book. The routine is:

```bash
git pull                 # get everyone's entries
npm run dev              # log your work (the app merges what you pulled automatically)
git add data && git commit -m "Log: broker password" && git push
```

- **No more JSON conflicts.** `npm install` registers a Git *merge driver* (see `.gitattributes`
  and `scripts/merge-logbook.ts`). When two people both add entries, Git merges them record by
  record instead of producing a conflict. Each record has an id and an `updatedAt` time; the
  newest edit wins, and deletions are remembered.
- **If you still get a conflict** (e.g. a teammate hasn't run `npm install`), just open the app
  with `npm run dev`: it reads both sides of the conflict markers, merges them, and rewrites the
  file. Then `git add data/logbook.json` and commit.
- **Pulling while the app is open is safe.** Before each save the app re-reads the file and merges,
  and it re-reads it when you switch back to the browser tab.
- **On a phone or the deployed site** (no `npm run dev`), entries are kept in that browser.
  Either connect the repo's `data` folder (Settings → *Connect data folder*, Chrome/Edge on a
  computer) or use *Download backup* and send the file to a teammate, who uses
  *Merge a teammate's file*.
- Screenshots are shrunk (max 1600 px wide) before they are saved, to keep the repo small.

## Using it for other projects

- **Several projects in one repo**: use the project picker in the top bar → *New project*. Start from
  **PIPER**, **Engineering design project** (typical work packages), **Blank**, or copy the team
  and features of the current project. Everything (entries, tasks, log book) is per project.
- **A separate repo for another team**: copy this folder (or mark the GitHub repo as a template),
  then either delete `data/logbook.json` and pick a template on the welcome screen, or run
  `npm run seed -- --template engineering --force`.
- **Add your own template**: copy `src/templates/piper.ts`, change the members, features and
  milestones, and list it in `src/templates/index.ts`.
- **Settings** holds the project name, university, course, group, supervisor, the date of log
  book week 1, whether weeks start on Monday or Sunday, the code repo URL, and the list of entry
  types.

## Importing an existing markdown log

Log page → **Import markdown** (or Settings). Two layouts are understood:

- **A dated log**: every heading with a date (`## 12 Sep 2026 — Broker set-up (2h)`) becomes an
  entry. Lines such as `Problem:`, `Fix:`, `Result:`, `Next:`, `Hours:`, `Tags:` or sub-headings
  like `### Problems` sort the text into fields.
- **A report** like `docs/WORK_LOG_smart_home.md`: the whole file becomes one entry. `Date:` and
  `Done by:` are read from the top, and each section goes to the field its heading suggests.
  A "problems I hit and how I solved them" section is split into problems and fixes.

You get a preview to check dates, authors, features and hours before anything is imported.
The seed data already contains `docs/WORK_LOG_smart_home.md`. **Its hours are 0** because the file
doesn't say how long it took, so edit that entry and set them.

## Deploying (optional)

The deployed site is a static copy: it shows the log book as it was when it was built, and
each visitor's own changes stay in their browser unless they connect the data folder.

**Privacy:** the build includes `data/`, so if the GitHub repo or the site is public, the log book
is public too. To deploy an empty app, set `LOGBOOK_PUBLISH_DATA=false` when building.

- **GitHub Pages**: push to `main`, then in the repo go to *Settings → Pages → Source:
  GitHub Actions*. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes on
  every push. The site appears at `https://<user>.github.io/<repo>/`.
- **Vercel**: *Add New Project* → import the repo. Vercel detects Vite: build command
  `npm run build`, output directory `dist`. No other settings are needed.

## Backups

- Settings → **Download backup** saves everything (or just this project) as JSON.
- **Restore from backup** makes the log book exactly match the file (anything not in it is deleted).
  **Merge a teammate's file** only adds or updates.
- `data/logbook.json` is in Git, so every commit is a backup as well.

## How it is built

```text
src/
  data/          the only data layer the UI talks to (src/data/index.ts)
    store.ts       in-memory state, saving, merging, attachments
    localDb.ts     IndexedDB in the browser
    fileTargets.ts where logbook.json lives: dev server, connected folder, or read-only site
    merge.ts       record-by-record merge (also used by the Git merge driver)
    workspace.ts   the file format, defaults and validation
  gantt/         ganttMath.ts (dependencies, slippage), layout, SVG chart, task panel, export
  logbook/       buildWeek.ts (what goes on a page), narrative draft, Word export, print layout
  import/        markdown work-log importer
  templates/     project templates (PIPER, engineering, blank)
  pages/         Dashboard, Log, Gantt, Team, Log book, Settings
vite-plugin-logbook.ts   dev-only endpoint that writes data/ to disk
scripts/                 seed, Git merge driver and its setup
data/logbook.json        the shared log book; data/assets/ holds screenshots
```

**Moving to a shared backend later (Supabase, Firebase).** The UI only uses `store` and the hooks
exported from `src/data/index.ts`. To switch, keep the `LogbookStore` methods (`apply`, `put`,
`remove`, `addAttachment`, `getAttachment`, `restore`, `mergeIn`…) and replace the saving and loading
inside `store.ts` with calls to the backend, with one table per collection (`projects`, `members`,
`features`, `tasks`, `entries`, `weekNotes`) keyed by `id`. The records already carry `id`,
`createdAt` and `updatedAt`, so the same merge rules apply.

**File format.** `data/logbook.json` is pretty-printed with a fixed key order and records sorted by
creation time, so `git diff` shows exactly what changed. Unknown fields are kept, so an older copy
of the app never strips data a newer one added.

## Troubleshooting

- **"Last saved … this browser only"** with `npm run dev`: make sure you opened the address printed
  by `npm run dev`, not a built copy.
- **The dot is red ("Not saved to file")**: click it. Usually `data/logbook.json` was edited by hand
  and is not valid JSON; the app refuses to overwrite it. Fix the file or restore a backup.
  Your changes are still safe in the browser meanwhile.
- **A screenshot shows as a file icon** on a teammate's computer: they need to `git pull` (the image
  is in `data/assets/`).
- **`npm` or `node` not found**: install Node.js (see Setup) and open a new terminal.
