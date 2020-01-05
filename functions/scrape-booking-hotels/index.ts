import chromium from 'chrome-aws-lambda'
import { CloudEventsContext } from '@google-cloud/functions-framework'
import { Browser } from 'puppeteer'

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
    headless: chromium.headless,
  })

  const page = await browser.newPage()

  await page.goto('https://www.booking.com/')

  await page.screenshot({path: 'screenshot.png'})

  await browser.close()
  console.log(data)
  console.log('Done!')
}
