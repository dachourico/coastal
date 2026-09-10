import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.addInitScript(() => { if (localStorage.getItem('coastal-google-calendar') === null) localStorage.setItem('coastal-google-calendar', ''); });
  await page.route('https://calendar.google.com/**', route => route.fulfill({body: '<html><body>Google calendar test response</body></html>', contentType: 'text/html'}));
});

test('calendar selection, views, persistence and removal', async ({ page }) => {
  await page.goto('/calendar/');
  await expect(page.locator('#calendar-frame iframe')).toHaveCount(0);
  await page.getByLabel('Google Calendar ID or embed link').fill('https://calendar.google.com/calendar/embed?src=work%40group.calendar.google.com');
  await page.getByRole('button', {name: 'Save calendar'}).click();
  const frame = page.locator('#calendar-frame iframe');
  await expect(frame).toHaveAttribute('src', /mode=MONTH.*src=work%40group.calendar.google.com/);
  await page.getByLabel('View', {exact: true}).selectOption('WEEK');
  await expect(frame).toHaveAttribute('src', /mode=WEEK/);
  await page.reload();
  await expect(frame).toHaveAttribute('src', /src=work%40group.calendar.google.com/);
  await page.getByText('Calendar settings', {exact: true}).click();
  await page.getByRole('button', {name: 'Remove calendar'}).click();
  await page.reload();
  await expect(frame).toHaveCount(0);
});

test('rejects untrusted and secret calendar links', async ({ page }) => {
  await page.goto('/calendar/');
  for (const value of ['https://example.com/calendar/embed?src=work@example.com', 'https://calendar.google.com/calendar/ical/work%40example.com/private-secret/basic.ics', '<iframe src="https://example.com"></iframe>']) {
    await page.getByLabel('Google Calendar ID or embed link').fill(value);
    await page.getByRole('button', {name: 'Save calendar'}).click();
    await expect(page.locator('#status')).toHaveClass('error');
    await expect(page.locator('iframe')).toHaveCount(0);
  }
});

test('calendar navigation is available from tools and supply', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', {name: 'Calendar', exact: true}).click();
  await expect(page).toHaveURL(/\/calendar\/$/);
  await page.getByRole('link', {name: 'Supply', exact: true}).click();
  await page.getByRole('link', {name: 'Calendar', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Work calendar'})).toBeVisible();
});

test('all work calendars and individual rooms are available', async ({ page }) => {
  await page.goto('/calendar/');
  await page.evaluate(() => localStorage.setItem('coastal-google-calendar', 'tjjhdjgtf9gv9aj3lp0udgfn04@group.calendar.google.com,oq1qkt590dklknhphgacp9ubeo@group.calendar.google.com,jkajr2s993fpuns6nt12bn8ngo@group.calendar.google.com,alexdacosta96@gmail.com'));
  await page.reload();
  const frame = page.locator('#calendar-frame iframe');
  expect(new URL(await frame.getAttribute('src')).searchParams.getAll('src')).toHaveLength(4);
  expect(new URL(await frame.getAttribute('src')).searchParams.getAll('color')).toEqual(['#0B8043', '#3F51B5', '#8E24AA', '#D56E0C']);
  await expect(page.locator('#calendar-legend')).toContainText('Service');
  await page.getByLabel('Calendar filter').selectOption('2');
  expect(new URL(await frame.getAttribute('src')).searchParams.getAll('src')).toEqual(['jkajr2s993fpuns6nt12bn8ngo@group.calendar.google.com']);
  await page.getByLabel('Calendar filter').selectOption('all');
  expect(new URL(await frame.getAttribute('src')).searchParams.getAll('src')).toHaveLength(4);
});
