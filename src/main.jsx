import React from 'react';
import ReactDOM from 'react-dom/client';
// Using the generic import and relying on the bundler's default resolution (which requires the file to be correctly named)
import App from './App';

// --- LOCAL FIREBASE CONFIGURATION MAPPING ---
// FIX: Changed 'process.env.VITE_' to 'import.meta.env.VITE_' to correctly access
// environment variables in a modern frontend bundler environment (like Vite).
window.__app_id = import.meta.env.VITE_FIREBASE_PROJECT_ID;

// Construct the Firebase Config object including all necessary fields
window.__firebase_config = JSON.stringify({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

// Since we are running locally, we set this to null,
// which tells App.jsx to use anonymous sign-in instead of a custom token.
window.__initial_auth_token = null;

// You might need to add a basic CSS import here if you didn't create a style sheet yet
// import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
