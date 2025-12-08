import { Link } from 'react-router-dom'

export function TermsPage() {
  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8 text-[var(--site-text)]">
          Terms of Service
        </h1>

        <div className="space-y-8 text-[var(--site-text)]">
          <section>
            <h2 className="text-2xl font-semibold mb-4">What is GreenGale?</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed">
              GreenGale is a markdown blog platform built on the{' '}
              <a
                href="https://atproto.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--site-accent)] hover:underline"
              >
                AT Protocol
              </a>
              . It lets you write and publish blog posts that are stored in your own Personal Data Server (PDS),
              giving you ownership and control over your content.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Your Content</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed mb-4">
              When you publish a post through GreenGale, it's stored on your PDS (typically hosted by Bluesky or a provider you choose).
              This means:
            </p>
            <ul className="list-disc list-inside space-y-2 text-[var(--site-text-secondary)]">
              <li>You own your content</li>
              <li>Your posts are portable and can be accessed by other AT Protocol apps</li>
              <li>Deleting a post removes it from your PDS</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Your Responsibilities</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed">
              You're responsible for the content you publish. Don't post anything illegal, harmful, or that violates others' rights.
              Your content is also subject to your PDS provider's terms of service (e.g., Bluesky's community guidelines).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">No Warranty</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed">
              GreenGale is provided as-is. We do our best to keep things running smoothly, but we can't guarantee
              the service will always be available or error-free. This is an open-source project maintained in spare time.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Changes to These Terms</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed">
              We may update these terms occasionally. Continued use of GreenGale after changes constitutes acceptance
              of the new terms. Since this is open source, you can always check the{' '}
              <a
                href="https://github.com/asa-degroff/greengale"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--site-accent)] hover:underline"
              >
                repository
              </a>
              {' '}for the latest version.
            </p>
          </section>

          <div className="pt-8 border-t border-[var(--site-border)]">
            <p className="text-sm text-[var(--site-text-secondary)]">
              See also: <Link to="/privacy" className="text-[var(--site-accent)] hover:underline">Privacy Policy</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
