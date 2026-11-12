import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { AppRoutes, Providers } from './App'
import { loadDataSource } from './data'
import { ErrorState, Loading } from './components/States'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(<main className="page-narrow"><Loading label="טוענים את הפורטל…" /></main>)
loadDataSource().then(
  source => root.render(
    // HashRouter: works from any folder of a static host (e.g. GitHub Pages) without server rewrites
    <StrictMode>
      <Providers source={source}>
        <HashRouter><AppRoutes /></HashRouter>
      </Providers>
    </StrictMode>,
  ),
  e => root.render(<main className="page-narrow"><ErrorState title="הפורטל לא הצליח להתחיל" message={(e as Error).message} /></main>),
)
