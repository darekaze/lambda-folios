/* eslint-disable no-console */
import chromium from 'chrome-aws-lambda'
import dayjs from 'dayjs'
import { Storage } from '@google-cloud/storage'
import { Browser, ElementHandle } from 'puppeteer-core'

// Message can be customized
interface HotelReviewEntry {
  url: string
}

//* Note: everything should be in this file
export const scrapeBookingReviews = async (data: HotelReviewEntry) => {
  const storage = new Storage()
  const dateTimeNow = dayjs()
  const today = dateTimeNow.format('YYYY-MM-DD')
  const nextday = dateTimeNow.add(1, 'day').format('YYYY-MM-DD')
  const currency = 'JPY'
  const banned = ['image', 'media', 'font']

  const totalItems = [] // List of data to be output

  let browser: Browser = null

  try {
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless, // default to true in dev, set to false if it's too anoyying
    })

    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36',
    )
    await page.setRequestInterception(true)
    page.on('request', req => (banned.includes(req.resourceType()) ? req.abort() : req.continue()))

    // TODO: format url (add date)
    await page.goto(`${data.url}?selected_currency=${currency}`)

    // TODO: load review section
    await Promise.all([
      page.click('button[data-sb-id="main"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ])

    // TODO: filter to only english
    await Promise.all([
      page.click('#filter_out_of_stock a'),
      page.click('#filter_concise_unit_type a[data-value="Hotels + more"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0' }), // ? can be faster
    ])

    // TODO: Loop through reviews and scrape data
    let nextBtn: ElementHandle = null
    do {
      const res = await page.evaluate(
        async (dateRange: string[], ccy: string) => {
          const items = Array.from<HTMLElement>(
            document.querySelectorAll('#hotellist_inner .sr_item'),
          )

          return Promise.all(
            items.map(async item => {
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

              // FIXME: next line could be problematic (table still needs to be checked i guess)
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
            }),
          )
        },
        [today, nextday],
        currency,
      )
      // Push to list
      totalItems.push(...res)

      // Check and proceed
      nextBtn = await page.$('.bui-pagination__next-arrow a')
      if (nextBtn) {
        await Promise.all([
          nextBtn.click(),
          page.waitForResponse('https://www.booking.com/rack_rates/rr_log_rendered'), // Wait till rendered
        ])
      }
    } while (nextBtn)
  } catch (err) {
    throw new Error(err)
  } finally {
    if (browser !== null) {
      await browser.close()
    }
  }

  // // Output data to cloud / https://googleapis.dev/nodejs/storage/latest/File.html#save
  // const file = storage
  //   .bucket('ag-booking-reviews')
  //   .file(`${dateTimeNow.format('YYYY-MM-DD_HHmm')}_${data.message}.json`) // hotelid here

  // try {
  //   await file.save(JSON.stringify(totalItems, null, 2), {
  //     contentType: 'application/json',
  //     resumable: false,
  //   })
  // } catch (err) {
  //   throw new Error(err)
  // }

  // return console.log(`Complete! File name: ${file.name}`)
}
