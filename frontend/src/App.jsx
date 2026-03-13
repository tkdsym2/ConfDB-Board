import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import Home from './pages/Home'
import Datasets from './pages/Datasets'
import DatasetDetail from './pages/DatasetDetail'
import Analyses from './pages/Analyses'
import Sandbox from './pages/Sandbox'
import Feedback from './pages/Feedback'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/datasets', element: <Datasets /> },
      { path: '/datasets/:id', element: <DatasetDetail /> },
      { path: '/analyses', element: <Analyses /> },
      { path: '/sandbox', element: <Sandbox /> },
      { path: '/feedback', element: <Feedback /> },
    ],
  },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
