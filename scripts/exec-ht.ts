import { scrapeBookingHotels } from '../functions/scrape-booking-hotels'

const msg = {
  message: 'Ofuna Station',
}

const data = Buffer.from(JSON.stringify(msg)).toString('base64')
scrapeBookingHotels({
  '@type': 'hotel-list-test',
  data,
})
