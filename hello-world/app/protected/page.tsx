'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase-browser'
import { useRouter } from 'next/navigation'

type Post = {
  imageId: string
  url: string
  image_description: string | null
  captionId: string
  content: string
  upvotes: number
  downvotes: number
  userVote: 1 | -1 | null
}

export default function ProtectedPage() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<any>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [votingId, setVotingId] = useState<string | null>(null)

  useEffect(() => {
    async function checkUserAndFetchData() {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setUser(user)

      const { data: profileData } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      if (profileData) {
        setProfileId(profileData.id)
      } else {
        const { data: profileData2 } = await supabase
          .from('profiles')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle()
        if (profileData2) setProfileId(profileData2.id)
      }

      try {
        // Fetch 200 captions from a random start point
        // This gives us enough to filter down to 30 unique images
        const randomStart = Math.floor(Math.random() * 300)

        const { data: captionsData, error: captionsError } = await supabase
          .from('captions')
          .select('id, image_id, content, images(id, url, image_description)')
          .eq('is_public', true)
          .not('image_id', 'is', null)
          .range(randomStart, randomStart + 199)

        if (captionsError) throw new Error(captionsError.message)

        const captionIds = (captionsData || []).map((c) => c.id)

        const { data: votesData } = await supabase
          .from('caption_votes')
          .select('caption_id, profile_id, vote_value')
          .in('caption_id', captionIds)

        // Keep only one caption per unique image, up to 30
        const seenImages = new Set()
        const combined: Post[] = []

        for (const c of (captionsData || [])) {
          if (combined.length >= 30) break

          const img = c.images as any
          if (!img || !img.url || seenImages.has(img.id)) continue

          seenImages.add(img.id)

          const captionVotes = (votesData || []).filter((v) => v.caption_id === c.id)
          const upvotes = captionVotes.filter((v) => v.vote_value === 1).length
          const downvotes = captionVotes.filter((v) => v.vote_value === -1).length
          const myVote = captionVotes.find((v) => v.profile_id === (profileData?.id || user.id))

          combined.push({
            imageId: img.id,
            url: img.url,
            image_description: img.image_description,
            captionId: c.id,
            content: c.content,
            upvotes,
            downvotes,
            userVote: myVote ? myVote.vote_value : null,
          })
        }

        setPosts(combined)
      } catch (err: any) {
        setError(err.message || 'Error fetching data')
      } finally {
        setLoading(false)
      }
    }

    checkUserAndFetchData()
  }, [])

  const handleVote = async (captionId: string, voteValue: 1 | -1) => {
    if (!user) return
    setVotingId(captionId)

    const idToUse = profileId || user.id
    const now = new Date().toISOString()

    try {
      const { data: existing } = await supabase
        .from('caption_votes')
        .select('id, vote_value')
        .eq('caption_id', captionId)
        .eq('profile_id', idToUse)
        .maybeSingle()

      if (existing) {
        if (existing.vote_value === voteValue) {
          await supabase.from('caption_votes').delete().eq('id', existing.id)
        } else {
          await supabase
            .from('caption_votes')
            .update({ vote_value: voteValue, modified_datetime_utc: now })
            .eq('id', existing.id)
        }
      } else {
        await supabase.from('caption_votes').insert({
          caption_id: captionId,
          profile_id: idToUse,
          vote_value: voteValue,
          created_datetime_utc: now,
          modified_datetime_utc: now,
        })
      }

      setCurrent((prev) => prev + 1)

    } catch (err) {
      console.error('Vote error:', err)
    } finally {
      setVotingId(null)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <p className="text-gray-500">Loading...</p>
    </div>
  )
  if (error) return <div className="p-8 text-red-500">Error: {error}</div>

  const post = posts[current]
  const captionsLeft = posts.length - current - 1
  const done = current >= posts.length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Image Gallery</h1>
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-600">{user?.email}</p>
          <button
            onClick={handleSignOut}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 text-sm"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="max-w-lg mx-auto pt-6 px-4">
        {done ? (
          <div className="bg-white rounded-2xl shadow p-12 text-center mt-8">
            <p className="text-4xl mb-4">🎉</p>
            <p className="text-xl font-bold text-gray-700">No captions left!</p>
            <p className="text-gray-400 mt-2">You've rated all captions. Come back later for more!</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            {/* Image */}
            <img
              src={post.url}
              alt={post.image_description || 'Image'}
              className="w-full object-cover"
              style={{ maxHeight: '380px' }}
            />

            {/* Caption */}
            <div className="px-6 pt-5 pb-2 text-center">
              <p className="text-xl font-bold text-gray-900 leading-snug">
                {post.content}
              </p>
            </div>

            {/* Vote Buttons */}
            <div className="flex items-center justify-center gap-6 px-6 py-5">
              <button
                onClick={() => handleVote(post.captionId, -1)}
                disabled={!!votingId}
                className={`flex items-center justify-center w-36 h-14 rounded-full border-2 text-2xl transition-all ${
                  post.userVote === -1
                    ? 'border-orange-400 bg-orange-50 text-orange-500'
                    : 'border-gray-300 bg-white text-gray-500 hover:border-orange-300 hover:text-orange-400'
                }`}
              >
                👎
              </button>

              <button
                onClick={() => handleVote(post.captionId, 1)}
                disabled={!!votingId}
                className={`flex items-center justify-center w-36 h-14 rounded-full text-2xl transition-all ${
                  post.userVote === 1
                    ? 'bg-orange-300 text-white'
                    : 'bg-orange-400 text-white hover:bg-orange-500'
                }`}
              >
                👍
              </button>
            </div>

            {/* Captions left */}
            <div className="text-center pb-6">
              <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                {captionsLeft} captions left
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}