import { Header } from '@/components/Header'

export function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--theme-bg)]">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-[var(--theme-text)]">
            GreenGale
          </h1>
          <p className="text-xl text-[var(--theme-text-secondary)] max-w-2xl mx-auto">
            A markdown blog platform built on AT Protocol. Compatible with WhiteWind
            and powered by your Bluesky identity.
          </p>
        </div>

        <div className="bg-[var(--theme-code-bg)] rounded-lg p-8 mb-12">
          <h2 className="text-xl font-semibold mb-4 text-[var(--theme-text)]">
            View a Blog
          </h2>
          <p className="text-[var(--theme-text-secondary)] mb-4">
            Enter a Bluesky handle to view their blog posts:
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const form = e.target as HTMLFormElement
              const input = form.elements.namedItem('handle') as HTMLInputElement
              const handle = input.value.trim().replace('@', '')
              if (handle) {
                window.location.href = `/${handle}`
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              name="handle"
              placeholder="handle.bsky.social"
              className="flex-1 px-4 py-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            />
            <button
              type="submit"
              className="px-6 py-2 bg-[var(--theme-accent)] text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
            >
              View Blog
            </button>
          </form>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-semibold mb-2 text-[var(--theme-text)]">WhiteWind Compatible</h3>
            <p className="text-sm text-[var(--theme-text-secondary)]">
              View existing WhiteWind blog posts without any migration needed.
            </p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </div>
            <h3 className="font-semibold mb-2 text-[var(--theme-text)]">Custom Themes</h3>
            <p className="text-sm text-[var(--theme-text-secondary)]">
              Choose from preset themes or customize colors to match your style.
            </p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-semibold mb-2 text-[var(--theme-text)]">LaTeX Support</h3>
            <p className="text-sm text-[var(--theme-text-secondary)]">
              Write mathematical equations with full LaTeX rendering support.
            </p>
          </div>
        </div>

        <div className="mt-16 text-center text-sm text-[var(--theme-text-secondary)]">
          <p>
            Your data lives on AT Protocol. GreenGale is just a viewer.{' '}
            <a
              href="https://atproto.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--theme-accent)] hover:underline"
            >
              Learn more about AT Protocol
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
