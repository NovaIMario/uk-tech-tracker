# Early Careers Tracker

UK tech internships, placements, spring weeks, graduate roles and apprenticeships in one list, read twice a day from the employers' own job boards.

**Live site:** https://novaimario.github.io/uk-tech-tracker/

## What it does

- Lists early-career roles based in the UK from over 120 employers: quant firms, AI labs, software companies, UK fintechs, banks, and engineering and defence companies.
- Filters by role type, field (software, data and AI, quant, hardware and engineering, security, product, or non-tech), employer, location, and posting date (on or after any day you pick, or the past week or month). Filters live in the URL, so a filtered view can be bookmarked or shared.
- House style: the site never prints the word "job". It shows as "j\*b" everywhere on the page (search for either and you'll get the same results).
- Shows which employers have the most roles open for the current filters, as a chart with a table view.
- Has an application tracker: mark a role as saved, applied, interviewing, offer, rejected or not interested. Your statuses stay in your browser and are never sent anywhere. Export and import them as JSON to back them up or move them to another device. Roles you track stay in your list after they close.

## How it works

`scripts/fetch-jobs.mjs` runs on GitHub Actions at 06:17 and 18:17 UTC:

1. It reads each board in `scripts/sources.mjs` through the public job-board API the employer publishes (Greenhouse, Lever and Ashby), or the endpoint the employer's own Workday career site calls, filtered to UK locations.
2. It keeps roles whose location is in the UK and whose title marks them as an internship, placement, spring week or insight programme, graduate or entry-level role, or apprenticeship. Senior roles, recruiter roles and roles only open to returning interns are dropped.
3. It merges the result into `data/jobs.json`. Each role keeps the date it was first posted. Roles that come down are marked closed and removed three weeks later. If a board can't be read, its roles are left as they were.
4. The workflow commits the data if it changed and deploys the site to GitHub Pages.

It's polite about it: one request at a time, at least 0.4 seconds apart per host (1.1 seconds for Lever, as its robots.txt asks), with a descriptive user agent.

Classification is by job title and location text, so it can miss a role with an unusual title or now and then include one that isn't really entry level. Run `NEAR_MISS=1 node scripts/fetch-jobs.mjs` to list UK titles that were left out but look early-career, which helps when tuning the patterns.

## Why it doesn't merge Gradcracker, Bright Network or Trackr

Gradcracker and Bright Network block automated access, and Trackr's list is its own curated work. The site links to them, along with TARGETjobs, RateMyPlacement, Prospects, GOV.UK's Find an apprenticeship and the Civil Service Fast Stream, because they cover employers whose boards aren't read here. SmartRecruiters boards are also left out, because SmartRecruiters' robots.txt asks bots not to crawl them.

## Adding an employer

Find the board name in the links on the employer's careers page:

| Careers links look like | Add |
| --- | --- |
| `boards.greenhouse.io/<board>` or `job-boards.greenhouse.io/<board>` | `gh('Name', '<board>')` |
| `jobs.lever.co/<board>` | `lv('Name', '<board>')` |
| `jobs.ashbyhq.com/<board>` | `ab('Name', '<board>')` |
| `<tenant>.wd<n>.myworkdayjobs.com/<site>` | `wd('Name', '<tenant>', n, '<site>')` |

Then run `node scripts/fetch-jobs.mjs` and check the log line for that employer.

## Running locally

```sh
node scripts/fetch-jobs.mjs   # refresh data/jobs.json (Node 20 or later)
npx serve .                   # or: python -m http.server
```

The page is plain HTML, CSS and JavaScript modules with no build step and no dependencies, so it needs to be served over HTTP rather than opened as a file.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `style.css` | The page |
| `js/app.js` | Filters, the role list, the application tracker and the sources table |
| `js/charts.js` | A small SVG chart kit (bars, tooltips, keyboard support, table view) |
| `js/dom.js` | DOM and formatting helpers |
| `scripts/fetch-jobs.mjs` | The fetcher and the title and location classifiers |
| `scripts/sources.mjs` | The employer boards that are read |
| `data/jobs.json` | The roles, written by the fetcher |
| `.github/workflows/update.yml` | The twice-daily update and deploy |

## Disclaimer

An independent project, not affiliated with any employer, job board or careers site. Every role links to the employer's own page; check eligibility and closing dates there before applying.
