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

  const allReviews = [] // List of data to be output

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

    // TODO: get basic information first
    // Hotel_name
    // Hotel_Address
    // Average_Score
    // Total review count

    // Filter to only fetch english reviews
    await Promise.all([
      page.$eval('.language_filter input[value="en"]', node => node.parentElement.click()),
      page.waitForResponse(
        res => res.url().includes('/has_seen_review_list') && res.status() === 200,
      ),
    ])

    // Loop through reviews and scrape data
    let nextBtn: ElementHandle = null
    let isEnd = true

    do {
      const result = await page.evaluate(async () => {
        const reviews = Array.from<HTMLElement>(
          document.querySelectorAll('#review_list_page_container .review_list .c-review-block'),
        )

        return Promise.all(
          reviews.map(async (item: HTMLElement) => {
            // Check whether the review is helpful, and only process helpful review
            const isHelpful = !!item.querySelector('.c-review-block__row--helpful-vote')

            if (!isHelpful) return null

            // Scrape helpful review // WONTFIX: problematic to use in China
            const nationality = item
              .querySelector('.c-guest .bui-avatar-block__subtitle')
              .textContent.trim()
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

            let stayedRoom = 'Not provided'
            let stayedNight = 0
            const roomInfo = Array.from<HTMLElement>(
              item.querySelectorAll('.c-review-block__room-info__name'),
            )
            if (roomInfo.length === 2) {
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

      // If contains null, end scraping
      isEnd = result.some(value => value === null)

      // Push to list
      allReviews.push(...result.filter(n => n))

      // Check and proceed
      await page.waitFor(400) // Delay for scrolling effect
      nextBtn = await page.$('#review_list_page_container .bui-pagination__next-arrow a')
      if (nextBtn) {
        await Promise.all([
          nextBtn.click(),
          page.waitForResponse(
            res => res.url().includes('/has_seen_review_list') && res.status() === 200,
          ),
        ])
      }
    } while (!isEnd && nextBtn)
  } catch (err) {
    return console.error(err)
  } finally {
    if (browser !== null) {
      await browser.close()
    }
  }

  console.dir(allReviews) // TEMP

  // TODO: get Useful review count

  // // Output data to cloud / https://googleapis.dev/nodejs/storage/latest/File.html#save
  // const file = storage
  //   .bucket('ag-booking-reviews')
  //   .file(`${dateTimeNow.format('YYYY-MM-DD_HHmm')}_${data.message}.json`) // hotelname with '_'

  // try {
  //   await file.save(JSON.stringify(allReviews), {
  //     contentType: 'application/json',
  //     resumable: false,
  //   })
  // } catch (err) {
  //   return console.error(err)
  // }

  // return console.log(`Complete! File name: ${file.name}`)
  return console.log('Done..')
}
