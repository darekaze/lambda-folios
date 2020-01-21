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
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36',
    )
    await page.setRequestInterception(true)
    page.on('request', req => (banned.includes(req.resourceType()) ? req.abort() : req.continue()))

    await page.goto(
      `${data.url}?selected_currency=${currency};checkin=${today};checkout=${nextday}#tab-reviews`,
      { waitUntil: 'networkidle2' },
    )

    // Filter to only fetch english reviews
    await page.$eval('.language_filter input[value="en"]', node => node.parentElement.click())
    await page.waitForSelector('#review_list_page_container', { visible: true })

    // Loop through reviews and scrape data
    let nextBtn: ElementHandle = null
    let isEnd = true

    do {
      const res = await page.evaluate(async () => {
        const reviews = Array.from<HTMLElement>(
          document.querySelectorAll('#review_list_page_container .review_list .c-review-block'),
        )

        return Promise.all(
          reviews.map(async item => {
            // Check whether the review is helpful, only process with helpful review
            const isHelpful = !!item.querySelector('.c-review-block__row--helpful-vote')

            if (!isHelpful) return null

            // Process helpful review // WONTFIX: problematic to use in China
            const nationality = item
              .querySelector('.c-guest .bui-avatar-block__subtitle')
              .lastChild.textContent.trim()
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

            let room = 'Not provided'
            const roomInfo = item.querySelector('.c-review-block__room-info .room_info_heading')
            if (roomInfo) {
              room = roomInfo.textContent.replace('Stayed in:', '').trim()
            }

            return {
              nationality,
              score,
              title,
              positive,
              negative,
              room,
              reviewDate,
            }
          }),
        )
      })

      // If contains null, end scraping
      isEnd = res.some(value => value === null)

      // Push to list
      allReviews.push(...res.filter(n => n))

      // Check and proceed
      await page.waitFor(1000) // TEMP: Scroll cause error, need to find a better way..
      nextBtn = await page.$('#review_list_page_container .bui-pagination__next-arrow a')
      if (nextBtn) {
        await nextBtn.click()
        await page.waitForSelector('#review_list_page_container', { visible: true })
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

  // // Output data to cloud / https://googleapis.dev/nodejs/storage/latest/File.html#save
  // const file = storage
  //   .bucket('ag-booking-reviews')
  //   .file(`${dateTimeNow.format('YYYY-MM-DD_HHmm')}_${data.message}.json`) // hotelid here

  // try {
  //   await file.save(JSON.stringify(allReviews, null, 2), {
  //     contentType: 'application/json',
  //     resumable: false,
  //   })
  // } catch (err) {
  //   return console.error(err)
  // }

  // return console.log(`Complete! File name: ${file.name}`)
  return console.log('Done..')
}
