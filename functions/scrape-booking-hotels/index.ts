import chromium from 'chrome-aws-lambda'
import dayjs from 'dayjs'
import { CloudEventsContext } from '@google-cloud/functions-framework'
import { Browser } from 'puppeteer-core'

interface PubSubMessage {
  a: string
  b: number
}

//* Note: everything should be in this file
export const scrapeBookingHotels = async (data: PubSubMessage, context: CloudEventsContext) => {
  const dateTimeNow = dayjs()
  let browser: Browser = null

  try {
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless, // default to true in dev, set to false if it's too anoyying
    })

    const page = await browser.newPage()

    // TODO: setup custom user agent pls
    // TODO: and set interrupt (don't load font and image)

    await page.goto('https://www.booking.com/?selected_currency=JPY')

    // Booking.com prevent direct dom manipulation, so we type and click lol
    await page.type('input[name=ss]', 'Tokyo') // TODO: dynamic input destination
    await page.click('.xp__date-time')
    await page.click(`td[data-date="${dateTimeNow.format('YYYY-MM-DD')}"]`)
    await page.click(`td[data-date="${dateTimeNow.add(1, 'day').format('YYYY-MM-DD')}"]`)

    // Submit and wait for new page to load
    await Promise.all([
      page.click('button[data-sb-id="main"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ])

    // Set filters
    await Promise.all([
      page.click('#filter_out_of_stock a'),
      page.click('#filter_concise_unit_type a[data-value="Hotels + more"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0' }), // kinda hacky?
    ])

    // TODO: Start scraping (loop should start here)
    const res = await page.evaluate(async () => {
      const items = Array.from<HTMLElement>(document.querySelectorAll('#hotellist_inner .sr_item'))
      const currentDate = new Date()

      return await Promise.all(
        items.map(async item => {
          const { dataset } = item
          return {
            hotelid: parseInt(dataset.hotelid, 10),
            stars: parseInt(dataset.class, 10),
            score: parseFloat(dataset.score),
          }
        }),
      )
    })

    console.dir(res)

    // await page.screenshot({ path: 'sc.png' })
  } catch (err) {
    return context.fail(err)
  } finally {
    if (browser !== null) {
      await browser.close()
    }
  }

  // https://googleapis.dev/nodejs/storage/latest/File.html#save
  // Disable resumable!!

  console.log(data)
  console.log('Done!')

  return context.succeed()
}
