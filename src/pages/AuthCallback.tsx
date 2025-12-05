import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // The OAuth client handles the callback automatically via its init() method
    // which is called in the AuthProvider. We just need to redirect after a brief delay.
    const params = new URLSearchParams(window.location.search)
    const errorParam = params.get('error')
    const errorDescription = params.get('error_description')

    if (errorParam) {
      setError(errorDescription || errorParam)
      return
    }

    // Give the auth provider time to process the callback
    const timer = setTimeout(() => {
      navigate('/', { replace: true })
    }, 1000)

    return () => clearTimeout(timer)
  }, [navigate])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4 text-[var(--site-text)]">
            Authentication Error
          </h1>
          <p className="text-[var(--site-text-secondary)] mb-6">{error}</p>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="px-6 py-2 bg-[var(--site-accent)] text-white rounded-lg hover:bg-[var(--site-accent-hover)] transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-[var(--site-accent)] border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-[var(--site-text-secondary)]">Completing login...</p>
      </div>
    </div>
  )
}
