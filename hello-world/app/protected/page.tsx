'use client'
import { useEffect, useState, useRef } from 'react'
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

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

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
        const randomStart = Math.floor(Math.random() * 100)

        const { data: captionsData, error: captionsError } = await supabase
          .from('captions')
          .select('id, image_id, content, images(id, url, image_description)')
          .eq('is_public', true)
          .not('image_id', 'is', null)
          .range(randomStart, randomStart + 499)

        if (captionsError) throw new Error(captionsError.message)

        const captionIds = (captionsData || []).map((c) => c.id)

        const { data: votesData } = await supabase
          .from('caption_votes')
          .select('caption_id, profile_id, vote_value')
          .in('caption_id', captionIds)

        const imageCount = new Map<string, number>()
        const combined: Post[] = []

        for (const c of (captionsData || [])) {
          if (combined.length >= 30) break

          const img = c.images as any
          if (!img || !img.url) continue

          const count = imageCount.get(img.id) || 0
          if (count >= 2) continue

          imageCount.set(img.id, count + 1)

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

        // Shuffle randomly
        const shuffled = [...combined].sort(() => Math.random() - 0.5)
        setPosts(shuffled)
      } catch (err: any) {
        setError(err.message || 'Error fetching data')
      } finally {
        setLoading(false)
      }
    }

    checkUserAndFetchData()
  }, [])

  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    setUploadStatus('Getting upload URL...')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const BASE_URL = 'https://api.almostcrackd.ai'

      // Step 1: Generate presigned URL
      const presignRes = await fetch(`${BASE_URL}/pipeline/generate-presigned-url`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contentType: file.type }),
      })
      if (!presignRes.ok) throw new Error(`Presign failed: ${presignRes.statusText}`)
      const { presignedUrl, cdnUrl } = await presignRes.json()

      // Step 2: Upload image bytes
      setUploadStatus('Uploading image...')
      const uploadRes = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.statusText}`)

      // Step 3: Register image
      setUploadStatus('Registering image...')
      const registerRes = await fetch(`${BASE_URL}/pipeline/upload-image-from-url`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageUrl: cdnUrl, isCommonUse: false }),
      })
      if (!registerRes.ok) throw new Error(`Register failed: ${registerRes.statusText}`)
      const { imageId } = await registerRes.json()

      // Step 4: Generate captions
      setUploadStatus('Generating captions... (this may take a moment)')
      const captionRes = await fetch(`${BASE_URL}/pipeline/generate-captions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageId }),
      })
      if (!captionRes.ok) throw new Error(`Caption generation failed: ${captionRes.statusText}`)
      const captions = await captionRes.json()

      const newPosts: Post[] = (captions || []).slice(0, 1).map((c: any) => ({
        imageId: imageId,
        url: cdnUrl,
        image_description: null,
        captionId: c.id,
        content: c.content,
        upvotes: 0,
        downvotes: 0,
        userVote: null,
      }))

      if (newPosts.length === 0) throw new Error('No captions were generated.')

      setPosts((prev) => [...newPosts, ...prev.slice(current)])
      setCurrent(0)
      setUploadStatus(null)
    } catch (err: any) {
      console.error('Upload error:', err)
      setUploadError(err.message || 'Upload failed')
      setUploadStatus(null)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
  }

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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-orange-400 text-white px-4 py-2 rounded hover:bg-orange-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? '⏳ Uploading...' : '📸 Upload Image'}
          </button>
          <p className="text-sm text-gray-600">{user?.email}</p>
          <button
            onClick={handleSignOut}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 text-sm"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Upload status banner */}
      {uploadStatus && (
        <div className="max-w-lg mx-auto mt-4 px-4">
          <div className="bg-orange-50 border border-orange-200 text-orange-700 rounded-xl px-4 py-3 text-sm text-center">
            ⏳ {uploadStatus}
          </div>
        </div>
      )}

      {/* Upload error banner */}
      {uploadError && (
        <div className="max-w-lg mx-auto mt-4 px-4">
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm text-center flex justify-between items-center">
            <span>❌ {uploadError}</span>
            <button onClick={() => setUploadError(null)} className="ml-4 text-red-400 hover:text-red-600">✕</button>
          </div>
        </div>
      )}

      {/* Card */}
      <div className="max-w-lg mx-auto pt-6 px-4">
        {done ? (
          <div className="bg-white rounded-2xl shadow p-12 text-center mt-8">
            <p className="text-4xl mb-4">🎉</p>
            <p className="text-xl font-bold text-gray-700">No captions left!</p>
            <p className="text-gray-400 mt-2">You've rated all captions. Upload an image to generate new ones!</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow overflow-hidden flex flex-col" style={{ height: '580px' }}>

            {/* Image — fixed height, always same size */}
            <div className="w-full bg-gray-100 flex-shrink-0" style={{ height: '300px' }}>
              <img
                src={post.url}
                alt={post.image_description || 'Image'}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Caption — fixed height with scroll if too long */}
            <div className="px-6 pt-4 pb-2 text-center flex-shrink-0" style={{ height: '100px', overflow: 'hidden' }}>
              <p className="text-xl font-bold text-gray-900 leading-snug line-clamp-3">
                {post.content}
              </p>
            </div>

            {/* Vote Buttons — always pinned at same position */}
            <div className="flex items-center justify-center gap-6 px-6 py-5 flex-shrink-0" style={{ height: '100px' }}>
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

            {/* Captions left — always at bottom */}
            <div className="text-center pb-4 flex-shrink-0">
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