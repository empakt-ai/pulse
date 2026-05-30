// Mashal SPA — Vite entry point.
//
// Load order matters. The pre-Vite SPA worked because the browser
// evaluated the <script type="text/babel" src="..."> tags strictly
// top-to-bottom and let every block share a single global scope. The
// imports below recreate that exact sequence:
//
//   1. React + ReactDOM are pushed to window so any string-eval call
//      site or legacy bare-name reference still resolves.
//   2. The brand stylesheet (Tailwind + custom CSS) lands next so the
//      first React paint already has the right styles.
//   3. utilities.jsx publishes all the shared UI primitives
//      (Card, Btn, Icon, cls, Sparkline, etc.) and the marketing
//      tree (Landing, Hero, Pricing, Footer, ...).
//   4. js/core/* publishes sbAuth, api, D, hydrateD and friends.
//   5. The eight feature modules (billing, ads-intel, referral, team,
//      support, webhooks) register their panel components.
//   6. screens.jsx — the App() root and ReactDOM mount — runs LAST,
//      reading every symbol the previous modules just published.
//
// Adding a new feature module: drop the file under js/<feature>/,
// publish its top-level names via the trailing Object.assign(window, ...)
// trailer (the legacy pattern), and add one `import` line in the same
// position the feature wants in the boot sequence.

import React from 'react';
import ReactDOM from 'react-dom/client';

// Expose React and ReactDOM globally so the legacy bare-name references
// inside screens.jsx (and any future debugging from the console) keep
// working without per-file imports.
window.React = React;
window.ReactDOM = ReactDOM;

import '../styles/app.css';

import './utilities.jsx';

import '../../js/core/auth.jsx';
import '../../js/core/api.jsx';
import '../../js/core/data.jsx';
import '../../js/billing/subscription-banner.jsx';
import '../../js/billing/upgrade-dialog.jsx';
import '../../js/ads-intel/settings-section.jsx';
import '../../js/ads-intel/ads-panels.jsx';
import '../../js/referral/panel.jsx';
import '../../js/team/panel.jsx';
import '../../js/support/panel.jsx';
import '../../js/webhooks/panel.jsx';

import './screens.jsx';
