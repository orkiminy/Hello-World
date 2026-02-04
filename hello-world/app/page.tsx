'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Image = {
  id: string
  url: string
  image_description: string | null
}

export default function Home() {
  const [images, setImages] = useState<Image[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchImages() {
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

    fetchImages()
  }, [])

  if (loading) return <div className="p-8">Loading...</div>
  if (error) return <div className="p-8">Error: {error}</div>

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Image Gallery</h1>
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