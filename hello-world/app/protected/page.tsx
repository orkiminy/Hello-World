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
  userVote: 1 | 0 | -1 | null
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

  const handleVote = async (captionId: string, voteValue: 1 | 0 | -1) => {
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
        <p className="text-gray-500 font-medium">Loading captions...</p>
        <div className="mt-4 flex justify-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-pink-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-purple-50 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-20 -left-20 w-72 h-72 bg-orange-200/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-60 -right-20 w-80 h-80 bg-pink-200/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-20 left-1/3 w-64 h-64 bg-purple-200/15 rounded-full blur-3xl pointer-events-none" />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/70 backdrop-blur-lg border-b border-gray-200/30 px-6 py-3 flex justify-between items-center shadow-sm">
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
          <div className="bg-gradient-to-r from-orange-50 to-pink-50 border border-orange-200 rounded-2xl px-4 py-3 text-sm text-center overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-r from-orange-200/30 via-pink-200/30 to-orange-200/30 animate-shimmer" />
            <span className="relative text-orange-700 font-medium">⏳ {uploadStatus}</span>
            <p className="relative text-orange-400 text-xs mt-1">This may take a few seconds — hang tight!</p>
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
      <div className="max-w-lg mx-auto pt-3 px-4 pb-6 relative">
        {done ? (
          <div className="animate-slide-up rounded-3xl shadow-2xl text-center mt-8 overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-orange-400 via-pink-500 to-purple-500" />
            <div className="bg-white p-12">
              <div className="text-6xl mb-2">🎉</div>
              <div className="flex justify-center gap-2 text-2xl mb-4">
                <span className="animate-float">🥳</span>
                <span className="animate-float-delayed">🎊</span>
                <span className="animate-float-delayed-2">✨</span>
              </div>
              <p className="text-2xl font-extrabold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">All done!</p>
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
          </div>
        ) : (
          <div key={cardKey} className="animate-slide-up rounded-3xl overflow-hidden flex flex-col shadow-2xl" style={{ height: '600px' }}>

            {/* Gradient accent bar at top */}
            <div className="h-1.5 bg-gradient-to-r from-orange-400 via-pink-500 to-purple-500 flex-shrink-0" />

            {/* Image */}
            <div className="w-full bg-gray-100 flex-shrink-0 relative" style={{ height: '300px' }}>
              <img
                src={post.url}
                alt={post.image_description || 'Image'}
                className="w-full h-full object-cover"
              />
              {/* Image overlay gradient for smooth transition to caption */}
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
            </div>

            {/* Caption — speech bubble style */}
            <div className="bg-white px-6 pt-3 pb-2 text-center flex-shrink-0 flex items-center justify-center" style={{ height: '110px', overflow: 'hidden' }}>
              <div className="bg-gradient-to-br from-orange-50 to-pink-50 rounded-2xl px-5 py-3 border border-orange-100 max-w-full">
                <p className="text-lg font-bold text-gray-800 leading-snug line-clamp-3">
                  &ldquo;{post.content || '(no caption)'}&rdquo;
                </p>
              </div>
            </div>

            {/* Vote Buttons */}
            <div className="bg-white flex items-center justify-center gap-3 px-4 py-3 flex-shrink-0" style={{ height: '120px' }}>
              <button
                onClick={() => handleVote(post.captionId, -1)}
                disabled={!!votingId}
                className={`flex flex-col items-center justify-center w-28 h-20 rounded-2xl border-2 transition-all hover:scale-105 active:scale-95 cursor-pointer ${
                  post.userVote === -1
                    ? 'border-red-300 bg-red-50 text-red-500 shadow-md shadow-red-100'
                    : 'border-gray-200 bg-white text-gray-400 hover:border-red-300 hover:text-red-400 hover:bg-red-50 hover:shadow-md hover:shadow-red-100'
                }`}
              >
                <span className="text-2xl">😑</span>
                <span className="text-[10px] font-bold mt-1 uppercase tracking-wide">Not Funny</span>
              </button>

              <button
                onClick={() => handleVote(post.captionId, 0)}
                disabled={!!votingId}
                className={`flex flex-col items-center justify-center w-28 h-20 rounded-2xl border-2 transition-all hover:scale-105 active:scale-95 cursor-pointer ${
                  post.userVote === 0
                    ? 'border-yellow-300 bg-yellow-50 text-yellow-600 shadow-md shadow-yellow-100'
                    : 'border-gray-200 bg-white text-gray-400 hover:border-yellow-300 hover:text-yellow-500 hover:bg-yellow-50 hover:shadow-md hover:shadow-yellow-100'
                }`}
              >
                <span className="text-2xl">😏</span>
                <span className="text-[10px] font-bold mt-1 uppercase tracking-wide">Meh</span>
              </button>

              <button
                onClick={() => handleVote(post.captionId, 1)}
                disabled={!!votingId}
                className={`flex flex-col items-center justify-center w-28 h-20 rounded-2xl border-2 transition-all hover:scale-105 active:scale-95 cursor-pointer ${
                  post.userVote === 1
                    ? 'border-green-300 bg-green-50 text-green-600 shadow-md shadow-green-100'
                    : 'border-gray-200 bg-white text-gray-400 hover:border-green-300 hover:text-green-500 hover:bg-green-50 hover:shadow-md hover:shadow-green-100'
                }`}
              >
                <span className="text-2xl">🤣</span>
                <span className="text-[10px] font-bold mt-1 uppercase tracking-wide">Funny!</span>
              </button>
            </div>

            {/* Captions left */}
            <div className="bg-white text-center pb-4 flex-shrink-0 rounded-b-3xl">
              <span className="text-xs font-medium text-gray-400">
                {captionsLeft} caption{captionsLeft !== 1 ? 's' : ''} remaining
              </span>
            </div>

          </div>
        )}

        {/* Upload section — below the card */}
        <div className="mt-6 bg-white/70 backdrop-blur-sm rounded-2xl border border-white/40 p-6 text-center shadow-lg">
          <div className="text-3xl mb-2">📸</div>
          <p className="text-sm font-semibold text-gray-700 mb-1">Want to add your own?</p>
          <p className="text-xs text-gray-400 mb-4">Upload an image and our AI will generate funny captions for you to rate.</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-gradient-to-r from-orange-400 via-pink-500 to-purple-500 text-white px-6 py-2.5 rounded-xl hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? '⏳ Uploading...' : 'Choose an Image'}
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
                <div className="flex items-center justify-center gap-5 my-4">
                  <div className="text-center">
                    <div className="text-2xl">😑</div>
                    <p className="text-xs text-gray-400 mt-1">Not funny</p>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl">😏</div>
                    <p className="text-xs text-gray-400 mt-1">Meh</p>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl">🤣</div>
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
