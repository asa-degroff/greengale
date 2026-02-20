# React Best Practices Review

Review the code for React and JavaScript performance issues based on the Vercel React Best Practices guide (40+ rules across 8 categories). Apply these rules when writing new code, refactoring, or reviewing changes.

Source: https://vercel.com/blog/introducing-react-best-practices
Repository: https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices

## How to Use

Scan the relevant files for violations of the rules below. Prioritize by impact level (CRITICAL > HIGH > MEDIUM > LOW). Report findings grouped by category with before/after code fixes.

---

## 1. Eliminating Waterfalls — CRITICAL

The #1 performance killer. Each sequential await adds full network latency.

### 1.1 Defer Await Until Needed (HIGH)
Move `await` into the branch where it's actually used. Don't block early-return paths.

```typescript
// BAD: blocks both branches
async function handle(id: string, skip: boolean) {
  const data = await fetchData(id)
  if (skip) return { skipped: true }
  return process(data)
}

// GOOD: only blocks when needed
async function handle(id: string, skip: boolean) {
  if (skip) return { skipped: true }
  const data = await fetchData(id)
  return process(data)
}
```

### 1.2 Promise.all() for Independent Operations (CRITICAL)
When async operations have no interdependencies, execute them concurrently.

```typescript
// BAD: sequential, 3 round trips
const user = await fetchUser()
const posts = await fetchPosts()
const comments = await fetchComments()

// GOOD: parallel, 1 round trip
const [user, posts, comments] = await Promise.all([
  fetchUser(), fetchPosts(), fetchComments()
])
```

### 1.3 Dependency-Based Parallelization (CRITICAL)
For partial dependencies, start independent work immediately.

```typescript
// BAD: config waits for auth
const session = await auth()
const config = await fetchConfig()
const data = await fetchData(session.user.id)

// GOOD: auth and config start immediately
const sessionPromise = auth()
const configPromise = fetchConfig()
const session = await sessionPromise
const [config, data] = await Promise.all([
  configPromise, fetchData(session.user.id)
])
```

### 1.4 Strategic Suspense Boundaries (HIGH, Next.js RSC)
Use Suspense to show wrapper UI faster while data loads. Move data fetching into child async components.

---

## 2. Bundle Size Optimization — CRITICAL

### 2.1 Avoid Barrel File Imports (CRITICAL)
Import directly from source files instead of barrel files (index.js re-exports).

```typescript
// BAD: imports entire library
import { Check, X } from 'lucide-react'

// GOOD: imports only what you need
import Check from 'lucide-react/dist/esm/icons/check'
import X from 'lucide-react/dist/esm/icons/x'
```

### 2.2 Dynamic Imports for Heavy Components (CRITICAL)
Lazy-load large components not needed on initial render using `React.lazy()` or framework equivalents.

### 2.3 Conditional Module Loading (HIGH)
Load large data/modules only when a feature is activated via dynamic `import()`.

### 2.4 Preload Based on User Intent (MEDIUM)
Preload heavy bundles on hover/focus before they're needed.

```tsx
const preload = () => { void import('./heavy-editor') }
<button onMouseEnter={preload} onFocus={preload} onClick={onClick}>
  Open Editor
</button>
```

### 2.5 Defer Non-Critical Libraries (MEDIUM)
Analytics, logging, error tracking don't block user interaction. Load after hydration.

---

## 3. Server-Side Performance — HIGH (Next.js specific)

### 3.1 Authenticate Server Actions Like API Routes (CRITICAL)
Server Actions are public endpoints. Always verify auth inside each action.

### 3.2 Minimize Serialization at RSC Boundaries (HIGH)
Only pass fields that the client actually uses across server/client boundaries.

### 3.3 Parallel Data Fetching with Component Composition (CRITICAL)
Restructure component tree so sibling components fetch data in parallel.

### 3.4 Per-Request Deduplication with React.cache() (MEDIUM)
Use `React.cache()` for server-side request deduplication within a single request.

### 3.5 Use after() for Non-Blocking Operations (MEDIUM)
Schedule logging/analytics to run after response is sent.

---

## 4. Client-Side Data Fetching — MEDIUM-HIGH

### 4.1 Use Passive Event Listeners for Scrolling (MEDIUM)
Add `{ passive: true }` to touch/wheel listeners that don't call `preventDefault()`.

```typescript
document.addEventListener('touchstart', handler, { passive: true })
document.addEventListener('wheel', handler, { passive: true })
```

### 4.2 Deduplicate Data Fetching (MEDIUM-HIGH)
Use SWR, React Query, or similar for automatic request deduplication and caching.

### 4.3 Version and Minimize localStorage Data (MEDIUM)
Add version prefix to keys, store only needed fields, always wrap in try-catch.

```typescript
const VERSION = 'v2'
function saveConfig(config: Config) {
  try {
    localStorage.setItem(`config:${VERSION}`, JSON.stringify(config))
  } catch {} // Throws in incognito, quota exceeded, or disabled
}
```

---

## 5. Re-render Optimization — MEDIUM

### 5.1 Calculate Derived State During Rendering (MEDIUM)
Don't store derived values in state or update them in effects. Compute inline.

```tsx
// BAD: redundant state + effect
const [fullName, setFullName] = useState('')
useEffect(() => { setFullName(first + ' ' + last) }, [first, last])

// GOOD: derive during render
const fullName = first + ' ' + last
```

### 5.2 Use Functional setState Updates (MEDIUM)
Prevents stale closures and creates stable callback references.

```tsx
// BAD: stale closure risk
const add = useCallback((item: Item) => {
  setItems([...items, item])
}, [items]) // recreated every change

// GOOD: always latest state
const add = useCallback((item: Item) => {
  setItems(curr => [...curr, item])
}, []) // stable reference
```

### 5.3 Use Lazy State Initialization (MEDIUM)
Pass a function to `useState` for expensive initial values.

```tsx
// BAD: runs on every render
const [index] = useState(buildSearchIndex(items))

// GOOD: runs only once
const [index] = useState(() => buildSearchIndex(items))
```

### 5.4 Don't useMemo Simple Primitive Expressions (LOW-MEDIUM)
Calling `useMemo` may cost more than the expression itself.

```tsx
// BAD
const isLoading = useMemo(() => a.isLoading || b.isLoading, [a.isLoading, b.isLoading])

// GOOD
const isLoading = a.isLoading || b.isLoading
```

### 5.5 Extract Default Non-primitive Values from Memoized Components (MEDIUM)
Default values like `() => {}` or `[]` break memoization. Extract to constants.

```tsx
const NOOP = () => {}
const UserAvatar = memo(function UserAvatar({ onClick = NOOP }) { ... })
```

### 5.6 Put Interaction Logic in Event Handlers (MEDIUM)
If a side effect is triggered by a user action, run it in the handler, not via state + effect.

### 5.7 Narrow Effect Dependencies (LOW)
Use primitive dependencies (`user.id`) instead of objects (`user`).

### 5.8 Use Transitions for Non-Urgent Updates (MEDIUM)
Mark frequent, non-urgent state updates with `startTransition`.

### 5.9 Use useRef for Transient Values (MEDIUM)
For values that change frequently but don't need re-renders (mouse position, intervals).

### 5.10 Defer State Reads to Usage Point (MEDIUM)
Don't subscribe to dynamic state if you only read it inside callbacks.

```tsx
// BAD: subscribes to all searchParams changes
const searchParams = useSearchParams()
const handleShare = () => { const ref = searchParams.get('ref') }

// GOOD: reads on demand
const handleShare = () => {
  const ref = new URLSearchParams(window.location.search).get('ref')
}
```

---

## 6. Rendering Performance — MEDIUM

### 6.1 CSS content-visibility for Long Lists (HIGH)
Apply `content-visibility: auto` to defer off-screen rendering.

```css
.list-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 80px;
}
```

### 6.2 Animate SVG Wrapper Instead of SVG Element (LOW)
Wrap SVG in a `<div>` and animate the wrapper for hardware acceleration.

### 6.3 Use Explicit Conditional Rendering (LOW)
Use ternary (`? :`) instead of `&&` when condition can be `0` or `NaN`.

```tsx
// BAD: renders "0" when count is 0
{count && <Badge>{count}</Badge>}

// GOOD
{count > 0 ? <Badge>{count}</Badge> : null}
```

### 6.4 Hoist Static JSX Elements (LOW)
Extract static JSX outside components to avoid re-creation.

### 6.5 Use Activity Component for Show/Hide (MEDIUM)
Use React's `<Activity>` to preserve state/DOM for toggled components.

### 6.6 Prevent Hydration Mismatch Without Flickering (MEDIUM, SSR)
Inject synchronous script to update DOM before React hydrates.

---

## 7. JavaScript Performance — LOW-MEDIUM

### 7.1 Build Index Maps for Repeated Lookups (LOW-MEDIUM)
Multiple `.find()` calls by the same key should use a Map.

```typescript
// BAD: O(n) per lookup
orders.map(o => ({ ...o, user: users.find(u => u.id === o.userId) }))

// GOOD: O(1) per lookup
const userById = new Map(users.map(u => [u.id, u]))
orders.map(o => ({ ...o, user: userById.get(o.userId) }))
```

### 7.2 Use Set/Map for O(1) Lookups (LOW-MEDIUM)
Convert arrays to Set for repeated membership checks.

```typescript
// BAD
items.filter(item => allowedIds.includes(item.id))

// GOOD
const allowed = new Set(allowedIds)
items.filter(item => allowed.has(item.id))
```

### 7.3 Combine Multiple Array Iterations (LOW-MEDIUM)
Multiple `.filter()` calls iterate the array multiple times. Combine into one loop.

### 7.4 Use toSorted() Instead of sort() (MEDIUM-HIGH)
`.sort()` mutates in place, breaking React's immutability model. Use `.toSorted()`.

### 7.5 Early Return from Functions (LOW-MEDIUM)
Return early when result is determined to skip unnecessary processing.

### 7.6 Avoid Layout Thrashing (MEDIUM)
Don't interleave style writes with layout reads. Batch writes, then read.

### 7.7 Cache Property Access in Loops (LOW-MEDIUM)
Cache deep property lookups and array.length in hot paths.

### 7.8 Hoist RegExp Creation (LOW-MEDIUM)
Don't create RegExp inside render. Hoist to module scope or memoize.

### 7.9 Early Length Check for Array Comparisons (MEDIUM-HIGH)
Check `array.length` before expensive comparisons (sorting, deep equality).

### 7.10 Cache Repeated Function Calls (MEDIUM)
Use module-level Map to cache function results for repeated inputs.

### 7.11 Use Loop for Min/Max Instead of Sort (LOW)
Finding min/max only requires O(n) single pass, not O(n log n) sort.

---

## 8. Advanced Patterns — LOW

### 8.1 Initialize App Once, Not Per Mount (LOW-MEDIUM)
Use module-level guard for one-time initialization, not `useEffect([])`.

```tsx
let didInit = false
function App() {
  useEffect(() => {
    if (didInit) return
    didInit = true
    initializeApp()
  }, [])
}
```

### 8.2 Store Event Handlers in Refs / useEffectEvent (LOW)
Store callbacks in refs when used in effects that shouldn't re-subscribe on callback changes.

---

## Project-Specific Notes

This project uses **React + Vite + Cloudflare Workers** (not Next.js), so:
- Server Components (RSC), Server Actions, and `next/dynamic` rules don't apply directly
- Use `React.lazy()` instead of `next/dynamic` for code splitting
- Bundle optimization rules apply via Vite's tree-shaking and code splitting
- Waterfall elimination rules apply to both frontend fetching and Worker API handlers
- All client-side React and JavaScript performance rules apply fully
