import { test, expect } from '@playwright/test';

// This test assumes the user is already signed in (via storageState in a follow-up
// task or via a `pnpm e2e --headed` interactive run). It validates the projects
// page interactions but not the auth flow.

test.describe('projects page', () => {
  test.skip(!process.env.E2E_AUTHED, 'Skipping until authenticated storageState is configured');

  test('create then delete a project', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name').fill('E2E Test Project');
    await page.getByRole('button', { name: 'Create' }).click();

    // After create, we redirect to /canvas/[id]; assert the canvas header back-link
    // rendered (the Button uses `render={<Link>...}` so the accessible role is `link`).
    await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible();

    await page.getByRole('link', { name: 'Projects' }).click();
    await expect(page.getByText('E2E Test Project')).toBeVisible();

    // Delete via dropdown.
    await page.getByRole('button', { name: 'Project actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('E2E Test Project')).not.toBeVisible();
  });
});
