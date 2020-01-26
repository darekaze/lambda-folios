/* eslint-disable no-console */
import chromium from 'chrome-aws-lambda'
import dayjs from 'dayjs'
import { Storage } from '@google-cloud/storage'
import { Browser, ElementHandle } from 'puppeteer-core'

interface HotelInfo {
  name: string
  address: string
  avg_score: number
  total_review_count: number
  useful_review_count: number
  reviews: HotelReview[]
}

interface HotelReview {
  nationality: string
  score: number
  reviewDate: string
  title: string
  positive: string
  negative: string
  stayedRoom: string
  stayedNight: number
}

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

  let hotelInfo: HotelInfo = null
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
      const name = document.querySelector('#hp_hotel_name').lastChild.textContent.trim()
      const address = document.querySelector('.hp_address_subtitle').textContent.trim()
      const avg_score = +document
        .querySelector('.reviews_panel_header_score .review-score-badge')
        .textContent.trim()
      const total_review_count = +document
        .querySelector('.reviews_panel_header_score .review-score-widget__subtext')
        .textContent.replace(/\D+/g, '')

      return {
        name,
        address,
        avg_score,
        total_review_count,
        useful_review_count: undefined,
        reviews: undefined,
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
            let nationality = 'None'
            const nationInfo = item.querySelector('.c-guest .bui-avatar-block__subtitle')
            if (nationInfo) {
              nationality = nationInfo.textContent.trim()
            }

            const score = +item.querySelector('.c-score').textContent.trim()
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

            // FIXME: error
            let stayedRoom = 'Not provided'
            let stayedNight = 0
            const roomInfo = Array.from<HTMLElement>(
              item.querySelectorAll('.c-review-block__room-info__name'),
            )
            if (roomInfo.length > 1) {
              stayedRoom = roomInfo[0].textContent.replace('Stayed in:', '').trim()
              stayedNight = +roomInfo[1].firstChild.textContent.replace(/\D+/g, '')
            }

            return {
              nationality,
              score,
              reviewDate,
              title,
              positive,
              negative,
              stayedRoom,
              stayedNight,
            }
          }),
        )
      })

      // If contains null (no comments avaliable), end scraping
      isEnd = result.some(value => value === null)

      // Push to list
      allReviews.push(...(result.filter(n => n) as HotelReview[]))

      // Check and proceed
      await page.waitFor(450) // Delay for scrolling effect
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

    // Organize reviews to Json
    hotelInfo.useful_review_count = allReviews.length
    hotelInfo.reviews = allReviews

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
  const sName = hotelInfo.name.replace(/\s\s+/g, '_')
  const file = storage.bucket('ag-booking-reviews').file(`${sDate}_${sName}.json`)

  try {
    await file.save(JSON.stringify(hotelInfo), {
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
