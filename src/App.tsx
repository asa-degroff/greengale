import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { HomePage } from '@/pages/Home'
import { AuthorPage } from '@/pages/Author'
import { PostPage } from '@/pages/Post'

function App() {
  return (
    <BrowserRouter>
      <Sidebar>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/:handle" element={<AuthorPage />} />
          <Route path="/:handle/:rkey" element={<PostPage />} />
        </Routes>
      </Sidebar>
    </BrowserRouter>
  )
}

export default App
