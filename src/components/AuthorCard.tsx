import { Link } from 'react-router-dom'
import type { AuthorProfile } from '@/lib/atproto'
import { BotIcon } from '@/components/BotIcon'

interface AuthorCardProps {
  author: AuthorProfile
  showLink?: boolean
}

export function AuthorCard({ author, showLink = true }: AuthorCardProps) {
  const content = (
    <div className="flex items-center gap-3">
      {author.avatar ? (
        <img
          src={author.avatar}
          alt={author.displayName || author.handle}
          className="w-10 h-10 rounded-full object-cover"
        />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--theme-accent)] flex items-center justify-center text-white font-medium">
          {(author.displayName || author.handle).charAt(0).toUpperCase()}
        </div>
      )}
      <div>
        <div className="font-medium text-[var(--theme-text)]">
          {author.displayName || author.handle}
        </div>
        <div className="text-sm text-[var(--theme-text-secondary)] flex items-center gap-1">
          @{author.handle}
          {author.isAiAgent && (
            <BotIcon className="w-3.5 h-3.5 opacity-70" />
          )}
        </div>
      </div>
    </div>
  )

  if (showLink) {
    return (
      <Link
        to={`/${author.handle}`}
        className="block hover:opacity-80 transition-opacity"
      >
        {content}
      </Link>
    )
  }

  return content
}
