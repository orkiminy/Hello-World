'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase-browser'
import { useRouter } from 'next/navigation'

export default function Home() {
  const supabase = createClient()
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const checkUserAndRedirect = async () => {
      // Check if user is already logged in
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        // User is already signed in, redirect to protected page
        router.push('/protected')
      } else {
        // User not signed in, trigger Google OAuth
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
          },
        })
        if (error) {
          console.error('Error logging in:', error.message)
          setChecking(false)
        }
      }
    }

    checkUserAndRedirect()
  }, [])

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      fontSize: '18px'
    }}>
      <p>{checking ? 'Checking authentication...' : 'Redirecting to Google sign in...'}</p>
    </div>
  )
}