import { Link, Outlet } from 'react-router-dom'

export function Layout() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 flex items-center h-14 gap-6">
          <Link to="/" className="font-semibold text-lg">
            ConfDB Board
          </Link>
          <Link to="/datasets" className="text-gray-600 hover:text-gray-900">
            Datasets
          </Link>
          <Link to="/analyses" className="text-gray-600 hover:text-gray-900">
            Analyses
          </Link>
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
