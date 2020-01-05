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

  await page.goto('https://www.booking.com/')

  // TODO: evaluate to input form and go to page

  await browser.close()
  console.log(data)
  console.log('Done!')
}
