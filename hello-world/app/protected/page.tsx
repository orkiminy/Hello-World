'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase-browser'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Image = {
  id: string
  url: string
  image_description: string | null
}

export default function ProtectedPage() {
  const router = useRouter()
  const supabaseClient = createClient()
  const [user, setUser] = useState<any>(null)
  const [images, setImages] = useState<Image[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function checkUserAndFetchImages() {
      // Check authentication
      const { data: { user } } = await supabaseClient.auth.getUser()
      
      if (!user) {
        router.push('/login')
        return
      }
      
      setUser(user)

      // Fetch images
      try {
        const { data, error } = await supabase
          .from('images')
          .select('id, url, image_description')
        
        if (error) {
          setError(error.message)
        } else {
          setImages(data || [])
        }
      } catch (err) {
        setError('Error fetching images')
      } finally {
        setLoading(false)
      }
    }

    checkUserAndFetchImages()
  }, [])

  const handleSignOut = async () => {
    await supabaseClient.auth.signOut()
    router.push('/login')
  }

  if (loading) return <div className="p-8">Loading...</div>
  if (error) return <div className="p-8">Error: {error}</div>

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Image Gallery</h1>
          <p className="text-sm text-gray-600 mt-1">Welcome, {user?.email}!</p>
        </div>
        <button 
          onClick={handleSignOut}
          className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
        >
          Sign Out
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {images.map((image) => (
          <div key={image.id} className="border rounded-lg p-4 shadow">
            <img 
              src={image.url} 
              alt={image.image_description || 'Image'} 
              className="w-full h-48 object-cover rounded mb-2"
            />
            <p className="text-sm text-gray-700">{image.image_description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}