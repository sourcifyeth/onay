// A page with only the card of the simulation step, to share the effects preview (issue #34).
// It shows every case of the card, also the cases that have no request in the mock.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { EffectsPage } from './components/EffectsPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EffectsPage />
  </StrictMode>,
)
