import { Link } from 'react-router-dom'

export function PrivacyPage() {
  return (
    <div>
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8 text-[var(--site-text)]">
          Privacy Policy
        </h1>

        <div className="space-y-8 text-[var(--site-text)]">
          <section>
            <h2 className="text-2xl font-semibold mb-4">The Short Version</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed">
              GreenGale is designed with privacy in mind. Your blog posts live on your own PDS, not on our servers.
              We collect minimal data needed to make the app work, and we don't track you or sell your information.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">What We Collect</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed mb-4">
              When you sign in with your AT Protocol account, we temporarily access:
            </p>
            <ul className="list-disc list-inside space-y-2 text-[var(--site-text-secondary)]">
              <li>Your handle and DID (decentralized identifier) for authentication</li>
              <li>Your profile information (name, avatar) to display in the app</li>
              <li>An OAuth session token stored in your browser to keep you signed in</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">What We Don't Collect</h2>
            <ul className="list-disc list-inside space-y-2 text-[var(--site-text-secondary)]">
              <li>No analytics or tracking scripts</li>
              <li>No advertising cookies</li>
              <li>No selling or sharing of your data with third parties</li>
              <li>No server-side storage of your blog content (it stays on your PDS)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Where Your Data Lives</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed">
              Your blog posts are stored on your Personal Data Server (PDS), which is part of the AT Protocol network.
              GreenGale is just a viewer and editor — we fetch your posts from your PDS when needed and write new posts
              directly to your PDS. We maintain an index of post metadata (titles, timestamps) to enable features like
              the recent posts feed, but the actual content always comes from your PDS.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Third-Party Services</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed mb-4">
              GreenGale uses:
            </p>
            <ul className="list-disc list-inside space-y-2 text-[var(--site-text-secondary)]">
              <li>
                <strong>AT Protocol / Bluesky</strong> — for authentication and data storage (governed by their{' '}
                <a
                  href="https://bsky.social/about/support/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--site-accent)] hover:underline"
                >
                  privacy policy
                </a>
                )
              </li>
              <li>
                <strong>Cloudflare</strong> — for hosting and edge computing (governed by their{' '}
                <a
                  href="https://www.cloudflare.com/privacypolicy/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--site-accent)] hover:underline"
                >
                  privacy policy
                </a>
                )
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Open Source</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed">
              GreenGale is open source. You can inspect exactly what the code does at any time in our{' '}
              <a
                href="https://github.com/asa-degroff/greengale"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--site-accent)] hover:underline"
              >
                GitHub repository
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Changes to This Policy</h2>
            <p className="text-[var(--site-text-secondary)] leading-relaxed">
              We may update this policy occasionally. Changes will be reflected in the repository and on this page.
            </p>
          </section>

          <div className="pt-8 border-t border-[var(--site-border)]">
            <p className="text-sm text-[var(--site-text-secondary)]">
              See also: <Link to="/terms" className="text-[var(--site-accent)] hover:underline">Terms of Service</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
