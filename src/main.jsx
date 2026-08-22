import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import {ThemeProvider} from './core/ThemeContext.jsx';
import './styles.css';
import './themes.css';
import './branch-branding.css';
import './developer-footer.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider><App /></ThemeProvider></React.StrictMode>);
