/* eslint-disable no-console */
import chromium from 'chrome-aws-lambda'
import dayjs from 'dayjs'
import { Storage } from '@google-cloud/storage'
import { Browser, ElementHandle } from 'puppeteer-core'

type HotelInfo = {
  hotel_name: string
  hotel_address: string
  avg_score: number
  total_review_count: number
  useful_review_count: number
}

type HotelReview = {
  review_date: string
  reviewer_nationality: string
  reviewer_score: number
  title: string
  positive: string
  negative: string
  stayed_room: string
  stayed_night: number
}

type HotelReviewOutput = HotelInfo & HotelReview & { scraped_at: string }

interface PubSubEvent {
  '@type': string
  attribute?: any
  data?: string
}

// Message can be customized
interface HotelReviewEntry {
  url: string
}

//* Note: everything should be in this file
export const scrapeBookingReviews = async (event: PubSubEvent) => {
  const storage = new Storage()
  const dateTimeNow = dayjs()
  const today = dateTimeNow.format('YYYY-MM-DD')
  const nextday = dateTimeNow.add(1, 'day').format('YYYY-MM-DD')
  const currency = 'JPY'
  const banned = ['image', 'media', 'font']

  const data: HotelReviewEntry = JSON.parse(Buffer.from(event.data, 'base64').toString())

  let browser: Browser = null
  let hotelInfo: HotelInfo = null
  let output: HotelReviewOutput[] = null

  try {
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless, // default to false in dev
    })

    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36',
    )
    await page.setRequestInterception(true)
    page.on('request', req => (banned.includes(req.resourceType()) ? req.abort() : req.continue()))

    await page.goto(
      `${data.url}?selected_currency=${currency};checkin=${today};checkout=${nextday}#tab-reviews`,
      { waitUntil: 'networkidle2' },
    )

    // Get basic info
    hotelInfo = await page.evaluate(() => {
      const hotel_name = document.querySelector('#hp_hotel_name').lastChild.textContent.trim()
      const hotel_address = document.querySelector('.hp_address_subtitle').textContent.trim()
      const avg_score = +document
        .querySelector('.reviews_panel_header_score .review-score-badge')
        .textContent.trim()
      const total_review_count = +document
        .querySelector('.reviews_panel_header_score .review-score-widget__subtext')
        .textContent.replace(/\D+/g, '')

      return {
        hotel_name,
        hotel_address,
        avg_score,
        total_review_count,
        useful_review_count: undefined,
      }
    })

    // Filter to only fetch english reviews
    await Promise.all([
      page.$eval('.language_filter input[value="en"]', node => node.parentElement.click()),
      page.waitForResponse(
        res => res.url().includes('/has_seen_review_list') && res.status() === 200,
      ),
    ])

    // Loop through reviews and scrape data
    const allReviews: HotelReview[] = []
    let nextBtn: ElementHandle = null
    let isEnd = true

    do {
      const result: (HotelReview | boolean)[] = await page.evaluate(async () => {
        const reviews = Array.from<HTMLElement>(
          document.querySelectorAll('#review_list_page_container .review_list .c-review-block'),
        )

        return Promise.all(
          reviews.map(async (item: HTMLElement) => {
            // Check whether the review is helpful, and only process helpful review
            const isHelpful = !!item.querySelector('.c-review-block__row--helpful-vote')

            if (!isHelpful) {
              return item
                .querySelector('.c-review__body')
                .textContent.includes('no comments available')
                ? null
                : false
            }

            // Scrape helpful review
            let reviewer_nationality = 'None'
            const nationInfo = item.querySelector('.c-guest .bui-avatar-block__subtitle')
            if (nationInfo) {
              reviewer_nationality = nationInfo.textContent.trim()
            }

            const reviewer_score = +item.querySelector('.c-score').textContent.trim()
            const reviewDate = item
              .querySelector('.c-review-block__date')
              .textContent.replace('Reviewed:', '')
              .trim()
            const title = item.querySelector('.c-review-block__title').textContent.trim()

            let positive = ''
            let negative = ''
            const reviewRows = Array.from<HTMLElement>(item.querySelectorAll('.c-review__row'))
            reviewRows.forEach(row => {
              if (row.querySelector('.c-review__prefix--color-green')) {
                positive = row.querySelector('.c-review__body').textContent
              } else {
                negative = row.querySelector('.c-review__body').textContent
              }
            })

            let stayed_room = 'Not provided'
            let stayed_night = 0
            const roomInfo = Array.from<HTMLElement>(
              item.querySelectorAll('.c-review-block__room-info__name'),
            )
            if (roomInfo.length > 1) {
              stayed_room = roomInfo[0].textContent.replace('Stayed in:', '').trim()
              stayed_night = +roomInfo[1].firstChild.textContent.replace(/\D+/g, '')
            }

            return {
              review_date: new Date(reviewDate).toISOString().slice(0, 10),
              reviewer_nationality,
              reviewer_score,
              title,
              positive,
              negative,
              stayed_room,
              stayed_night,
            }
          }),
        )
      })

      // If contains null (no comments avaliable), end scraping
      isEnd = result.some(value => value === null)

      // Push to list
      allReviews.push(...(result.filter(n => n) as HotelReview[]))

      // Check and proceed
      await page.waitFor(430) // Delay for scrolling effect
      nextBtn = await page.$('#review_list_page_container .bui-pagination__next-arrow a')
      if (nextBtn && !isEnd) {
        await Promise.all([
          nextBtn.click(),
          page.waitForResponse(
            res => res.url().includes('/has_seen_review_list') && res.status() === 200,
          ),
        ])
      }
    } while (!isEnd && nextBtn)

    // Organize reviews to Json output
    hotelInfo.useful_review_count = allReviews.length
    output = allReviews.map<HotelReviewOutput>(review => ({
      ...hotelInfo,
      ...review,
      scraped_at: today,
    }))

    // --error handling--
  } catch (err) {
    return console.error(err)
  } finally {
    if (browser !== null) {
      await browser.close()
    }
  }

  // Output data to cloud / https://googleapis.dev/nodejs/storage/latest/File.html#save
  const sDate = dateTimeNow.format('YYYY-MM-DD_HHmm')
  const sName = hotelInfo.hotel_name.replace(/\s/g, '_')
  const file = storage.bucket('ag-booking-reviews').file(`${sDate}_${sName}.json`)

  try {
    await file.save(JSON.stringify(output), {
      contentType: 'application/json',
      resumable: false,
    })
  } catch (err) {
    return console.error(err)
  }

  return console.log(
    `Review JSON uploaded! File name: ${file.name}, useful review count: ${hotelInfo.useful_review_count}`,
  )
}
