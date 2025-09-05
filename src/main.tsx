import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Alarms from './alarms/Alarms.tsx'


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Alarms />
  </StrictMode>,
)
