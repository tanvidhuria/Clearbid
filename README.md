# Clearbid

Draft an RFx with an AI co-pilot, read vendor replies in any format (Excel, PDF, Word, phone photo, email), compare them on one grid, and ask plain-language questions until the award is defensible.

## How it works

- **AI reads, code calculates.** Claude extracts what each vendor stated (price, unit, pack size, terms, documents). Plain code in `lib/core.js` and `lib/scenarios.js` does every conversion, total and award scenario.
- **Every number has a source.** Click any cell to see the file, location and quote it came from, plus the conversion formula.
- **Gaps are found, not guessed.** Missing lines, unclear units, "same as last year", wrong attachments and expired certificates are flagged, with a drafted email to the vendor.
- **Checked answers.** The analyst answers by calling tools over the comparison. Every number in an answer is matched against tool results before it is shown.
- **Guardrails.** Vendor files are treated as data. Text that tries to instruct the AI is ignored and reported (a code scan backs up the model).

## Setup (Vercel)

1. Import this repository in Vercel (framework: Next.js, no settings to change).
2. Add environment variables `ANTHROPIC_API_KEY` and `ACCESS_CODE` (see `.env.example`).
3. Deploy.

## Saved runs

Reading all five demo responses live takes a few minutes. After one full live run, click **Save this run** on the Responses page and upload the downloaded `run.json` into `public/snapshots/` in this repository. Reviewers then get a **Load the saved run** button, and can still re-run any vendor live.

## Demo data

`public/data/` holds the RFx and the five fabricated vendor responses. The answer key used to score extraction is kept outside this repository, so the app cannot read it.
