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
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [cardKey, setCardKey] = useState(0)

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
        const randomStart = 0

        const { data: captionsData, error: captionsError } = await supabase
          .from('captions')
          .select('id, image_id, content, images(id, url, image_description)')
          .eq('is_public', true)
          .not('image_id', 'is', null)
          .not('content', 'is', null)
          .neq('content', '')
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

        const shuffled = [...combined].sort(() => Math.random() - 0.5)
        setPosts(shuffled)

        // Show onboarding if user hasn't seen it
        const seen = localStorage.getItem('onboarding_seen')
        if (!seen && shuffled.length > 0) {
          setShowOnboarding(true)
        }
      } catch (err: any) {
        setError(err.message || 'Error fetching data')
      } finally {
        setLoading(false)
      }
    }

    checkUserAndFetchData()
  }, [])

  const dismissOnboarding = () => {
    setShowOnboarding(false)
    localStorage.setItem('onboarding_seen', 'true')
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    setUploadStatus('Getting upload URL...')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const BASE_URL = 'https://api.almostcrackd.ai'

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

      setUploadStatus('Uploading image...')
      const uploadRes = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.statusText}`)

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
      const captionData = await captionRes.json()

      const captions = Array.isArray(captionData)
        ? captionData
        : captionData.captions || captionData.data || []

      const newPosts: Post[] = (captions || []).map((c: any) => ({
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
      setCardKey((k) => k + 1)
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
            .update({ vote_value: voteValue, modified_by_user_id: idToUse, modified_datetime_utc: now })
            .eq('id', existing.id)
        }
      } else {
        await supabase.from('caption_votes').insert({
          caption_id: captionId,
          profile_id: idToUse,
          vote_value: voteValue,
          created_by_user_id: idToUse,
          modified_by_user_id: idToUse,
          created_datetime_utc: now,
          modified_datetime_utc: now,
        })
      }

      setCurrent((prev) => prev + 1)
      setCardKey((k) => k + 1)

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
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
      <div className="text-center animate-fade-in">
        <div className="text-4xl mb-3 animate-float">😄</div>
        <p className="text-gray-400 font-medium">Loading captions...</p>
      </div>
    </div>
  )
  if (error) return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm text-center">
        <div className="text-3xl mb-3">😕</div>
        <p className="text-red-500 font-medium">Something went wrong</p>
        <p className="text-gray-400 text-sm mt-2">{error}</p>
      </div>
    </div>
  )

  const post = posts[current]
  const captionsLeft = posts.length - current - 1
  const done = current >= posts.length
  const progress = posts.length > 0 ? ((current) / posts.length) * 100 : 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header — clean: brand + user info only */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-2xl">😄</span>
          <h1 className="text-xl font-extrabold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
            Almost Crack'd
          </h1>
          <button
            onClick={() => setShowOnboarding(true)}
            className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 text-xs font-bold flex items-center justify-center transition-colors"
            title="How does this work?"
          >
            ?
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            Welcome back, <strong className="text-gray-700">{(user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '')?.split(' ')[0]}</strong>
            <span className="mx-1.5 text-gray-300">·</span>
            <button
              onClick={handleSignOut}
              className="text-gray-400 hover:text-red-500 transition-colors font-medium"
            >
              Sign out
            </button>
          </span>
        </div>
      </div>

      {/* Upload status banner */}
      {uploadStatus && (
        <div className="max-w-lg mx-auto mt-4 px-4 animate-fade-in">
          <div className="bg-gradient-to-r from-orange-50 to-pink-50 border border-orange-200 text-orange-700 rounded-2xl px-4 py-3 text-sm text-center font-medium">
            ⏳ {uploadStatus}
          </div>
        </div>
      )}

      {/* Upload error banner */}
      {uploadError && (
        <div className="max-w-lg mx-auto mt-4 px-4 animate-fade-in">
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl px-4 py-3 text-sm text-center flex justify-between items-center">
            <span>❌ {uploadError}</span>
            <button onClick={() => setUploadError(null)} className="ml-4 text-red-400 hover:text-red-600 transition-colors">✕</button>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {!done && posts.length > 0 && (
        <div className="max-w-lg mx-auto mt-4 px-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-400 to-pink-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-400 whitespace-nowrap">
              {current}/{posts.length}
            </span>
          </div>
        </div>
      )}

      {/* Card */}
      <div className="max-w-lg mx-auto pt-4 px-4 pb-8 relative">
        {done ? (
          <div className="animate-slide-up bg-white rounded-3xl shadow-xl p-12 text-center mt-8 border border-gray-100">
            <div className="text-6xl mb-4">🎉</div>
            <p className="text-2xl font-bold text-gray-800">All done!</p>
            <p className="text-gray-400 mt-3 leading-relaxed">
              You've rated all the captions. Want more?
            </p>
            <p className="text-gray-500 mt-2 text-sm leading-relaxed">
              Upload any image and our AI will generate funny captions for it. Then you can swipe through and rate each one!
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="mt-6 bg-gradient-to-r from-orange-400 to-pink-500 text-white font-semibold px-6 py-3 rounded-2xl hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              📸 Upload an Image
            </button>
          </div>
        ) : (
          <div key={cardKey} className="animate-slide-up bg-white rounded-3xl shadow-xl overflow-hidden flex flex-col border border-gray-100" style={{ height: '580px' }}>

            {/* Image */}
            <div className="w-full bg-gray-100 flex-shrink-0 relative" style={{ height: '300px' }}>
              <img
                src={post.url}
                alt={post.image_description || 'Image'}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Caption */}
            <div className="px-6 pt-5 pb-2 text-center flex-shrink-0 flex items-center justify-center" style={{ height: '110px', overflow: 'hidden' }}>
              <p className="text-xl font-bold text-gray-800 leading-snug line-clamp-3 italic">
                "{post.content || '(no caption)'}"
              </p>
            </div>

            {/* Vote Buttons with labels */}
            <div className="flex items-center justify-center gap-8 px-6 py-4 flex-shrink-0" style={{ height: '110px' }}>
              <button
                onClick={() => handleVote(post.captionId, -1)}
                disabled={!!votingId}
                className={`flex flex-col items-center justify-center w-32 h-20 rounded-2xl border-2 transition-all hover:scale-105 active:scale-95 ${
                  post.userVote === -1
                    ? 'border-red-300 bg-red-50 text-red-500'
                    : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-red-200 hover:text-red-400 hover:bg-red-50'
                }`}
              >
                <span className="text-2xl">👎</span>
                <span className="text-xs font-semibold mt-1">Not Funny</span>
              </button>

              <button
                onClick={() => handleVote(post.captionId, 1)}
                disabled={!!votingId}
                className={`flex flex-col items-center justify-center w-32 h-20 rounded-2xl border-2 transition-all hover:scale-105 active:scale-95 ${
                  post.userVote === 1
                    ? 'border-green-300 bg-green-50 text-green-600'
                    : 'border-green-200 bg-green-50 text-green-500 hover:border-green-300 hover:bg-green-100 animate-pulse-glow'
                }`}
              >
                <span className="text-2xl">👍</span>
                <span className="text-xs font-semibold mt-1">Funny!</span>
              </button>
            </div>

            {/* Captions left */}
            <div className="text-center pb-4 flex-shrink-0">
              <span className="text-xs font-medium text-gray-400">
                {captionsLeft} caption{captionsLeft !== 1 ? 's' : ''} remaining
              </span>
            </div>

          </div>
        )}

        {/* Upload section — below the card */}
        <div className="mt-6 bg-white/60 backdrop-blur-sm rounded-2xl border border-white/50 p-5 text-center">
          <p className="text-sm text-gray-500 mb-3">
            📸 <strong>Want to add your own?</strong> Upload an image and our AI will generate funny captions for you to rate.
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-gradient-to-r from-orange-400 to-pink-500 text-white px-5 py-2.5 rounded-xl hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? '⏳ Uploading...' : '📸 Upload Image'}
          </button>
        </div>

        {/* Onboarding overlay */}
        {showOnboarding && !done && (
          <div className="absolute inset-0 z-20 flex items-center justify-center px-4" style={{ top: '0' }}>
            <div className="absolute inset-0 bg-black/40 rounded-3xl" onClick={dismissOnboarding} />
            <div className="relative bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full animate-slide-up">
              <div className="text-center">
                <div className="text-4xl mb-3">👋</div>
                <h3 className="text-xl font-bold text-gray-800 mb-3">Welcome!</h3>
                <p className="text-gray-500 leading-relaxed mb-2">
                  Each card shows an image with an <strong>AI-generated caption</strong>.
                </p>
                <div className="flex items-center justify-center gap-6 my-4">
                  <div className="text-center">
                    <div className="text-2xl">👎</div>
                    <p className="text-xs text-gray-400 mt-1">Not funny</p>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl">👍</div>
                    <p className="text-xs text-gray-400 mt-1">Funny!</p>
                  </div>
                </div>
                <p className="text-gray-500 text-sm mb-5">
                  Vote to see the next caption. You can also upload your own images!
                </p>
                <button
                  onClick={dismissOnboarding}
                  className="w-full bg-gradient-to-r from-orange-400 to-pink-500 text-white font-semibold py-3 rounded-2xl hover:shadow-lg transition-all"
                >
                  Got it, let's go!
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
