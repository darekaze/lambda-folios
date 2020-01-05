import { scrapeBookingHotels } from '../functions/scrape-booking-hotels'

scrapeBookingHotels(
  { a: 'asd', b: 12 },
  {
    fail(err: any) {
      console.error(err)
    },
    succeed(res: any) {
      console.log(res)
    },
  },
)
