# Early Careers Tracker

UK tech internships, placements, spring weeks, graduate roles and apprenticeships in one list, read every two hours from the employers' own job boards.

**Live site:** https://novaimario.github.io/uk-tech-tracker/

## What it does

- Lists early-career roles based in the UK from over 130 employers: quant firms, AI labs, big tech, software companies, UK fintechs, banks, and engineering and defence companies.
- Filters by role type, field (software, data and AI, quant, hardware and engineering, security, product, or non-tech), employer, location, and posting date (on or after any day you pick, or the past week or month). Filters live in the URL, so a filtered view can be bookmarked or shared.
- House style: the site never prints the word "job". It shows as "j\*b" everywhere on the page (search for either and you'll get the same results).
- Shows which employers have the most roles open for the current filters, as a chart with a table view.
- Has an application tracker: mark a role as saved, applied, interviewing, offer, rejected or not interested. Your statuses stay in your browser and are never sent anywhere. Export and import them as JSON to back them up or move them to another device. Roles you track stay in your list after they close.

## How it works

`scripts/fetch-jobs.mjs` runs on GitHub Actions every two hours from 06:17 to 22:17 UTC:

1. It reads each board in `scripts/sources.mjs` through the public job-board API the employer publishes (Greenhouse, Lever and Ashby), or the endpoint the employer's own Workday career site calls, filtered to UK locations. Three large employers with their own careers sites are read through the search their site calls (Amazon, Microsoft) or its sitemap (Arm), each allowed by the site's robots.txt. The searches look only for early-career roles (Amazon's student programmes, and words such as intern and graduate), so the sources table has no count of all their UK roles.
2. It keeps roles whose location is in the UK and whose title marks them as an internship, placement, spring week or insight programme, graduate or entry-level role, or apprenticeship. When the title doesn't say, the employer's own label for the role counts too: Greenhouse custom fields such as "Employment Type", Lever's commitment and Ashby's employment type. Jane Street, for example, lists "Software Engineer" with the employment type "Summer Internship" or "Full-Time: New Grad". Senior roles, recruiter roles and roles only open to returning interns are dropped. Some Greenhouse boards give only "Hybrid" or "In-Office" as the location and name the office in a custom field (Cloudflare's "Job Posting Location"), so those fields are read too.
3. It merges the result into `data/jobs.json`. Each role keeps the date it was first posted. Roles that come down are marked closed and removed three weeks later. If a board can't be read, its roles are left as they were and the employer list says when it was last read. A site that answers "too many requests" (HTTP 429) isn't retried in the same run, and after two such answers in a row from one service (Workday, for example) the rest of its boards wait for the next run. Every run stops starting new boards after 13 minutes, so it always finishes and saves.
4. If the data changed, the workflow commits it and redeploys the site to GitHub Pages.

It's polite about it: one request at a time, at least 0.4 seconds apart per host (1.1 seconds for Lever, as its robots.txt asks, and 45 seconds for Microsoft's search, which turns away faster requests), with a descriptive user agent. For Arm it reads a role's own page only once, the first time it finds a UK early-career role, to get the exact title.

Classification is by job title, location and those labels, so it can miss a role with an unusual title or now and then include one that isn't really entry level. Run `NEAR_MISS=1 node scripts/fetch-jobs.mjs` to list UK titles that were left out but look early-career, which helps when tuning the patterns.

## Why it doesn't merge Gradcracker, Bright Network or Trackr

Gradcracker and Bright Network block automated access, and Trackr's list is its own curated work. The site links to them, along with TARGETjobs, RateMyPlacement, Prospects, GOV.UK's Find an apprenticeship and the Civil Service Fast Stream, because they cover employers whose boards aren't read here. SmartRecruiters boards are also left out, because SmartRecruiters' robots.txt asks bots not to crawl them. So are a few big employers whose careers sites can't be read this way: Google and Goldman Sachs (their robots.txt asks bots to stay out of the job search), Meta and Bloomberg (their sitemaps don't say what or where a role is, so every role's page would have to be read) and Citadel (its site turns away automated requests).

## Adding an employer

Find the board name in the links on the employer's careers page:

| Careers links look like | Add |
| --- | --- |
| `boards.greenhouse.io/<board>` or `job-boards.greenhouse.io/<board>` | `gh('Name', '<board>')` |
| `jobs.lever.co/<board>` | `lv('Name', '<board>')` |
| `jobs.ashbyhq.com/<board>` | `ab('Name', '<board>')` |
| `<tenant>.wd<n>.myworkdayjobs.com/<site>` | `wd('Name', '<tenant>', n, '<site>')` |

Then run `node scripts/fetch-jobs.mjs` and check the log line for that employer.

A careers site whose sitemap lists every role with the place and title in the address can be added like Arm's entry: `ats: 'sitemap'`, the sitemap URL, and a `match` pattern with `place`, `slug` and `id` groups. Check the site's robots.txt first.

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
| `.github/workflows/update.yml` | The update and deploy, every two hours |

## Disclaimer

An independent project, not affiliated with any employer, job board or careers site. Every role links to the employer's own page; check eligibility and closing dates there before applying.
