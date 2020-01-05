import chromium from 'chrome-aws-lambda'
import { CloudEventsContext } from '@google-cloud/functions-framework'
import { Browser } from 'puppeteer-core'

interface PubSubMessage {
  a: string
  b: number
}

//* Note: everything should be in this file
export const scrapeBookingHotels = async (data: PubSubMessage, context: CloudEventsContext) => {
  const browser: Browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless, // default to true in dev, set to false if it's too anoyying
  })

  const page = await browser.newPage()

  // TODO: setup custom user agent pls
  // TODO: and set interrupt (don't load font and image)

  await page.goto('https://www.booking.com/')

  // Booking.com prevent direct dom manipulation, so we type and click lol
  await page.type('input[name=ss]', 'Tokyo')

  // TODO: make select date dynamic input
  await page.click('.xp__date-time')
  await page.click(`td[data-date="2020-01-06"]`)
  await page.click(`td[data-date="2020-01-07"]`)

  // submit
  await page.click('button[data-sb-id="main"]')

  // Entering new page
  await page.waitForSelector('#hotellist_inner')

  // await page.screenshot({ path: 'sc.png' })

  // TODO: evaluate to input form and go to page
  // await page.evaluate(() => {})

  // Still figuring out the loading component

  await browser.close()

  // https://googleapis.dev/nodejs/storage/latest/File.html#save
  // Disable resumable!!

  console.log(data)
  console.log('Done!')
}
