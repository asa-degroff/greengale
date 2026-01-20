import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { ThemePreferenceProvider } from '@/lib/useThemePreference'
import { Sidebar } from '@/components/Sidebar'
import { HomePage } from '@/pages/Home'
import { AuthorPage } from '@/pages/Author'
import { PostPage } from '@/pages/Post'
import { AuthCallbackPage } from '@/pages/AuthCallback'
import { EditorPage } from '@/pages/Editor'
import { TagPage } from '@/pages/Tag'
import { SearchPage } from '@/pages/Search'
import { TermsPage } from '@/pages/Terms'
import { PrivacyPage } from '@/pages/Privacy'

// Layout component that wraps all routes with providers and sidebar
function RootLayout() {
  return (
    <AuthProvider>
      <ThemePreferenceProvider>
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
      { path: '/tag/:tag', element: <TagPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/:handle', element: <AuthorPage /> },
      { path: '/:handle/:rkey', element: <PostPage /> },
    ],
  },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
