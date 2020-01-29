/* eslint-disable no-console */
import chromium from 'chrome-aws-lambda'
import dayjs from 'dayjs'
import { Storage } from '@google-cloud/storage'
import { Browser, ElementHandle } from 'puppeteer-core'

interface PubSubEvent {
  '@type': string
  attribute?: any
  data?: string
}

// Message can be customized
interface BookingHotelSearch {
  message: string
}

//* Note: everything should be in this file
export const scrapeBookingHotels = async (event: PubSubEvent) => {
  const bucket = new Storage().bucket('ag-booking-hotels')
  const dateTimeNow = dayjs()
  const today = dateTimeNow.format('YYYY-MM-DD')
  const nextday = dateTimeNow.add(1, 'day').format('YYYY-MM-DD')
  const currency = 'JPY'
  const banned = ['image', 'media', 'font']

  const data: BookingHotelSearch = JSON.parse(Buffer.from(event.data, 'base64').toString())

  let browser: Browser = null
  let pageCounter = 1

  try {
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless, // default to false in dev
    })

    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36',
    )
    await page.setRequestInterception(true)
    page.on('request', req => (banned.includes(req.resourceType()) ? req.abort() : req.continue()))

    await page.goto(`https://www.booking.com/?selected_currency=${currency}`)

    // Booking.com prevent direct dom manipulation, so we type and click lol
    await page.type('input[name=ss]', data.message) // Read from pubsub message
    await page.click('.xp__date-time')
    await page.click(`td[data-date="${today}"]`)
    await page.click(`td[data-date="${nextday}"]`)

    // Submit and wait for new page to load
    await Promise.all([
      page.click('button[data-sb-id="main"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ])

    // Set filters
    await page.click('#filter_out_of_stock a')
    await page.click('#filter_concise_unit_type a[data-value="Hotels + more"]')
    await page.waitForResponse('https://www.booking.com/rack_rates/rr_log_rendered')

    // Loop through pages and scrape data
    const sDate = dateTimeNow.format('YYYY-MM-DD_HHmm')
    const sMessage = data.message.replace(/[^\w\s]/gi, '').replace(/\s/g, '_')
    let nextBtn: ElementHandle = null

    do {
      const res = await page.evaluate(
        async (dateRange: string[], ccy: string) => {
          const items = Array.from<HTMLElement>(
            document.querySelectorAll('#hotellist_inner .sr_item'),
          )

          return Promise.all(
            // Return null for error item
            items.map(async item => {
              try {
                const { dataset } = item

                const hotel_name = item.querySelector('.sr-hotel__name').textContent.trim()
                const urlpath = item.querySelector<HTMLAnchorElement>('a.hotel_name_link').pathname
                const is_partner = !!item.querySelector('.-iconset-thumbs_up_square')
                const location = item
                  .querySelector('.sr_card_address_line a')
                  .firstChild.textContent.trim()

                const review_score = +dataset.score
                const review_count = review_score
                  ? +item.querySelector('.bui-review-score__text').textContent.replace(/\D+/g, '')
                  : 0

                //* Next line could be problematic (might need to check table)
                const roomNode = item.querySelector('div.featuredRooms')
                const featured_room = roomNode.querySelector('.room_link strong').textContent
                const price = +roomNode
                  .querySelector('.bui-price-display__value')
                  .textContent.replace(/\D+/g, '')
                const has_extra = roomNode
                  .querySelector('.prd-taxes-and-fees-under-price')
                  .textContent.includes('Additional')

                return {
                  hotel_id: +dataset.hotelid,
                  stars: +dataset.class,
                  hotel_name,
                  location,
                  is_partner,
                  review_score,
                  review_count,
                  featured_room,
                  currency: ccy,
                  price,
                  has_extra,
                  in_date: dateRange[0],
                  out_date: dateRange[1],
                  url: `https://www.booking.com${urlpath}`,
                }
              } catch (err) {
                console.warn(err)
                return null
              }
            }),
          )
        },
        [today, nextday],
        currency,
      )

      // Output data to cloud / https://googleapis.dev/nodejs/storage/latest/File.html#save
      const file = bucket.file(`${sDate}_${sMessage}_${pageCounter}.json`)

      await file.save(JSON.stringify(res.filter(n => n)), {
        contentType: 'application/json',
        resumable: false,
      })
      console.log(`JSON uploaded! File name: ${file.name}`)
      pageCounter += 1

      // Check and proceed
      nextBtn = await page.$('.bui-pagination__next-arrow a')
      if (nextBtn) {
        await Promise.all([
          nextBtn.click(),
          page.waitForResponse('https://www.booking.com/rack_rates/rr_log_rendered'),
        ])
      }
    } while (nextBtn)
  } catch (err) {
    return console.error(err)
  } finally {
    if (browser !== null) {
      await browser.close()
    }
  }

  return console.log(`All Done!! Total page number: ${pageCounter - 1}`)
}
