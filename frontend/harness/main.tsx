/**
 * Static harness for the review dialog. Renders the dialog markup against
 * fixture data with no auth or API, so the visual result can be checked in a
 * browser without a live backend. Not part of the app bundle.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ApprovalQueueHarness } from './ApprovalQueueHarness';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApprovalQueueHarness />
  </StrictMode>,
);
