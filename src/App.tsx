import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { Sidebar } from '@/components/Sidebar'
import { HomePage } from '@/pages/Home'
import { AuthorPage } from '@/pages/Author'
import { PostPage } from '@/pages/Post'
import { AuthCallbackPage } from '@/pages/AuthCallback'
import { EditorPage } from '@/pages/Editor'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Sidebar>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/new" element={<EditorPage />} />
            <Route path="/edit/:rkey" element={<EditorPage />} />
            <Route path="/:handle" element={<AuthorPage />} />
            <Route path="/:handle/:rkey" element={<PostPage />} />
          </Routes>
        </Sidebar>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
