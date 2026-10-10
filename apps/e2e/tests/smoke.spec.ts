import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * One person's journey through the real app, API and database, on a 360px phone screen:
 * register, store a credential and a card, manage lists, back up and restore, log out and in,
 * and be logged out when idle. The tests share state on purpose and run in order.
 */

const USERNAME = `e2e.${Date.now().toString(36)}`
const PASSWORD = 'violet tractor ceiling marathon pebble'
const BACKUP_PASSPHRASE = 'correct horse battery staple'

let context: BrowserContext
let page: Page
let generated = ''
/** Every Content Security Policy violation seen anywhere: pages, the key-derivation worker, frames. */
const violations: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  // Violations in the page arrive as events; those in workers only show up as console errors.
  await context.exposeFunction('__reportCsp', (detail: string) => violations.push(detail))
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      void (window as unknown as { __reportCsp: (d: string) => void }).__reportCsp(
        `${e.violatedDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile ?? 'page'})`,
      )
    })
  })
  context.on('console', (msg) => {
    if (
      /Content Security Policy|Refused to (?:load|execute|connect|create|apply)/i.test(msg.text())
    ) {
      violations.push(msg.text())
    }
  })
  // Replace Cloudflare's captcha script with a stub that passes at once.
  await context.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = {
        render: (_el, o) => { setTimeout(() => o.callback('e2e-token'), 50); return 'w1' },
        remove: () => {},
      }`,
    }),
  )
  page = await context.newPage()
})

// Playwright insists on a destructuring pattern here, even an empty one, so lint is told to allow it.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    await page.screenshot({ path: info.outputPath('failure.png'), fullPage: true })
  }
})

test.afterAll(async () => context.close())

/** Set E2E_SCREENSHOTS=some/folder to save a picture of each screen for a visual check. */
const shot = async (name: string) => {
  const dir = process.env.E2E_SCREENSHOTS
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const noSideScroll = async () =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'page must not scroll sideways at 360px',
  ).toBe(true)

const section = (title: string): Locator =>
  page.locator('section', { has: page.getByRole('heading', { name: title, exact: true }) })

const openMenu = async () => page.getByRole('button', { name: /^Account menu/ }).click()
const menuItem = (name: string | RegExp) => page.getByRole('menuitem', { name })

async function logIn(p: Page) {
  await p.getByRole('button', { name: 'Log in' }).click()
  await p.getByLabel('Username').fill(USERNAME)
  await p.getByLabel('Master password').fill(PASSWORD)
  await p.getByRole('button', { name: 'Log in' }).last().click()
}

test('home page loads and the API is reachable', async () => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Secret Manager', level: 1 })).toBeVisible()
  await expect(page.getByTestId('api-status')).toHaveText('Server: ok')
  await noSideScroll()
})

test('registers, saves the recovery key and lands in the vault', async () => {
  await page.getByRole('button', { name: 'Register' }).click()
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel(/^Master password/).fill(PASSWORD)
  await page.getByLabel('Confirm master password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Continue' }).click()

  const key = (await page.getByTestId('recovery-key').textContent()) ?? ''
  expect(key.length).toBeGreaterThan(20)
  const tail = key.replace(/[^A-Za-z0-9]/g, '').slice(-5)
  await page.getByLabel('Type the last 5 characters to confirm').fill(tail)
  await page.getByLabel('I have saved my recovery key somewhere safe.').check()
  await noSideScroll()
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('combobox', { name: 'Member' }).locator('option:checked')).toHaveText(
    'Self',
  )
  await expect(page.getByText('12 of 1000 items used')).toBeVisible()
  await noSideScroll()
  await shot('01-empty-vault')
})

test('adds a credential with the password generator, then shows and copies it', async () => {
  await page.getByRole('button', { name: 'Add credential' }).click()
  await page.getByRole('combobox', { name: 'Account' }).selectOption({ label: 'Google (Web)' })
  await page.getByLabel('Username').fill('arjun.dev')

  await page.getByText('Generate a strong password').click()
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  generated = ((await page.getByTestId('generated').textContent()) ?? '').trim()
  expect(generated).toHaveLength(20)
  expect(generated).not.toMatch(/[0Oo1lI|]/)
  await page.getByRole('button', { name: 'Use this password' }).click()
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(generated)
  await noSideScroll()
  await shot('02-credential-form')
  await page.getByRole('button', { name: 'Save' }).click()

  const card = page.getByRole('listitem').filter({ hasText: 'arjun.dev' })
  await expect(card).toContainText('Google')
  await expect(card).not.toContainText(generated)
  await shot('03-credential-masked')
  await card.getByRole('button', { name: 'Show Password' }).click()
  await expect(card).toContainText(generated)
  await shot('04-credential-shown')
  await card.getByRole('button', { name: 'Copy Password' }).click()
  await expect(card.getByRole('button', { name: 'Copy Password' })).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generated)
  await noSideScroll()
})

test('adds a card whose number stays masked until shown', async () => {
  await page.getByRole('tab', { name: 'Cards' }).click()
  await page.getByRole('button', { name: 'Add card' }).click()
  await page.getByRole('combobox', { name: 'Bank' }).selectOption({ label: 'Misc' })
  await page.getByLabel('Card name').fill('Travel')
  await page.getByLabel('Name on card').fill('ARJUN DEV')
  await page.getByLabel('Card number').fill('4111 1111 1111 1111')
  await page.getByLabel(/^Expiry/).fill('2030-09')
  await page.getByLabel('CVV').fill('123')
  await noSideScroll()
  await page.getByRole('button', { name: 'Save' }).click()

  const card = page.getByRole('listitem').filter({ hasText: 'Travel' })
  await expect(card).toContainText('xxxx xxxx xxxx 1111')
  await expect(card).not.toContainText('4111 1111')
  await expect(card).toContainText('09/30')
  await card.getByRole('button', { name: 'Show Card number' }).click()
  await expect(card).toContainText('4111 1111 1111 1111')
  await card.getByRole('button', { name: 'Show CVV' }).click()
  await expect(card).toContainText('123')
  await shot('05-card-shown')
})

test('validates forms in plain language', async () => {
  await page.getByRole('button', { name: 'Add card' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Card name is required.')).toBeVisible()
  await expect(page.getByText('Card number must be 8 to 19 digits.')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('manages lists: adds, renames, blocks deleting what is in use, deletes with confirmation', async () => {
  await page.getByRole('button', { name: 'Manage lists' }).click()
  await noSideScroll()
  await shot('06-lists')

  const members = section('Members')
  await members.getByLabel('New member').fill('Mum')
  await members.getByRole('button', { name: 'Add member' }).click()
  await expect(members.getByRole('listitem').filter({ hasText: 'Mum' })).toBeVisible()

  // Self is used by the credential and the card.
  await members
    .getByRole('listitem')
    .filter({ hasText: 'Self' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(members.getByText('Still used by 2 items')).toBeVisible()
  await members.getByRole('button', { name: 'OK' }).click()

  const mum = members.getByRole('listitem').filter({ hasText: 'Mum' })
  await mum.getByRole('button', { name: 'Rename' }).click()
  await members.getByLabel('Rename member').fill('Mother')
  await members.getByRole('button', { name: 'Save' }).click()
  await expect(members.getByRole('listitem').filter({ hasText: 'Mother' })).toBeVisible()

  // Duplicate names are refused.
  await members.getByLabel('New member').fill('self')
  await members.getByRole('button', { name: 'Add member' }).click()
  await expect(members.getByText('That name already exists.')).toBeVisible()

  await members
    .getByRole('listitem')
    .filter({ hasText: 'Mother' })
    .getByRole('button', { name: 'Delete' })
    .click()
  const remove = members.getByRole('button', { name: 'Delete forever' })
  await expect(remove).toBeDisabled()
  await members.getByLabel('Type to confirm').fill('Mother')
  await expect(remove).toBeEnabled()
  await remove.click()
  await expect(members.getByText('Mother')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
})

test('edits a credential', async () => {
  await page.getByRole('tab', { name: 'Credentials' }).click()
  await page
    .getByRole('listitem')
    .filter({ hasText: 'arjun.dev' })
    .getByRole('button', { name: 'Edit' })
    .click()
  await page.getByLabel('Username').fill('arjun.work')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'arjun.work' })).toBeVisible()
  await expect(page.getByText('arjun.dev')).toHaveCount(0)
})

test('backs up, loses a credential, and restores it from the file', async () => {
  await openMenu()
  await menuItem(/Backup/).click()
  await noSideScroll()

  const exportCard = section('Export')
  await exportCard.getByLabel('Backup passphrase').fill(BACKUP_PASSPHRASE)
  await exportCard.getByLabel('Repeat the passphrase').fill(BACKUP_PASSPHRASE)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportCard.getByRole('button', { name: 'Create backup file' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^secret-manager-\d{4}-\d{2}-\d{2}\.smvault$/)
  const file = await download.path()
  expect(readFileSync(file, 'utf8')).not.toContain('arjun')
  await expect(exportCard.getByText('Backup saved with 14 items.')).toBeVisible()

  // Lose the credential.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page
    .getByRole('listitem')
    .filter({ hasText: 'arjun.work' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await page.getByLabel('Type to confirm').fill('arjun.work')
  await page.getByRole('button', { name: 'Delete forever' }).click()
  await expect(page.getByText('Nothing here yet.')).toBeVisible()

  // Restore it.
  await openMenu()
  await menuItem(/Backup/).click()
  const importCard = section('Import')
  await importCard.locator('input[type=file]').setInputFiles(file)
  await importCard.getByLabel('Backup passphrase').fill('definitely the wrong one')
  await importCard.getByRole('button', { name: 'Check file' }).click()
  await expect(importCard.getByText('Wrong passphrase, or the file is damaged.')).toBeVisible()

  await importCard.getByLabel('Backup passphrase').fill(BACKUP_PASSPHRASE)
  await importCard.getByRole('button', { name: 'Check file' }).click()
  await expect(importCard.getByText('Nothing has been changed yet.')).toBeVisible()
  await expect(importCard).toContainText(/1\s*to add \(1 credential, 0 cards, 0 list entries\)/)
  await expect(importCard).toContainText(/13\s*already in your vault/)
  await noSideScroll()
  await shot('07-import-review')
  await importCard.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(importCard.getByText(/Import finished: 1 added/)).toBeVisible()

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'arjun.work' })).toBeVisible()
  await expect(page.getByText('14 of 1000 items used')).toBeVisible()
})

test('a reload locks the vault, and logging in again decrypts everything', async () => {
  await page.reload()
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await expect(page.getByText('arjun.work')).toHaveCount(0)

  await logIn(page)
  await expect(page.getByRole('listitem').filter({ hasText: 'arjun.work' })).toBeVisible()
  await page.getByRole('tab', { name: 'Cards' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'xxxx xxxx xxxx 1111' })).toBeVisible()
})

test('the account menu opens settings and logs out', async () => {
  await openMenu()
  await expect(page.getByText(`Signed in as ${USERNAME}`)).toBeVisible()
  await shot('09-account-menu')
  await menuItem(/Settings/).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await noSideScroll()
  await shot('08-settings')

  await openMenu()
  await page.keyboard.press('Escape')
  await expect(menuItem(/Log out/)).toHaveCount(0)

  await openMenu()
  await menuItem(/Log out/).click()
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Account menu/ })).toHaveCount(0)
})

test('logs out by itself after a period of inactivity', async () => {
  const p = await context.newPage()
  await p.clock.install() // time still flows normally until we jump it
  await p.goto('/')
  await logIn(p)
  await expect(p.getByRole('combobox', { name: 'Member' })).toBeVisible()

  await p.clock.fastForward('06:00') // six minutes with no activity
  await expect(p.getByText('You were logged out after a period of inactivity.')).toBeVisible()
  await expect(p.getByRole('button', { name: 'Log in' })).toBeVisible()
  await p.close()
})

test('no Content Security Policy violations happened anywhere in the journey', () => {
  // Meaningful only against the production build, which carries the real headers.
  test.skip(Boolean(process.env.E2E_DEV), 'The Vite dev server does not send the security headers')
  expect(violations).toEqual([])
})
