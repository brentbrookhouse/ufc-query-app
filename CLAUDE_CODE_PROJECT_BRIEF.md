# UFC Elo Database — Query App Project Brief

## What this is

A small internal web app for a team at CBS Sports to query a UFC fight-by-fight
results database — fighter lookups, finish-type searches, date ranges, and
similar stat-hunting queries, without needing to write raw SQL. Think of it as
a friendlier front end over a spreadsheet-like dataset of every UFC fight in
history.

This is a **separate project** from an existing public-facing UFC Elo ratings
website (a static HTML site). That site shows *computed* Elo ratings and
rankings. **This database has no computed ratings in it at all** — it's the
raw fight-by-fight results only (who fought whom, when, how it ended). If
ranking/rating display is ever wanted in this app, that's new work, not
something to expect from the existing data.

## Tech stack (match this exactly — same as a previous successful project)

- Next.js, **App Router**, TypeScript, Tailwind CSS
- `@supabase/supabase-js` + `@supabase/ssr` (separate browser and server
  Supabase clients — the App Router needs both, not just one)
- Deployed to Vercel
- No need to build real user authentication/login for this — it's a small
  trusted internal team. Gate access at the Vercel level (e.g. a simple shared
  password) rather than building out Supabase Auth, unless requirements
  change.

Scaffold command reference:
```
npx create-next-app@latest [app-name] --typescript --tailwind --eslint --app --src-dir --no-turbopack
npm install @supabase/supabase-js @supabase/ssr
```

## Supabase connection

- **Project URL**: found in Supabase dashboard → Settings → Data API → "Project URL"
- **Publishable key** (`sb_publishable_...`): found in Settings → API Keys.
  This is the key safe to use in client-side code — it respects Row Level
  Security (see below), so it cannot write to the database regardless of
  where it ends up in the app's code.
- Put these in `.env.local`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=<project url>
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
  ```
- Row Level Security is already enabled on the `fights` table with a
  **read-only** policy (`SELECT` allowed for `anon`/`authenticated`, no
  `INSERT`/`UPDATE`/`DELETE` policy exists). This means the app can only ever
  read data through the publishable key, never write — enforced by the
  database itself, not just app-level convention. Writes/updates to the
  dataset happen separately, outside this app, via the Supabase SQL Editor or
  secret key. **The app does not need any write functionality at all.**

## Database schema

One table: `fights`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, primary key | auto-increment |
| `event_date` | date | ISO format |
| `event` | text | event name, e.g. "UFC 331: Van vs. Pantoja 2" |
| `weight_class` | text | the division the fight is bucketed into (see catchweight note below) |
| `fighter_a` | text | **the winner** of the fight (or one side of a draw — see Result Semantics below) |
| `fighter_b` | text | **the loser** of the fight (or the other side of a draw) |
| `result` | text | one of `'a_win'`, `'draw'`, `'nc'` (no contest) |
| `a_was_champ` | boolean | true if fighter_a held the title entering this fight |
| `b_was_champ` | boolean | true if fighter_b held the title entering this fight |
| `method` | text | free-text finish/decision description — see Method Field Gotchas below, this needs care |
| `round` | integer | already normalized to a clean integer; can be null |
| `time` | text | e.g. `"2:46"` |
| `notes` | text | often null; occasional citation markers like `[a]` |
| `catchweight` | boolean | true if this was a catchweight bout (see below) |
| `source_file` | text | which original source CSV this row came from — internal provenance, not generally useful for app features |

Indexes exist on `fighter_a`, `fighter_b`, `event_date`, and `weight_class`.

### Result semantics — important

`fighter_a` and `fighter_b` are **not** neutral "side 1 / side 2" labels.
Whenever `result = 'a_win'`, `fighter_a` is the winner and `fighter_b` is the
loser — this is baked into the data, not something to derive. For `result =
'draw'`, both sides are symmetric (no winner/loser). For `result = 'nc'`
(no contest), the outcome doesn't reflect a real result — the fight happened
but was overturned/nullified (failed drug test, doctor stoppage
reclassification, etc.). Any feature that shows "wins" or "losses" for a
fighter should query both `fighter_a` and `fighter_b` columns and check
`result` accordingly, and should almost always exclude `result = 'nc'` rows
from win/loss tallies.

A given fighter's name can appear as `fighter_a` in one row and `fighter_b`
in another — there is no separate "fighters" table, names are just repeated
text across rows. Fighter search/lookup features need to query both columns.

### Catchweight bucketing — important context, not a bug

A catchweight fight (contracted at a weight that doesn't match a standard
division limit) is filed under the **nearest standard division whose limit is
at or above the contracted weight**, not its own separate category. For
example, a fight contracted at 130 lb is bucketed into Bantamweight (135 lb
cap) even though it's not really "a bantamweight fight" in the usual sense.
The `catchweight` boolean is what tells you this happened — always check it
alongside `weight_class` if a query cares about "real" divisional fights vs.
catchweight bouts that happened to land there. A division's fight count or
average stats can be skewed by a fighter's catchweight bout if this flag
isn't accounted for.

### Method field gotchas — this will bite you if you're not careful

`method` is free text like `"Submission (rear-naked choke)"`,
`"TKO (punches)"`, `"Decision (unanimous) (29–28, 29–28, 29–28)"`. There is
no separate structured "finish type" column — any search by finish type has
to pattern-match against this free text field, and **naive substring
matching produces wrong results** for at least one real, already-discovered
case:

- `"reverse triangle choke"` contains the substring `"triangle choke"` — a
  query for plain triangle chokes using `method LIKE '%triangle choke%'`
  will incorrectly include reverse triangle chokes too. There is exactly
  **one** reverse triangle choke in the entire dataset as of this writing
  (a genuinely rare finish), and it's easy to accidentally misattribute it
  to the wrong category.
- There's also `"arm-triangle choke"` (a completely different technique from
  a leg triangle), `"inverted triangle choke"`, `"flying triangle choke"`,
  `"mounted triangle choke"` (all still real triangle-choke variants), and
  several **combo finishes** that reference "triangle" but aren't purely a
  triangle finish: `"triangle armbar"`, `"reverse triangle and kimura"`,
  `"inverted triangle choke and americana"`, etc. Don't assume a simple
  `LIKE '%triangle%'` gives a clean answer to "how many triangle chokes."
- The correct pattern for "standard/leg triangle choke, excluding
  arm-triangle and reverse-triangle" is:
  ```sql
  method LIKE '%triangle choke%'
    AND method NOT LIKE '%arm-triangle%'
    AND method NOT LIKE '%reverse triangle%'
  ```
- The general lesson: **any finish-type search should be built and spot-
  checked carefully**, ideally by first running a `SELECT DISTINCT method`
  filtered to a loose pattern and eyeballing every variant that comes back,
  the same way this triangle-choke issue was caught. Don't trust a single
  substring match to be exhaustive or exclusive.

### Fighter name consistency

Fighter names are stored as plain text strings, and while a real effort has
gone into keeping one fighter under one consistent name across their whole
career, this is a live dataset compiled from public results over 30+ years
and **isn't guaranteed to be perfectly clean going forward**. If a query
result for a well-known fighter looks incomplete (fewer fights than expected),
consider that a possible name-spelling inconsistency rather than assuming the
data itself is wrong — this has happened before (e.g. one fighter's UFC debut
was recorded under his legal first name while all his other fights use his
ring nickname). Cross-checking a surprising result against public UFC records
before treating it as ground truth is reasonable practice for this dataset.

## What the app should actually do

**Scope, settled**: this app is for record-based and historical/notable-fact
queries only — fighter lookups, finish-type searches, streaks, rarity counts,
"first time X happened since Y," and similar. **It does not need Elo ratings,
rankings, or anything rating-derived (upsets, top-15 breakthroughs, etc.) at
all.** That's intentional, not a gap to fill in later.

Elo ratings/rankings are handled entirely through a separate, existing
workflow: results get reported in a chat conversation during a live event,
computed and shared there in real time for social media, then formalized into
a public ratings website afterward. That workflow already exists and works
well — this app is not replacing or duplicating it, and doesn't need to
import, compute, or display any Elo-derived number. If a feature idea starts
requiring a rating value, it's out of scope for this app.

Likely useful building blocks, all achievable from the raw fight-by-fight
data already in this database:

- Fighter search (name lookup → their full fight history, checking both
  `fighter_a` and `fighter_b`)
- Finish-type / method search, built carefully per the gotchas above
- Date-range and event filtering
- **Auto-surfaced notable facts from a single entered result**: a screen
  where the user enters a fight result (two fighter names, method, round) and
  the app checks it against history for things like:
  - "First [finish type] since [date]" / rarity counts (e.g. "only the Nth
    time this has happened")
  - Win/loss streak extending or snapping for either fighter
  - Fastest/slowest example of this finish type at this weight class
  - First time this specific fighter has finished someone this way
  - This is explicitly a **read-only, scratchpad-style query** — the entered
    result should NOT be written to the database. The user enters results
    here purely to see what they reveal against history; the database itself
    only gets updated separately, after the event, through the existing
    chat-based workflow. Don't build any insert/write path for this feature.
- Simple stat aggregations (e.g. "how many fights ended in round 1 this
  year")

Confirm scope and priority features directly with the user before building
out a large surface area — start with a simple, working search + results
table, then layer in more specific query tools based on what's actually
useful in practice.
