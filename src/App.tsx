import { useEffect } from 'react'
import { createBrowserRouter, RouterProvider, Outlet, useLocation } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { ThemePreferenceProvider } from '@/lib/useThemePreference'
import { Sidebar } from '@/components/Sidebar'
import { HomePage } from '@/pages/Home'
import { AuthorPage } from '@/pages/Author'
import { PostPage } from '@/pages/Post'
import { AuthCallbackPage } from '@/pages/AuthCallback'
import { EditorPage } from '@/pages/Editor'
import { AgentsPage } from '@/pages/Agents'
import { TagPage } from '@/pages/Tag'
import { SearchPage } from '@/pages/Search'
import { ExternalPreviewPage } from '@/pages/ExternalPreview'
import { TermsPage } from '@/pages/Terms'
import { PrivacyPage } from '@/pages/Privacy'
import { PWAUpdatePrompt } from '@/components/PWAUpdatePrompt'
import { OfflineIndicator } from '@/components/OfflineIndicator'

/**
 * ScrollToTop - Scrolls to top on route changes
 * Only scrolls when the pathname changes (not on hash changes)
 * This ensures new page navigations start at the top
 */
function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    // Scroll to top when pathname changes
    // Use instant scroll to avoid jarring smooth scroll on navigation
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])

  return null
}

// Layout component that wraps all routes with providers and sidebar
function RootLayout() {
  return (
    <AuthProvider>
      <ThemePreferenceProvider>
        <ScrollToTop />
        <Sidebar>
          <Outlet />
        </Sidebar>
      </ThemePreferenceProvider>
    </AuthProvider>
  )
}

// Create router with data router API to support useBlocker
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/auth/callback', element: <AuthCallbackPage /> },
      { path: '/new', element: <EditorPage /> },
      { path: '/edit/:rkey', element: <EditorPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/agents', element: <AgentsPage /> },
      { path: '/tag/:tag', element: <TagPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/external', element: <ExternalPreviewPage /> },
      { path: '/:handle', element: <AuthorPage /> },
      { path: '/:handle/:rkey', element: <PostPage /> },
    ],
  },
])

function App() {
  return (
    <>
      <RouterProvider router={router} />
      <PWAUpdatePrompt />
      <OfflineIndicator />
    </>
  )
}

export default App
