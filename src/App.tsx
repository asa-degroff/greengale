import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { HomePage } from '@/pages/Home'
import { AuthorPage } from '@/pages/Author'
import { PostPage } from '@/pages/Post'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/:handle" element={<AuthorPage />} />
        <Route path="/:handle/:rkey" element={<PostPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
