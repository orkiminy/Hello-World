import { createClient } from '@/utils/supabase-server'
import { redirect } from 'next/navigation'

export default async function ProtectedPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Protected Page</h1>
      <p className="mb-4">Welcome, {user.email}!</p>
      <p className="mb-4">This page is only accessible to authenticated users.</p>
      
      <form action="/auth/signout" method="post">
        <button 
          type="submit"
          className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
        >
          Sign Out
        </button>
      </form>
    </div>
  )
}