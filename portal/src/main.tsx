import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { AppRoutes, Providers } from './App'
import { createDataSource } from './data'
import { ErrorState } from './components/States'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
let source
try {
  source = createDataSource()
} catch (e) {
  root.render(<main className="page-narrow"><ErrorState title="הפורטל לא הצליח להתחיל" message={(e as Error).message} /></main>)
}
if (source) {
  // HashRouter: works from any folder of a static host (e.g. GitHub Pages) without server rewrites
  root.render(
    <StrictMode>
      <Providers source={source}>
        <HashRouter><AppRoutes /></HashRouter>
      </Providers>
    </StrictMode>,
  )
}
