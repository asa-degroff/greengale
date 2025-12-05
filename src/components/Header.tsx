import { Link } from 'react-router-dom'

export function Header() {
  return (
    <header className="border-b border-[var(--theme-border)] bg-[var(--theme-bg)]">
      <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-[var(--theme-text)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-8 h-8"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
              fill="#22c55e"
              stroke="none"
            />
            <path
              d="M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4"
              strokeLinecap="round"
              stroke="#fff"
            />
            <path
              d="M12 8v8M9 11l3-3 3 3"
              strokeLinecap="round"
              strokeLinejoin="round"
              stroke="#fff"
            />
          </svg>
          <span className="text-xl font-semibold">GreenGale</span>
        </Link>
        <nav className="flex items-center gap-4">
          <a
            href="https://bsky.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-accent)]"
          >
            Bluesky
          </a>
        </nav>
      </div>
    </header>
  )
}
