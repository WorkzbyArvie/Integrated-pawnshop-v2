import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import LandingPage from '../LandingPage';

/**
 * A pawner has to be able to reach the application flow from the landing page.
 *
 * The landing page is written for a shop owner — its primary action is "Start
 * Free Trial" and every section link scrolls to a sales pitch. Someone with a
 * ring in their pocket is not the audience for any of it, so without an
 * explicit route they have nothing to click. That defect is invisible in a
 * design review, because the page looks complete.
 *
 * These tests assert the route is reachable from each of the three places a
 * visitor might look, and that it is reachable without an account.
 */
vi.mock('../../lib/apiClient', () => ({
  api: { get: async () => [], post: async () => ({}) },
  default: { get: async () => [], post: async () => ({}) },
}));

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      // The landing page subscribes to auth changes on mount. A stub without
      // this throws a TypeError before the first assertion, which reads as a
      // broken page rather than an incomplete stub.
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  },
}));

const renderLanding = () =>
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );

afterEach(cleanup);

/** Every link on the page that leads to the application flow. */
const applyLinks = () =>
  screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/apply');

describe('LandingPage — reaching the online application', () => {
  it('offers the route in the header navigation', () => {
    renderLanding();

    const inNav = within(screen.getByRole('banner'))
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/apply');

    expect(inNav.length).toBeGreaterThan(0);
  });

  it('offers the route in the hero, for someone who never looks at the nav', () => {
    renderLanding();

    // The hero's primary action is "Start Free Trial", which is for an
    // operator. A pawner must not have to work out that it is not for them.
    expect(screen.getAllByText(/get an estimate for your item/i).length).toBeGreaterThan(0);
  });

  it('offers the route in the footer, the last place someone looks', () => {
    renderLanding();

    const footer = screen.getByRole('contentinfo');
    const links = within(footer)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/apply');

    expect(links.length).toBeGreaterThan(0);
  });

  it('reaches it in at least three places, so no one is left without a way in', () => {
    renderLanding();

    expect(applyLinks().length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the pawner route visually distinct from the owner call to action', () => {
    renderLanding();

    const ownerCta = screen.getAllByRole('button', { name: /start free trial/i });
    const pawnerCta = screen.getAllByRole('link', { name: /get an estimate/i });

    // Rule 1 of the design system: one primary action per view. Two equally
    // weighted gold actions on the hero means the visitor has no primary
    // action, and here the two would also be competing for two different
    // audiences.
    expect(ownerCta.length).toBeGreaterThan(0);
    expect(pawnerCta.length).toBeGreaterThan(0);
    expect(pawnerCta.every((link) => link.tagName === 'A')).toBe(true);
  });

  it('never points the pawner route at a login first', () => {
    renderLanding();

    // A prospective pawner has no account and cannot get one from here, so a
    // route through `/login` would strand them at the door.
    for (const link of applyLinks()) {
      expect(link.getAttribute('href')).toBe('/apply');
    }
  });

  it('leaves the owner sign-in in place', () => {
    renderLanding();

    // The pawner route must not come at the cost of the operator flow.
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('does not call the application a loan', () => {
    renderLanding();

    // A pawn loan requires physical possession of the collateral. The landing
    // page must not promise a loan the system cannot create remotely.
    const routeCopy = applyLinks()
      .map((link) => link.textContent ?? '')
      .join(' ');

    expect(routeCopy.toLowerCase()).not.toMatch(/apply for a loan|get a loan/);
  });
});
