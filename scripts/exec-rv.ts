import { scrapeBookingReviews } from '../functions/scrape-booking-reviews'

const msg = {
  url: 'https://www.booking.com/hotel/jp/wing-international-shinjuku.html',
}

const data = Buffer.from(JSON.stringify(msg)).toString('base64')
scrapeBookingReviews({
  '@type': 'review-page-test',
  data,
})
