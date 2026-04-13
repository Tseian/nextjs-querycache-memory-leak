## OpenArt AI Coding Session - North America


### What you'll be doing during the interview

In a time‑boxed session, you’ll read a small Next.js codebase and implement a few focused UI and API tasks. You don’t need to finish everything—clarity, iteration, and communication matter more than breadth.

- What you’ll work on
  - Read the project layout and briefly explain how requests flow through the app.
  - Pick 1–2 quizzes to implement or improve (table/UI tweaks, small form, basic API route).
  - Add minimal styling with Tailwind and ensure a clean, accessible UX.
  - If time allows, discuss performance and scalability trade‑offs at a high level.
- Expectations
  - Prefer simple, readable React + TypeScript; keep changes minimal but complete.
  - Use idiomatic state updates (immutability), basic typing, and small components.
  - Handle basic UI states (loading/empty/error) where relevant.
  - Communicate trade‑offs as you go; it’s fine to leave TODOs when time is short.
- Constraints
  - You can add Route Handlers under `app/api/.../route.ts`; no database is required.
  - Front‑end only implementations are acceptable unless an API is explicitly requested.
  - Avoid extra libraries; use what’s already in the repo (Next.js, React, Tailwind).
- How we evaluate
  - Correctness and completeness of the chosen tasks
  - Code quality (clarity, typing, structure)
  - Problem‑solving and communication
  - Scope and time management (iterative progress, sensible trade‑offs)

### During the interview
- Think aloud: we care more about how you approach problems than the final answer.
- Ask questions: treat the interviewer as a teammate who can clarify requirements.
- Expect a 45–60 minute, time‑boxed session.


### Knowledge to brush up
Before the interview, a quick review of the following will help you move faster and communicate your decisions clearly:

- Next.js App Router
  - App directory structure (`app/`), `layout.tsx` and `page.tsx`
  - Client vs Server Components and when to choose each
  - Route Handlers (`app/api/.../route.ts`) for building simple APIs
- React + TypeScript
  - Functional components, props, and local state (`useState`, `useMemo`, `useEffect`)
  - Immutability patterns when updating arrays/objects
  - Basic typing: `interface`, `type`, `keyof`, discriminated unions, and narrowing
- Tailwind CSS
  - Utility-first styling, spacing, borders, typography, and dark mode classes
  - Responsive classes and small component composition
- Lists, tables, and forms
  - Rendering lists with stable keys; basic table layout and semantics
  - Sorting, filtering, and (cursor) pagination at a high level
  - Form inputs, validation, submit handlers, and accessible labels
- Data fetching and UI states
  - `fetch` basics, JSON parsing, GET vs POST, and simple error handling
  - Loading/empty/error states; optimistic updates (what/why, high level)
- Algorithms and systems thinking (lightweight)
  - Complexity intuition: how approach choices affect cost as data grows (e.g., scanning versus using a lookup structure), and the cost to return results.
  - Data structures at a high level: when to prefer precomputed lookups versus ordered collections, and how these choices impact read/write patterns.
  - Architecture ideas: layered caching, partitioning data by a key, and rebuilding search structures in the background without disrupting reads.

### Requirements
- Node.js v20+
- pnpm (`npm i -g pnpm`)

### Getting Started
Install dependencies:

```bash
pnpm install
```

Run the dev server:

```bash
pnpm dev
```

Open the app at `http://localhost:3000`.

