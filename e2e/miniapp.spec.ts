import { test, expect } from '@playwright/test';

type MockSdkUser = {
  fid: number;
  username: string;
  custodyAddress: string;
  verifiedAddresses: {
    ethereumAddresses: string[];
  };
};

type MockSdk = {
  actions: {
    ready: () => Promise<void>;
    signIn: () => Promise<{ user: MockSdkUser }>;
    openUrl: (url: string) => Promise<void>;
  };
};

test.describe('m00n Cabal Mini App', () => {
  test.beforeEach(async ({ context }) => {
    // Mock the Farcaster SDK
    await context.addInitScript(() => {
      const mockSdk: MockSdk = {
        actions: {
          ready: () => Promise.resolve(),
          signIn: () =>
            Promise.resolve({
              user: {
                fid: 12345,
                username: 'testuser',
                custodyAddress: '0x1234567890123456789012345678901234567890',
                verifiedAddresses: {
                  ethereumAddresses: ['0x1234567890123456789012345678901234567890']
                }
              }
            }),
          openUrl: (url: string) => {
            console.log('Opening URL:', url);
            return Promise.resolve();
          }
        }
      };

      (window as Window & { sdk: MockSdk }).sdk = mockSdk;
    });
  });

  test('should show landing page with sign-in button', async ({ page }) => {
    await page.goto('/miniapp');

    // Check for main elements
    await expect(page.getByText('m00n Cabal Check')).toBeVisible();
    await expect(page.getByText('REVEAL YOUR FATE')).toBeVisible();

    // Check for banner image
    const banner = page.locator('img[alt="m00n Cabal"]');
    await expect(banner).toBeVisible();
  });

  test('should show eligible state for valid address', async ({ page }) => {
    // Mock API response for eligible address
    await page.route('/api/airdrop*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          eligible: true,
          amount: '1000000000'
        })
      });
    });

    await page.route('/api/engagement*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          replyCount: 42,
          isFollowing: true,
          moonpapiFid: 6169
        })
      });
    });

    await page.goto('/miniapp');

    // Click sign in
    await page.getByText('REVEAL YOUR FATE').click();

    // Check for success state
    await expect(page.getByText('WELCOME TO THE CABAL')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('1,000,000,000 $m00n')).toBeVisible();
    await expect(page.getByText('SHARE CAST')).toBeVisible();
    await expect(page.getByText('DOWNLOAD RECEIPT')).toBeVisible();
  });

  test('should show ineligible state for invalid address', async ({ page }) => {
    // Mock API response for ineligible address
    await page.route('/api/airdrop*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          eligible: false
        })
      });
    });

    await page.goto('/miniapp');

    // Click sign in
    await page.getByText('REVEAL YOUR FATE').click();

    // Check for failure state
    await expect(page.getByText('ACCESS DENIED')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('you are not part of the cabal maybe next time')).toBeVisible();
  });

  test('should show engagement tier for eligible user', async ({ page }) => {
    // Mock API responses
    await page.route('/api/airdrop*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          eligible: true,
          amount: '5000000000'
        })
      });
    });

    await page.route('/api/engagement*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          replyCount: 55,
          isFollowing: true,
          moonpapiFid: 6169
        })
      });
    });

    await page.goto('/miniapp');
    await page.getByText('REVEAL YOUR FATE').click();

    // Check for tier display
    await expect(page.getByText('Eclipse Strongbox')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Tier: Cabal Lieutenant')).toBeVisible();
    await expect(page.getByText('Replies: 55')).toBeVisible();
  });
});
