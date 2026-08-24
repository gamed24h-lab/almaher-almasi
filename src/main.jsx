import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import GlobalFeedback from './components/GlobalFeedback.jsx';
import {ThemeProvider} from './core/ThemeContext.jsx';
import {SystemBrandProvider} from './core/SystemBrandContext.jsx';
import './styles.css';
import './themes.css';
import './branch-branding.css';
import './developer-footer.css';
import './modal-feedback.css';
import './feedback.css';
import './ticket-approved.css';
import './ticket-polish.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider><SystemBrandProvider><App/><GlobalFeedback/></SystemBrandProvider></ThemeProvider></React.StrictMode>);